import Phaser from "phaser";
import { resolveLayers, EquippedWardrobe, WardrobeLayer } from "../wardrobeCatalog";
import { CharacterRig, LPC_RIG } from "../characterRig";

/**
 * Draws a wardrobe as a stack of sprites over one base sprite.
 *
 * ## The one idea
 *
 * A character used to be a single sprite whose texture was the whole
 * character (a "skin"). It is now a BASE sprite - the physics body that
 * actually moves and collides, textured with the equipped BODY piece - plus
 * one plain overlay sprite per worn piece, each sitting exactly on top of
 * it. Everything else here follows from that.
 *
 * The base sprite is owned by the caller (OverworldScene's `player`), not by
 * this class: it's a physics sprite with a collision body, a velocity and a
 * camera following it, and none of that should move house just because the
 * character gained a hat. This class only owns the overlays.
 *
 * ## Why overlays MIRROR the base's frame instead of playing their own anims
 *
 * Every LPC piece is exported on the same 64x64, 13-column grid, so frame
 * N means the same pose in every piece's sheet as it does in the body's.
 * That makes syncing trivial and, more importantly, exact: each overlay
 * simply copies `base.frame.name` every tick. No second animation to start,
 * stop, or keep in phase - and therefore no way for the shirt to fall a
 * frame behind the body mid-stride, which is the classic failure of running
 * one animation per layer.
 *
 * It also means a piece needs NO animations registered at all. Adding a
 * piece is a texture and a catalogue entry; it is never animation wiring.
 *
 * ## Degrading when art is missing
 *
 * A piece whose texture never loaded is skipped, silently, per layer. The
 * character renders without it rather than throwing, showing a green box,
 * or failing to render at all. Since the BODY layer always resolves to the
 * free default (see wardrobeCatalog.ts's resolveLayers) and BootScene
 * guarantees a generated placeholder texture for every catalogue piece,
 * the realistic case for this is a piece added to the catalogue whose art
 * hasn't been produced yet - which should look like "no hat", not a crash.
 */

/** How far apart consecutive layers sit in Phaser's depth ordering. */
const DEPTH_STEP = 0.001;

export interface LayeredCharacterOptions {
  /**
   * The rig every layer is drawn on. LPC in practice - the layered format
   * is what makes this whole class possible - but taken as an option rather
   * than hardcoded so the base sprite and its overlays can never end up
   * assuming different frame layouts.
   */
  rig?: CharacterRig;
}

export class LayeredCharacter {
  private readonly scene: Phaser.Scene;
  private readonly base: Phaser.GameObjects.Sprite;
  private readonly rig: CharacterRig;
  /** One overlay per worn non-BODY piece, in draw order. */
  private overlays: Phaser.GameObjects.Sprite[] = [];

  constructor(
    scene: Phaser.Scene,
    base: Phaser.GameObjects.Sprite,
    options: LayeredCharacterOptions = {}
  ) {
    this.scene = scene;
    this.base = base;
    this.rig = options.rig ?? LPC_RIG;
  }

  /**
   * Rebuilds the whole stack from what the player is wearing. Call on spawn
   * and after any buy/equip/unequip.
   *
   * Deliberately a full teardown-and-rebuild rather than a diff: the stack
   * is at most six sprites, this runs on an explicit user action (never per
   * frame), and a rebuild cannot leave a stale layer behind - which a diff
   * absolutely can, and the symptom would be a player wearing a shirt they
   * just took off.
   */
  apply(equipped: EquippedWardrobe) {
    this.destroyOverlays();

    const layers = resolveLayers(equipped);

    // The BODY layer is the base sprite's own texture, not an overlay -
    // it's the thing everything else draws on top of. resolveLayers
    // guarantees exactly one, so this is never undefined in practice; the
    // guard is here so a future catalogue edit can't turn a missing body
    // into a crash on spawn.
    const bodyLayer = layers.find((l) => l.slot === "BODY");
    if (bodyLayer && this.textureReady(bodyLayer)) {
      this.base.setTexture(bodyLayer.piece.id, this.base.frame.name);
    }

    for (const layer of layers) {
      if (layer.slot === "BODY") continue;
      if (!this.textureReady(layer)) continue; // art not produced yet - wear nothing there
      this.overlays.push(this.createOverlay(layer));
    }

    this.sync();
  }

  /**
   * Pulls every overlay onto the base sprite's current position, scale,
   * frame and visibility. Call once per frame, after the base has moved.
   *
   * Copying the frame index is what keeps the layers in lockstep with the
   * walk cycle - see this file's header on why that beats one animation per
   * layer.
   */
  sync() {
    if (this.overlays.length === 0) return;

    const frame = this.base.frame.name;
    const baseDepth = this.base.depth;

    this.overlays.forEach((overlay, i) => {
      overlay.x = this.base.x;
      overlay.y = this.base.y;
      overlay.setScale(this.base.scaleX, this.base.scaleY);
      overlay.setFlipX(this.base.flipX);
      overlay.setVisible(this.base.visible);
      overlay.setAlpha(this.base.alpha);
      // Sit just above the base, in catalogue z-order. Fractional steps
      // keep the whole character inside the base's own depth slot, so a
      // hat can never sort above furniture the character is standing
      // behind.
      overlay.setDepth(baseDepth + DEPTH_STEP * (i + 1));

      // A frame index that doesn't exist in this piece's sheet would render
      // as the whole packed image. Only set what the texture actually has.
      if (overlay.texture.has(frame)) overlay.setFrame(frame);
    });
  }

  /** Frees every overlay. Call from the scene's shutdown, alongside the base sprite's own teardown. */
  destroy() {
    this.destroyOverlays();
  }

  /** Which pieces are actually being drawn right now - used by the tests and useful when debugging a missing layer. */
  get renderedPieceIds(): string[] {
    return this.overlays.map((o) => o.texture.key);
  }

  private createOverlay(layer: WardrobeLayer): Phaser.GameObjects.Sprite {
    // Plain sprite, NOT physics.add.sprite: overlays are moved by sync()
    // every frame and never collide with anything, so an Arcade body would
    // be pure cost plus a second thing that could disagree with the base
    // about where the character is.
    const sprite = this.scene.add.sprite(this.base.x, this.base.y, layer.piece.id);
    sprite.setOrigin(this.base.originX, this.base.originY);
    return sprite;
  }

  /**
   * Whether this layer's texture actually exists in the texture manager -
   * the graceful-degradation check. Phaser's `__MISSING` placeholder is
   * excluded explicitly: `textures.exists` is false for an unloaded key,
   * but a key whose load FAILED can land on the missing-texture entry
   * instead, which would draw a green-and-black checkerboard on the
   * character rather than nothing.
   */
  private textureReady(layer: WardrobeLayer): boolean {
    const key = layer.piece.id;
    if (!this.scene.textures.exists(key)) return false;
    return this.scene.textures.get(key).key !== "__MISSING";
  }

  private destroyOverlays() {
    this.overlays.forEach((o) => o.destroy());
    this.overlays = [];
  }

  /** The rig every layer in this stack is drawn on - callers need it for body/scale/accessory maths. */
  get characterRig(): CharacterRig {
    return this.rig;
  }
}
