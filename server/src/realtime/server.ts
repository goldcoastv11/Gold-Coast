/**
 * The WebSocket adapter: sockets, timers and auth on one side, the pure
 * room model (realtime/presence.ts) on the other.
 *
 * Read protocol.ts first - it states what this channel is allowed to carry
 * and why position is trusted while emotes are not.
 *
 * ## Shape of a connection's life
 *
 *   open  ->  (unauthenticated, useless, HELLO_TIMEOUT_MS to live)
 *   hello ->  JWT verified, wardrobe read from the DB, `welcome` sent
 *   room  ->  entered the casino floor: gets the roster, others get `join`
 *   move  ->  10Hz, accumulated into the room and flushed by the tick loop
 *   close ->  removed from the room, others get `leave`
 *
 * The socket deliberately survives leaving a room. Walking into a game
 * scene sends `{t:"room", room:null}`, not a disconnect, so coming back out
 * to the floor is instant instead of a fresh handshake and a JWT verify.
 */

import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { verifyToken } from "../auth/jwt";
import { env } from "../env";
import { prisma } from "../db";
import { getEquippedWardrobe } from "../economy/wardrobe";
import { PresenceHub, presenceHub } from "./presence";
import { TableEvent } from "./rouletteTable";
import { BlackjackEvent } from "./blackjackTable";
import { GameServer, gameServers } from "./gameServers";
import { settleTableRound } from "./tableSettlement";
import { settleBlackjackRound } from "./blackjackSettlement";
import {
  EMOTE_RATE_LIMIT_MAX,
  EMOTE_RATE_LIMIT_WINDOW_MS,
  HEARTBEAT_MS,
  HELLO_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  PresencePlayer,
  RATE_LIMIT_MAX_MESSAGES,
  RATE_LIMIT_WINDOW_MS,
  REALTIME_PATH,
  ROOM_BLACKJACK,
  ROOM_OVERWORLD,
  ROOM_ROULETTE,
  RoomName,
  SERVER_CAPACITY,
  ServerMessage,
  TICK_MS,
  decodeClientMessage,
  encode,
  parseRoomKey,
  roomKey
} from "./protocol";

// Defined in protocol.ts (see its comment on why) and re-exported here,
// since this is the module a caller reaches for when wiring up the server.
export { REALTIME_PATH };

/**
 * WebSocket close codes used here. 1008 is the RFC 6455 "policy violation"
 * code; 4000+ is the application-defined range, so a client can tell "you
 * were replaced by your own second tab" from "your token was bad" and only
 * retry the reconnect for one of them.
 */
export const CLOSE_POLICY_VIOLATION = 1008;
export const CLOSE_DISPLACED = 4001;

interface Connection {
  socket: WebSocket;
  /** Set once `hello` succeeds; null before that. Its presence IS the authenticated flag. */
  userId: string | null;
  username: string;
  /** Fixed-window inbound budget, same approach as routes/events.ts's limiter. */
  windowStart: number;
  messagesInWindow: number;
  emoteWindowStart: number;
  emotesInWindow: number;
  lastSeenAt: number;
  helloTimer: NodeJS.Timeout | null;
}

export interface RealtimeHandle {
  wss: WebSocketServer;
  hub: PresenceHub;
  /** Stops the tick/sweep timers and closes every socket. Used by tests and by a graceful shutdown. */
  close(): Promise<void>;
}

/**
 * Attaches the realtime channel to an existing HTTP server.
 *
 * Sharing the HTTP server (rather than listening on a second port) is what
 * lets this work behind Railway's single exposed port and through the same
 * TLS termination the API already gets - a separate port would need its own
 * public route and its own certificate story for no benefit.
 */
