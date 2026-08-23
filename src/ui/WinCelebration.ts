import Phaser from "phaser";
import { Theme } from "./Theme";
import { playSfx } from "./SoundManager";

/**
 * Big, hard-to-miss win reaction for the 14 games (per user direction:
 * "make it a bigger reaction... have gold text flash across the whole
 * game screen"). Purely presentational - callers pass the amount of
 * TICKETS the server already confirmed as the payout; this never decides
 * win/lose or touches the ledger itself, and it's a no-op for a
 * non-positive payout so callers can pass a game's raw `payout` straight
 * through without their own `if (won)`/`if (payout > 0)` guard.
 *
 * Self-contained and self-cleaning: builds its own objects at a depth
 * above everything else in the calling scene (including the game shell's
 * panels and any modal dialogs), tweens itself in, flashes, then fades
 * out and destroys - no handle for the caller to manage, and nothing to
 * wire up on scene shutdown (a mid-animation scene swap just tears these
 * down with everything else Phaser already destroys).
 */
export function showWinCelebration(scene: Phaser.Scene, ticketsPayout: number): void {
  if (!(ticketsPayout > 0)) return;

  playSfx(scene, "confirm");

  const { width, height } = scene.scale;
  const DEPTH = 900; // above every game's own UI (panels/modals top out well under this)

  // Full-screen gold flash pulse behind the text - the "flash across the
  // whole game screen" half of the brief, not just a bigger message-box
  // label. Plain alpha fade rather than a blend mode, so it reads as a
  // warm flash without blowing out whatever's underneath.
  const flash = scene.add
    .rectangle(width / 2, height / 2, width, height, Theme.gold, 0.32)
    .setScrollFactor(0)
    .setDepth(DEPTH);
  scene.tweens.add({
    targets: flash,
    alpha: 0,
    duration: 550,
    ease: "Cubic.Out",
    onComplete: () => flash.destroy()
  });

  const label = scene.add
    .text(width / 2, height / 2, `+${ticketsPayout} TICKETS!`, {
      fontSize: "64px",
      color: Theme.textGold,
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 8
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(DEPTH + 1)
    .setScale(0.3)
    .setAlpha(0);

  // Pop in -> flash (a couple of quick alpha blinks, the literal "flash"
  // the text itself does) -> hold -> fade out -> destroy. Phaser's tween
  // chain runs these strictly in sequence on the same target.
  scene.tweens.chain({
    targets: label,
    tweens: [
      { scale: 1, alpha: 1, duration: 220, ease: "Back.Out" },
      { alpha: 0.35, duration: 90, yoyo: true, repeat: 2 },
      { alpha: 0, duration: 450, ease: "Cubic.In", delay: 500 }
    ],
    onComplete: () => label.destroy()
  });
}
