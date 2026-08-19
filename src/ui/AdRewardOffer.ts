import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "./Theme";
import { makeButton, makePanel } from "./uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { AD_REWARD_GC_AMOUNT } from "../economy/adRewards";

/**
 * "Watch an Ad" offer at the overworld Ad Kiosk. GC only, server-
 * authoritative (POST /ads/claim - see server/src/economy/adRewards.ts).
 *
 * IMPORTANT - this is a SIMULATED ad, not a real one: this project has no
 * real ad-network integration (no publisher account/SDK credentials exist
 * or can be created here - see that doc comment for the full explanation).
 * The "Ad playing..." countdown below is a placeholder standing in for an
 * actual video ad, exactly like packages.ts's purchasePackage simulates
 * "payment succeeded" until a real payment gateway exists. Swapping in a
 * real ad SDK later means replacing `playSimulatedAd`'s countdown with a
 * real ad-completion callback before calling `api.claimAdReward()` - the
 * offer/result UI around it doesn't need to change.
 */

const PANEL_W = 440;
const PANEL_H = 240;
const AD_DURATION_S = 4;

/**
 * Shows the offer at (x, y) in `scene`. Fires `onComplete` exactly once,
 * after the player either declines, successfully claims, or the claim
 * fails (including a COOLDOWN response, if the button was somehow shown
 * stale - the server is always the real authority regardless of what the
 * client's optimistic `gameState.adRewardCooldownRemainingMs` said).
 *
 * `onBalanceChange` (optional, same pattern as TripleChanceOffer.ts): fires
 * once, right after `gameState.hydrateFromServer()`, so a caller with a
 * persistent on-screen balance (OverworldScene's corner HUD) can refresh it
 * immediately instead of only once this whole offer completes.
 */
export function offerAdReward(
  scene: Phaser.Scene,
  x: number,
  y: number,
  onComplete: () => void,
  onBalanceChange?: () => void
): void {
  showOffer(scene, x, y, undefined, onComplete, onBalanceChange);
}

function showOffer(
  scene: Phaser.Scene,
  x: number,
  y: number,
  errorMessage: string | undefined,
  onComplete: () => void,
  onBalanceChange?: () => void
) {
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
    .text(x, y - 44, `Watch a short ad to earn ${AD_REWARD_GC_AMOUNT} Gold Coins.`, {
      fontSize: "12px",
      color: Theme.textMuted,
      align: "center",
      wordWrap: { width: PANEL_W - 60 }
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(401);
  const errorText = errorMessage
    ? scene.add
        .text(x, y - 14, errorMessage, { fontSize: "11px", color: Theme.textDanger, align: "center", wordWrap: { width: PANEL_W - 60 } })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(401)
    : null;

  const cleanup = () => {
    panel.destroy();
    title.destroy();
    sub.destroy();
    errorText?.destroy();
    watchBtn.destroy();
    declineBtn.destroy();
  };

  const watchBtn = makeButton(scene, x - 100, y + 60, 170, 46, "▶️ Watch Ad", Theme.accent, Theme.accentHover, () => {
    cleanup();
    playSimulatedAd(scene, x, y, onComplete, onBalanceChange);
  });
  watchBtn.container.setScrollFactor(0).setDepth(401);

  const declineBtn = makeButton(scene, x + 100, y + 60, 170, 46, "Not Now", Theme.neutral, Theme.neutralHover, () => {
    cleanup();
    onComplete();
  });
  declineBtn.container.setScrollFactor(0).setDepth(401);
}

/**
 * The simulated "ad" itself - a fixed-length countdown with a filling
 * progress bar, no skip button (matches how real rewarded-ad flows work:
 * the reward is contingent on watching the whole thing). Purely cosmetic
 * timing; nothing here talks to the server until it completes, at which
 * point the real, server-authoritative POST /ads/claim call happens.
 */
function playSimulatedAd(
  scene: Phaser.Scene,
  x: number,
  y: number,
  onComplete: () => void,
  onBalanceChange?: () => void
) {
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
      countText.setText(secondsLeft > 0 ? `${secondsLeft}` : "Claiming...");
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
    api
      .claimAdReward()
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        onBalanceChange?.();
        showResult(scene, x, y, res.granted.gcAmount, onComplete);
      })
      .catch((err) => {
        const message =
          err instanceof ApiError && err.code === "COOLDOWN"
            ? "That ad reward isn't ready again yet - try again in a bit."
            : err instanceof ApiError || err instanceof NetworkError
              ? err.message
              : "Something went wrong - please try again.";
        showOffer(scene, x, y, message, onComplete, onBalanceChange);
      });
  });
}

function showResult(scene: Phaser.Scene, x: number, y: number, gcGained: number, onComplete: () => void) {
  const panel = makePanel(scene, x, y, PANEL_W, PANEL_H, 400).setScrollFactor(0);
  const title = scene.add
    .text(x, y - 40, `🎉 +${gcGained} Gold Coins!`, {
      fontSize: "20px",
      color: Theme.textGold,
      fontStyle: "bold"
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(401);
  const sub = scene.add
    .text(x, y, "Thanks for watching!", { fontSize: "13px", color: Theme.textMuted })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(401);

  const okBtn = makeButton(scene, x, y + 60, 170, 46, "Nice!", Theme.accent, Theme.accentHover, () => {
    panel.destroy();
    title.destroy();
    sub.destroy();
    okBtn.destroy();
    onComplete();
  });
  okBtn.container.setScrollFactor(0).setDepth(401);
}
