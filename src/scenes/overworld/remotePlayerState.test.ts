import { describe, expect, it } from "vitest";
import { RemotePlayerStore, SNAP_DISTANCE, easeToward } from "./remotePlayerState";
import { PresencePlayer, TICK_MS } from "../../api/realtimeProtocol";

/**
 * Coverage for the half of remote-player rendering that can be tested at
 * all - see remotePlayerState.ts's header on why the Phaser half cannot
 * (importing the `phaser` package root throws under plain Node, so this
 * repo's unit suite is Phaser-free by design and scenes are covered by
 * SMOKE_TESTS.md instead).
 *
 * What is pinned here is the arithmetic that decides whether other players
 * look like people walking around or like a stuttering mess, plus the
 * roster bookkeeping whose failure mode is a ghost standing on the casino
 * floor forever.
 */

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

describe("easeToward", () => {
  it("closes most of the gap over one server tick, but is still moving at the end of it", () => {
    // Both halves matter. Covering most of the gap keeps the lag down to a
    // few pixels; NOT arriving means the character is still in motion when
    // the next target lands, instead of parking between updates.
    let value = 0;
    const frameMs = TICK_MS / 6; // ~60fps against a 10Hz server
    for (let i = 0; i < 6; i++) value = easeToward(value, 60, frameMs);

    expect(value).toBeGreaterThan(60 * 0.6);
    expect(value).toBeLessThan(60);
  });

  it("closes the same fraction of the gap per tick regardless of frame rate", () => {
    // Exponential smoothing keyed off deltaMs, not a per-frame constant -
    // so a 30fps phone and a 144Hz monitor show the same lag rather than
    // the phone's characters dragging behind.
    const overOneTick = (frames: number) => {
      let value = 0;
      for (let i = 0; i < frames; i++) value = easeToward(value, 100, TICK_MS / frames);
      return value;
    };

    expect(Math.abs(overOneTick(3) - overOneTick(12))).toBeLessThan(6);
  });

  it("never overshoots its target on a long frame", () => {
    // A tab regaining focus or a GC pause hands in a huge delta. Clamped,
    // this lands exactly on target; unclamped it would fly past and
    // oscillate back, which reads as a character vibrating in place.
    expect(easeToward(0, 100, 5000)).toBe(100);
    expect(easeToward(100, 0, 5000)).toBe(0);
  });

  it("is a no-op when already there", () => {
    expect(easeToward(42, 42, 16)).toBe(42);
  });
});

describe("RemotePlayerStore roster handling", () => {
  it("draws a newly-seen player where they are, not from the origin", () => {
    const store = new RemotePlayerStore();
    store.upsert(player("a", { x: 700, y: 300 }));

    const state = store.get("a")!;
    expect(state.x).toBe(700);
    expect(state.y).toBe(300);
    // Nothing to ease toward on the first frame - they should simply be
    // standing there, not sliding in across the room.
    expect(state.targetX).toBe(700);
    expect(state.targetY).toBe(300);
  });

  it("replaces the roster wholesale and reports who disappeared", () => {
    const store = new RemotePlayerStore();
    store.applyRoster([player("a"), player("b")]);

    const { removed } = store.applyRoster([player("b"), player("c")]);

    // "a" wasn't in the new roster, so they have left - keeping them would
    // leave a ghost standing on the floor with nothing ever to remove it.
    expect(removed).toEqual(["a"]);
    expect(store.all().map((p) => p.id).sort()).toEqual(["b", "c"]);
  });

  it("keeps a player's live position when a re-roster mentions them again", () => {
    const store = new RemotePlayerStore();
    store.applyRoster([player("a", { x: 100, y: 100 })]);
    store.applyDeltas([{ id: "a", x: 140, y: 100, dir: "right", moving: true }]);
    store.advance(TICK_MS);

    // The server's roster carries where it last recorded them, which can be
    // older than the deltas already applied. Snapping back to it would jerk
    // the character backwards.
    store.applyRoster([player("a", { x: 100, y: 100 })]);
    expect(store.get("a")!.targetX).toBe(140);
  });

  it("flags an appearance change only when the wardrobe actually differs", () => {
    const store = new RemotePlayerStore();
    store.upsert(player("a"));
    store.markAppearanceApplied("a");

    store.upsert(player("a"));
    expect(store.get("a")!.appearanceDirty).toBe(false);

    store.upsert(player("a", { wardrobe: { BODY: "body_default", HAT: "hat_cap" } }));
    expect(store.get("a")!.appearanceDirty).toBe(true);
  });

  it("treats a removed piece as an appearance change", () => {
    const store = new RemotePlayerStore();
    store.upsert(player("a", { wardrobe: { BODY: "body_default", HAT: "hat_cap" } }));
    store.markAppearanceApplied("a");

    store.upsert(player("a", { wardrobe: { BODY: "body_default" } }));
    // Taking a hat off changes no remaining key's value - only the count -
    // so a naive "every key matches" comparison would miss it and the
    // player would keep wearing a hat they just removed.
    expect(store.get("a")!.appearanceDirty).toBe(true);
  });
});

