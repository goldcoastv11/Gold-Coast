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
import { PresenceHub } from "./presence";
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
  ROOM_OVERWORLD,
  ServerMessage,
  TICK_MS,
  decodeClientMessage,
  encode
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
  const hub = new PresenceHub();
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
        await handleRoom(conn, message.room);
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

  async function handleRoom(conn: Connection, room: string | null) {
    const userId = conn.userId;
    if (!userId) return;

    const previous = hub.exit(userId);
    if (previous) broadcast(previous, { t: "leave", id: userId }, userId);

    if (room === null) return; // Left the floor for a game screen or their own room.

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

    const result = hub.enter(ROOM_OVERWORLD, player);
    if (!result.ok) {
      send(conn.socket, { t: "error", code: "ROOM_FULL", message: "The floor is full - try again shortly" });
      return;
    }

    send(conn.socket, { t: "roster", players: hub.room(ROOM_OVERWORLD).roster(userId) });
    broadcast(ROOM_OVERWORLD, { t: "join", player }, userId);
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
   * everyone who moved. Rooms where nobody moved send nothing at all, so an
   * idle floor is free.
   */
  const tickTimer = setInterval(() => {
    for (const { name, room } of hub.activeRooms()) {
      const players = room.drainDeltas();
      if (players.length === 0) continue;
      // Sent to everyone including the players in it: the client filters
      // out its own id (it has `selfId` from `welcome`) rather than the
      // server building a bespoke payload per recipient, which at 10Hz is
      // the difference between one JSON.stringify and one per occupant.
      broadcast(name, { t: "state", players });
    }
  }, TICK_MS);

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

  return {
    wss,
    hub,
    close() {
      clearInterval(tickTimer);
      clearInterval(sweepTimer);
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
