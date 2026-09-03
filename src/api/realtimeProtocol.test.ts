import { describe, expect, it } from "vitest";
import {
  DIRECTIONS,
  EMOTES,
  HEARTBEAT_MS,
  MAP_COLS,
  MAP_ROWS,
  ROOM_OVERWORLD,
  TICK_MS,
  TILE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  realtimeUrlFor
} from "./realtimeProtocol";
import {
  DIRECTIONS as SERVER_DIRECTIONS,
  EMOTES as SERVER_EMOTES,
  HEARTBEAT_MS as SERVER_HEARTBEAT_MS,
  MAP_COLS as SERVER_MAP_COLS,
  MAP_ROWS as SERVER_MAP_ROWS,
  REALTIME_PATH as SERVER_REALTIME_PATH,
  ROOM_OVERWORLD as SERVER_ROOM_OVERWORLD,
  TICK_MS as SERVER_TICK_MS,
  TILE as SERVER_TILE,
  WORLD_HEIGHT as SERVER_WORLD_HEIGHT,
  WORLD_WIDTH as SERVER_WORLD_WIDTH
} from "../../server/src/realtime/protocol";
import { REALTIME_PATH } from "./realtimeProtocol";

/**
 * The guard on the client/server protocol duplication.
 *
 * `src/api/realtimeProtocol.ts` is a hand-maintained copy of
 * `server/src/realtime/protocol.ts` (the server's is built on zod, which
 * the browser bundle has no reason to carry). This file imports BOTH and
 * asserts they agree, the same way itemCatalog.test.ts / roomCatalog.test.ts
 * / wardrobeCatalog.test.ts guard the other three duplicated modules in
 * this repo.
 *
 * The failure this prevents is a nasty one: a drifted emote list or a
 * changed path produces a client that connects, handshakes, and then has
 * every message it sends silently rejected - which looks exactly like "the
 * server is down" and not at all like a typo.
 */
describe("client/server realtime protocol agreement", () => {
  it("agrees on the emote vocabulary", () => {
    // Closed on both sides and identical - the server's zod enum rejects
    // anything else outright, so a client-only addition is a message that
    // is simply never delivered.
    expect([...EMOTES]).toEqual([...SERVER_EMOTES]);
  });

  it("agrees on the directions a character can face", () => {
    expect([...DIRECTIONS]).toEqual([...SERVER_DIRECTIONS]);
  });

  it("agrees on the room name", () => {
    expect(ROOM_OVERWORLD).toBe(SERVER_ROOM_OVERWORLD);
  });

  it("agrees on the socket path", () => {
    expect(REALTIME_PATH).toBe(SERVER_REALTIME_PATH);
  });

  it("agrees on the world's dimensions, which the server clamps against", () => {
    expect(TILE).toBe(SERVER_TILE);
    expect(MAP_COLS).toBe(SERVER_MAP_COLS);
    expect(MAP_ROWS).toBe(SERVER_MAP_ROWS);
    expect(WORLD_WIDTH).toBe(SERVER_WORLD_WIDTH);
    expect(WORLD_HEIGHT).toBe(SERVER_WORLD_HEIGHT);
  });

  it("agrees on the tick and heartbeat timings the two sides pace themselves by", () => {
    expect(TICK_MS).toBe(SERVER_TICK_MS);
    expect(HEARTBEAT_MS).toBe(SERVER_HEARTBEAT_MS);
  });
});

describe("realtimeUrlFor", () => {
  it("derives the socket URL from the HTTP API base", () => {
    expect(realtimeUrlFor("http://localhost:8787")).toBe("ws://localhost:8787/realtime");
  });

  it("upgrades https to wss so a TLS page never opens a plaintext socket", () => {
    // A browser blocks ws:// from an https:// page as mixed content, so
    // getting this wrong means multiplayer works locally and silently never
    // connects in production.
    expect(realtimeUrlFor("https://api.example.com")).toBe("wss://api.example.com/realtime");
  });

  it("tolerates a trailing slash on the configured base URL", () => {
    expect(realtimeUrlFor("https://api.example.com/")).toBe("wss://api.example.com/realtime");
  });

  it("keeps a path prefix, for a server hosted under one", () => {
    expect(realtimeUrlFor("https://example.com/api")).toBe("wss://example.com/api/realtime");
  });

  it("leaves an already-ws base's scheme alone rather than guessing", () => {
    expect(realtimeUrlFor("wss://api.example.com")).toBe("wss://api.example.com/realtime");
  });
});