describe("RemotePlayerStore movement", () => {
  it("eases toward a delta rather than teleporting to it", () => {
    const store = new RemotePlayerStore();
    store.upsert(player("a", { x: 100, y: 100 }));

    store.applyDeltas([{ id: "a", x: 116, y: 100, dir: "right", moving: true }]);
    // Position doesn't change until a frame is advanced - the delta only
    // sets the target.
    expect(store.get("a")!.x).toBe(100);

    store.advance(16);
    const state = store.get("a")!;
    expect(state.x).toBeGreaterThan(100);
    expect(state.x).toBeLessThan(116);
  });

  it("snaps rather than glides when a player jumps across the map", () => {
    const store = new RemotePlayerStore();
    store.upsert(player("a", { x: 100, y: 100 }));

    // Walking back out of a game cabinet at a different spot. Eased, the
    // character would visibly slide across the floor through the walls.
    store.applyDeltas([{ id: "a", x: 100 + SNAP_DISTANCE + 50, y: 100, dir: "right", moving: false }]);

    expect(store.get("a")!.x).toBe(100 + SNAP_DISTANCE + 50);
  });

  it("carries facing and moving straight through, since the walk animation reads them directly", () => {
    const store = new RemotePlayerStore();
    store.upsert(player("a"));

    store.applyDeltas([{ id: "a", x: 100, y: 100, dir: "up", moving: true }]);
    expect(store.get("a")).toMatchObject({ dir: "up", moving: true });
  });

  it("ignores a delta for someone who already left", () => {
    const store = new RemotePlayerStore();
    store.upsert(player("a"));
    store.remove("a");

    // A `state` broadcast racing a `leave` is normal. Creating a player
    // from it would produce someone with no username and no wardrobe.
    store.applyDeltas([{ id: "a", x: 500, y: 500, dir: "down", moving: true }]);
    expect(store.size).toBe(0);
  });

  it("advances every player, not just the most recent one", () => {
    const store = new RemotePlayerStore();
    store.upsert(player("a", { x: 0, y: 0 }));
    store.upsert(player("b", { x: 0, y: 0 }));
    store.applyDeltas([
      { id: "a", x: 40, y: 0, dir: "right", moving: true },
      { id: "b", x: 0, y: 40, dir: "down", moving: true }
    ]);

    store.advance(TICK_MS);

    expect(store.get("a")!.x).toBe(40);
    expect(store.get("b")!.y).toBe(40);
  });

  it("clear() empties the store", () => {
    const store = new RemotePlayerStore();
    store.applyRoster([player("a"), player("b")]);
    store.clear();
    expect(store.size).toBe(0);
  });
});
