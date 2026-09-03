/**
 * The wire format for the realtime (WebSocket) channel, defined once here
 * and imported by both the socket adapter (realtime/server.ts) and the
 * pure room logic (realtime/presence.ts).
 *
 * ## What this channel is, and what it deliberately is NOT
 *
 * It carries PRESENCE ONLY: where other players are standing on the casino
 * floor, which way they face, and the occasional emote. That's the whole
 * remit, and the boundary matters more than anything else in this file.
 *
 * Nothing here moves money, grants an item, records progress, or settles a
 * round. Every one of those still goes over the authenticated HTTP API,
 * server-authoritative, exactly as before. The consequence is the security
 * property this design leans on: **position is client-reported, and that is
 * fine, because a forged position moves a cosmetic avatar and nothing
 * else.** A player who patches their client to teleport across the floor
 * has cheated at standing in a place. They cannot reach a balance, a bet,
 * or another player's account from here.
 *
 * That is why `move` is trusted after only clamping, while an emote (which
 * is visible text-shaped content, seen by strangers) gets a closed
 * vocabulary rather than a free string. If a future message on this channel
 * ever DOES touch state that matters, it must not inherit this trust -
 * settle it through the HTTP API and let this channel only announce it.
 *
 * ## Why the token arrives in a `hello` frame, not the URL
 *
 * A browser cannot set an Authorization header on a WebSocket handshake, so
 * the usual workarounds are `?token=<jwt>` or a subprotocol hack. A query
 * string is the wrong place for a credential: it lands in access logs,
 * proxy logs, and `Referer` headers, none of which are supposed to hold a
 * bearer token. So the socket opens unauthenticated and useless, and the
 * client's FIRST frame must be `hello` carrying the JWT. Anything else
 * before it, or nothing at all within HELLO_TIMEOUT_MS, closes the socket.
 */

import { z } from "zod";

/**
 * The path clients connect to. Kept off `/` so a stray browser hitting the
 * API root isn't an upgrade attempt.
 *
 * Lives in this file rather than next to the WebSocket server it configures
 * so that the client's agreement test can check it without importing
 * realtime/server.ts - which pulls in env validation and a Prisma client,
 * neither of which exist in a browser-side unit test.
 */
export const REALTIME_PATH = "/realtime";

/** Overworld dimensions, mirroring src/scenes/OverworldScene.ts's MAP_COLS/MAP_ROWS/TILE. */
export const TILE = 16;
export const MAP_COLS = 80;
export const MAP_ROWS = 56;
export const WORLD_WIDTH = MAP_COLS * TILE;
export const WORLD_HEIGHT = MAP_ROWS * TILE;

/**
 * How long a freshly-opened socket may stay silent before it is closed.
 * Short on purpose: an unauthenticated socket is an object this process is
 * holding on behalf of nobody.
 */
export const HELLO_TIMEOUT_MS = 10_000;

/** Server broadcast rate. 10Hz - the client interpolates between ticks (see src/scenes/overworld/RemotePlayers.ts), so this is smooth without being chatty. */
export const TICK_MS = 100;

/**
 * A socket that has sent nothing at all for this long is considered gone
 * and closed. Longer than any client's own heartbeat interval, so a player
 * standing perfectly still is never mistaken for a dead connection - the
 * client pings on a timer precisely so that idling is not a disconnect.
 */
export const IDLE_TIMEOUT_MS = 60_000;

/** Client heartbeat interval the client is expected to use, comfortably inside IDLE_TIMEOUT_MS. */
export const HEARTBEAT_MS = 20_000;

/**
 * Per-socket inbound message budget, fixed window. Sized off what a
 * legitimate client actually sends: moves at ~10Hz (see MOVE_SEND_MS on the
 * client) plus heartbeats and the occasional emote, so ~600/minute is the
 * honest ceiling and this is roughly 3x headroom over it.
 */
