import Phaser from "phaser";
import { Theme } from "./Theme";
import { makeButton, makePanel } from "./uiHelpers";
import { isolateFixedUi } from "./sceneCameraSplit";

/**
 * "Watch an Ad?" gate for the overworld Coin Kiosk (formerly the "Chip
 * Attendant" - see src/scenes/OverworldScene.ts's openCoinKiosk() and
 * src/economy/attendantClaim.ts's doc comment for the full history). This
 * module is ONLY the ad-watching UI - it does no claiming itself. Clicking
 * the watch button calls `onWatched()` immediately and the caller takes it
 * from there (OverworldScene chains straight into the existing shuffle-cup
 * mini-game + Triple Chance + result flow, reusing the exact same claim
 * mechanics the Chip Attendant used).
 *
 * Per user direction ("have the button say 'watch ad for additional
 * tickets' instead of making the player wait"), there's no simulated
 * countdown any more - a previous version played a fake 4s "ad" timer
 * before calling onWatched; that's gone, the button itself IS the ad-watch
 * signal now. Still a SIMULATED ad in the sense that no real ad network is
 * involved (see this project's other placeholder flows, e.g. packages.ts's
 * purchasePackage "payment succeeded") - there's just no artificial delay
 * standing in for one any more.
 */

const PANEL_W = 440;
const PANEL_H = 240;

/**
 * Shows the offer at (x, y) in `scene`. Fires exactly one of `onWatched`
 * (the player chose to watch) or `onDecline` (chose not to).
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
    .text(x, y - 44, "Watch an ad, then shuffle the cups for your Gold Coins!", {
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

  const watchBtn = makeButton(
    scene,
    x - 100,
    y + 60,
    190,
    46,
    "🪙 Watch Ad for\nAdditional Gold Coins",
    Theme.accent,
    Theme.accentHover,
    () => {
      cleanup();
      onWatched();
    }
  );
  watchBtn.container.setScrollFactor(0).setDepth(401);

  const declineBtn = makeButton(scene, x + 110, y + 60, 150, 46, "Not Now", Theme.neutral, Theme.neutralHover, () => {
    cleanup();
    onDecline();
  });
  declineBtn.container.setScrollFactor(0).setDepth(401);

  // Screen-fixed - safe to call even in a scene with no zoomed main camera
  // (e.g. RoomScene doesn't use this offer today) - see
  // ui/sceneCameraSplit.ts's header.
  isolateFixedUi(scene, [panel, title, sub, watchBtn.container, declineBtn.container]);
}
