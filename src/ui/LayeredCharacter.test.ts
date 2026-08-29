import { describe, expect, it } from "vitest";
// Phaser's EventEmitter is a CJS module with a default export - imported
// from its own file (not the top-level "phaser" package) because importing
// the package root pulls in device detection that reaches for `window` and
// throws under plain Node (confirmed while writing this file), which is
// exactly why this repo's vitest config keeps Phaser scenes out of the unit
// suite. EventEmitter itself has no such dependency.
import EventEmitter from "phaser/src/events/EventEmitter.js";
import { LayeredCharacter } from "./LayeredCharacter";
import { DEFAULT_BODY_PIECE_ID, EquippedWardrobe } from "../wardrobeCatalog";

/**
 * Regression coverage for the "clothes trail the body" bug.
 *
 * This repo's vitest config deliberately runs Phaser-free (see
 * vitest.config.ts's comment: "impractical, and low value, to unit test
 * Phaser scenes directly" - Phaser's top-level module import itself throws
 * under plain Node, since it reaches for `window` during device detection;
 * confirmed while writing this file). So there is no real
 * `Phaser.Physics.Arcade.Sprite` or `Phaser.Scene` here - a full OverworldScene
 * can only be exercised by hand, via the dev server + manual smoke check
 * (see SMOKE_TESTS.md), same as every other scene in this codebase.
 *
 * What CAN be pinned here, and is:
 *
 * 1. `LayeredCharacter.sync()` itself is a pure, order-correct copy: given a
 *    base whose x/y/frame already reflect "this tick's" state, every overlay
 *    matches it exactly - across several simulated ticks, through a
 *    direction change, and at idle - with correct depth ordering. This is
 *    the class's actual contract, unchanged by this fix.
 * 2. The event-ordering guarantee OverworldScene's fix relies on - that a
 *    POST_UPDATE listener registered AFTER Arcade Physics' own POST_UPDATE
 *    listener always runs after it, so it always observes the physics
 *    engine's finished position rather than last frame's - using Phaser's
 *    actual `EventEmitter` class (not a mock of it), which is the real
 *    primitive both the physics plugin and OverworldScene's fix register
 *    on. It also reproduces the OLD bug's shape: a listener that reads
 *    position before the physics-equivalent listener has run sees the
 *    stale value.
 */

// A stand-in for Phaser.GameObjects.Sprite covering exactly what
// LayeredCharacter reads/writes. Chainable setters, like the real thing.
class FakeSprite {
  x = 0;
  y = 0;
  scaleX = 1;
  scaleY = 1;
  flipX = false;
  visible = true;
  alpha = 1;
  depth = 0;
  originX = 0.5;
  originY = 1;
  displayHeight = 64;
  height = 64;
  private textureKey: string;
  private frameName = "0";
  private frameSet: Set<string>;

  constructor(textureKey: string, frameSet: Set<string>) {
    this.textureKey = textureKey;
    this.frameSet = frameSet;
  }

  get texture() {
    return { key: this.textureKey, has: (f: string) => this.frameSet.has(f) };
  }

  get frame() {
    return { name: this.frameName };
  }

  setOrigin(x: number, y: number) {
    this.originX = x;
    this.originY = y;
    return this;
  }
  setScale(x: number, y: number) {
    this.scaleX = x;
    this.scaleY = y;
    return this;
  }
  setFlipX(v: boolean) {
    this.flipX = v;
    return this;
  }
  setVisible(v: boolean) {
    this.visible = v;
    return this;
  }
  setAlpha(v: number) {
    this.alpha = v;
    return this;
  }
  setDepth(v: number) {
    this.depth = v;
    return this;
  }
  setFrame(f: number | string) {
    this.frameName = String(f);
    return this;
  }
  setTexture(key: string, frame?: number | string) {
    this.textureKey = key;
    if (frame !== undefined) this.frameName = String(frame);
    return this;
  }
  destroy() {}
}

// All the frame names used below - every real piece is on the same grid,
// so any texture "has" every frame in this test's set.
const FRAMES = new Set(["idle_down", "walk_left_0", "walk_right_0", "idle_left"]);

