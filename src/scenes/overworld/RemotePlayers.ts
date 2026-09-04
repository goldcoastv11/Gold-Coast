/**
 * Draws everyone else on the casino floor.
 *
 * Owns one sprite stack per remote player - a base sprite plus the same
 * `LayeredCharacter` overlay stack the local player uses, so another
 * player's hat, shirt and trousers are the real purchased pieces rather
 * than a generic silhouette. That reuse is the point: a wardrobe is only
 * worth buying if other people can see it, and the shop's whole pitch
 * ("seeing an outfit a player could go and buy") only pays off once the
 * character wearing it is a person rather than a bystander NPC.
 *
 * ## What lives here and what does not
 *
 * This file is rendering only. Who is present, and where they are being
 * drawn this frame, is `remotePlayerState.ts` - which is Phaser-free
 * precisely so the interpolation can be unit tested (importing the `phaser`
 * package root throws under plain Node). The rule: if it is arithmetic, it
 * belongs there; if it touches a sprite, it belongs here.
 *
 * ## Depth
 *
 * Remote players draw in the same shallow depth band as the pet (see
 * OverworldScene's pet sprite at depth 5) and, like it, are NOT y-sorted
 * against the scene's furniture. This scene has never y-sorted anything, so
 * a remote player standing "behind" a bench draws in front of it - the same
 * limitation the pet already has, inherited deliberately rather than
 * solving world-wide depth sorting inside a multiplayer change.
 */

import Phaser from "phaser";
import { LayeredCharacter } from "../../ui/LayeredCharacter";
import { EquippedWardrobe } from "../../wardrobeCatalog";
import { DEFAULT_BODY_PIECE_ID } from "../../wardrobeCatalog";
import { LPC_RIG, headTopY, idleFrame, resolveRig } from "../../characterRig";
import { Theme } from "../../ui/Theme";
import { isolateWorldObject } from "../../ui/sceneCameraSplit";
import { Direction, Emote, PresenceDelta, PresencePlayer } from "../../api/realtimeProtocol";
import { RemotePlayerStore } from "./remotePlayerState";

/** How long an emote bubble stays up. Long enough to read across the room, short enough not to litter the floor with them. */
const EMOTE_DURATION_MS = 2600;

/** Gap in pixels between the top of a character's head and their name tag. */
const NAME_TAG_GAP = 10;

/** Additional gap above the name tag for an emote bubble, so the two never overlap. */
const EMOTE_GAP = 18;

/**
 * What each emote draws. Glyphs rather than the project's procedurally
 * drawn pixel art, deliberately: an emote is transient chrome floating over
 * a character for two seconds, not a worn item, so the argument that sank
 * emoji for Item Shop accessories ("read as floating near the HUD, not on
 * the person" - see itemCatalog.ts) does not apply. "GG" is a word because
 * there is no glyph for it that reads as anything.
 */
const EMOTE_GLYPH: Record<Emote, string> = {
  wave: "👋",
  cheer: "🎉",
  laugh: "😄",
  cry: "😢",
  thumbsup: "👍",
  shock: "😮",
  heart: "❤️",
  gg: "GG"
};

interface RemoteSprites {
  base: Phaser.GameObjects.Sprite;
  layers: LayeredCharacter;
  nameTag: Phaser.GameObjects.Text;
  emote?: { text: Phaser.GameObjects.Text; expiresAt: number };
  /** The body piece the walk animation keys are built from - cached so the per-frame animation call doesn't re-read the texture key. */
  bodyKey: string;
}

export interface RemotePlayersOptions {
  /**
   * The scale a character is drawn at, matching whatever OverworldScene
   * uses for the local player (rig `displayScale`, times the mobile boost).
   * Passed in rather than recomputed so the local player and everyone else
   * can never end up different sizes on the same screen.
   */
  scaleFor: (bodyTextureKey: string) => number;
}