export function attachRealtime(server: HttpServer): RealtimeHandle {
  // The module-level hub, not a fresh one: the HTTP game routes read it to
  // work out which server's table a player is sitting at (see
  // presence.ts's locate()).
  const hub = presenceHub;
  hub.clear();
  const connections = new Map<WebSocket, Connection>();
  /** Reverse index so a broadcast can find a player's socket, and so a second tab can displace the first. */
  const byUserId = new Map<string, WebSocket>();

  const allowedOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim());

  const wss = new WebSocketServer({
    server,
    path: REALTIME_PATH,
    /**
     * Origin allow-list, matching the HTTP API's CORS config.
     *
     * The browser does NOT enforce same-origin on WebSockets, so without
     * this any page on the internet could open a socket to this server.
     * That is less severe here than it would be for a cookie-authenticated
     * API - this channel authenticates with a JWT the attacker's page has
     * no way to read, so a hijacked socket is an unauthenticated socket
     * that gets closed in ten seconds - but "the attack fails at the next
     * step" is a poor reason to accept the connection at all.
     *
     * A missing Origin (a non-browser client: the test suite, a CLI probe)
     * is allowed through, since the header is browser-supplied and its
     * absence means the same-origin question doesn't arise.
     */
    verifyClient: ({ origin }, done) => {
      if (!origin || allowedOrigins.includes(origin)) return done(true);
      return done(false, 403, "Origin not allowed");
    }
  });

  wss.on("connection", (socket: WebSocket) => {
    const conn: Connection = {
      socket,
      userId: null,
      username: "",
      windowStart: Date.now(),
      messagesInWindow: 0,
      emoteWindowStart: Date.now(),
      emotesInWindow: 0,
      lastSeenAt: Date.now(),
      helloTimer: null
    };
    connections.set(socket, conn);

    // An unauthenticated socket is holding resources on behalf of nobody -
    // give it a short, hard deadline to say who it is.
    conn.helloTimer = setTimeout(() => {
      if (!conn.userId) {
        send(socket, { t: "error", code: "UNAUTHORIZED", message: "No hello frame" });
        socket.close(CLOSE_POLICY_VIOLATION, "No hello");
      }
    }, HELLO_TIMEOUT_MS);

    socket.on("message", (raw: RawData) => {
      void handleMessage(conn, raw);
    });

    socket.on("close", () => {
      cleanup(conn);
    });

    socket.on("error", () => {
      // `ws` emits this for transport-level failures (a reset connection, a
      // malformed frame). Nothing to do but drop the socket - a `close`
      // follows, which is where the room cleanup lives.
      cleanup(conn);
    });
  });

  async function handleMessage(conn: Connection, raw: RawData) {
    conn.lastSeenAt = Date.now();

    if (!withinRateLimit(conn)) {
      send(conn.socket, { t: "error", code: "RATE_LIMITED", message: "Too many messages" });
      conn.socket.close(CLOSE_POLICY_VIOLATION, "Rate limited");
      return;
    }

    const message = decodeClientMessage(typeof raw === "string" ? raw : raw.toString());
    if (!message) {
      // Advisory, not fatal: a client one version ahead may send a message
      // type this build doesn't know, and disconnecting it would turn a
      // harmless forward-compatibility gap into an outage for that player.
      send(conn.socket, { t: "error", code: "BAD_MESSAGE", message: "Unrecognised message" });
      return;
    }

    if (message.t === "hello") {
      await handleHello(conn, message.token);
      return;
    }

    // Everything below requires an authenticated socket. No partial
    // capability before `hello` - an unauthenticated socket can do exactly
    // one thing, and this is the single place that is enforced.
    if (!conn.userId) {
      send(conn.socket, { t: "error", code: "UNAUTHORIZED", message: "Send hello first" });
      conn.socket.close(CLOSE_POLICY_VIOLATION, "Not authenticated");
      return;
    }

    switch (message.t) {
      case "ping":
        send(conn.socket, { t: "pong" });
        return;

      case "room":
        await handleRoom(conn, message.room, message.serverId ?? null);
        return;

      case "move": {
        const roomName = hub.roomNameFor(conn.userId);
        if (!roomName) return; // Not in a shared space - nothing to update, nobody to tell.
        hub.room(roomName).move(conn.userId, message.x, message.y, message.dir, message.moving);
        return;
      }

      case "emote": {
        if (!withinEmoteRateLimit(conn)) {
          send(conn.socket, { t: "error", code: "EMOTE_RATE_LIMITED", message: "Slow down" });
          return;
        }
        const roomName = hub.roomNameFor(conn.userId);
        if (!roomName) return;
        // Echoed to the sender too, so their own emote is drawn by the same
        // code path that draws everyone else's rather than a local special
        // case that can drift from it.
        broadcast(roomName, { t: "emote", id: conn.userId, e: message.e });
        return;
      }

      case "appearance": {
        const roomName = hub.roomNameFor(conn.userId);
        if (!roomName) return;
        const wardrobe = await readWardrobe(conn.userId);
        const occupant = hub.room(roomName).setWardrobe(conn.userId, wardrobe);
        if (!occupant) return;
        broadcast(roomName, {
          t: "appearance",
          player: {
            id: occupant.id,
            username: occupant.username,
            x: occupant.x,
            y: occupant.y,
            dir: occupant.dir,
            moving: occupant.moving,
            wardrobe: occupant.wardrobe
          }
        });
        return;
      }
    }
  }

  async function handleHello(conn: Connection, token: string) {
    if (conn.userId) return; // Already authenticated; a second hello is a no-op, not a re-auth.

    let userId: string;
    let username: string;
    try {
      const payload = verifyToken(token);
      userId = payload.sub;
      username = payload.username;
    } catch {
      send(conn.socket, { t: "error", code: "UNAUTHORIZED", message: "Invalid or expired token" });
      conn.socket.close(CLOSE_POLICY_VIOLATION, "Bad token");
      return;
    }

    // Second tab wins. See presence.ts's header for why presence is keyed
    // by account rather than by connection.
    const existing = byUserId.get(userId);
    if (existing && existing !== conn.socket) {
      send(existing, { t: "error", code: "DISPLACED", message: "Signed in from another tab" });
      existing.close(CLOSE_DISPLACED, "Displaced");
    }

    conn.userId = userId;
    conn.username = username;
    byUserId.set(userId, conn.socket);
    if (conn.helloTimer) {
      clearTimeout(conn.helloTimer);
      conn.helloTimer = null;
    }

    send(conn.socket, { t: "welcome", selfId: userId, tickMs: TICK_MS, heartbeatMs: HEARTBEAT_MS });
  }

  async function handleRoom(conn: Connection, room: RoomName | null, serverId: string | null) {
    const userId = conn.userId;
    if (!userId) return;

    const previousKey = hub.exit(userId);
    const previous = previousKey ? parseRoomKey(previousKey) : null;
    // Only the casino floor draws avatars, so only the casino floor needs to
    // be told someone stopped standing in it.
    if (previousKey && previous?.room === ROOM_OVERWORLD) {
      broadcast(previousKey, { t: "leave", id: userId }, userId);
    }

    if (room === null) return; // Left for a solo game screen, their own room, or the server browser.

    // A room only exists inside a server. Rejecting rather than defaulting:
    // silently dropping a player onto some arbitrary server is far more
    // confusing than being told to pick one.
    if (!serverId) {
      send(conn.socket, { t: "error", code: "NO_SERVER", message: "Pick a server first" });
      return;
    }

    const server = gameServers.get(serverId);
    if (!server) {
      // A private server that was reaped, or a stale id from an old tab.
      send(conn.socket, { t: "error", code: "SERVER_GONE", message: "That server no longer exists" });
      return;
    }

    if (hub.occupancy(serverId) >= SERVER_CAPACITY) {
      send(conn.socket, { t: "error", code: "SERVER_FULL", message: "That server is full - try another" });
      return;
    }

    // Tables only run while somebody is here (see the registry's
    // ensureTablesRunning) - this is where "somebody" starts being true.
    gameServers.ensureTablesRunning(server);

    const key = roomKey(serverId, room);

    if (room === ROOM_ROULETTE || room === ROOM_BLACKJACK) {
      // Sitting down at a table. No avatar, no roster, no positions - these
      // rooms exist only so "tell everyone at this table" reuses the same
      // fan-out as "tell everyone on this floor" (see protocol.ts). Who is
      // at the table is conveyed by the bets and seats on it.
      hub.enter(key, seatedPlaceholder(userId, conn.username));
      send(
        conn.socket,
        room === ROOM_ROULETTE
          ? { t: "table", snapshot: server.roulette.snapshot() }
          : { t: "blackjack", snapshot: server.blackjack.snapshot() }
      );
      return;
    }

    const wardrobe = await readWardrobe(userId);
    // The socket may have closed while that DB read was in flight.
    if (conn.socket.readyState !== WebSocket.OPEN) return;

    const player: PresencePlayer = {
      id: userId,
      username: conn.username,
      // Spawn at the map's centre-ish default until the client's first
      // `move` lands, which is within one frame of entering the floor.
      // Deliberately not persisted-last-position: that is the client's own
      // restore concern (GET /me), and reading it here would make entering
      // a room a second database round-trip for a value overwritten
      // milliseconds later.
      x: 40 * 16,
      y: 46 * 16,
      dir: "down",
      moving: false,
      wardrobe
    };

    const result = hub.enter(key, player);
    if (!result.ok) {
      send(conn.socket, { t: "error", code: "ROOM_FULL", message: "The floor is full - try again shortly" });
      return;
    }

    send(conn.socket, { t: "roster", players: hub.room(key).roster(userId) });
    broadcast(key, { t: "join", player }, userId);
  }

  /**
   * Reads a player's equipped wardrobe.
   *
   * Failure is swallowed to an empty map rather than propagated: the client
   * resolves a missing BODY to the free default piece (see
   * src/wardrobeCatalog.ts's resolveLayers), so a database hiccup costs the
   * player their hat for a moment instead of costing them presence
   * entirely.
   */
  async function readWardrobe(userId: string): Promise<Record<string, string>> {
    try {
      return (await getEquippedWardrobe(prisma, userId)) as Record<string, string>;
    } catch {
      return {};
    }
  }

  function broadcast(roomName: string, message: ServerMessage, exceptUserId?: string) {
    const room = hub.room(roomName);
    const payload = encode(message);
    for (const id of room.ids()) {
      if (id === exceptUserId) continue;
      const socket = byUserId.get(id);
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  /**
   * The heartbeat of the whole channel: once every TICK_MS, each room sends
   * everyone who moved, and the Roulette table's round loop is advanced.
   * Rooms where nobody moved send nothing at all, so an idle floor is free.
   *
   * The table shares this tick rather than owning a timer: it needs a clock
   * with roughly 100ms resolution against phases measured in seconds, which
   * is exactly what is already running.
   */
  const tickTimer = setInterval(() => {
    for (const { name, room } of hub.activeRooms()) {
      // Table rooms hold no avatars, so they never have movement to send -
      // skipped explicitly rather than relying on them happening to be
      // empty.
      const parsed = parseRoomKey(name);
      if (!parsed || parsed.room !== ROOM_OVERWORLD) continue;
      const players = room.drainDeltas();
      if (players.length === 0) continue;
      // Sent to everyone including the players in it: the client filters
      // out its own id (it has `selfId` from `welcome`) rather than the
      // server building a bespoke payload per recipient, which at 10Hz is
      // the difference between one JSON.stringify and one per occupant.
      broadcast(name, { t: "state", players });
    }

    // Every server runs its own wheel and its own table. A server nobody is
    // in has both stopped (see the registry's sweep), so `advance()` on it
    // is a no-op rather than a round dealt to an empty room.
    for (const server of gameServers.all()) {
      for (const event of server.roulette.advance()) {
        void handleTableEvent(server, event);
      }
      for (const event of server.blackjack.advance()) {
        void handleBlackjackEvent(server, event);
      }
    }

    gameServers.sweep((id) => hub.occupancy(id));
  }, TICK_MS);

  /**
   * Turns one round-loop event into broadcasts and, for a settle, ledger
   * writes.
   *
   * This is the only place in the realtime layer that touches money, and it
   * does so through `settleSingleShotBet` - the same helper every one of the
   * 14 solo games funnels through, so a live-table round lands in the ledger
   * as the same shape as a solo one and counts toward challenges and XP
   * identically. Nothing bespoke about the currency wiring exists here.
   */
  async function handleTableEvent(server: GameServer, event: TableEvent): Promise<void> {
    const key = roomKey(server.id, ROOM_ROULETTE);

    if (event.kind === "phase") {
      broadcast(key, { t: "table", snapshot: event.snapshot });
      return;
    }

    const { voidedUserIds, settled } = await settleTableRound(
      event.roundId,
      event.number,
      event.results
    );

    if (voidedUserIds.length > 0) {
      server.roulette.markVoided(event.roundId, voidedUserIds);
      notifyVoided(voidedUserIds, "Your bet was voided - it couldn't be settled when the wheel stopped");
    }

    // Broadcast AFTER settling, so the numbers a player reads here are the
    // ones their balance actually moved by.
    broadcast(key, {
      t: "tableresult",
      roundId: event.roundId,
      number: event.number,
      color: event.color,
      results: settled
    });
  }

  /**
   * The Blackjack equivalent. Simpler on the wire than Roulette's because
   * the snapshot already carries every seat's outcome - there is no separate
   * "results" message, just a snapshot broadcast after the ledger is
   * written.
   */
  async function handleBlackjackEvent(server: GameServer, event: BlackjackEvent): Promise<void> {
    const key = roomKey(server.id, ROOM_BLACKJACK);

    if (event.kind === "phase") {
      broadcast(key, { t: "blackjack", snapshot: event.snapshot });
      return;
    }

    const { voidedUserIds } = await settleBlackjackRound(event.roundId, event.seats);

    if (voidedUserIds.length > 0) {
      server.blackjack.markVoided(event.roundId, voidedUserIds);
      notifyVoided(voidedUserIds, "Your hand was voided - it couldn't be settled when the round ended");
    }

    // Re-snapshot AFTER settling (and after any voiding), so what a player
    // reads is what their balance actually did.
    broadcast(key, { t: "blackjack", snapshot: server.blackjack.snapshot() });
  }

  /** Tells individual players their bet didn't stand. Not broadcast - that is between them and the table. */
  function notifyVoided(userIds: string[], message: string): void {
    for (const userId of userIds) {
      const socket = byUserId.get(userId);
      if (socket) send(socket, { t: "error", code: "BET_VOIDED", message });
    }
  }

  /**
   * Reaps sockets that have gone quiet. A live client pings every
   * HEARTBEAT_MS, so silence past IDLE_TIMEOUT_MS means a connection that
   * died without a close frame - half-open TCP through a phone changing
   * networks, typically, which `ws` alone will happily hold open forever.
   */
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const conn of connections.values()) {
      if (now - conn.lastSeenAt > IDLE_TIMEOUT_MS) {
        conn.socket.close(CLOSE_POLICY_VIOLATION, "Idle");
      }
    }
  }, IDLE_TIMEOUT_MS / 2);

  function cleanup(conn: Connection) {
    if (conn.helloTimer) {
      clearTimeout(conn.helloTimer);
      conn.helloTimer = null;
    }
    connections.delete(conn.socket);

    const userId = conn.userId;
    if (!userId) return;

    // Only clear the reverse index if it still points at THIS socket - a
    // displaced first tab closes after the second has already claimed the
    // entry, and deleting unconditionally would unregister the live one.
    if (byUserId.get(userId) === conn.socket) {
      byUserId.delete(userId);
      const roomName = hub.exit(userId);
      if (roomName) broadcast(roomName, { t: "leave", id: userId });
    }
  }

  // Tables only run while the realtime channel is up AND somebody is on
  // that server (see the registry's ensureTablesRunning/sweep). If this
  // attach ever fails, every table's `running` stays false and the HTTP bet
  // routes refuse cleanly - rather than taking stakes for a wheel that will
  // never spin.
  //
  // Registered with the REGISTRY rather than with each table, so servers
  // created later - every private one - are wired up as they are born. See
  // gameServers.ts's TableBroadcaster for why subscribing once at startup
  // is a trap.
  gameServers.setBroadcaster({
    bet(serverId, roundId, bet) {
      broadcast(roomKey(serverId, ROOM_ROULETTE), { t: "tablebet", roundId, bet });
    },
    seat(serverId) {
      // The whole snapshot rather than just the new seat: a blackjack seat
      // is only meaningful next to the rest of the table (who else is in,
      // whose turn it will be), and the payload is small.
      const server = gameServers.get(serverId);
      if (!server) return;
      broadcast(roomKey(serverId, ROOM_BLACKJACK), {
        t: "blackjack",
        snapshot: server.blackjack.snapshot()
      });
    }
  });

  return {
    wss,
    hub,
    close() {
      clearInterval(tickTimer);
      clearInterval(sweepTimer);
      gameServers.setBroadcaster(null);
      for (const server of gameServers.all()) {
        server.roulette.stop();
        server.blackjack.stop();
      }
      hub.clear();
      for (const conn of connections.values()) {
        if (conn.helloTimer) clearTimeout(conn.helloTimer);
        conn.socket.terminate();
      }
      connections.clear();
      byUserId.clear();
      return new Promise((resolve) => wss.close(() => resolve()));
    }
  };
}

