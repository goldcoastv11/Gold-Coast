import Phaser from "phaser";
import { LayeredCharacter } from "./LayeredCharacter";
import { EquippedWardrobe, DEFAULT_BODY_PIECE_ID } from "../wardrobeCatalog";
import { LPC_RIG, idleFrame } from "../characterRig";

/**
 * A single static, non-animating standing portrait, built from
 * LayeredCharacter - reused wherever a small character needs to sit next
 * to some other UI (currently ui/LeaderboardPanel.ts) rather than forking
 * a second copy of the layering/degradation rules LayeredCharacter.ts
 * already owns.
 *
 * "Static" just means the caller never has to call `sync()` again after
 * this returns: unlike the overworld/room player, a portrait's base sprite
 * never moves, changes frame, or flips, so the one apply() call inside
 * here (which itself ends with a sync()) is the whole job. All of
 * LayeredCharacter's own guarantees carry over unchanged - an all-default
 * wardrobe still renders a body (never an invisible portrait), and a piece
 * whose art hasn't loaded is skipped for that layer rather than crashing.
 *
 * The base sprite is created facing the camera (idleFrame(LPC_RIG, "down"))
 * - a sensible, readable single frame for a name-tag-sized portrait, same
 * direction the player spawns facing.
 *
 * Ownership follows LayeredCharacter's own doc comment: the base sprite is
 * the CALLER's (this function's) to own and position, not the class's -
 * this function is that caller. Returns the LayeredCharacter itself so a
 * caller can read `.displayObjects` (base + every overlay, already in
 * correct bottom-to-top draw order) to reparent the whole stack into a
 * container, apply a shared mask, or destroy it.
 */
export function createCharacterPortrait(
  scene: Phaser.Scene,
  equipped: EquippedWardrobe,
  x: number,
  y: number,
  scale: number
): LayeredCharacter {
  const base = scene.add.sprite(x, y, DEFAULT_BODY_PIECE_ID, idleFrame(LPC_RIG, "down"));
  base.setOrigin(0.5, 0.5);
  base.setScale(scale);
  const layered = new LayeredCharacter(scene, base, { rig: LPC_RIG });
  layered.apply(equipped);
  return layered;
}
