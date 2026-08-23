import Phaser from "phaser";
import { Theme } from "./Theme";
import { makeButton, makePanel } from "./uiHelpers";

/**
 * "Watch an Ad?" gate for the overworld Coin Kiosk (formerly the "Chip
 * Attendant" - see src/scenes/OverworldScene.ts's openCoinKiosk() and
 * src/economy/attendantClaim.ts's doc comment for the full history). Per
 * user direction ("have the ad kiosk start the game after the ad is
 * watched"), this module is ONLY the ad-watching UI (offer + countdown) -
 * it does no claiming itself. When the simulated ad finishes, it calls
 * `onWatched()` and the caller takes it from there (OverworldScene chains
 * straight into the existing shuffle-cup mini-game + Triple Chance + result
 * flow, reusing the exact same claim mechanics the Chip Attendant used).
 *
 * IMPORTANT - this is a SIMULATED ad, not a real one, same placeholder
 * pattern as packages.ts's purchasePackage "payment succeeded" and the
 * former Ad Kiosk feature this supersedes (see git history - the
 * standalone Ad Kiosk station/claim this was extracted from has been
 * retired; server/src/economy/adRewards.ts and its routes are unused now
 * but deliberately left in place rather than deleted, to avoid touching
 * already-applied DB migrations for a pure cleanup with no functional
 * benefit).
 */

const PANEL_W = 440;
const PANEL_H = 240;
const AD_DURATION_S = 4;

/**
 * Shows the offer at (x, y) in `scene`. Fires exactly one of `onWatched`
 * (ad played all the way through) or `onDecline` (player backed out before
 * or during - "Not Now" only appears before the countdown starts, matching
 * how real rewarded-ad flows work: no skip once it's playing).
 */
export function offerCoinKiosk(
  scene: Phaser.Scene,
  x: number,
  y: number,
  onWatched: () => void,
  onDecline: () => void
): void {
  const panel = makePanel(scene, x, y, PANEL_W, PANEL_H, 400).setScrollFactor(0);
  const title = scene.add
    .text(x, y - 80, "📺 Watch an Ad?", {
      fontSize: "18px",
      color: Theme.textGold,
      fontStyle: "bold"
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(401);
  const sub = scene.add
    .text(x, y - 44, "Watch a short ad, then shuffle the cups for your Tickets!", {
      fontSize: "12px",
      color: Theme.textMuted,
      align: "center",
      wordWrap: { width: PANEL_W - 60 }
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(401);

  const cleanup = () => {
    panel.destroy();
    title.destroy();
    sub.destroy();
    watchBtn.destroy();
    declineBtn.destroy();
  };

  const watchBtn = makeButton(scene, x - 100, y + 60, 170, 46, "▶️ Watch Ad", Theme.accent, Theme.accentHover, () => {
    cleanup();
    playSimulatedAd(scene, x, y, onWatched);
  });
  watchBtn.container.setScrollFactor(0).setDepth(401);

  const declineBtn = makeButton(scene, x + 100, y + 60, 170, 46, "Not Now", Theme.neutral, Theme.neutralHover, () => {
    cleanup();
    onDecline();
  });
  declineBtn.container.setScrollFactor(0).setDepth(401);
}

/**
 * The simulated "ad" itself - a fixed-length countdown with a filling
 * progress bar, no skip button. Purely cosmetic timing; calls `onWatched`
 * once it completes - no server call happens here, that's entirely the
 * caller's responsibility (see file header).
 */
function playSimulatedAd(scene: Phaser.Scene, x: number, y: number, onWatched: () => void) {
  const panel = makePanel(scene, x, y, PANEL_W, PANEL_H, 400).setScrollFactor(0);
  const title = scene.add
    .text(x, y - 80, "📺 Ad Playing...", { fontSize: "18px", color: Theme.textGold, fontStyle: "bold" })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(401);

  const barW = PANEL_W - 100;
  const barBg = scene.add.graphics().setScrollFactor(0).setDepth(401);
  barBg.fillStyle(Theme.inset, 1);
  barBg.fillRoundedRect(x - barW / 2, y - 10, barW, 20, 10);
  barBg.lineStyle(2, Theme.panelBorder, 1);
  barBg.strokeRoundedRect(x - barW / 2, y - 10, barW, 20, 10);

  const barFill = scene.add.graphics().setScrollFactor(0).setDepth(402);

  const countText = scene.add
    .text(x, y + 40, `${AD_DURATION_S}`, { fontSize: "14px", color: Theme.textMuted })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(401);

  let secondsLeft = AD_DURATION_S;
  const redrawFill = () => {
    const progress = (AD_DURATION_S - secondsLeft) / AD_DURATION_S;
    barFill.clear();
    barFill.fillStyle(Theme.accent, 1);
    if (progress > 0) barFill.fillRoundedRect(x - barW / 2, y - 10, barW * progress, 20, 10);
  };
  redrawFill();

  const tick = scene.time.addEvent({
    delay: 1000,
    repeat: AD_DURATION_S - 1,
    callback: () => {
      secondsLeft--;
      countText.setText(secondsLeft > 0 ? `${secondsLeft}` : "Starting...");
      redrawFill();
    }
  });

  const cleanup = () => {
    tick.remove(false);
    panel.destroy();
    title.destroy();
    barBg.destroy();
    barFill.destroy();
    countText.destroy();
  };

  scene.time.delayedCall(AD_DURATION_S * 1000, () => {
    cleanup();
    onWatched();
  });
}