/**
 * A presence entry for someone sitting at a table rather than standing on
 * the floor.
 *
 * The position and wardrobe fields are inert here - nothing draws a table's
 * occupants as avatars (see handleRoom). They exist because the hub is a
 * presence hub, and reusing it for the table's fan-out is worth more than a
 * second, near-identical "who is in this room" structure would be.
 */
function seatedPlaceholder(userId: string, username: string): PresencePlayer {
  return { id: userId, username, x: 0, y: 0, dir: "down", moving: false, wardrobe: {} };
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(encode(message));
}

function withinRateLimit(conn: Connection, now = Date.now()): boolean {
  if (now - conn.windowStart >= RATE_LIMIT_WINDOW_MS) {
    conn.windowStart = now;
    conn.messagesInWindow = 1;
    return true;
  }
  conn.messagesInWindow += 1;
  return conn.messagesInWindow <= RATE_LIMIT_MAX_MESSAGES;
}

function withinEmoteRateLimit(conn: Connection, now = Date.now()): boolean {
  if (now - conn.emoteWindowStart >= EMOTE_RATE_LIMIT_WINDOW_MS) {
    conn.emoteWindowStart = now;
    conn.emotesInWindow = 1;
    return true;
  }
  conn.emotesInWindow += 1;
  return conn.emotesInWindow <= EMOTE_RATE_LIMIT_MAX;
}
