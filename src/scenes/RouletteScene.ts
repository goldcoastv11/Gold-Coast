import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import type { RouletteColor } from "../api/types";

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
]);

/** Client-side preview only (coloring the spin animation's tumbling digits) - mirrors server/src/games/roulette.ts's colorOf() exactly, but the number that actually gets paid out always comes from the server's response (#36). */
function colorOf(n: number): RouletteColor {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

// Roulette's red/black/green stay domain-specific (a real wheel needs 3
// distinguishable colors), but the black pocket is a warm dark-brown, not
// pure black, and red/green now share the theme's danger/success family -
// per STYLE_GUIDE direction notes 1/2/7.
const COLOR_HEX: Record<RouletteColor, string> = {
  red: "#c2504d",
  black: "#5c3a2e",
  green: "#2e9b72"
};
const COLOR_NUM: Record<RouletteColor, number> = {
  red: 0xc2504d,
  black: 0x5c3a2e,
  green: 0x2e9b72
};
const COLOR_NUM_HOVER: Record<RouletteColor, number> = {
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

  constructor() {
    super("RouletteScene");
  }

  create() {
    fadeInOnCreate(this);
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
      fadeToScene(this, "OverworldScene")
    );

    this.betControl = makeBetControl(this, 400, 505, () => {});

    this.updateBalance();
  }

  /** #36: the winning number is resolved server-side (POST /games/roulette/play) - the spinning-digits animation here is purely cosmetic while the request is in flight. */
  private spin(bet: RouletteColor) {
    if (this.spinning) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Tickets!").setColor(Theme.textDanger);
      return;
    }

    const wager = gameState.betAmount;
    this.spinning = true;
    this.betButtons.forEach((b) => b.setEnabled(false));
    this.betControl?.setEnabled(false);
    this.messageText.setText("Spinning...").setColor(Theme.textMuted);

    this.spinTimer = this.time.addEvent({
      delay: 70,
      loop: true,
      callback: () => {
        if (this.resultText.active) {
          const n = Phaser.Math.Between(0, 36);
          this.resultText.setText(String(n)).setColor(COLOR_HEX[colorOf(n)]);
        }
      }
    });

    api
      .playRoulette(wager, "GC", bet)
      .then((res) => this.resolveSpin(res))
      .catch((err) => this.handleSpinError(err));
  }

  private resolveSpin(res: Awaited<ReturnType<typeof api.playRoulette>>) {
    this.spinTimer?.remove(false);
    this.spinTimer = undefined;

    gameState.hydrateFromServer(res.user);

    const { number, color, won, payout } = res.result;
    this.resultText.setText(String(number)).setColor(COLOR_HEX[color]);

    if (won) {
      this.messageText
        .setText(`${number} ${color.toUpperCase()} — you win +${payout} Tickets`)
        .setColor(Theme.textAccent);
      popIn(this, this.resultText);
    } else {
      this.messageText.setText(`${number} ${color.toUpperCase()} — you lose`).setColor(Theme.textDanger);
    }

    this.updateBalance();
    this.spinning = false;
    this.betButtons.forEach((b) => b.setEnabled(true));
    this.betControl?.setEnabled(true);
  }

  private handleSpinError(err: unknown) {
    this.spinTimer?.remove(false);
    this.spinTimer = undefined;
    this.resultText.setText("?").setColor(Theme.textPrimary);

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Tickets!").setColor(Theme.textDanger);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Theme.textDanger);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Theme.textDanger);
    }

    this.spinning = false;
    this.betButtons.forEach((b) => b.setEnabled(true));
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(
      `Tickets: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
