import Phaser from "phaser";
import { gameState } from "../GameState";
import { Tokens } from "../ui/DesignTokens";
import {
  makeButton,
  makeText,
  makeDivider,
  makeGameShell,
  formatBalance,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  GAME_SHELL_DISPLAY_CENTER_Y,
  popIn,
  drawCabinetFrame,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { track, EVENTS } from "../api/track";

const TARGET_MIN = 5;
const TARGET_MAX = 95;
const TARGET_STEP = 5;
const DEFAULT_TARGET = 50;
const HOUSE_EDGE_NUMERATOR = 99; // 99 instead of 100 -> ~1% house edge baked into the multiplier - mirrors server/src/games/dice.ts exactly, used here only for the live win-chance/multiplier preview before rolling

/**
 * DICE, on the Stake-style direction (see ui/DesignTokens.ts).
 *
 * The board is one flat surface. A micro-label sits above the hero roll
 * number, a single hairline separates the result from the controls, and the
 * win/lose bar is the one place two saturated colours are allowed on this
 * screen - the green run IS the win state and the red run IS the losing
 * range, which is exactly the pair direction note 2 permits. The bar has no
 * outline any more: it is defined by where its two fills meet.
 */
const BOARD_CX = GAME_SHELL_DISPLAY_CENTER_X;
const BOARD_CY = GAME_SHELL_DISPLAY_CENTER_Y;
const BOARD_W = 410;
const BOARD_H = 300;
/** Board content column, inset from the board surface by one token pad - same rule as Limbo. */
const BOARD_LEFT = BOARD_CX - BOARD_W / 2 + Tokens.space.xxl;
const BOARD_RIGHT = BOARD_CX + BOARD_W / 2 - Tokens.space.xxl;

const BAR_X = BOARD_CX;
const BAR_WIDTH = BOARD_RIGHT - BOARD_LEFT;
const BAR_H = Tokens.space.md;

/** Vertical rhythm, on the same label-above-value / hairline / controls stack Limbo uses. */
const HERO_LABEL_Y = 210;
const HERO_Y = 254;
const DIVIDER_Y = 300;
const SECTION_LABEL_Y = 320;
const BAR_Y = 348;
const TARGET_ROW_Y = 388;
const STATS_Y = 424;

const STEP_BTN_W = 44;
const STEP_BTN_H = 32;

/**
 * Client-side preview only, for the live "Win Chance / Multiplier" readout
 * before the player rolls - matches server/src/games/dice.ts's
 * diceMultiplier() exactly, but the number that actually gets paid out is
 * always whatever the server computes in the response (#36 - the server is
 * the trust boundary; this is display-only, never used to settle a round).
 */
function multiplierFor(target: number): number {
  return Math.round((HOUSE_EDGE_NUMERATOR / target) * 100) / 100;
}

export class DiceScene extends Phaser.Scene {
  private target = DEFAULT_TARGET;
  private rolling = false;
  private rollTimer?: Phaser.Time.TimerEvent;
  private lastRoll: number | null = null;

  private rollText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private targetLabel!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private zoneBar!: Phaser.GameObjects.Graphics;
  private marker!: Phaser.GameObjects.Triangle;
  private rollBtn?: UIButton;
  private minusBtn?: UIButton;
  private plusBtn?: UIButton;
  private betControl?: BetControl;
  private shell!: GameShellHandle;

  constructor() {
    super("DiceScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "drummingSticks");
    this.target = DEFAULT_TARGET;
    this.rolling = false;
    this.rollTimer = undefined;
    this.lastRoll = null;
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.rollTimer) {
        this.rollTimer.remove(false);
        this.rollTimer = undefined;
      }
    });

    this.shell = makeGameShell(this, "DICE", "ROLL", {
      onStart: () => this.roll(),
      onCashOut: () => {},
      onWalkAway: () => fadeToScene(this, "OverworldScene")
    });
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.betControl = this.shell.betControl;
    this.rollBtn = this.shell.startBtn;
    this.messageText.setText("Roll under your target to win.").setColor(Tokens.text.muted);

    drawCabinetFrame(this, BOARD_CX, BOARD_CY, BOARD_W, BOARD_H);

    // --- Hero result --------------------------------------------------
    makeText(this, BOARD_CX, HERO_LABEL_Y, "ROLL", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5
    });
    this.rollText = makeText(this, BOARD_CX, HERO_Y, "--", {
      size: Tokens.type.size.display,
      weight: Tokens.type.weight.bold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5
    });

    makeDivider(this, BOARD_LEFT, DIVIDER_Y, BOARD_RIGHT);

    // --- Target picker ------------------------------------------------
    makeText(this, BOARD_LEFT, SECTION_LABEL_Y, "ROLL UNDER", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps
    });

    this.zoneBar = this.add.graphics();
    // Marker for the last roll. Plain white so it reads against BOTH halves
    // of the bar without needing a second colour of its own.
    this.marker = this.add
      .triangle(BAR_X, BAR_Y - BAR_H, -5, 7, 5, 7, 0, -5, Tokens.color.textPrimary)
      .setVisible(false);

    this.minusBtn = makeButton(
      this,
      BOARD_LEFT + STEP_BTN_W / 2,
      TARGET_ROW_Y,
      STEP_BTN_W,
      STEP_BTN_H,
      `−${TARGET_STEP}`,
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => this.adjustTarget(-TARGET_STEP),
      Tokens.text.secondary,
      Tokens.radius.sm
    );
    this.targetLabel = makeText(this, BOARD_CX, TARGET_ROW_Y, "", {
      size: Tokens.type.size.xl,
      weight: Tokens.type.weight.semibold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5
    });
    this.plusBtn = makeButton(
      this,
      BOARD_RIGHT - STEP_BTN_W / 2,
      TARGET_ROW_Y,
      STEP_BTN_W,
      STEP_BTN_H,
      `+${TARGET_STEP}`,
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => this.adjustTarget(TARGET_STEP),
      Tokens.text.secondary,
      Tokens.radius.sm
    );

    this.statsText = makeText(this, BOARD_CX, STATS_Y, "", {
      size: Tokens.type.size.sm,
      color: Tokens.text.muted,
      align: "center",
      originX: 0.5
    });

    this.redrawZoneBar();
    this.updateTargetLabel();
    this.updateBalance();
  }

  private adjustTarget(delta: number) {
    if (this.rolling) return;
    this.target = Phaser.Math.Clamp(this.target + delta, TARGET_MIN, TARGET_MAX);
    this.updateTargetLabel();
    this.redrawZoneBar();
  }

  private updateTargetLabel() {
    this.targetLabel.setText(String(this.target));
    const mult = multiplierFor(this.target);
    this.statsText.setText(`Win chance ${this.target}%   ·   Pays ${mult.toFixed(2)}x`);
  }

  /** Draws the win (accent) / lose (negative) zone bar for the current target. */
  private redrawZoneBar() {
    const left = BAR_X - BAR_WIDTH / 2;
    const winWidth = (this.target / 100) * BAR_WIDTH;

    this.zoneBar.clear();
    this.zoneBar.fillStyle(Tokens.color.accent, 1);
    this.zoneBar.fillRoundedRect(left, BAR_Y - BAR_H / 2, winWidth, BAR_H, Tokens.radius.xs);
    this.zoneBar.fillStyle(Tokens.color.negative, 1);
    this.zoneBar.fillRoundedRect(
      left + winWidth,
      BAR_Y - BAR_H / 2,
      BAR_WIDTH - winWidth,
      BAR_H,
      Tokens.radius.xs
    );

    if (this.lastRoll !== null) {
      const markerX = left + (this.lastRoll / 99) * BAR_WIDTH;
      this.marker.setPosition(markerX, BAR_Y - BAR_H).setVisible(true);
    }
  }

  /**
   * #36: the roll and payout are resolved server-side (POST
   * /games/dice/play) - this only plays a cosmetic "spinning digits"
   * animation while the request is in flight (real network latency, not a
   * fixed tick count) and then reconciles to whatever the server actually
   * returned. The local `gameState.goldCoins < betAmount` check below is
   * just a fast-fail UX nicety; the server re-checks affordability itself
   * and is what actually decides whether the bet is accepted.
   */
  private roll() {
    if (this.rolling) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins.").setColor(Tokens.text.negative);
      return;
    }

    const bet = gameState.betAmount;
    const target = this.target;
    this.rolling = true;
    this.rollBtn?.setEnabled(false);
    this.minusBtn?.setEnabled(false);
    this.plusBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.rollText.setColor(Tokens.text.primary);
    this.messageText.setText("Rolling...").setColor(Tokens.text.muted);
    playSfx(this, "diceThrow");

    this.rollTimer = this.time.addEvent({
      delay: Tokens.motion.duration.instant,
      loop: true,
      callback: () => {
        if (this.rollText.active) {
          this.rollText.setText(String(Phaser.Math.Between(0, 99)));
        }
      }
    });

    api
      .playDice(bet, "GC", target)
      .then((res) => this.resolveRoll(res, bet))
      .catch((err) => this.handleRollError(err));
  }

  /** `bet` is threaded through purely so the round can be tracked with its stake - the play response doesn't echo it back. */
  private resolveRoll(res: Awaited<ReturnType<typeof api.playDice>>, bet: number) {
    this.rollTimer?.remove(false);
    this.rollTimer = undefined;

    gameState.hydrateFromServer(res.user);

    const { roll, target, won, payout } = res.result;

    // Retention Leg 1 - see src/api/track.ts. Server-settled result only;
    // betAmount and payout are both Gold Coins (GC-only economy).
    track(EVENTS.GAME_ROUND_PLAYED, {
      game: "dice",
      betAmount: bet,
      outcome: won ? "win" : "loss",
      payout
    });
    this.lastRoll = roll;
    this.rollText.setText(String(roll));
    this.redrawZoneBar();

    if (won) {
      this.rollText.setColor(Tokens.text.accent);
      this.messageText.setText(`Under ${target} - you win ${payout} Gold Coins.`).setColor(Tokens.text.accent);
      popIn(this, this.rollText);
      showWinCelebration(this, payout);
    } else {
      this.rollText.setColor(Tokens.text.negative);
      this.messageText.setText(`Not under ${target}. No win this round.`).setColor(Tokens.text.secondary);
      playSfx(this, "lose");
    }

    this.updateBalance();
    this.rolling = false;
    this.rollBtn?.setEnabled(true);
    this.minusBtn?.setEnabled(true);
    this.plusBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private handleRollError(err: unknown) {
    this.rollTimer?.remove(false);
    this.rollTimer = undefined;
    this.rollText.setText("--").setColor(Tokens.text.primary);

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Gold Coins.").setColor(Tokens.text.negative);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
    }

    this.rolling = false;
    this.rollBtn?.setEnabled(true);
    this.minusBtn?.setEnabled(true);
    this.plusBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins));
  }
}
