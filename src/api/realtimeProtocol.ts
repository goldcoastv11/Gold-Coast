/**
 * Client-side mirror of `server/src/realtime/protocol.ts`.
 *
 * ## Why this is a copy and not an import
 *
 * The server's copy is built on zod, which is a server dependency the
 * browser bundle has no reason to carry, and the two halves compile under
 * different tsconfigs. Same situation as `wardrobeCatalog.ts`,
 * `itemCatalog.ts` and `roomCatalog.ts`, which are duplicated for the same
 * reason - and, like those, the duplication is guarded by a test that
 * imports BOTH files and asserts they agree
 * (`src/api/realtimeProtocol.test.ts`). A rename on one side that isn't
 * mirrored on the other fails the suite rather than silently producing a
 * client that talks a dialect the server rejects.
 *
 * Read the server file for the design rationale - what this channel is
 * allowed to carry, why the token goes in a frame instead of the URL, and
 * why position is trusted while emotes are a closed vocabulary. That
 * reasoning is not repeated here.
 */

export const TILE = 16;
export const MAP_COLS = 80;
export const MAP_ROWS = 56;
export const WORLD_WIDTH = MAP_COLS * TILE;
export const WORLD_HEIGHT = MAP_ROWS * TILE;

/** Server broadcast period. The client interpolates remote players over this window - see RemotePlayers.ts. */
export const TICK_MS = 100;

/** How often the client pings, so that standing still is never mistaken for a dead socket. */
export const HEARTBEAT_MS = 20_000;

export const EMOTES = ["wave", "cheer", "laugh", "cry", "thumbsup", "shock", "heart", "gg"] as const;
export type Emote = (typeof EMOTES)[number];

export const DIRECTIONS = ["down", "left", "right", "up"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const ROOM_OVERWORLD = "overworld";

/**
 * The live Roulette table. A second shared room - and unlike the floor, its
 * occupants have no avatars and send no positions. It uses the same room
 * mechanism purely so "tell everyone at this table" reuses one fan-out.
 */
export const ROOM_ROULETTE = "roulette";

/** The live Blackjack table. Turn-based, unlike Roulette - see the server's blackjackTable.ts. */
export const ROOM_BLACKJACK = "blackjack";

export const ROOMS = [ROOM_OVERWORLD, ROOM_ROULETTE, ROOM_BLACKJACK] as const;
export type RoomName = (typeof ROOMS)[number];

// --- Servers -------------------------------------------------------------
//
// A "server" is one instance of the arcade: its own casino floor, its own
// wheel, its own Blackjack table. Players on different servers never see
// each other. Every room join names one.

export const JOIN_CODE_LENGTH = 6;
export const SERVER_CAPACITY = 20;

export type ServerVisibility = "public" | "private";

export interface GameServerSummary {
  id: string;
  name: string;
  visibility: ServerVisibility;
  players: number;
  capacity: number;
  /** Only ever present for a private server you just created. */
  joinCode?: string;
}

// --- The live Blackjack table's wire shapes ------------------------------

export type BlackjackPhase = "betting" | "dealing" | "acting" | "dealer" | "payout";
export type BlackjackSeatStatus = "playing" | "stood" | "busted" | "blackjack";
export type BlackjackOutcomeName = "win" | "push" | "lose";

export interface BlackjackSeat {
  userId: string;
  username: string;
  bet: number;
  /** Card RANKS only (1=A, 2-10, 11=J, 12=Q, 13=K). The client picks a suit purely for display. */
  hand: number[];
  total: number;
  status: BlackjackSeatStatus;
  outcome: BlackjackOutcomeName | null;
  payout: number;
  /** True when the server couldn't settle this seat - nothing debited, nothing paid. */
  voided?: boolean;
}

export interface BlackjackSnapshot {
  roundId: string;
  phase: BlackjackPhase;
  /** Milliseconds left in this phase. A DURATION, so a wrong local clock doesn't matter. */
  msRemaining: number;
  seats: BlackjackSeat[];
  /** Whose turn it is during `acting`; null otherwise. */
  activeUserId: string | null;
  dealerUpCard: number | null;
  /** The dealer's full hand, only once the dealer has actually drawn. */
  dealerHand: number[] | null;
  dealerTotal: number | null;
}

// --- The live Roulette table's wire shapes (mirrors the server's) ---------

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
  /** True when the server couldn't settle this player's wager - nothing was debited and nothing paid. */
  voided?: boolean;
}

export interface TableSnapshot {
  roundId: string;
  phase: TablePhase;
  /** Milliseconds left in this phase. A DURATION, not a deadline - so the countdown is right even if this device's clock is wrong. */
  msRemaining: number;
  bets: TableBet[];
  number: number | null;
  color: TableColor | null;
  results: TableResult[] | null;
}

/** Application close code meaning "your account connected from somewhere else" - see the server's CLOSE_DISPLACED. */
export const CLOSE_DISPLACED = 4001;

export interface PresencePlayer {
  id: string;
  username: string;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  /** Equipped wardrobe piece ids by slot. Server-read from the database, never client-reported. */
  wardrobe: Record<string, string>;
}

export interface PresenceDelta {
  id: string;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
}

export type ClientMessage =
  | { t: "hello"; token: string }
  | { t: "move"; x: number; y: number; dir: Direction; moving: boolean }
  | { t: "emote"; e: Emote }
  | { t: "room"; room: RoomName | null; serverId?: string | null }
  | { t: "ping" }
  | { t: "appearance" };

export type ServerMessage =
  | { t: "welcome"; selfId: string; tickMs: number; heartbeatMs: number }
  | { t: "roster"; players: PresencePlayer[] }
  | { t: "join"; player: PresencePlayer }
  | { t: "leave"; id: string }
  | { t: "state"; players: PresenceDelta[] }
  | { t: "emote"; id: string; e: Emote }
  | { t: "appearance"; player: PresencePlayer }
  | { t: "pong" }
  | { t: "table"; snapshot: TableSnapshot }
  | { t: "tablebet"; roundId: string; bet: TableBet }
  | { t: "tableresult"; roundId: string; number: number; color: TableColor; results: TableResult[] }
  | { t: "blackjack"; snapshot: BlackjackSnapshot }
  | { t: "error"; code: string; message: string };

/**
 * Turns the HTTP API base URL into the WebSocket endpoint.
 *
 * Derived rather than configured separately so there is no way to deploy a
 * client pointed at one host for HTTP and another for sockets - a
 * misconfiguration that presents as "multiplayer silently never works on
 * production", which is exactly the kind of thing nobody notices for a
 * week. `https` upgrades to `wss` so a page served over TLS never opens a
 * plaintext socket (browsers block that as mixed content anyway).
 */
export const REALTIME_PATH = "/realtime";

export function realtimeUrlFor(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.replace(/\/+$/, "");
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}${REALTIME_PATH}`;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}${REALTIME_PATH}`;
  // Already a ws:// or wss:// base, or a protocol-relative one - leave the
  // scheme alone rather than guessing wrong about it.
  return `${trimmed}${REALTIME_PATH}`;
}
