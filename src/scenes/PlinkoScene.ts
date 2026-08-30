import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Tokens } from "../ui/DesignTokens";
import {
  makeGameShell,
  makeText,
  formatBalance,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  makeInset,
  popIn,
  drawCabinetFrame,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";

const ROWS = 8; // rows of pegs -> 9 landing slots
const ROW_SPACING = 28;
const PEG_SPACING = 28;
const BOARD_TOP_Y = 182;
// Stake-style layout: board centered in the shell's right-side display area
// (see ui/uiHelpers.ts's makeGameShell), not the old canvas center - the
// sidebar now occupies the left third of the screen.
const BOARD_CENTER_X = GAME_SHELL_DISPLAY_CENTER_X;
const SLOTS_Y = 402;

/** Board surface, sized around the peg triangle + the slot row beneath it. */
const BOARD_CY = 292;
const BOARD_W = 410;
const BOARD_H = 280;

/** Peg radius, and the slot buckets under the board. */
const PEG_RADIUS = 3;
const BALL_RADIUS = 6;
const SLOT_H = 26;

// Symmetric payout table, one entry per slot (index = number of "right" bounces) - mirrors server/src/games/plinko.ts's PLINKO_MULTIPLIERS exactly (display/preview only; the server is what actually resolves a drop, see drop()).
const MULTIPLIERS = [16, 5, 1.2, 0.5, 0.2, 0.5, 1.2, 5, 16];

/**
 * Slot label colour, on the Stake-style direction (see ui/DesignTokens.ts).
 *
 * The buckets used to be four saturated fills deep (gold / orange / slate /
 * red), which put four competing hues across nine slots. Every bucket is now
 * the same recessed well and only its NUMBER carries the tier, as a ramp of
 * text emphasis: the two jackpot edges take the one accent (they are the win
 * state), anything that at least returns the stake is plain bright text, and
 * the sub-1x middle simply recedes to muted. Bands unchanged from the
 * 2026-08-27 rebalance - same visual story, no extra hues.
 */
function textColorForMultiplier(m: number): string {
  if (m >= 16) return Tokens.text.accent;
  if (m >= 1) return Tokens.text.primary;
  return Tokens.text.muted;
}

export class PlinkoScene extends Phaser.Scene {
  private dropping = false;
  private ball!: Phaser.GameObjects.Arc;
  private slotTexts: Phaser.GameObjects.Text[] = [];
  private messageText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private dropBtn?: UIButton;
  private betControl?: BetControl;
  private shell!: GameShellHandle;

  constructor() {
    super("PlinkoScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "flowingRocks");
    this.dropping = false;
    this.slotTexts = [];
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.tweens.killTweensOf(this.ball);
    });

    // Stake-style shell: left sidebar (title/balance/bet/message/Drop
    // Ball/Walk Away) + open right-side display area for the pegs board -
    // see ui/uiHelpers.ts's makeGameShell doc comment.
    this.shell = makeGameShell(this, "PLINKO", "DROP BALL", {
      onStart: () => this.drop(),
      onCashOut: () => {},
      onWalkAway: () => fadeToScene(this, "OverworldScene")
    });
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.dropBtn = this.shell.startBtn;
    this.betControl = this.shell.betControl;
    this.messageText.setText("Drop a ball and watch it bounce").setColor(Tokens.text.muted);

    // Flat board surface - no frame, no trim. The peg board is narrower than
    // most other games' content, so the surface stays at the same ~410px
    // family width used elsewhere (Slots/Dragon Tower/Dice) so the whole set
    // reads as one system rather than hugging the pegs tightly.
    drawCabinetFrame(this, BOARD_CENTER_X, BOARD_CY, BOARD_W, BOARD_H);

    this.drawPegs();
    this.drawSlots();

    // Plain white ball, for the same reason Dice's marker is plain white: it
    // has to read against every slot it can land on without claiming a
    // colour of its own.
    this.ball = this.add.circle(
      BOARD_CENTER_X,
      BOARD_TOP_Y - Tokens.space.lg,
      BALL_RADIUS,
      Tokens.color.textPrimary
    );

    this.updateBalance();
  }

  /**
   * Static triangular peg grid - row r has r+1 pegs. A peg is now a single
   * flat muted dot with no outline (direction note 3): it used to be a
   * near-white disc with a dark stroke around it, which read as 36 little
   * outlined boxes rather than as the quiet obstacle field it is.
   */
  private drawPegs() {
    for (let r = 0; r < ROWS; r++) {
      const y = BOARD_TOP_Y + r * ROW_SPACING;
      for (let p = 0; p <= r; p++) {
        const x = BOARD_CENTER_X + (2 * p - r) * (PEG_SPACING / 2);
        this.add.circle(x, y, PEG_RADIUS, Tokens.color.textMuted);
      }
    }
  }

  /** Static row of multiplier buckets under the board, one per possible landing slot. */
  private drawSlots() {
    const slotWidth = PEG_SPACING;
    MULTIPLIERS.forEach((mult, i) => {
      const x = BOARD_CENTER_X + (2 * i - ROWS) * (PEG_SPACING / 2);
      makeInset(this, x, SLOTS_Y, slotWidth - Tokens.space.xxs, SLOT_H, Tokens.radius.xs);
      const label = makeText(this, x, SLOTS_Y, `${mult}x`, {
        size: Tokens.type.size.xs,
        weight: Tokens.type.weight.semibold,
        color: textColorForMultiplier(mult),
        align: "center",
        originX: 0.5,
        originY: 0.5
      });
      this.slotTexts.push(label);
    });
  }

  /** #36: the bounce path (and therefore the landing slot) is resolved server-side (POST /games/plinko/play) - `result.path` is the exact per-row "how many right bounces so far" sequence the server used, so the client just replays it visually instead of rolling its own. */
  private drop() {
    if (this.dropping) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    const bet = gameState.betAmount;
    this.dropping = true;
    this.dropBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Dropping...").setColor(Tokens.text.muted);

    api
      .playPlinko(bet, "GC")
      .then((res) => {
        const waypoints = res.result.path.map((rightCount, step) => ({
          x: BOARD_CENTER_X + (2 * rightCount - (step + 1)) * (PEG_SPACING / 2),
          y: BOARD_TOP_Y + (step + 1) * ROW_SPACING
        }));
        this.ball.setPosition(BOARD_CENTER_X, BOARD_TOP_Y - Tokens.space.lg);
        playSfx(this, "ballDrop");
        this.animateStep(waypoints, 0, () => this.resolveDrop(res));
      })
      .catch((err) => {
        this.dropping = false;
        this.dropBtn?.setEnabled(true);
        this.betControl?.setEnabled(true);
        if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
          this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
        } else if (err instanceof NetworkError) {
          this.messageText.setText(err.message).setColor(Tokens.text.negative);
        } else {
          this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
        }
      });
  }

  private animateStep(waypoints: Array<{ x: number; y: number }>, index: number, onDone: () => void) {
    if (index >= waypoints.length) {
      onDone();
      return;
    }
    // Per-peg fall timing is the game's own physics, not UI chrome - a
    // falling ball accelerates, so this keeps its ease-IN and its own
    // hand-tuned cadence rather than borrowing a token transition duration
    // (same reasoning as Limbo's hand-tuned climb tween).
    this.tweens.add({
      targets: this.ball,
      x: waypoints[index].x,
      y: waypoints[index].y,
      duration: 130,
      ease: "Quad.In",
      onComplete: () => this.animateStep(waypoints, index + 1, onDone)
    });
  }

  private resolveDrop(res: Awaited<ReturnType<typeof api.playPlinko>>) {
    gameState.hydrateFromServer(res.user);

    const { slotIndex, multiplier, payout } = res.result;
    const label = this.slotTexts[slotIndex];
    popIn(this, label);

    if (multiplier >= 1) {
      this.messageText.setText(`Landed on ${multiplier}x! +${payout} Gold Coins`).setColor(Tokens.text.accent);
      showWinCelebration(this, payout);
    } else {
      this.messageText.setText(`Landed on ${multiplier}x - only +${payout} Gold Coins`).setColor(Tokens.text.negative);
      playSfx(this, "lose");
    }

    this.updateBalance();
    this.dropping = false;
    this.dropBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins));
  }
}
