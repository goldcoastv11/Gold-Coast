import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Tokens, toCss } from "../ui/DesignTokens";
import {
  makeButton,
  makeText,
  makeDivider,
  makeGameShell,
  formatBalance,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  GAME_SHELL_DISPLAY_CENTER_Y,
  makeInset,
  popIn,
  drawCabinetFrame,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { track, EVENTS } from "../api/track";
import type { RouletteColor } from "../api/types";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
]);

/** Client-side preview only (coloring the spin animation's tumbling digits) - mirrors server/src/games/roulette.ts's colorOf() exactly, but the number that actually gets paid out always comes from the server's response (#36). */
function colorOf(n: number): RouletteColor {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

/**
 * ROULETTE, on the Stake-style direction (see ui/DesignTokens.ts).
 *
 * The three pocket colours were the last hand-picked hex in this file. They
 * now come straight from Tokens.game.roulette, which derives all three from
 * tokens that already exist: black is simply a raised surface, red is the
 * one functional negative, green is the accent (on this screen green is also
 * the win state, so the accent is doing exactly its job). Nothing else on
 * the screen is saturated - the shell's own primary button stays hidden
 * here, because on Roulette the three colour buttons ARE the action.
 */
const COLOR_NUM: Record<RouletteColor, number> = {
  red: Tokens.game.roulette.red,
  black: Tokens.game.roulette.black,
  green: Tokens.game.roulette.green
};
const COLOR_NUM_HOVER: Record<RouletteColor, number> = {
  red: Tokens.game.roulette.redHover,
  black: Tokens.game.roulette.blackHover,
  green: Tokens.game.roulette.greenHover
};
/** The same three, as CSS strings, for the tumbling result number's own colour. */
const COLOR_HEX: Record<RouletteColor, string> = {
  red: toCss(COLOR_NUM.red),
  // The black pocket's own surface value is too dark to read as text on the
  // board, so a "black" number prints as plain primary text instead.
  black: Tokens.text.primary,
  green: toCss(COLOR_NUM.green)
};

const DX = GAME_SHELL_DISPLAY_CENTER_X;
const DY = GAME_SHELL_DISPLAY_CENTER_Y;
const BOARD_W = 410;
/** 300 +/- 160 = 140-460, inside the 130-470 safe zone (uiHelpers' SAFE_ZONE_TOP/BOTTOM). */
const BOARD_H = 320;
const BOARD_LEFT = DX - BOARD_W / 2 + Tokens.space.xxl;
const BOARD_RIGHT = DX + BOARD_W / 2 - Tokens.space.xxl;

/**
 * The felt asset is fixed art and can't be re-toned from tokens, so it runs
 * quiet enough to read as texture over the token surface rather than as its
 * own warm colour - the same treatment Blackjack's table gets.
 */
const TABLE_ART_ALPHA = 0.25;
const TABLE_ART_Y = 250;
const TABLE_ART_W = 400;
const TABLE_ART_H = 224;

const RESULT_LABEL_Y = 176;
const RESULT_WELL_Y = 240;
const RESULT_WELL_W = 150;
const RESULT_WELL_H = 88;
const DIVIDER_Y = 320;
const BET_LABEL_Y = 342;
const BET_BTN_Y = 388;
const BET_BTN_H = 44;
const BET_BTN_W = (BOARD_RIGHT - BOARD_LEFT - Tokens.space.sm * 2) / 3;
/**
 * The dealer sprite used to sit at y=65 - well above SAFE_ZONE_TOP (130),
 * i.e. croppable on a real phone. It now stands in the board's own left
 * gutter, inside the band, at a scale that clears the result well.
 */
const DEALER_SPRITE_X = DX - 150;
const DEALER_SPRITE_Y = 205;
const DEALER_SPRITE_SCALE = 2.2;

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
    playMusic(this, "polkaTrain");
    this.spinning = false;
    this.spinTimer = undefined;
    this.betButtons = [];
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

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
    this.messageText.setText("Bet on red, black, or green.").setColor(Tokens.text.muted);

    // Flat board surface - the gold trim frame that used to be stroked around
    // the table is gone; the board is defined by where the surface ends.
    drawCabinetFrame(this, DX, DY, BOARD_W, BOARD_H);

    // Table image backdrop, over the token surface and under everything else.
    this.add
      .image(DX, TABLE_ART_Y, "roulette_table")
      .setDisplaySize(TABLE_ART_W, TABLE_ART_H)
      .setAlpha(TABLE_ART_ALPHA);

    // Dealer - stands off to the side, "dealing" via a looping animation.
    const dealer = this.add
      .sprite(DEALER_SPRITE_X, DEALER_SPRITE_Y, "dealer_sheet", 1)
      .setScale(DEALER_SPRITE_SCALE);
    dealer.play("dealer_walk_down");

    // --- Hero result --------------------------------------------------
    // The "Place your bet: Red, Black or Green!" bubble is gone - that
    // instruction now lives on the shell's message line, which is where
    // every other converted game puts its "here's what to do" copy.
    makeText(this, DX, RESULT_LABEL_Y, "WINNING NUMBER", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5
    });
    makeInset(this, DX, RESULT_WELL_Y, RESULT_WELL_W, RESULT_WELL_H, Tokens.radius.md);
    this.resultText = makeText(this, DX, RESULT_WELL_Y, "?", {
      size: Tokens.type.size.display,
      weight: Tokens.type.weight.bold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });

    makeDivider(this, BOARD_LEFT, DIVIDER_Y, BOARD_RIGHT);

    // --- Bet buttons ---------------------------------------------------
    // These three ARE the action on this screen, so they keep the pocket
    // colours rather than being demoted to plain surfaces.
    makeText(this, BOARD_LEFT, BET_LABEL_Y, "BET ON", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps
    });

    const options: Array<{ color: RouletteColor; label: string }> = [
      { color: "red", label: "RED 2x" },
      { color: "black", label: "BLACK 2x" },
      // Must match server/src/games/roulette.ts's ROULETTE_PAYOUTS.green (rebalanced from 20x to
      // 36x on 2026-08-27 so green returns the same 97.3% as red/black).
      { color: "green", label: "GREEN 36x" }
    ];
    this.betButtons = options.map((opt, i) =>
      makeButton(
        this,
        BOARD_LEFT + BET_BTN_W / 2 + i * (BET_BTN_W + Tokens.space.sm),
        BET_BTN_Y,
        BET_BTN_W,
        BET_BTN_H,
        opt.label,
        COLOR_NUM[opt.color],
        COLOR_NUM_HOVER[opt.color],
        () => this.spin(opt.color),
        undefined,
        Tokens.radius.md
      )
    );

    this.updateBalance();
  }

  /** #36: the winning number is resolved server-side (POST /games/roulette/play) - the spinning-digits animation here is purely cosmetic while the request is in flight. */
  private spin(bet: RouletteColor) {
    if (this.spinning) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    const wager = gameState.betAmount;
    this.spinning = true;
    this.betButtons.forEach((b) => b.setEnabled(false));
    this.betControl?.setEnabled(false);
    this.messageText.setText("Spinning...").setColor(Tokens.text.muted);
    playSfx(this, "chipBet");
    playSfx(this, "ballDrop");

    this.spinTimer = this.time.addEvent({
      delay: Tokens.motion.duration.instant,
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
      .then((res) => this.resolveSpin(res, wager))
      .catch((err) => this.handleSpinError(err));
  }

  /** `wager` is threaded through purely so the round can be tracked with its stake - the play response doesn't echo it back. */
  private resolveSpin(res: Awaited<ReturnType<typeof api.playRoulette>>, wager: number) {
    this.spinTimer?.remove(false);
    this.spinTimer = undefined;

    gameState.hydrateFromServer(res.user);
    playSfx(this, "reelStop");

    const { number, color, won, payout } = res.result;

    // Retention Leg 1 - see src/api/track.ts. Server-settled result only;
    // betAmount and payout are both Gold Coins (GC-only economy).
    track(EVENTS.GAME_ROUND_PLAYED, {
      game: "roulette",
      betAmount: wager,
      outcome: won ? "win" : "loss",
      payout
    });
    this.resultText.setText(String(number)).setColor(COLOR_HEX[color]);

    if (won) {
      this.messageText
        .setText(`${number} ${color.toUpperCase()} — you win +${payout} Gold Coins`)
        .setColor(Tokens.text.accent);
      popIn(this, this.resultText);
      showWinCelebration(this, payout);
    } else {
      this.messageText.setText(`${number} ${color.toUpperCase()} — you lose`).setColor(Tokens.text.negative);
      playSfx(this, "lose");
    }

    this.updateBalance();
    this.spinning = false;
    this.betButtons.forEach((b) => b.setEnabled(true));
    this.betControl?.setEnabled(true);
  }

  private handleSpinError(err: unknown) {
    this.spinTimer?.remove(false);
    this.spinTimer = undefined;
    this.resultText.setText("?").setColor(Tokens.text.primary);

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
    }

    this.spinning = false;
    this.betButtons.forEach((b) => b.setEnabled(true));
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins));
  }
}
