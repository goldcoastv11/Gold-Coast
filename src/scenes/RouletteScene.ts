import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
]);

type BetColor = "red" | "black" | "green";

function colorOf(n: number): BetColor {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

const PAYOUTS: Record<BetColor, number> = {
  red: 2,
  black: 2,
  green: 20 // generous for early playtesting, same spirit as the slots paytable
};

// Roulette's red/black/green stay domain-specific (a real wheel needs 3
// distinguishable colors), but the black pocket is a warm dark-brown, not
// pure black, and red/green now share the theme's danger/success family -
// per STYLE_GUIDE direction notes 1/2/7.
const COLOR_HEX: Record<BetColor, string> = {
  red: "#c2504d",
  black: "#5c3a2e",
  green: "#2e9b72"
};
const COLOR_NUM: Record<BetColor, number> = {
  red: 0xc2504d,
  black: 0x5c3a2e,
  green: 0x2e9b72
};
const COLOR_NUM_HOVER: Record<BetColor, number> = {
  red: 0xd47a77,
  black: 0x7a5442,
  green: 0x5cc79c
};

export class RouletteScene extends Phaser.Scene {
  private resultText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private betButtons: UIButton[] = [];
  private spinning = false;
  private spinTimer?: Phaser.Time.TimerEvent;
  private betControl?: BetControl;
  private currentBet = 0;

  constructor() {
    super("RouletteScene");
  }

  create() {
    this.spinning = false;
    this.spinTimer = undefined;
    this.betButtons = [];
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.spinTimer) {
        this.spinTimer.remove(false);
        this.spinTimer = undefined;
      }
    });

    makePanel(this, 400, 300, 540, 480);

    this.add
      .text(400, 90, "ROULETTE", {
        fontSize: "28px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    this.add.image(400, 300, "roulette_table").setDisplaySize(500, 280).setAlpha(0.5);

    // Dealer - stands off to the side, "dealing" via a looping animation.
    // Scale 4.4 (not the old 2.2) - see BlackjackScene.ts's dealer comment:
    // the #24 character reskin dropped the sheet's frame size from 21x32 to
    // 16x16, so 2.2 now renders too small. 4.4 = old display height
    // (32*2.2=70.4px) / new frame height (16px), preserving the dealer's
    // previous on-screen size.
    const dealer = this.add.sprite(105, 130, "dealer_sheet", 1).setScale(4.4);
    dealer.play("dealer_walk_down");

    makeInset(this, 250, 110, 210, 42, 12);
    this.add
      .text(250, 110, "Place your bet:\nRed, Black, or Green!", {
        fontSize: "11px",
        color: Theme.textPrimary,
        align: "center"
      })
      .setOrigin(0.5);

    makeInset(this, 400, 165, 380, 30, 15);
    this.balanceText = this.add
      .text(400, 165, "", { fontSize: "13px", color: Theme.textPrimary })
      .setOrigin(0.5);

    makeInset(this, 400, 245, 140, 66, 14);
    this.resultText = this.add
      .text(400, 245, "?", { fontSize: "38px", color: Theme.textPrimary, fontStyle: "bold" })
      .setOrigin(0.5);

    this.messageText = this.add
      .text(400, 295, "Place your bet", { fontSize: "15px", color: Theme.textMuted })
      .setOrigin(0.5);

    const redBtn = makeButton(this, 240, 400, 140, 50, "RED (2x)", COLOR_NUM.red, COLOR_NUM_HOVER.red, () =>
      this.spin("red")
    );
    const blackBtn = makeButton(
      this,
      400,
      400,
      140,
      50,
      "BLACK (2x)",
      COLOR_NUM.black,
      COLOR_NUM_HOVER.black,
      () => this.spin("black"),
      Theme.textOnDark // dark warm-brown fill needs a light label
    );
    const greenBtn = makeButton(this, 560, 400, 140, 50, "GREEN (20x)", COLOR_NUM.green, COLOR_NUM_HOVER.green, () =>
      this.spin("green")
    );
    this.betButtons = [redBtn, blackBtn, greenBtn];

    makeButton(this, 400, 460, 200, 36, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      this.scene.start("OverworldScene")
    );

    this.betControl = makeBetControl(this, 400, 505, () => {});

    this.updateBalance();
  }

  private spin(bet: BetColor) {
    if (this.spinning) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    this.currentBet = gameState.betAmount;
    this.spinning = true;
    this.betButtons.forEach((b) => b.setEnabled(false));
    this.betControl?.setEnabled(false);
    gameState.goldCoins -= this.currentBet;
    this.updateBalance();
    this.messageText.setText("Spinning...").setColor(Theme.textMuted);

    let ticks = 0;
    this.spinTimer = this.time.addEvent({
      delay: 70,
      repeat: 16,
      callback: () => {
        if (!this.resultText.active) {
          this.spinTimer?.remove(false);
          return;
        }
        const n = Phaser.Math.Between(0, 36);
        this.resultText.setText(String(n)).setColor(COLOR_HEX[colorOf(n)]);
        ticks++;
        if (ticks >= 16) {
          this.resolveSpin(bet);
        }
      }
    });
  }

  private resolveSpin(bet: BetColor) {
    const n = Phaser.Math.Between(0, 36);
    const resultColor = colorOf(n);
    this.resultText.setText(String(n)).setColor(COLOR_HEX[resultColor]);

    if (resultColor === bet) {
      const payout = this.currentBet * PAYOUTS[bet];
      gameState.goldCoins += payout;
      this.messageText
        .setText(`${n} ${resultColor.toUpperCase()} — you win +${payout} GC`)
        .setColor(Theme.textAccent);
      popIn(this, this.resultText);
    } else {
      this.messageText.setText(`${n} ${resultColor.toUpperCase()} — you lose`).setColor(
        Theme.textDanger
      );
    }

    this.updateBalance();
    this.spinning = false;
    this.betButtons.forEach((b) => b.setEnabled(true));
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
