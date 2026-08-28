import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
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
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";

const PRESET_TARGETS = [1.5, 2, 3, 5, 10, 25, 50, 100];
const DEFAULT_TARGET = 2;

/**
 * LIMBO - the worked example for the Stake-style visual direction.
 *
 * This is the ONE game converted in this pass, deliberately: the shared
 * chrome in ui/uiHelpers.ts now carries all 14 games, but each game's own
 * board art still has to be re-laid-out by hand, and getting the aesthetic
 * agreed on one screen is much cheaper than unpicking it on fourteen. Limbo
 * was picked because it is almost entirely type and space - a single large
 * number and a picker - so the direction itself does the talking rather
 * than any game-specific artwork.
 *
 * Layout (see ui/DesignTokens.ts for the rules the numbers come from):
 * the board is one flat surface with no frame. A micro-label sits above the
 * hero multiplier - label above value, the same pattern the sidebar uses -
 * then a single hairline separates the result from the target picker below
 * it. The picker is a plain 4x2 grid of flat cells on a strict token
 * rhythm; the selected cell is marked by a lighter SURFACE and heavier
 * text, not by colour, so accent green stays reserved for the one primary
 * action and the win state.
 */
const BOARD_CX = GAME_SHELL_DISPLAY_CENTER_X;
const BOARD_CY = GAME_SHELL_DISPLAY_CENTER_Y;
const BOARD_W = 420;
const BOARD_H = 320;
/** Board content column, inset from the board surface by one token pad. */
const BOARD_LEFT = BOARD_CX - BOARD_W / 2 + Tokens.space.xxl;
const BOARD_RIGHT = BOARD_CX + BOARD_W / 2 - Tokens.space.xxl;

/** Preset grid: 4 columns across the board's content column, 2 rows. */
const CHIP_COLS = 4;
const CHIP_GAP = Tokens.space.sm;
const CHIP_W = (BOARD_RIGHT - BOARD_LEFT - CHIP_GAP * (CHIP_COLS - 1)) / CHIP_COLS;
const CHIP_H = 32;
const CHIP_ROW_Y = [372, 372 + CHIP_H + CHIP_GAP];

export class LimboScene extends Phaser.Scene {
  private target = DEFAULT_TARGET;
  private running = false;
  private presetButtons: UIButton[] = [];

  private multiplierText!: Phaser.GameObjects.Text;
  private heroCaption!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private targetText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private playBtn?: UIButton;
  private betControl?: BetControl;
  private shell!: GameShellHandle;

  constructor() {
    super("LimboScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "sadDescent");
    this.target = DEFAULT_TARGET;
    this.running = false;
    this.presetButtons = [];
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.tweens.killTweensOf(this);
    });

    this.shell = makeGameShell(this, "Limbo", "BET", {
      onStart: () => this.play(),
      onCashOut: () => {},
      onWalkAway: () => fadeToScene(this, "OverworldScene")
    });
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.betControl = this.shell.betControl;
    this.playBtn = this.shell.startBtn;
    // The shell's readout line carries the round's key parameter, which for
    // Limbo is the target - the same place Stake puts it, beside the stake
    // rather than buried in the board.
    this.targetText = this.shell.multiplierText;
    this.messageText.setText("Pick a target multiplier.").setColor(Tokens.text.muted);

    // Flat board surface - no frame, no trim. The board is defined by where
    // the surface ends.
    drawCabinetFrame(this, BOARD_CX, BOARD_CY, BOARD_W, BOARD_H);

