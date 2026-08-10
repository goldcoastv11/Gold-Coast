import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";

const ROWS = 8; // rows of pegs -> 9 landing slots
const ROW_SPACING = 28;
const PEG_SPACING = 28;
const BOARD_TOP_Y = 182;
const BOARD_CENTER_X = 400;
const SLOTS_Y = 402;

// Symmetric payout table, one entry per slot (index = number of "right" bounces).
const MULTIPLIERS = [16, 9, 2, 1.4, 0.6, 1.4, 2, 9, 16];

function colorForMultiplier(m: number): number {
  if (m >= 9) return Theme.gold;
  if (m >= 2) return Theme.accent;
  if (m >= 1) return 0xffffff;
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

  constructor() {
    super("PlinkoScene");
  }

  create() {
    this.dropping = false;
    this.slotTexts = [];
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.tweens.killTweensOf(this.ball);
    });

    makePanel(this, 400, 300, 520, 480);

    this.add
      .text(400, 82, "PLINKO", {
        fontSize: "26px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    makeInset(this, 400, 114, 380, 30, 15);
    this.balanceText = this.add
      .text(400, 114, "", { fontSize: "13px", color: Theme.textPrimary })
      .setOrigin(0.5);

    this.betControl = makeBetControl(this, 400, 146, () => {});

    this.drawPegs();
    this.drawSlots();

    this.ball = this.add.circle(BOARD_CENTER_X, BOARD_TOP_Y - 16, 6, Theme.gold);

    this.messageText = this.add
      .text(400, 432, "Drop a ball and watch it bounce", { fontSize: "13px", color: Theme.textMuted })
      .setOrigin(0.5);

    this.dropBtn = makeButton(this, 400, 470, 200, 46, "DROP BALL", Theme.accent, Theme.accentHover, () =>
      this.drop()
    );

    makeButton(this, 400, 516, 200, 32, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      this.scene.start("OverworldScene")
    );

    this.updateBalance();
  }

  /** Static triangular peg grid - row r has r+1 pegs. */
  private drawPegs() {
    for (let r = 0; r < ROWS; r++) {
      const y = BOARD_TOP_Y + r * ROW_SPACING;
      for (let p = 0; p <= r; p++) {
        const x = BOARD_CENTER_X + (2 * p - r) * (PEG_SPACING / 2);
        this.add.circle(x, y, 2.5, 0x8a92a3);
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
    gameState.goldCoins -= bet;
    this.updateBalance();
    this.messageText.setText("Dropping...").setColor(Theme.textMuted);

    // Precompute the whole bounce path up front (fair coin flip per row)
    let rightCount = 0;
    const waypoints: Array<{ x: number; y: number }> = [];
    for (let step = 0; step < ROWS; step++) {
      if (Phaser.Math.Between(0, 1) === 1) rightCount++;
      const x = BOARD_CENTER_X + (2 * rightCount - (step + 1)) * (PEG_SPACING / 2);
      const y = BOARD_TOP_Y + (step + 1) * ROW_SPACING;
      waypoints.push({ x, y });
    }

    this.ball.setPosition(BOARD_CENTER_X, BOARD_TOP_Y - 16);
    this.animateStep(waypoints, 0, () => this.resolveDrop(bet, rightCount));
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

  private resolveDrop(bet: number, slotIndex: number) {
    const mult = MULTIPLIERS[slotIndex];
    const payout = Math.round(bet * mult);
    gameState.goldCoins += payout;

    const label = this.slotTexts[slotIndex];
    popIn(this, label);

    if (mult >= 1) {
      this.messageText.setText(`Landed on ${mult}x! +${payout} GC`).setColor(Theme.textAccent);
    } else {
      this.messageText.setText(`Landed on ${mult}x - only +${payout} GC`).setColor(Theme.textDanger);
    }

    this.updateBalance();
    this.dropping = false;
    this.dropBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
