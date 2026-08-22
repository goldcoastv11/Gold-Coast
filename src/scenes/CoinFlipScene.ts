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

    makeButton(this, 400, 450, 200, 36, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      fadeToScene(this, "OverworldScene")
    );

    this.betControl = makeBetControl(this, 400, 486, () => {});

    this.add
      .text(400, 516, "Pays 2x", { fontSize: "11px", color: Theme.textMuted })
      .setOrigin(0.5);

    this.updateBalance();
  }

  /** #36: the coin's real outcome is resolved server-side (POST /games/coinflip/play) - the flip animation here is purely cosmetic while the request is in flight. */
  private flip(guess: CoinSide) {
    if (this.flipping) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

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
