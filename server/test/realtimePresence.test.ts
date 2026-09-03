/**
 * Unit tests for the room model (src/realtime/presence.ts).
 *
 * No sockets, no database, no timers - that separation is the whole reason
 * presence.ts has no `ws` import. The socket-level behaviour (handshake,
 * auth, broadcast fan-out) is covered by realtime.test.ts against a real
 * server; this file covers the logic that is easy to get subtly wrong and
 * miserable to debug through a WebSocket: clamping, dedupe, and the
 * dirty-set delta.
 */

import { describe, expect, it } from "vitest";
import { PresenceHub, PresenceRoom } from "../src/realtime/presence";
import {
  MAX_ROOM_OCCUPANTS,
  PresencePlayer,
  ROOM_OVERWORLD,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from "../src/realtime/protocol";

function player(id: string, overrides: Partial<PresencePlayer> = {}): PresencePlayer {
  return {
    id,
    username: id,
    x: 100,
    y: 100,
    dir: "down",
    moving: false,
    wardrobe: { BODY: "body_default" },
    ...overrides
  };
}

describe("PresenceRoom", () => {
  it("adds a player and reports them in the roster, excluding the requester", () => {
    const room = new PresenceRoom();
    room.join(player("a"));
    room.join(player("b"));

    expect(room.size).toBe(2);
    expect(room.roster("a").map((p) => p.id)).toEqual(["b"]);
    expect(room.roster().map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("re-joining an existing id replaces rather than duplicates", () => {
    const room = new PresenceRoom();
    room.join(player("a", { username: "old" }));
    room.join(player("a", { username: "new" }));

    expect(room.size).toBe(1);
    expect(room.roster()[0].username).toBe("new");
  });

  it("refuses a new player past the occupancy cap but still lets an existing one rejoin", () => {
    const room = new PresenceRoom();
    for (let i = 0; i < MAX_ROOM_OCCUPANTS; i++) {
      expect(room.join(player(`p${i}`)).ok).toBe(true);
    }

    expect(room.join(player("one-too-many"))).toEqual({ ok: false, reason: "ROOM_FULL" });
    // A reconnect of someone already counted is not a new occupant, so the
    // cap must not lock out a player who is already standing there.
    expect(room.join(player("p0")).ok).toBe(true);
    expect(room.size).toBe(MAX_ROOM_OCCUPANTS);
  });

  it("clamps out-of-bounds coordinates instead of broadcasting an undrawable avatar", () => {
    const room = new PresenceRoom();
    room.join(player("a"));

    room.move("a", -5000, 999_999, "left", true);
    const [delta] = room.drainDeltas();
    expect(delta.x).toBe(0);
    expect(delta.y).toBe(WORLD_HEIGHT);

    room.move("a", WORLD_WIDTH + 10, -1, "right", true);
    const [second] = room.drainDeltas();
    expect(second.x).toBe(WORLD_WIDTH);
    expect(second.y).toBe(0);
  });

  it("clamps a non-finite coordinate rather than letting it through", () => {
    const room = new PresenceRoom();
    // Spawn coordinates go through the same clamp as a move - a garbage
    // value must not be able to enter the room in the first place.
    room.join(player("a", { x: Number.NaN, y: Number.POSITIVE_INFINITY }));

    const [entry] = room.roster();
    expect(Number.isFinite(entry.x)).toBe(true);
    expect(Number.isFinite(entry.y)).toBe(true);

    room.move("a", Number.NaN, Number.NEGATIVE_INFINITY, "up", true);
    const [delta] = room.drainDeltas();
    expect(Number.isFinite(delta.x)).toBe(true);
    expect(Number.isFinite(delta.y)).toBe(true);
  });

  it("returns no deltas when nobody moved, so an idle floor costs no traffic", () => {
    const room = new PresenceRoom();
    room.join(player("a"));

    expect(room.drainDeltas()).toEqual([]);

    // Re-reporting the same position is not movement.
    room.move("a", 100, 100, "down", false);
    expect(room.drainDeltas()).toEqual([]);
  });

  it("ignores sub-pixel jitter but reports a real step, a turn, or a stop", () => {
    const room = new PresenceRoom();
    room.join(player("a"));

    room.move("a", 100.2, 100.1, "down", false);
    expect(room.drainDeltas()).toEqual([]);

    room.move("a", 104, 100, "down", false);
    expect(room.drainDeltas()).toHaveLength(1);

    // Same spot, new facing - still worth sending, or a player who turns on
    // the spot would face the wrong way on everyone else's screen.
    room.move("a", 104, 100, "left", false);
    expect(room.drainDeltas()).toHaveLength(1);

    // Same spot and facing, but now walking - drives the walk animation.
    room.move("a", 104, 100, "left", true);
    expect(room.drainDeltas()).toHaveLength(1);
  });

  it("drains each change exactly once", () => {
    const room = new PresenceRoom();
    room.join(player("a"));
    room.move("a", 200, 200, "up", true);

    expect(room.drainDeltas()).toHaveLength(1);
    expect(room.drainDeltas()).toHaveLength(0);
  });

  it("coalesces many moves within one tick into a single delta", () => {
    const room = new PresenceRoom();
    room.join(player("a"));
    for (let i = 0; i < 50; i++) room.move("a", 100 + i, 100, "right", true);

    const deltas = room.drainDeltas();
    expect(deltas).toHaveLength(1);
    // The LAST reported position wins - an intermediate one would render a
    // player permanently lagging behind where they actually are.
    expect(deltas[0].x).toBe(149);
  });

  it("does not emit a delta for a player who left before the drain", () => {
    const room = new PresenceRoom();
    room.join(player("a"));
    room.join(player("b"));
    room.move("a", 300, 300, "up", true);
    room.move("b", 400, 400, "up", true);

    room.leave("a");

    const deltas = room.drainDeltas();
    expect(deltas.map((d) => d.id)).toEqual(["b"]);
  });

  it("ignores a move from an id that is not in the room", () => {
    const room = new PresenceRoom();
    expect(room.move("ghost", 1, 1, "down", false)).toBe(false);
    expect(room.drainDeltas()).toEqual([]);
  });

  it("replaces a wardrobe without touching position", () => {
    const room = new PresenceRoom();
    room.join(player("a", { x: 250, y: 260 }));

    room.setWardrobe("a", { BODY: "body_default", HAT: "hat_cap" });

    const [entry] = room.roster();
    expect(entry.wardrobe).toEqual({ BODY: "body_default", HAT: "hat_cap" });
    expect(entry.x).toBe(250);
    expect(entry.y).toBe(260);
  });
});

describe("PresenceHub", () => {
  it("moves a player between rooms, leaving the first", () => {
    const hub = new PresenceHub();
    hub.enter(ROOM_OVERWORLD, player("a"));
    expect(hub.roomNameFor("a")).toBe(ROOM_OVERWORLD);
    expect(hub.room(ROOM_OVERWORLD).size).toBe(1);

    hub.enter("roulette", player("a"));
    expect(hub.roomNameFor("a")).toBe("roulette");
    expect(hub.room(ROOM_OVERWORLD).size).toBe(0);
    expect(hub.room("roulette").size).toBe(1);
  });

  it("exit removes the player and reports which room they left", () => {
    const hub = new PresenceHub();
    hub.enter(ROOM_OVERWORLD, player("a"));

    expect(hub.exit("a")).toBe(ROOM_OVERWORLD);
    expect(hub.roomNameFor("a")).toBeUndefined();
    expect(hub.room(ROOM_OVERWORLD).size).toBe(0);
    // Exiting again is a no-op, not an error - a close event can race a
    // client's own "room: null".
    expect(hub.exit("a")).toBeUndefined();
  });

  it("activeRooms lists only rooms that actually hold someone", () => {
    const hub = new PresenceHub();
    hub.room("empty-but-created");
    hub.enter(ROOM_OVERWORLD, player("a"));

    expect(hub.activeRooms().map((r) => r.name)).toEqual([ROOM_OVERWORLD]);
  });
});