function makeFakeScene(existingTextures: Set<string>) {
  const sprites: FakeSprite[] = [];
  return {
    add: {
      sprite: (x: number, y: number, key: string) => {
        const s = new FakeSprite(key, FRAMES);
        s.x = x;
        s.y = y;
        sprites.push(s);
        return s as unknown as Phaser.GameObjects.Sprite;
      }
    },
    textures: {
      exists: (key: string) => existingTextures.has(key),
      get: (key: string) => ({ key: existingTextures.has(key) ? key : "__MISSING" })
    },
    sprites
  };
}

const EQUIPPED: EquippedWardrobe = {
  BODY: DEFAULT_BODY_PIECE_ID,
  LEGS: "legs_jeans",
  TORSO: "torso_tee",
  HAIR: "hair_short"
};

const ALL_TEXTURES = new Set([DEFAULT_BODY_PIECE_ID, "legs_jeans", "torso_tee", "hair_short"]);

describe("LayeredCharacter.sync() - the copy that must never be stale", () => {
  it("matches the base's position, frame and flip exactly across several simulated ticks", () => {
    const scene = makeFakeScene(ALL_TEXTURES);
    const base = new FakeSprite(DEFAULT_BODY_PIECE_ID, FRAMES);
    const character = new LayeredCharacter(scene as unknown as Phaser.Scene, base as unknown as Phaser.GameObjects.Sprite);
    character.apply(EQUIPPED);

    expect(character.renderedPieceIds.sort()).toEqual(["hair_short", "legs_jeans", "torso_tee"].sort());

    // Simulate several ticks of movement: move the base (as Arcade Physics'
    // POST_UPDATE would have already done by the time sync() is called),
    // set its walk frame, then sync.
    const ticks = [
      { x: 100, y: 200, frame: "walk_right_0", flip: false },
      { x: 108, y: 200, frame: "walk_right_0", flip: false },
      { x: 116, y: 196, frame: "walk_right_0", flip: false },
      { x: 116, y: 196, frame: "idle_down", flip: false } // stopped
    ];

    for (const tick of ticks) {
      base.x = tick.x;
      base.y = tick.y;
      base.setFrame(tick.frame);
      base.setFlipX(tick.flip);

      character.sync();

      for (const overlay of scene.sprites) {
        expect(overlay.x).toBe(base.x);
        expect(overlay.y).toBe(base.y);
        expect(overlay.frame.name).toBe(base.frame.name);
        expect(overlay.flipX).toBe(base.flipX);
      }
    }
  });

  it("stays in sync on a direction change (walk_right -> walk_left with flip)", () => {
    const scene = makeFakeScene(ALL_TEXTURES);
    const base = new FakeSprite(DEFAULT_BODY_PIECE_ID, FRAMES);
    const character = new LayeredCharacter(scene as unknown as Phaser.Scene, base as unknown as Phaser.GameObjects.Sprite);
    character.apply(EQUIPPED);

    base.x = 50;
    base.y = 50;
    base.setFrame("walk_right_0");
    base.setFlipX(false);
    character.sync();
    for (const overlay of scene.sprites) {
      expect(overlay.frame.name).toBe("walk_right_0");
      expect(overlay.flipX).toBe(false);
    }

    // Reverse direction - some rigs mirror the right-walk frame with flipX
    // rather than a separate left sheet.
    base.x = 42;
    base.setFrame("walk_right_0");
    base.setFlipX(true);
    character.sync();
    for (const overlay of scene.sprites) {
      expect(overlay.x).toBe(42);
      expect(overlay.frame.name).toBe("walk_right_0");
      expect(overlay.flipX).toBe(true);
    }
  });

  it("stays in sync at idle, not just mid-stride", () => {
    const scene = makeFakeScene(ALL_TEXTURES);
    const base = new FakeSprite(DEFAULT_BODY_PIECE_ID, FRAMES);
    const character = new LayeredCharacter(scene as unknown as Phaser.Scene, base as unknown as Phaser.GameObjects.Sprite);
    character.apply(EQUIPPED);

    base.x = 300;
    base.y = 300;
    base.setFrame("idle_left");
    character.sync();

    for (const overlay of scene.sprites) {
      expect(overlay.x).toBe(300);
      expect(overlay.y).toBe(300);
      expect(overlay.frame.name).toBe("idle_left");
    }
  });

  it("keeps every overlay's depth above the base, in ascending catalogue z-order", () => {
    const scene = makeFakeScene(ALL_TEXTURES);
    const base = new FakeSprite(DEFAULT_BODY_PIECE_ID, FRAMES);
    base.depth = 5;
    const character = new LayeredCharacter(scene as unknown as Phaser.Scene, base as unknown as Phaser.GameObjects.Sprite);
    character.apply(EQUIPPED);
    character.sync();

    // resolveLayers sorts by WARDROBE_SLOTS z (LEGS=10, TORSO=30, HAIR=40),
    // so the draw order - and therefore the depth order - must be
    // legs, torso, hair, each one above the last and all above the base.
    expect(character.renderedPieceIds).toEqual(["legs_jeans", "torso_tee", "hair_short"]);
    let lastDepth = base.depth;
    for (const overlay of scene.sprites) {
      expect(overlay.depth).toBeGreaterThan(lastDepth);
      lastDepth = overlay.depth;
    }
  });
});

