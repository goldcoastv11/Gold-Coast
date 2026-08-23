import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import {
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

const ROWS = 8; // rows of pegs -> 9 landing slots
const ROW_SPACING = 28;
const PEG_SPACING = 28;
const BOARD_TOP_Y = 182;
// Stake-style layout: board centered in the shell's right-side display area
// (see ui/uiHelpers.ts's makeGameShell), not the old canvas center - the
// sidebar now occupies the left third of the screen.
const BOARD_CENTER_X = GAME_SHELL_DISPLAY_CENTER_X;
const SLOTS_Y = 402;

// Symmetric payout table, one entry per slot (index = number of "right" bounces) - mirrors server/src/games/plinko.ts's PLINKO_MULTIPLIERS exactly (display/preview only; the server is what actually resolves a drop, see drop()).
const MULTIPLIERS = [16, 9, 2, 1.4, 0.6, 1.4, 2, 9, 16];

function colorForMultiplier(m: number): number {
  if (m >= 9) return Theme.gold;
  if (m >= 2) return Theme.accent;
  if (m >= 1) return Theme.neutral;
  return Theme.danger;
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
    this.dropping = false;
    this.slotTexts = [];
    this.cameras.main.setBackgroundColor(Theme.bgDark);

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
    this.messageText.setText("Drop a ball and watch it bounce").setColor(Theme.textMuted);

    this.drawPegs();
    this.drawSlots();

    this.ball = this.add.circle(BOARD_CENTER_X, BOARD_TOP_Y - 16, 6, Theme.gold);

    this.updateBalance();
  }

  /** Static triangular peg grid - row r has r+1 pegs. */
  private drawPegs() {
    for (let r = 0; r < ROWS; r++) {
      const y = BOARD_TOP_Y + r * ROW_SPACING;
      for (let p = 0; p <= r; p++) {
        const x = BOARD_CENTER_X + (2 * p - r) * (PEG_SPACING / 2);
        this.add.circle(x, y, 2.5, Theme.outline);
      }
    }
  }

  /** Static row of multiplier buckets under the board, one per possible landing slot. */
  private drawSlots() {
    const slotWidth = PEG_SPACING;
    MULTIPLIERS.forEach((mult, i) => {
      const x = BOARD_CENTER_X + (2 * i - ROWS) * (PEG_SPACING / 2);
      const color = colorForMultiplier(mult);
      makeInset(this, x, SLOTS_Y, slotWidth - 2, 26, 5);
      const label = this.add
        .text(x, SLOTS_Y, `${mult}x`, { fontSize: "10px", color: Phaser.Display.Color.IntegerToColor(color).rgba, fontStyle: "bold" })
        .setOrigin(0.5);
      this.slotTexts.push(label);
    });
  }

  /** #36: the bounce path (and therefore the landing slot) is resolved server-side (POST /games/plinko/play) - `result.path` is the exact per-row "how many right bounces so far" sequence the server used, so the client just replays it visually instead of rolling its own. */
  private drop() {
    if (this.dropping) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    const bet = gameState.betAmount;
    this.dropping = true;
    this.dropBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Dropping...").setColor(Theme.textMuted);

    api
      .playPlinko(bet, "GC")
      .then((res) => {
        const waypoints = res.result.path.map((rightCount, step) => ({
          x: BOARD_CENTER_X + (2 * rightCount - (step + 1)) * (PEG_SPACING / 2),
          y: BOARD_TOP_Y + (step + 1) * ROW_SPACING
        }));
        this.ball.setPosition(BOARD_CENTER_X, BOARD_TOP_Y - 16);
        this.animateStep(waypoints, 0, () => this.resolveDrop(res));
      })
      .catch((err) => {
        this.dropping = false;
        this.dropBtn?.setEnabled(true);
        this.betControl?.setEnabled(true);
        if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
          this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
        } else if (err instanceof NetworkError) {
          this.messageText.setText(err.message).setColor(Theme.textDanger);
        } else {
          this.messageText.setText("Something went wrong - please try again.").setColor(Theme.textDanger);
        }
      });
  }

  private animateStep(waypoints: Array<{ x: number; y: number }>, index: number, onDone: () => void) {
    if (index >= waypoints.length) {
      onDone();
      return;
    }
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
      this.messageText.setText(`Landed on ${multiplier}x! +${payout} Tickets`).setColor(Theme.textAccent);
    } else {
      this.messageText.setText(`Landed on ${multiplier}x - only +${payout} Tickets`).setColor(Theme.textDanger);
    }

    this.updateBalance();
    this.dropping = false;
    this.dropBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(`🪙 ${gameState.goldCoins}   🎟️ ${gameState.tickets}`);
  }
}
