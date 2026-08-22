import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";
import { showHighlightRing, HighlightHandle } from "../ui/TutorialGuide";
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
  private tutorialHighlight?: HighlightHandle;
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

    makeButton(this, 400, 450, 200, 36, "WALK AWAY", Theme.danger, Theme.dangerHover, () => {
      // Leaving without ever flipping shouldn't leave a stale flag behind
      // - a LATER, unrelated visit to Coin Flip would otherwise incorrectly
      // show the tutorial highlight again. See resolveFlip() for the
      // normal (played-a-real-round) path that also clears this.
      gameState.tutorialAwaitingGamePlay = false;
      fadeToScene(this, "OverworldScene");
    });

    this.betControl = makeBetControl(this, 400, 486, () => {});

    this.add
      .text(400, 516, "Pays 2x", { fontSize: "11px", color: Theme.textMuted })
      .setOrigin(0.5);

    // Onboarding tutorial's "Play a Game" hands-on step (see
    // gameState.tutorialAwaitingGamePlay's doc comment) - the player
    // walked up and pressed E for real (this is a completely ordinary
    // entry into CoinFlipScene, no tutorial-specific transition logic
    // involved), so highlight the real HEADS/TAILS buttons and wait for
    // one real round to resolve (see resolveFlip()) before returning to
    // the Overworld to resume the tutorial.
    if (gameState.tutorialAwaitingGamePlay) {
      this.tutorialHighlight = showHighlightRing(this, 400, 400, 150, true);
      this.tutorialHint = this.add
        .text(400, 30, "Tutorial: pick Heads or Tails to flip!", {
          fontSize: "13px",
          color: Theme.textGold,
          fontStyle: "bold",
          backgroundColor: "#fdf3e1e6",
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
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    // Onboarding tutorial's "Play a Game" hands-on step - the ring/hint's
    // whole job is showing the player WHERE to click. The instant they
    // actually click Heads/Tails for real, that job is done - clear it
    // here, not in resolveFlip() (previously the ring stayed up through the
    // entire "Flipping..." animation while awaiting the server response,
    // which read as "the ring is still visible when you play coin flip").
    // tutorialAwaitingGamePlay itself (which gates the tutorial STEP
    // actually advancing - flag clear, resume-at-Skin-Attendant flag, the
    // delayed scene transition) deliberately still waits for resolveFlip(),
    // since that's about the real round genuinely completing, not just a
    // click being made.
    this.tutorialHighlight?.destroy();
    this.tutorialHint?.destroy();
    this.tutorialHighlight = undefined;
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
      this.messageText.setText(`${result.toUpperCase()}! You win +${payout} GC`).setColor(Theme.textAccent);
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
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
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
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