    // --- Hero result --------------------------------------------------
    makeText(this, BOARD_CX, 208, "MULTIPLIER", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5
    });
    this.multiplierText = makeText(this, BOARD_CX, 252, "1.00x", {
      size: Tokens.type.size.display,
      weight: Tokens.type.weight.bold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5
    });
    this.heroCaption = makeText(this, BOARD_CX, 296, "", {
      size: Tokens.type.size.sm,
      color: Tokens.text.muted,
      align: "center",
      originX: 0.5
    });

    makeDivider(this, BOARD_LEFT, 328, BOARD_RIGHT);

    // --- Target picker ------------------------------------------------
    makeText(this, BOARD_LEFT, 348, "TARGET MULTIPLIER", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps
    });

    this.renderPresets();
    this.updateTargetText();
    this.updateBalance();
  }

  private renderPresets() {
    this.presetButtons.forEach((b) => b.destroy());
    this.presetButtons = [];

    PRESET_TARGETS.forEach((value, i) => {
      const col = i % CHIP_COLS;
      const row = Math.floor(i / CHIP_COLS);
      const x = BOARD_LEFT + CHIP_W / 2 + col * (CHIP_W + CHIP_GAP);
      const y = CHIP_ROW_Y[row];
      const selected = value === this.target;
      const btn = makeButton(
        this,
        x,
        y,
        CHIP_W,
        CHIP_H,
        `${value}x`,
        // Selection reads as a lighter surface plus brighter/heavier text -
        // never as accent colour, which is reserved for the primary action
        // and the win state (DesignTokens direction note 2).
        selected ? Tokens.color.surfaceHover : Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        () => {
          if (this.running) return;
          this.target = value;
          this.updateTargetText();
          this.renderPresets();
        },
        selected ? Tokens.text.primary : Tokens.text.secondary,
        Tokens.radius.sm
      );
      this.presetButtons.push(btn);
    });
  }

  private updateTargetText() {
    this.targetText.setText(`Target ${this.target.toFixed(2)}x`);
  }

  /** #36: the crash point is resolved server-side (POST /games/limbo/play) - the climbing-number animation here plays toward the server's real crashPoint once the response arrives, it doesn't determine the outcome. */
  private play() {
    if (this.running) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins.").setColor(Tokens.text.negative);
      return;
    }

    const bet = gameState.betAmount;
    const target = this.target;
    this.running = true;
    this.playBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.presetButtons.forEach((b) => b.setEnabled(false));

    this.multiplierText.setText("1.00x").setColor(Tokens.text.primary);
    this.heroCaption.setText("").setColor(Tokens.text.muted);
    this.messageText.setText("Climbing...").setColor(Tokens.text.muted);

    api
      .playLimbo(bet, "GC", target)
      .then((res) => this.animateAndResolve(res))
      .catch((err) => this.handlePlayError(err));
  }

  private animateAndResolve(res: Awaited<ReturnType<typeof api.playLimbo>>) {
    const { crashPoint } = res.result;
    const duration = Phaser.Math.Clamp(700 + Math.min(crashPoint, 30) * 35, 700, 2200);
    const counter = { val: 1 };

    this.tweens.add({
      targets: counter,
      val: crashPoint,
      duration,
      ease: Tokens.motion.ease.out,
      onUpdate: () => {
        this.multiplierText.setText(`${counter.val.toFixed(2)}x`);
      },
      onComplete: () => this.resolveRound(res)
    });
  }

  private resolveRound(res: Awaited<ReturnType<typeof api.playLimbo>>) {
    gameState.hydrateFromServer(res.user);

    const { target, crashPoint, won, payout } = res.result;
    this.multiplierText.setText(`${crashPoint.toFixed(2)}x`);

    if (won) {
      this.multiplierText.setColor(Tokens.text.accent);
      this.heroCaption.setText(`Cleared ${target.toFixed(2)}x`).setColor(Tokens.text.accent);
      // "Tickets" is the win currency and is what a payout is actually paid
      // in - see CLAUDE.md's economy rules.
      this.messageText.setText(`You win ${payout} Tickets.`).setColor(Tokens.text.accent);
      popIn(this, this.multiplierText);
      showWinCelebration(this, payout);
    } else {
      this.multiplierText.setColor(Tokens.text.negative);
      this.heroCaption.setText(`Short of ${target.toFixed(2)}x`).setColor(Tokens.text.muted);
      this.messageText.setText("No win this round.").setColor(Tokens.text.secondary);
      playSfx(this, "lose");
    }

    this.updateBalance();
    this.running = false;
    this.playBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
    this.presetButtons.forEach((b) => b.setEnabled(true));
  }

  private handlePlayError(err: unknown) {
    this.multiplierText.setText("1.00x").setColor(Tokens.text.primary);
    this.heroCaption.setText("");

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Gold Coins.").setColor(Tokens.text.negative);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
    }

    this.running = false;
    this.playBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
    this.presetButtons.forEach((b) => b.setEnabled(true));
  }

  /** Shared across all 14 games now - see uiHelpers.ts's formatBalance. */
  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins, gameState.tickets));
  }
}
