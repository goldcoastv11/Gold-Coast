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
  | { t: "room"; room: typeof ROOM_OVERWORLD | null }
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
