/**
 * The browser end of the realtime presence channel.
 *
 * One long-lived WebSocket for the whole session, owned here rather than by
 * a scene: walking into a game cabinet must not tear down and re-handshake
 * the connection, and OverworldScene is destroyed and recreated every time
 * the player leaves and comes back. So the socket lives at module scope
 * (`realtime`, exported at the bottom, same shape as `gameState` and the
 * `api` client) and scenes attach and detach listeners around it.
 *
 * ## Degrading to single-player is a first-class outcome
 *
 * Every failure path here ends in "the game keeps working, you just don't
 * see other people". No throw reaches a caller, no scene waits on a
 * connection, and nothing about betting, balances or progress goes through
 * this socket - so an outage on this channel costs presence and nothing
 * else. That is a deliberate property, not an accident of error handling:
 * multiplayer is a layer on top of a game that was already complete
 * without it, and it must never be able to take that game down.
 *
 * The corollary is that the reconnect loop is quiet. It backs off, it never
 * logs a wall of errors, and it gives up permanently once the player is
 * logged out - a socket that keeps retrying against a cleared token is just
 * a machine arguing with a 401.
 */

import { API_BASE_URL, getToken } from "./client";
import {
  ClientMessage,
  CLOSE_DISPLACED,
  Direction,
  Emote,
  HEARTBEAT_MS,
  PresenceDelta,
  PresencePlayer,
  RoomName,
  ServerMessage,
  TableBet,
  TableColor,
  TableResult,
  TableSnapshot,
  BlackjackSnapshot,
  realtimeUrlFor
} from "./realtimeProtocol";

/**
 * How often the client reports its own position, in ms.
 *
 * Matched to the server's broadcast tick: sending faster than the server
 * forwards only inflates the last-write-wins coalescing the server already
 * does (see presence.ts's drainDeltas), and sending slower makes remote
 * players visibly steppy no matter how good the interpolation is.
 */
export const MOVE_SEND_MS = 100;

/**
 * Reconnect backoff. Starts fast (a dropped socket is usually a blip) and
 * caps well short of a minute so a player who tabs away for a while comes
 * back to a floor that repopulates in seconds rather than staying
 * mysteriously empty.
 */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 20_000;

export type RealtimeStatus = "offline" | "connecting" | "online";

/**
 * What a listener can subscribe to. Deliberately NOT the raw wire messages:
 * `welcome`/`pong` are this module's own bookkeeping, and a scene that had
 * to know about them would be a scene that could get the handshake wrong.
 */
export interface RealtimeEvents {
  /** The full occupant list for the room just entered. Always precedes any join/state for that room. */
  roster: (players: PresencePlayer[]) => void;
  join: (player: PresencePlayer) => void;
  leave: (id: string) => void;
  state: (players: PresenceDelta[]) => void;
  emote: (id: string, emote: Emote) => void;
  appearance: (player: PresencePlayer) => void;
  status: (status: RealtimeStatus) => void;
  /** The live Roulette table's state - on sitting down and on every phase change. */
  table: (snapshot: TableSnapshot) => void;
  /** Somebody got a bet down, between phase changes. */
  tableBet: (roundId: string, bet: TableBet) => void;
  /**
   * The round's settled outcomes. Sent AFTER the server wrote the ledger,
   * so these figures are what balances actually moved by - the scene holds
   * them until its wheel animation finishes rather than showing them early.
   */
  tableResult: (roundId: string, number: number, color: TableColor, results: TableResult[]) => void;
  /**
   * The live Blackjack table's state: on sitting down, on every phase
   * change, and after every player's action. Unlike Roulette there is no
   * separate results message - the snapshot carries each seat's outcome,
   * and the one sent during `payout` is broadcast only after the ledger has
   * been written.
   */
  blackjack: (snapshot: BlackjackSnapshot) => void;
  /**
   * A non-fatal server message aimed at this player - today only
   * `BET_VOIDED`. Separate from the internal handling of `UNAUTHORIZED`,
   * which this module deals with itself.
   */
  notice: (code: string, message: string) => void;
}