export const RATE_LIMIT_MAX_MESSAGES = 1800;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Emotes are the one thing here other players read as communication, so they get their own, much tighter budget. */
export const EMOTE_RATE_LIMIT_MAX = 10;
export const EMOTE_RATE_LIMIT_WINDOW_MS = 30_000;

/** Hard cap on how many players one room broadcasts. Beyond this a join is refused rather than degrading everyone's frame rate. */
export const MAX_ROOM_OCCUPANTS = 60;

/**
 * The closed emote vocabulary.
 *
 * Founder decision (2026-09-02): emotes, not free-text chat. Nothing a
 * player types reaches another player's screen, which is why this channel
 * needs no profanity filter, no moderation queue, and no user-generated-
 * content retention story on a social-casino product. Adding a free-text
 * message type here is not a small change - it is that whole decision
 * being reversed, and it needs the founder, not a follow-up PR.
 */
export const EMOTES = ["wave", "cheer", "laugh", "cry", "thumbsup", "shock", "heart", "gg"] as const;
export type Emote = (typeof EMOTES)[number];

/** The four cardinal facings the character rigs draw. Mirrors OverworldScene's `lastDir`. */
export const DIRECTIONS = ["down", "left", "right", "up"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * Which shared space a socket is present in. Only the casino floor is
 * shared today: a Player Room is by definition one player's own space, and
 * a game scene is a single-player screen, so both report as `null` - the
 * socket stays connected (so re-entering the floor is instant) but the
 * player is not broadcast to anyone and receives no broadcasts.
 *
 * `null` rather than dropping the socket, and a string rather than a
 * boolean, because the shared Roulette table is the next room to exist.
 */
export const ROOM_OVERWORLD = "overworld";

/**
 * The live Roulette table (see realtime/rouletteTable.ts). A second shared
 * room, and the reason `room` is a string rather than an "am I on the floor"
 * boolean.
 *
 * Unlike the floor, this room's occupants do not send positions - it is a
 * screen, not a place you walk around - so nothing on it is drawn from
 * presence. It uses the same room mechanism purely for the fan-out: "tell
 * everyone sitting at this table" is the same problem as "tell everyone on
 * this floor", and one broadcast path is better than two.
 */
export const ROOM_ROULETTE = "roulette";

/** Every shared room a client may ask to enter. */
export const ROOMS = [ROOM_OVERWORLD, ROOM_ROULETTE] as const;
export type RoomName = (typeof ROOMS)[number];

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

const HelloSchema = z.object({
  t: z.literal("hello"),
  token: z.string().min(1).max(4096)
});

const MoveSchema = z.object({
  t: z.literal("move"),
  // Finite-checked here and CLAMPED to the map in presence.ts - a bad value
  // must not be able to park an avatar at Infinity, which renders as a
  // sprite that vanishes rather than an obvious error.
  x: z.number().finite(),
  y: z.number().finite(),
  dir: z.enum(DIRECTIONS),
  moving: z.boolean()
});

const EmoteSchema = z.object({
  t: z.literal("emote"),
  e: z.enum(EMOTES)
});

/** Announces which shared room this socket is in; see ROOM_OVERWORLD/ROOM_ROULETTE. `null` means "not in a shared space". */
const RoomSchema = z.object({
  t: z.literal("room"),
  room: z.union([z.enum(ROOMS), z.null()])
});

/** Heartbeat. Exists so standing still isn't indistinguishable from a dead socket - see IDLE_TIMEOUT_MS. */
const PingSchema = z.object({ t: z.literal("ping") });

/**
 * Pushes a changed wardrobe to everyone who can see this player, without a
 * reconnect. The equipped pieces themselves are NOT taken from this
 * message - it carries no payload at all - because what a player is wearing
 * is purchased state and must come from the database. This is a "re-read
 * me" nudge; the server does the reading. See realtime/server.ts.
 */
const AppearanceSchema = z.object({ t: z.literal("appearance") });

export const ClientMessageSchema = z.discriminatedUnion("t", [
  HelloSchema,
  MoveSchema,
  EmoteSchema,
  RoomSchema,
  PingSchema,
  AppearanceSchema
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

/** How another player is described the first time you see them. */
export interface PresencePlayer {
  id: string;
  username: string;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  /** Equipped wardrobe piece ids by slot, read from the database - never from the client. */
  wardrobe: Record<string, string>;
}

// ---------------------------------------------------------------------------
// The live Roulette table's wire shapes
//
// Declared here, with the rest of the protocol, rather than in
// realtime/rouletteTable.ts - these are what goes over the socket and get
// mirrored on the client, so they belong with everything else the two sides
// have to agree about. The table module imports them.
// ---------------------------------------------------------------------------

/** Structurally identical to games/roulette.ts's RouletteColor; restated so this file stays free of game-module imports. */
export type TableColor = "red" | "black" | "green";

export type TablePhase = "betting" | "spinning" | "payout";

export interface TableBet {
  userId: string;
  username: string;
  choice: TableColor;
  amount: number;
}

export interface TableResult extends TableBet {
  won: boolean;
  payout: number;
  /** True when the ledger refused this player's wager at settlement - nothing was debited and nothing paid. See rouletteTable.ts. */
  voided?: boolean;
}

export interface TableSnapshot {
  roundId: string;
  phase: TablePhase;
  /** Milliseconds left in this phase - a DURATION, not a deadline, so a client whose clock is wrong still counts down correctly. */
  msRemaining: number;
  bets: TableBet[];
  /** The winning number, known from the moment betting closes. Null while betting is open, because there is nothing to know yet. */
  number: number | null;
  color: TableColor | null;
  results: TableResult[] | null;
}

/** A per-tick movement delta. Deliberately terser than PresencePlayer: this is the message that repeats 10x a second. */
export interface PresenceDelta {
  id: string;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
}

export type ServerMessage =
  /** Handshake accepted. `selfId` lets the client recognise (and skip drawing) itself in any later roster. */
  | { t: "welcome"; selfId: string; tickMs: number; heartbeatMs: number }
  /** The full roster for the room just entered. Sent on room entry, not on connect - an empty floor sends an empty list. */
  | { t: "roster"; players: PresencePlayer[] }
  | { t: "join"; player: PresencePlayer }
  | { t: "leave"; id: string }
  /** Batched movement for everyone who moved since the last tick. Omits players who didn't. */
  | { t: "state"; players: PresenceDelta[] }
  | { t: "emote"; id: string; e: Emote }
  /** A player's wardrobe changed; redraw them. Same shape the roster uses so the client has one code path. */
  | { t: "appearance"; player: PresencePlayer }
  | { t: "pong" }
  /**
   * The live Roulette table's current state (see realtime/rouletteTable.ts).
   * Sent on sitting down and on every phase change. Carries no money and no
   * authority: bets are placed over the HTTP API, and this is only how the
   * table reports what it did with them.
   */
  | { t: "table"; snapshot: TableSnapshot }
  /** One player just got a bet down. A live feed message, so the table fills in without waiting for the next phase. */
  | { t: "tablebet"; roundId: string; bet: TableBet }
  /** The round's settled outcomes, broadcast AFTER the ledger has been written - so what a player reads here is what actually happened to their balance. */
  | { t: "tableresult"; roundId: string; number: number; color: TableColor; results: TableResult[] }
  /** Terminal for `code === "UNAUTHORIZED"`/"ROOM_FULL" (the socket closes); advisory otherwise. */
  | { t: "error"; code: string; message: string };

export function encode(message: ServerMessage): string {
  return JSON.stringify(message);
}

/**
 * Parses one inbound frame. Returns null for anything that isn't a valid
 * message rather than throwing, so the caller's decision ("ignore it" vs
 * "close the socket") stays in one readable place instead of a try/catch.
 */
export function decodeClientMessage(raw: string): ClientMessage | null {
  if (raw.length > 8192) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ClientMessageSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