export class RemotePlayers {
  private readonly scene: Phaser.Scene;
  private readonly options: RemotePlayersOptions;
  private readonly store = new RemotePlayerStore();
  private readonly sprites = new Map<string, RemoteSprites>();

  constructor(scene: Phaser.Scene, options: RemotePlayersOptions) {
    this.scene = scene;
    this.options = options;
  }

  /** How many other players are currently on the floor - drives OverworldScene's "N others here" readout. */
  get count(): number {
    return this.store.size;
  }

  setRoster(players: PresencePlayer[]): void {
    const { removed } = this.store.applyRoster(players);
    for (const id of removed) this.destroySprites(id);
    for (const player of players) this.ensureSprites(player.id);
  }

  add(player: PresencePlayer): void {
    this.store.upsert(player);
    this.ensureSprites(player.id);
  }

  remove(id: string): void {
    this.store.remove(id);
    this.destroySprites(id);
  }

  /** Applies one server tick of movement. The drawn positions catch up over the following frames - see remotePlayerState.ts. */
  applyDeltas(deltas: PresenceDelta[]): void {
    this.store.applyDeltas(deltas);
  }

  /** A player changed what they're wearing; rebuild their layer stack on the next frame. */
  updateAppearance(player: PresencePlayer): void {
    this.store.upsert(player);
    this.ensureSprites(player.id);
  }

  /**
   * Pops an emote bubble over a player. Unknown ids are ignored rather than
   * spawning an orphan bubble: the sender may have walked off the floor
   * between sending it and this arriving.
   */
  showEmote(id: string, emote: Emote): void {
    const sprites = this.sprites.get(id);
    if (!sprites) return;

    sprites.emote?.text.destroy();
    const text = this.scene.add
      .text(sprites.base.x, sprites.base.y, EMOTE_GLYPH[emote], {
        fontSize: "20px",
        color: Theme.textPrimary,
        stroke: "#2e211a",
        strokeThickness: 4
      })
      .setOrigin(0.5, 1)
      .setDepth(6);
    isolateWorldObject(this.scene, text);

    sprites.emote = { text, expiresAt: this.scene.time.now + EMOTE_DURATION_MS };
  }

  /**
   * Removes every remote player without touching the store's knowledge of
   * them. Used when the local player walks into a game screen: they stop
   * being on the floor, so their presence subscription ends and the
   * sprites go, but nothing here needs to remember a roster it will be
   * handed fresh on the way back.
   */
  clear(): void {
    for (const id of [...this.sprites.keys()]) this.destroySprites(id);
    this.store.clear();
  }

  /** Frees every sprite. Call from the scene's shutdown handler. */
  destroy(): void {
    this.clear();
  }

