import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";

export class CoinFlipScene extends Phaser.Scene {
  private coinText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private headsBtn?: UIButton;
  private tailsBtn?: UIButton;
  private flipping = false;
  private flipTimer?: Phaser.Time.TimerEvent;
  private betControl?: BetControl;
  private currentBet = 0;

  constructor() {
    super("CoinFlipScene");
  }

  create() {
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
      this.scene.start("OverworldScene")
    );

    this.betControl = makeBetControl(this, 400, 486, () => {});

    this.add
      .text(400, 516, "Pays 2x", { fontSize: "11px", color: Theme.textMuted })
      .setOrigin(0.5);

    this.updateBalance();
  }

  private flip(guess: "heads" | "tails") {
    if (this.flipping) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    this.currentBet = gameState.betAmount;
    this.flipping = true;
    this.headsBtn?.setEnabled(false);
    this.tailsBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    gameState.goldCoins -= this.currentBet;
    this.updateBalance();
    this.messageText.setText("Flipping...").setColor(Theme.textMuted);

    let ticks = 0;
    this.flipTimer = this.time.addEvent({
      delay: 90,
      repeat: 10,
      callback: () => {
        if (!this.coinText.active) {
          this.flipTimer?.remove(false);
          return;
        }
        this.coinText.setText(ticks % 2 === 0 ? "🪙" : "🟡");
        ticks++;
        if (ticks >= 10) {
          this.resolveFlip(guess);
        }
      }
    });
  }

  private resolveFlip(guess: "heads" | "tails") {
    const result: "heads" | "tails" = Math.random() < 0.5 ? "heads" : "tails";
    this.coinText.setText("🪙");

    if (result === guess) {
      const payout = this.currentBet * 2;
      gameState.goldCoins += payout;
      this.messageText.setText(`${result.toUpperCase()}! You win +${payout} GC`).setColor(
        Theme.textAccent
      );
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

  private updateBalance() {
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
