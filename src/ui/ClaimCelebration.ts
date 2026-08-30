import Phaser from "phaser";
import { Tokens } from "./DesignTokens";
import { makeText } from "./uiHelpers";
import { playSfx } from "./SoundManager";
import { isolateFixedUi } from "./sceneCameraSplit";

/**
 * The payoff moment for a challenge claim, and the level-up that a claim can
 * trigger.
 *
 * Modelled directly on WinCelebration.ts (full-screen flash behind a
 * popped-in centre label, self-cleaning, no handle for the caller to manage,
 * nothing to tear down on scene shutdown) so the two read as the same game -
 * but deliberately QUIETER than it. A game win is the loud moment; claiming
 * a challenge is a smaller, calmer "here you go". So: the token accent
 * rather than WinCelebration's gold, a 0.16 flash rather than 0.32, ~34px
 * type rather than 64px, no stroke, and the token motion durations rather
 * than hand-picked ones. It should feel like the same family, one notch down.
 *
 * Purely presentational. Callers pass amounts the SERVER already confirmed
 * and credited; nothing here touches the ledger or decides anything.
 *
 * ECONOMY: challenge and level rewards are Gold Coins plus XP - the only
 * currency there is now (repo-root CLAUDE.md; TICKETS is retired) - hence
 * the wording below, which must not be "generalised" into a
 * currency-agnostic amount.
 */

/** Above every panel in the calling scene, and above the toast (depth 210). Matches WinCelebration's band. */
const DEPTH = 900;

/**
 * "+150 GOLD COINS / +40 XP" over a brief accent flash. A no-op for a
 * non-positive reward, so a caller can pass a claim response straight
 * through without its own guard.
 */
export function showClaimCelebration(scene: Phaser.Scene, rewardGc: number, rewardXp: number): void {
  if (!(rewardGc > 0) && !(rewardXp > 0)) return;

  playSfx(scene, "confirm");

  const { width, height } = scene.scale;

  const flash = scene.add
    .rectangle(width / 2, height / 2, width, height, Tokens.color.accent, 0.16)
    .setScrollFactor(0)
    .setDepth(DEPTH);
  scene.tweens.add({
    targets: flash,
    alpha: 0,
    duration: Tokens.motion.duration.dwell / 2,
    ease: Tokens.motion.ease.out,
    onComplete: () => flash.destroy()
  });

  const group = scene.add.container(width / 2, height / 2).setScrollFactor(0).setDepth(DEPTH + 1);

  const amount = makeText(scene, 0, -12, `+${Math.round(rewardGc).toLocaleString("en-US")} GOLD COINS`, {
    size: Tokens.type.glyph.lg,
    weight: Tokens.type.weight.bold,
    color: Tokens.text.accent,
    align: "center",
    originX: 0.5,
    originY: 0.5,
    tracking: Tokens.type.tracking.caps
  });
  const xp = makeText(scene, 0, 20, `+${Math.round(rewardXp).toLocaleString("en-US")} XP`, {
    size: Tokens.type.size.xxl,
    weight: Tokens.type.weight.semibold,
    color: Tokens.text.primary,
    align: "center",
    originX: 0.5,
    originY: 0.5
  });
  group.add([amount, xp]);
  group.setScale(0.86).setAlpha(0);
  // Screen-fixed - see ui/sceneCameraSplit.ts's header.
  isolateFixedUi(scene, [flash, group]);

  // Pop -> hold -> fade. The emphasis ease is allowed here for the same
  // reason uiHelpers' popIn allows it: this is a result number settling
  // into place, which is the one thing the system lets overshoot a hair.
  scene.tweens.chain({
    targets: group,
    tweens: [
      { scale: 1, alpha: 1, duration: Tokens.motion.duration.slow, ease: Tokens.motion.ease.emphasis },
      {
        alpha: 0,
        duration: Tokens.motion.duration.slow,
        ease: Tokens.motion.ease.out,
        delay: Tokens.motion.duration.dwell
      }
    ],
    onComplete: () => group.destroy()
  });
}

/**
 * A level-up banner, shown after `showClaimCelebration` when a claim's XP
 * crossed a level boundary - the "levelling up mid-session must be visible,
 * not silent" case.
 *
 * Sits at the TOP of the screen rather than the centre so it can't fight the
 * claim celebration it follows, and it names all three things a level is
 * worth (the number, the Gold Coins it paid, and the cosmetic it granted, if
 * any). `cosmeticName` is already resolved by the caller (challengeDisplay's
 * cosmeticName) - this module does no catalog lookups of its own.
 *
 * Multiple levels in one claim (possible with a big achievement) stack as a
 * staggered sequence rather than overlapping, one banner per level.
 */
export function showLevelUpCelebration(
  scene: Phaser.Scene,
  grants: Array<{ level: number; rewardGc: number; cosmeticName: string | null }>
): void {
  if (grants.length === 0) return;

  grants.forEach((grant, i) => {
    scene.time.delayedCall(i * (Tokens.motion.duration.dwell + Tokens.motion.duration.slow), () => {
      showOneLevelUp(scene, grant);
    });
  });
}

function showOneLevelUp(
  scene: Phaser.Scene,
  grant: { level: number; rewardGc: number; cosmeticName: string | null }
): void {
  playSfx(scene, "bigWin");

  const { width } = scene.scale;
  // Inside the measured mobile-crop-safe band (see uiHelpers' SAFE_ZONE_TOP
  // = 130): a celebration nobody on a phone can see is not a celebration.
  const cy = 168;

  const container = scene.add.container(width / 2, cy).setScrollFactor(0).setDepth(DEPTH + 2);

  const lines: string[] = [`+${Math.round(grant.rewardGc).toLocaleString("en-US")} Gold Coins`];
  if (grant.cosmeticName) lines.push(`Unlocked: ${grant.cosmeticName}`);

  const heading = makeText(scene, 0, -14, `LEVEL ${grant.level}`, {
    size: Tokens.type.size.xxxl,
    weight: Tokens.type.weight.bold,
    color: Tokens.text.accent,
    align: "center",
    originX: 0.5,
    originY: 0.5,
    tracking: Tokens.type.tracking.caps
  });
  const detail = makeText(scene, 0, 16, lines.join("   ·   "), {
    size: Tokens.type.size.lg,
    weight: Tokens.type.weight.medium,
    color: Tokens.text.primary,
    align: "center",
    originX: 0.5,
    originY: 0.5
  });

  // A panel-coloured plate behind the text, sized from the text itself, so
  // the banner stays legible over whatever the panel underneath is showing.
  const plateW = Math.max(heading.width, detail.width) + Tokens.space.xxxl * 2;
  const plateH = 76;
  const plate = scene.add.graphics();
  plate.fillStyle(Tokens.color.surface, 0.96);
  plate.fillRoundedRect(-plateW / 2, -plateH / 2, plateW, plateH, Tokens.radius.lg);

  container.add([plate, heading, detail]);
  container.setAlpha(0).setY(cy - Tokens.space.md);
  // Screen-fixed - see ui/sceneCameraSplit.ts's header.
  isolateFixedUi(scene, container);

  scene.tweens.chain({
    targets: container,
    tweens: [
      { alpha: 1, y: cy, duration: Tokens.motion.duration.slow, ease: Tokens.motion.ease.out },
      {
        alpha: 0,
        duration: Tokens.motion.duration.slow,
        ease: Tokens.motion.ease.out,
        delay: Tokens.motion.duration.dwell
      }
    ],
    onComplete: () => container.destroy()
  });
}