  /**
   * One frame of rendering: ease positions, drive walk animations, move the
   * name tags, expire emote bubbles.
   *
   * Called from OverworldScene's own `update()` rather than a POST_UPDATE
   * listener (which is what the LOCAL player needs, because Arcade Physics
   * writes its position after update() returns). Remote players have no
   * physics body at all - their positions are written right here - so there
   * is nothing to wait for.
   */
  update(deltaMs: number): void {
    this.store.advance(deltaMs);
    const now = this.scene.time.now;

    for (const state of this.store.all()) {
      const sprites = this.sprites.get(state.id);
      if (!sprites) continue;

      if (state.appearanceDirty) {
        this.applyWardrobe(sprites, state.wardrobe);
        this.store.markAppearanceApplied(state.id);
      }

      sprites.base.setPosition(state.x, state.y);
      this.playDirection(sprites, state.dir, state.moving);
      // Overlays are pulled onto the base AFTER it has been positioned and
      // its frame set - the same ordering the local player's POST_UPDATE
      // sync guarantees, and for the same reason: a sync that ran first
      // would draw this frame's clothes at last frame's position.
      sprites.layers.sync();

      sprites.nameTag.setPosition(
        state.x,
        headTopY(this.rigFor(sprites.bodyKey), state.y, sprites.base.displayHeight) - NAME_TAG_GAP
      );

      if (sprites.emote) {
        if (now >= sprites.emote.expiresAt) {
          sprites.emote.text.destroy();
          sprites.emote = undefined;
        } else {
          sprites.emote.text.setPosition(state.x, sprites.nameTag.y - EMOTE_GAP);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private ensureSprites(id: string): void {
    if (this.sprites.has(id)) return;
    const state = this.store.get(id);
    if (!state) return;

    // Plain sprite, not a physics one: remote players are moved by
    // interpolation, never by the physics engine, and giving them Arcade
    // bodies would mean the local player could be shoved around the floor
    // by someone else's forged position - the exact thing the "presence is
    // cosmetic" trust model depends on NOT being possible. They are drawn
    // through, not collided with.
    const bodyKey = bodyTextureKey(state.wardrobe);
    const base = this.scene.add
      .sprite(state.x, state.y, bodyKey, idleFrame(resolveRig(bodyKey), state.dir))
      .setDepth(4);

    const nameTag = this.scene.add
      .text(state.x, state.y, state.username, {
        fontSize: "11px",
        color: Theme.textPrimary,
        stroke: "#2e211a",
        strokeThickness: 3
      })
      .setOrigin(0.5, 1)
      .setDepth(6);

    // World-space objects created after create()'s synchronous pass must
    // opt out of the UI camera or they render twice - once correctly via
    // the zoomed main camera, once undistorted via the UI camera. See
    // ui/sceneCameraSplit.ts.
    isolateWorldObject(this.scene, [base, nameTag]);

    const layers = new LayeredCharacter(this.scene, base, { rig: LPC_RIG });
    const sprites: RemoteSprites = { base, layers, nameTag, bodyKey };
    this.sprites.set(id, sprites);

    this.applyWardrobe(sprites, state.wardrobe);
    this.store.markAppearanceApplied(id);
  }

  private applyWardrobe(sprites: RemoteSprites, wardrobe: Record<string, string>): void {
    sprites.layers.apply(wardrobe as EquippedWardrobe);
    // apply() may have swapped the base texture to a different body piece,
    // so re-read it rather than trusting the key computed at spawn.
    sprites.bodyKey = sprites.base.texture.key;
    sprites.base.setScale(this.options.scaleFor(sprites.bodyKey));
    sprites.layers.sync();
    // Overlays are created by apply() and are world-space objects born
    // outside create() - same UI-camera caveat as the base sprite above.
    isolateWorldObject(this.scene, sprites.layers.displayObjects);
  }

  private playDirection(sprites: RemoteSprites, dir: Direction, moving: boolean): void {
    const key = `${sprites.bodyKey}_walk_${dir}`;
    if (moving) {
      // `true` = ignore-if-already-playing, so this is a cheap no-op on
      // every frame a player keeps walking the same way.
      if (this.scene.anims.exists(key)) sprites.base.play(key, true);
      return;
    }
    sprites.base.stop();
    sprites.base.setFrame(idleFrame(this.rigFor(sprites.bodyKey), dir));
  }

  private rigFor(bodyKey: string) {
    return resolveRig(bodyKey);
  }

  private destroySprites(id: string): void {
    const sprites = this.sprites.get(id);
    if (!sprites) return;
    sprites.emote?.text.destroy();
    sprites.nameTag.destroy();
    sprites.layers.destroy();
    sprites.base.destroy();
    this.sprites.delete(id);
  }
}

/**
 * The texture key for a wardrobe's body piece, falling back to the free
 * default. Mirrors what `resolveLayers` guarantees, but needed BEFORE the
 * LayeredCharacter exists, since a sprite has to be created with some
 * texture before anything can be applied to it.
 */
function bodyTextureKey(wardrobe: Record<string, string>): string {
  return wardrobe.BODY ?? DEFAULT_BODY_PIECE_ID;
}
