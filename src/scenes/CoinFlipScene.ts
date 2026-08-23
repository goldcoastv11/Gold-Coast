import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import type { CoinSide } from "../api/types";

export class CoinFlipScene extends Phaser.Scene {
  private coinText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private headsBtn?: UIButton;
  private tailsBtn?: UIButton;
  private flipping = false;
  private flipTimer?: Phaser.Time.TimerEvent;
  private betControl?: BetControl;
  /** Onboarding tutorial's "Play a Game" hands-on step - see gameState.tutorialAwaitingGamePlay's doc comment and OverworldScene.runHandsOnGameStep. */
  private tutorialHint?: Phaser.GameObjects.Text;

  constructor() {
    super("CoinFlipScene");
  }

  create() {
    fadeInOnCreate(this);
    this.flipping = false;
    this.flipTimer = undefined;
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.flipTimer) {
        this.flipTimer.remove(false);
        this.flipTimer = undefined;
      }
    });

    makePanel(this, 400, 300, 460, 420);

    this.add
      .text(400, 130, "COIN FLIP", {
        fontSize: "28px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    makeInset(this, 400, 165, 340, 32, 16);
    this.balanceText = this.add
      .text(400, 165, "", { fontSize: "13px", color: Theme.textPrimary })
      .setOrigin(0.5);

    this.coinText = this.add.text(400, 260, "🪙", { fontSize: "90px" }).setOrigin(0.5);

    this.messageText = this.add
      .text(400, 340, "Pick a side to flip", { fontSize: "16px", color: Theme.textMuted })
      .setOrigin(0.5);

    this.headsBtn = makeButton(
      this,
      300,
      400,
      160,
      50,
      "HEADS",
      Theme.accent,
      Theme.accentHover,
      () => this.flip("heads")
    );
    this.tailsBtn = makeButton(
      this,
      500,
      400,
      160,
      50,
      "TAILS",
      Theme.accent,
      Theme.accentHover,
      () => this.flip("tails")
    );

    const walkAwayBtn = makeButton(this, 400, 450, 200, 36, "WALK AWAY", Theme.danger, Theme.dangerHover, () => {
      // Leaving without ever flipping shouldn't leave a stale flag behind
      // - a LATER, unrelated visit to Coin Flip would otherwise incorrectly
      // show the tutorial highlight again. See resolveFlip() for the
      // normal (played-a-real-round) path that also clears this.
      gameState.tutorialAwaitingGamePlay = false;
      fadeToScene(this, "OverworldScene");
    });
    // Onboarding tutorial's "Play a Game" hands-on step - per user
    // direction, WALK AWAY needs to be unclickable here: it exits back to
    // the Overworld WITHOUT setting tutorialResumeAtSkinAttendant (by
    // design - leaving without playing shouldn't count as "played"), so
    // using it mid-tutorial silently dropped the player out of the
    // tutorial with no Skin Attendant step ever appearing. Disabling it
    // for this one step forces a real round to be played (or the
    // Overworld instruction bubble's own Skip button, before ever walking
    // in) instead of a dead end.
    if (gameState.tutorialAwaitingGamePlay) {
      walkAwayBtn.setEnabled(false);
    }

    this.betControl = makeBetControl(this, 400, 486, () => {});

    this.add
      .text(400, 516, "Pays 2x", { fontSize: "11px", color: Theme.textMuted })
      .setOrigin(0.5);

    // Onboarding tutorial's "Play a Game" hands-on step (see
    // gameState.tutorialAwaitingGamePlay's doc comment) - the player
    // walked up and pressed E for real (this is a completely ordinary
    // entry into CoinFlipScene, no tutorial-specific transition logic
    // involved). Per user direction, the ring itself only belongs out in
    // the Overworld pointing at the station (see
    // OverworldScene.runHandsOnGameStep) - once the real game screen is
    // actually open, no ring overlays the real HEADS/TAILS buttons, just
    // this small hint banner. Still waits for one real round to resolve
    // (see resolveFlip()) before returning to the Overworld to resume the
    // tutorial.
    if (gameState.tutorialAwaitingGamePlay) {
      this.tutorialHint = this.add
        .text(400, 30, "Tutorial: pick Heads or Tails to flip!", {
          fontSize: "13px",
          color: Theme.textGold,
          fontStyle: "bold",
          // Contrast sweep: this used to be a warm-cream "#fdf3e1e6" chip,
          // a leftover from the old light theme - unreadable-ish (light
          // gold text on a near-white chip) against the new dark palette.
          // Text's own backgroundColor only accepts a CSS string (not a
          // Theme.* numeric token), so this matches Theme.panel's hex at
          // ~90% opacity instead, same pattern as OverworldScene's
          // CHIP_BG_SOFT constant.
          backgroundColor: "#1a2138e6",
          padding: { x: 10, y: 6 }
        })
        .setOrigin(0.5)
        .setDepth(600);
    }

    this.updateBalance();
  }

  /** #36: the coin's real outcome is resolved server-side (POST /games/coinflip/play) - the flip animation here is purely cosmetic while the request is in flight. */
  private flip(guess: CoinSide) {
    if (this.flipping) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Tickets!").setColor(Theme.textDanger);
      return;
    }

    // Onboarding tutorial's "Play a Game" hands-on step - the hint banner's
    // whole job is showing the player what to do. The instant they actually
    // click Heads/Tails for real, that job is done - clear it here, not in
    // resolveFlip(). tutorialAwaitingGamePlay itself (which gates the
    // tutorial STEP actually advancing - flag clear, resume-at-Skin-
    // Attendant flag, the delayed scene transition) deliberately still
    // waits for resolveFlip(), since that's about the real round genuinely
    // completing, not just a click being made.
    this.tutorialHint?.destroy();
    this.tutorialHint = undefined;

    const bet = gameState.betAmount;
    this.flipping = true;
    this.headsBtn?.setEnabled(false);
    this.tailsBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Flipping...").setColor(Theme.textMuted);

    let ticks = 0;
    this.flipTimer = this.time.addEvent({
      delay: 90,
      loop: true,
      callback: () => {
        if (this.coinText.active) {
          this.coinText.setText(ticks % 2 === 0 ? "🪙" : "🟡");
        }
        ticks++;
      }
    });

    api
      .playCoinFlip(bet, "GC", guess)
      .then((res) => this.resolveFlip(res))
      .catch((err) => this.handleFlipError(err));
  }

  private resolveFlip(res: Awaited<ReturnType<typeof api.playCoinFlip>>) {
    this.flipTimer?.remove(false);
    this.flipTimer = undefined;

    gameState.hydrateFromServer(res.user);
    this.coinText.setText("🪙");

    const { result, won, payout } = res.result;
    if (won) {
      this.messageText.setText(`${result.toUpperCase()}! You win +${payout} Tickets`).setColor(Theme.textAccent);
      popIn(this, this.coinText);
    } else {
      this.messageText.setText(`${result.toUpperCase()} - you lose`).setColor(Theme.textDanger);
    }

    this.updateBalance();
    this.flipping = false;
    this.headsBtn?.setEnabled(true);
    this.tailsBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);

    // Onboarding tutorial's "Play a Game" hands-on step - a real round
    // (win OR lose, either counts as "played") just resolved for real, so
    // the tutorial's task here is done. Let the player see this result for
    // a beat, then send them back to the Overworld to resume at the Skin
    // Attendant step - see gameState.tutorialResumeAtSkinAttendant's doc
    // comment and OverworldScene.create()'s resume check.
    if (gameState.tutorialAwaitingGamePlay) {
      gameState.tutorialAwaitingGamePlay = false;
      gameState.tutorialResumeAtSkinAttendant = true;
      // Re-disable right away (already re-enabled above, matching the
      // normal non-tutorial flow) so a second flip can't slip in during
      // the delay below and race the scene transition.
      this.headsBtn?.setEnabled(false);
      this.tailsBtn?.setEnabled(false);
      this.betControl?.setEnabled(false);
      this.time.delayedCall(1200, () => {
        fadeToScene(this, "OverworldScene");
      });
    }
  }

  private handleFlipError(err: unknown) {
    this.flipTimer?.remove(false);
    this.flipTimer = undefined;
    this.coinText.setText("🪙");

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Tickets!").setColor(Theme.textDanger);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Theme.textDanger);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Theme.textDanger);
    }

    this.flipping = false;
    this.headsBtn?.setEnabled(true);
    this.tailsBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(`🎟️ ${gameState.goldCoins}   💰 ${gameState.stakeCoins}`);
  }
}