describe("the POST_UPDATE ordering the OverworldScene fix relies on", () => {
  /**
   * Reproduces, with Phaser's real EventEmitter, the exact registration
   * shape OverworldScene now uses: the physics-plugin-equivalent listener
   * (which writes the moved position onto the game object) is bound first,
   * because the physics plugin boots before any scene code runs; our sync
   * listener is bound second, in create(). EventEmitter guarantees
   * registration-order dispatch, so ours always observes the finished
   * position.
   */
  it("a listener registered after the physics-equivalent one always sees the post-physics position", () => {
    const events = new EventEmitter();
    const gameObject = { x: 0, y: 0 };
    const body = { x: 0, y: 0 };

    // Simulates Body.update(): physics computes a new position into the
    // body, independent of the game object, during World's own update.
    body.x = 10;
    body.y = 20;

    // Simulates the physics plugin's POST_UPDATE binding (Body.postUpdate),
    // registered during the plugin's boot - before scene code runs.
    events.on("POST_UPDATE", () => {
      gameObject.x = body.x;
      gameObject.y = body.y;
    });

    // Simulates OverworldScene's own POST_UPDATE listener, registered in
    // create() - necessarily after the plugin's, since plugin boot always
    // precedes scene create().
    const observed: Array<{ x: number; y: number }> = [];
    events.on("POST_UPDATE", () => {
      observed.push({ x: gameObject.x, y: gameObject.y });
    });

    events.emit("POST_UPDATE");

    expect(observed).toEqual([{ x: 10, y: 20 }]);
  });

  it("pins the shape of the original bug: reading position from inside update(), before POST_UPDATE, sees last frame's stale value", () => {
    const events = new EventEmitter();
    const gameObject = { x: 0, y: 0 };
    const body = { x: 0, y: 0 };

    events.on("POST_UPDATE", () => {
      gameObject.x = body.x;
      gameObject.y = body.y;
    });

    function frame(newBodyX: number, newBodyY: number) {
      // UPDATE: physics computes this frame's movement into the body.
      body.x = newBodyX;
      body.y = newBodyY;

      // scene.update() (and anything it calls, like the old
      // handleMovement()) runs BEFORE POST_UPDATE - so a read here is the
      // bug: it's this frame's body position, but LAST frame's gameObject.
      const staleReadDuringUpdate = { x: gameObject.x, y: gameObject.y };

      // POST_UPDATE now runs, same as the real Phaser loop.
      events.emit("POST_UPDATE");

      return staleReadDuringUpdate;
    }

    const frame1 = frame(10, 20);
    expect(frame1).toEqual({ x: 0, y: 0 }); // stale - body moved to (10,20), gameObject hadn't caught up yet
    expect(gameObject).toEqual({ x: 10, y: 20 }); // caught up only after POST_UPDATE

    const frame2 = frame(15, 20);
    expect(frame2).toEqual({ x: 10, y: 20 }); // stale by exactly one frame, every frame
    expect(gameObject).toEqual({ x: 15, y: 20 });
  });
});
