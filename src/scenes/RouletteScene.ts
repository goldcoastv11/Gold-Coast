import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import {
  makeButton,
  makeGameShell,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  makeInset,
  popIn,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
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
  private shell!: GameShellHandle;

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

    // Stake-style shell: left sidebar (title/balance/bet/message/Walk Away)
    // + open right-side display area for the wheel table + bet buttons -
    // see ui/uiHelpers.ts's makeGameShell doc comment. Roulette has no
    // single "primary bet" button (red/black/green are the actions), so the
    // shell's own start button stays hidden and unused - the real actions
    // are the three color buttons below, same as before.
    this.shell = makeGameShell(this, "ROULETTE", "SPIN", {
      onStart: () => {},
      onCashOut: () => {},
      onWalkAway: () => fadeToScene(this, "OverworldScene")
    });
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.betControl = this.shell.betControl;
    this.shell.startBtn.container.setVisible(false);
    this.shell.startBtn.setEnabled(false);
    this.messageText.setText("Place your bet").setColor(Theme.textMuted);

    // Table image backdrop - scaled down (500x280 -> 400x224) so it fits
    // inside the narrower display area instead of the old 540px-wide panel.
    this.add
      .image(GAME_SHELL_DISPLAY_CENTER_X, 300, "roulette_table")
      .setDisplaySize(400, 224)
      .setAlpha(0.5);

    // Dealer - stands off to the side, "dealing" via a looping animation.
    // Scaled down from 4.4 to 3.2 and tucked into the top-left corner of the
    // display area (it used to bleed left of the old panel entirely, which
    // isn't available anymore now that the sidebar occupies that space).
    const dealer = this.add.sprite(400, 65, "dealer_sheet", 1).setScale(3.2);
    dealer.play("dealer_walk_down");

    makeInset(this, GAME_SHELL_DISPLAY_CENTER_X, 120, 320, 42, 12);
    this.add
      .text(GAME_SHELL_DISPLAY_CENTER_X, 120, "Place your bet:\nRed, Black, or Green!", {
        fontSize: "11px",
        color: Theme.textPrimary,
        align: "center"
      })
      .setOrigin(0.5);

    makeInset(this, GAME_SHELL_DISPLAY_CENTER_X, 245, 140, 66, 14);
    this.resultText = this.add
      .text(GAME_SHELL_DISPLAY_CENTER_X, 245, "?", { fontSize: "38px", color: Theme.textPrimary, fontStyle: "bold" })
      .setOrigin(0.5);

    // Bet buttons - scaled down from 140px to 130px wide (and their spacing
    // tightened from 160px to 135px between centers) so all three fit
    // within the narrower display area without overflowing its edges.
    const redBtn = makeButton(
      this,
      GAME_SHELL_DISPLAY_CENTER_X - 135,
      405,
      130,
      50,
      "RED (2x)",
      COLOR_NUM.red,
      COLOR_NUM_HOVER.red,
      () => this.spin("red")
    );
    const blackBtn = makeButton(
      this,
      GAME_SHELL_DISPLAY_CENTER_X,
      405,
      130,
      50,
      "BLACK (2x)",
      COLOR_NUM.black,
      COLOR_NUM_HOVER.black,
      () => this.spin("black"),
      Theme.textOnDark // dark warm-brown fill needs a light label
    );
    const greenBtn = makeButton(
      this,
      GAME_SHELL_DISPLAY_CENTER_X + 135,
      405,
      130,
      50,
      "GREEN (20x)",
      COLOR_NUM.green,
      COLOR_NUM_HOVER.green,
      () => this.spin("green")
    );
    this.betButtons = [redBtn, blackBtn, greenBtn];

    this.updateBalance();
  }

  /** #36: the winning number is resolved server-side (POST /games/roulette/play) - the spinning-digits animation here is purely cosmetic while the request is in flight. */
  private spin(bet: RouletteColor) {
    if (this.spinning) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
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
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
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
    this.balanceText.setText(`🪙 ${gameState.goldCoins}   🎟️ ${gameState.tickets}`);
  }
}
