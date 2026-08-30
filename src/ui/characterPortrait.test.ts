import { describe, expect, it } from "vitest";
import { createCharacterPortrait } from "./characterPortrait";
import { DEFAULT_BODY_PIECE_ID, EquippedWardrobe } from "../wardrobeCatalog";

/**
 * Same Phaser-free fake-scene approach LayeredCharacter.test.ts uses (see
 * that file's own doc comment on why this repo's unit suite stays
 * Phaser-free) - a FakeSprite standing in for
 * Phaser.GameObjects.Sprite, covering exactly what
 * LayeredCharacter/characterPortrait read or write.
 */
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
  private frameName: string;
  private frameSet: Set<string>;

  constructor(textureKey: string, frame: number | string, frameSet: Set<string>) {
    this.textureKey = textureKey;
    this.frameName = String(frame);
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
  setScale(x: number, y?: number) {
    this.scaleX = x;
    this.scaleY = y ?? x;
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

// The LPC idle-down frame index resolves to this string via
// characterRig.ts's LPC_RIG - reproduced here rather than imported so the
// fake scene's "which frames exist" set is explicit and self-contained.
const IDLE_DOWN_FRAME = String((8 + 2) * 13); // (LPC_WALK_ROW + down offset) * LPC_COLUMNS

function makeFakeScene(existingTextures: Set<string>) {
  const sprites: FakeSprite[] = [];
  return {
    add: {
      sprite: (x: number, y: number, key: string, frame: number | string) => {
        const s = new FakeSprite(key, frame, new Set([IDLE_DOWN_FRAME]));
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

describe("createCharacterPortrait", () => {
  it("draws the free default body for a player wearing nothing - never an invisible portrait", () => {
    const scene = makeFakeScene(new Set([DEFAULT_BODY_PIECE_ID]));
    const equipped: EquippedWardrobe = {};

    const portrait = createCharacterPortrait(scene as unknown as Phaser.Scene, equipped, 40, 17, 0.55);

    expect(portrait.displayObjects.length).toBe(1); // just the base - no overlays worn
    const base = portrait.displayObjects[0] as unknown as FakeSprite;
    expect(base.texture.key).toBe(DEFAULT_BODY_PIECE_ID);
    expect(base.x).toBe(40);
    expect(base.y).toBe(17);
    expect(base.scaleX).toBe(0.55);
  });

  it("skips a worn piece whose art hasn't loaded rather than crashing or leaving a gap", () => {
    // Only the body's texture exists - the hair piece is in the wardrobe
    // but its art was never loaded (the realistic "catalogue entry added,
    // art not produced yet" case LayeredCharacter.ts's own header describes).
    const scene = makeFakeScene(new Set([DEFAULT_BODY_PIECE_ID]));
    const equipped: EquippedWardrobe = { HAIR: "hair_short" };

    const portrait = createCharacterPortrait(scene as unknown as Phaser.Scene, equipped, 0, 0, 0.55);

    expect(portrait.displayObjects.length).toBe(1); // body only, hair silently skipped
    expect(portrait.renderedPieceIds).toEqual([]);
  });

  it("draws worn pieces that DO have art, in ascending catalogue z-order, all positioned at the portrait's spot", () => {
    const scene = makeFakeScene(new Set([DEFAULT_BODY_PIECE_ID, "legs_jeans", "hair_short"]));
    const equipped: EquippedWardrobe = { LEGS: "legs_jeans", HAIR: "hair_short" };

    const portrait = createCharacterPortrait(scene as unknown as Phaser.Scene, equipped, 12, 34, 0.55);

    expect(portrait.renderedPieceIds).toEqual(["legs_jeans", "hair_short"]);
    for (const obj of portrait.displayObjects) {
      const sprite = obj as unknown as FakeSprite;
      expect(sprite.x).toBe(12);
      expect(sprite.y).toBe(34);
    }
  });
});