type Listener<K extends keyof RealtimeEvents> = RealtimeEvents[K];

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private status: RealtimeStatus = "offline";
  private selfId: string | null = null;

  /**
   * The room this client WANTS to be in. Kept separate from what the server
   * has been told, because the two diverge constantly: the player walks
   * onto the floor while the socket is still connecting, or a reconnect
   * lands while they're inside a game. Re-announced on every successful
   * handshake, which is what makes reconnect-into-the-right-place work
   * without any scene having to notice a reconnect happened.
   */
  private desiredRoom: RoomName | null = null;
  /**
   * Which server the player picked. Held alongside desiredRoom and
   * re-announced together on every handshake: a room only exists inside a
   * server, so a reconnect that named the room alone would be refused.
   */
  private desiredServerId: string | null = null;

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** True once stop() is called - suppresses every reconnect until start() is called again. */
  private stopped = true;

  private lastSent: { x: number; y: number; dir: Direction; moving: boolean } | null = null;
  private lastSentAt = 0;

  private listeners: { [K in keyof RealtimeEvents]: Set<Listener<K>> } = {
    roster: new Set(),
    join: new Set(),
    leave: new Set(),
    state: new Set(),
    emote: new Set(),
    appearance: new Set(),
    status: new Set(),
    table: new Set(),
    tableBet: new Set(),
    tableResult: new Set(),
    blackjack: new Set(),
    notice: new Set()
  };

  /** This player's own presence id, once the handshake has completed. Used to filter yourself out of a broadcast. */
  get id(): string | null {
    return this.selfId;
  }

  get currentStatus(): RealtimeStatus {
    return this.status;
  }

  on<K extends keyof RealtimeEvents>(event: K, listener: Listener<K>): () => void {
    this.listeners[event].add(listener);
    // Returns its own unsubscribe rather than requiring a matching off()
    // call: a Phaser scene's shutdown handler is the one place these must
    // be removed, and handing back a closure means the caller cannot pass
    // the wrong function reference and silently leak the listener across a
    // scene restart.
    return () => {
      this.listeners[event].delete(listener);
    };
  }

  /**
   * Opens the connection if it isn't already open. Safe to call repeatedly
   * (LoginScene calls it after a successful login, and OverworldScene calls
   * it on every create()) - a call while already connected is a no-op.
   */
  start(): void {
    this.stopped = false;
    if (this.socket || this.status === "connecting") return;
    this.openSocket();
  }

  /** Closes the connection and stops reconnecting. Called on logout. */
  stop(): void {
    this.stopped = true;
    this.desiredRoom = null;
    this.desiredServerId = null;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    this.selfId = null;
    this.lastSent = null;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onopen = null;
      try {
        socket.close();
      } catch {
        // Already closing/closed - nothing to do.
      }
    }
    this.setStatus("offline");
  }

  /**
   * Declares which shared space this player is in. `null` means "not
   * anywhere shared" - inside a game screen or their own Player Room.
   *
   * Remembered even when the socket is down, so entering the floor during a
   * reconnect does the right thing once the connection comes back.
   */
  setRoom(room: RoomName | null, serverId: string | null = this.desiredServerId): void {
    this.desiredRoom = room;
    this.desiredServerId = serverId;
    // A fresh room means the movement dedupe below has nothing valid to
    // compare against - without this the first move after re-entering a
    // room can be swallowed as "unchanged", leaving the avatar at its
    // spawn point until the player next turns.
    this.lastSent = null;
    this.send({ t: "room", room, serverId });
  }

  /** Which server this client is on, if any. Read by scenes that need to show or re-enter it. */
  get serverId(): string | null {
    return this.desiredServerId;
  }

  /**
   * Reports the local player's position. Called every frame by
   * OverworldScene; the throttling and dedupe live here rather than at the
   * call site so no scene has to remember to do them.
   *
   * A move is sent when the throttle window has elapsed AND something
   * actually changed - so a player standing still sends nothing at all
   * (the heartbeat, not a stream of identical positions, is what keeps the
   * socket alive).
   */
  sendMove(x: number, y: number, dir: Direction, moving: boolean, now = Date.now()): void {
    if (now - this.lastSentAt < MOVE_SEND_MS) return;

    const previous = this.lastSent;
    const changed =
      !previous ||
      previous.dir !== dir ||
      previous.moving !== moving ||
      Math.abs(previous.x - x) > 0.5 ||
      Math.abs(previous.y - y) > 0.5;
    if (!changed) return;

    this.lastSentAt = now;
    this.lastSent = { x, y, dir, moving };
    this.send({ t: "move", x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, dir, moving });
  }

  sendEmote(emote: Emote): void {
    this.send({ t: "emote", e: emote });
  }

  /** Tells the server to re-read this player's wardrobe and push it to everyone. Call after a buy/equip/unequip. */
  announceAppearance(): void {
    this.send({ t: "appearance" });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private openSocket(): void {
    const token = getToken();
    // No token means nobody is logged in. Not an error and not worth
    // retrying - start() gets called again after a successful login.
    if (!token) {
      this.setStatus("offline");
      return;
    }

    if (typeof WebSocket === "undefined") {
      // No WebSocket in this environment (a test runner, an ancient
      // browser). Single-player, permanently, without a retry loop.
      this.stopped = true;
      this.setStatus("offline");
      return;
    }

    this.setStatus("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(realtimeUrlFor(API_BASE_URL));
    } catch {
      // Constructing the socket can throw outright on a malformed URL or a
      // mixed-content violation. Treated like any other failed attempt.
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      // The first frame must be `hello` - see the server protocol's header
      // for why the token isn't in the URL.
      socket.send(JSON.stringify({ t: "hello", token } satisfies ClientMessage));
    };

    socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    socket.onerror = () => {
      // Browsers give no useful detail here (deliberately - it would be a
      // cross-origin probe), and a `close` always follows, which is where
      // the reconnect is scheduled. Swallowed so a routine dropped socket
      // isn't a red console error on a player's screen.
    };

    socket.onclose = (event) => {
      this.socket = null;
      this.selfId = null;
      this.lastSent = null;
      this.clearHeartbeat();
      this.setStatus("offline");

      if (event.code === CLOSE_DISPLACED) {
        // The same account opened the game elsewhere. Reconnecting would
        // start a fight between two tabs, each displacing the other
        // forever - so this one stays down.
        this.stopped = true;
        return;
      }
      this.scheduleReconnect();
    };
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;

    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }

    switch (message.t) {
      case "welcome":
        this.selfId = message.selfId;
        this.reconnectAttempts = 0;
        this.setStatus("online");
        this.startHeartbeat();
        // Re-announce the room on every handshake, including a reconnect's
        // - see `desiredRoom`.
        if (this.desiredRoom !== null) {
          this.send({ t: "room", room: this.desiredRoom, serverId: this.desiredServerId });
        }
        return;

      case "roster":
        this.emit("roster", message.players);
        return;

      case "join":
        this.emit("join", message.player);
        return;

      case "leave":
        this.emit("leave", message.id);
        return;

      case "state":
        this.emit("state", message.players);
        return;

      case "emote":
        this.emit("emote", message.id, message.e);
        return;

      case "appearance":
        this.emit("appearance", message.player);
        return;

      case "table":
        this.emit("table", message.snapshot);
        return;

      case "tablebet":
        this.emit("tableBet", message.roundId, message.bet);
        return;

      case "blackjack":
        this.emit("blackjack", message.snapshot);
        return;

      case "tableresult":
        this.emit("tableResult", message.roundId, message.number, message.color, message.results);
        return;

      case "pong":
        return;

      case "error":
        if (message.code === "UNAUTHORIZED") {
          // The JWT is bad or expired. The HTTP client's own 401 handler
          // owns sending the player back to the login screen; all this
          // needs to do is stop retrying with a credential that doesn't
          // work.
          this.stopped = true;
          return;
        }
        // Everything else is advisory and aimed at whatever screen the
        // player is looking at - passed on rather than swallowed, since a
        // voided bet is something they need to be told about.
        this.emit("notice", message.code, message.message);
        return;
    }
  }

  private send(message: ClientMessage): void {
    const socket = this.socket;
    // Dropped silently while offline. Position and emotes are both
    // "current moment" facts - a queue that replayed them after a reconnect
    // would teleport an avatar through a path it already walked and fire
    // emotes nobody is standing next to any more.
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // Socket died between the readyState check and the send. The close
      // handler will pick it up.
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => this.send({ t: "ping" }), HEARTBEAT_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;

    // Exponential backoff with jitter. The jitter matters more than usual
    // here: a server restart drops every connected player at the same
    // instant, and without it they would all reconnect in the same
    // millisecond, repeatedly.
    const base = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    const delay = base / 2 + Math.random() * (base / 2);
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.openSocket();
    }, delay);
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", status);
  }

  private emit<K extends keyof RealtimeEvents>(event: K, ...args: Parameters<RealtimeEvents[K]>): void {
    // Copied before iterating: a listener is allowed to unsubscribe itself
    // (a scene shutting down mid-event), and mutating the set during
    // iteration would skip the next listener.
    for (const listener of [...this.listeners[event]]) {
      try {
        (listener as (...a: Parameters<RealtimeEvents[K]>) => void)(...args);
      } catch (err) {
        // One misbehaving listener must not stop the others, and must not
        // take down the socket. Logged because unlike a network failure,
        // this one is a bug in our own code.
        console.error("realtime listener threw", err);
      }
    }
  }
}

/** The session-wide connection. See this file's header for why it isn't owned by a scene. */
export const realtime = new RealtimeClient();
