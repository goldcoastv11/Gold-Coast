import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import {
  makeButton,
  makeGameShell,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  GAME_SHELL_DISPLAY_CENTER_Y,
  popIn,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx } from "../ui/SoundManager";

const SEGMENT_COUNT = 20; // physical slices on the wheel - every risk level uses the same wheel
const HOUSE_EDGE = 0.03; // 3%, folded into every tier's multiplier below

// Stake-style layout: wheel centered in the shell's right-side display
// area (see ui/uiHelpers.ts's makeGameShell), not the old canvas center -
// the sidebar now occupies the left third of the screen. The display area
// is ~430px wide (x: 360-790), comfortably wider than the wheel's 216px
// diameter, so no scale-down is needed here.
const WHEEL_CENTER_X = GAME_SHELL_DISPLAY_CENTER_X;
const WHEEL_CENTER_Y = GAME_SHELL_DISPLAY_CENTER_Y - 8;
const WHEEL_RADIUS = 108;

type RiskKey = "low" | "medium" | "high";

interface WheelTier {
  count: number; // how many of the 20 segments pay this tier
  weight?: number; // relative payout emphasis; defaults to 1/count (rarer tier pays more)
}

interface RiskConfig {
  key: RiskKey;
  label: string;
  zeroCount: number; // losing segments (always pay 0)
  tiers: WheelTier[];
}

/**
 * Three risk levels, each spending the same 20 segments differently:
 * - low: no losing segments, small spread around ~1x
 * - medium: some losing segments, moderate spread
 * - high: mostly losing segments, one rare segment with a big multiplier
 *   (custom weights instead of the 1/count default so the single rarest
 *   segment gets a disproportionate jackpot instead of just "1/count" more)
 * Segment counts were hand-picked (like Plinko's slot layout); the
 * multiplier for each tier is *derived*, not picked - see tierMultipliers.
 *
 * #36: this file's copy of the math (mirrored exactly in
 * server/src/games/wheel.ts) is used for the initial wheel drawing/legend
 * before the player has spun; every actual spin's landing segment comes
 * from the server's response instead (see spin()), so a drift between the
 * two copies could never mismatch what a round actually pays.
 */
const RISK_CONFIGS: Record<RiskKey, RiskConfig> = {
  low: { key: "low", label: "Low", zeroCount: 2, tiers: [{ count: 12 }, { count: 6 }] },
  medium: {
    key: "medium",
    label: "Medium",
    zeroCount: 6,
    tiers: [{ count: 8 }, { count: 4 }, { count: 2 }]
  },
  high: {
    key: "high",
    label: "High",
    zeroCount: 16,
    tiers: [
      { count: 2, weight: 3 },
      { count: 1, weight: 8 },
      { count: 1, weight: 40 }
    ]
  }
};

/**
 * Each risk config assigns `count` (out of SEGMENT_COUNT) segments to pay
 * out at some multiplier. If a tier's multiplier were priced independently
 * as (1-edge)/probability - the same style Dice/Mines use for their single
 * winning outcome - multiple simultaneous paying tiers would each
 * contribute ~(1-edge) to the expected value and the sum would blow way
 * past 1 (see the equivalent bug caught and fixed in KenoScene). Instead,
 * every tier's multiplier is `K * weight`, with K solved so that summing
 * (probability * multiplier) across every paying tier - the actual
 * expected value of a spin - lands on exactly (1-HOUSE_EDGE):
 *
 *   sum(count_i/N * K * weight_i) = 1 - HOUSE_EDGE
 *   K = (1-HOUSE_EDGE) * N / sum(count_i * weight_i)
 *
 * Default weight = 1/count, so a tier's own multiplier is inversely
 * proportional to how common it is (rarer pays more) - "high" overrides
 * this on its rarest segment for a proper jackpot feel.
 */
function tierMultipliers(cfg: RiskConfig): number[] {
  const weights = cfg.tiers.map((t) => t.weight ?? 1 / t.count);
  const weightedSum = cfg.tiers.reduce((sum, t, i) => sum + t.count * weights[i], 0);
  if (weightedSum <= 0) return cfg.tiers.map(() => 0);
  const k = ((1 - HOUSE_EDGE) * SEGMENT_COUNT) / weightedSum;
  return cfg.tiers.map((t, i) => Math.round(k * weights[i] * 100) / 100);
}

/** Builds the 20 physical segment values, interleaved so zeros/tiers alternate around the wheel instead of clumping. */
function buildSegmentValues(cfg: RiskConfig): number[] {
  const mults = tierMultipliers(cfg);
  const groups: number[][] = [Array(cfg.zeroCount).fill(0)];
  cfg.tiers.forEach((t, i) => groups.push(Array(t.count).fill(mults[i])));

  const maxLen = Math.max(...groups.map((g) => g.length));
  const result: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    for (const g of groups) {
      if (i < g.length) result.push(g[i]);
    }
  }
  return result;
}

function colorForMultiplier(m: number): number {
  if (m <= 0) return Theme.danger;
  if (m >= 8) return Theme.gold;
  if (m >= 2) return Theme.accent;
  return Theme.neutral;
}

export class WheelScene extends Phaser.Scene {
  private risk: RiskKey = "low";
  private segments: number[] = [];
  private spinning = false;
  private wheelContainer!: Phaser.GameObjects.Container;
  private riskButtons: Partial<Record<RiskKey, UIButton>> = {};

  private balanceText!: Phaser.GameObjects.Text;
  private legendText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private spinBtn?: UIButton;
  private betControl?: BetControl;
  private shell!: GameShellHandle;

  constructor() {
    super("WheelScene");
  }

  create() {
    fadeInOnCreate(this);
    this.risk = "low";
    this.spinning = false;
    this.riskButtons = {};
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.tweens.killTweensOf(this.wheelContainer);
    });

    // Stake-style shell: left sidebar (title/balance/bet/message/Spin/
    // Walk Away) + open right-side display area for the wheel/risk
    // selector/legend - see ui/uiHelpers.ts's makeGameShell doc comment.
    this.shell = makeGameShell(this, "WHEEL", "SPIN", {
      onStart: () => this.spin(),
      onCashOut: () => {},
      onWalkAway: () => fadeToScene(this, "OverworldScene")
    });
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.betControl = this.shell.betControl;
    this.spinBtn = this.shell.startBtn;
    this.messageText.setText("Pick a risk level and spin").setColor(Theme.textMuted);

    this.renderRiskButtons();

    // Wheel visual: a rotating container of pie slices, plus a fixed pointer at the top
    this.wheelContainer = this.add.container(WHEEL_CENTER_X, WHEEL_CENTER_Y);
    this.add
      .triangle(
        WHEEL_CENTER_X,
        WHEEL_CENTER_Y - WHEEL_RADIUS - 14,
        -9,
        -12,
        9,
        -12,
        0,
        6,
        Theme.outline
      )
      .setDepth(10);

    this.legendText = this.add
      .text(GAME_SHELL_DISPLAY_CENTER_X, GAME_SHELL_DISPLAY_CENTER_Y + 128, "", {
        fontSize: "11px",
        color: Theme.textGold,
        align: "center"
      })
      .setOrigin(0.5);

    this.rebuildWheel();
    this.updateBalance();
  }

  private renderRiskButtons() {
    Object.values(this.riskButtons).forEach((b) => b?.destroy());
    this.riskButtons = {};

    const xs: Record<RiskKey, number> = {
      low: GAME_SHELL_DISPLAY_CENTER_X - 120,
      medium: GAME_SHELL_DISPLAY_CENTER_X,
      high: GAME_SHELL_DISPLAY_CENTER_X + 120
    };
    (Object.keys(RISK_CONFIGS) as RiskKey[]).forEach((key) => {
      const cfg = RISK_CONFIGS[key];
      const selected = key === this.risk;
      this.riskButtons[key] = makeButton(
        this,
        xs[key],
        GAME_SHELL_DISPLAY_CENTER_Y - 166,
        110,
        30,
        cfg.label,
        selected ? Theme.accent : Theme.neutral,
        selected ? Theme.accentHover : Theme.neutralHover,
        () => {
          if (this.spinning || this.risk === key) return;
          this.risk = key;
          this.renderRiskButtons();
          this.rebuildWheel();
        }
      );
    });
  }

  /** Rebuilds the segment values/visual/legend for the current risk level (called on create and on risk change). */
  private rebuildWheel() {
    this.segments = buildSegmentValues(RISK_CONFIGS[this.risk]);
    this.drawWheel();
    this.updateLegend();
  }

  private drawWheel() {
    this.wheelContainer.removeAll(true);
    this.wheelContainer.setAngle(0);

    const anglePer = 360 / SEGMENT_COUNT;
    const g = this.add.graphics();
    for (let i = 0; i < this.segments.length; i++) {
      const startDeg = -90 + i * anglePer;
      const endDeg = startDeg + anglePer;
      const startRad = Phaser.Math.DegToRad(startDeg);
      const endRad = Phaser.Math.DegToRad(endDeg);
      const color = colorForMultiplier(this.segments[i]);

      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, WHEEL_RADIUS, startRad, endRad, false);
      g.closePath();
      g.fillPath();
      g.lineStyle(1, Theme.outline, 1);
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, WHEEL_RADIUS, startRad, endRad, false);
      g.closePath();
      g.strokePath();
    }
    g.lineStyle(3, Theme.panelBorder, 1);
    g.strokeCircle(0, 0, WHEEL_RADIUS);
    this.wheelContainer.add(g);

    const hub = this.add.circle(0, 0, 14, Theme.outline).setStrokeStyle(2, Theme.panelBorder);
    this.wheelContainer.add(hub);
  }

  private updateLegend() {
    const cfg = RISK_CONFIGS[this.risk];
    const mults = tierMultipliers(cfg);
    const parts = [`0x×${cfg.zeroCount}`];
    cfg.tiers.forEach((t, i) => parts.push(`${mults[i]}x×${t.count}`));
    this.legendText.setText(parts.join("   "));
  }

  /** #36: the landing segment is resolved server-side (POST /games/wheel/play) - the spin tween just rotates toward whatever index the server picked, it doesn't decide the outcome. `result.segments` also comes straight from the server so the drawn wheel and the payout can never disagree, even if the client's own buildSegmentValues ever drifted from the server's copy. */
  private spin() {
    if (this.spinning) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    const bet = gameState.betAmount;
    this.spinning = true;
    this.spinBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    Object.values(this.riskButtons).forEach((b) => b?.setEnabled(false));
    this.messageText.setText("Spinning...").setColor(Theme.textMuted);

    api
      .playWheel(bet, "GC", this.risk)
      .then((res) => {
        this.segments = res.result.segments;
        const { landingIndex } = res.result;
        const anglePer = 360 / SEGMENT_COUNT;
        const segmentCenterDeg = -90 + (landingIndex + 0.5) * anglePer;
        const extraSpins = 6;
        // Rotate so segmentCenterDeg ends up at the pointer (-90deg / top).
        const targetAngle = extraSpins * 360 - 90 - segmentCenterDeg;

        this.tweens.add({
          targets: this.wheelContainer,
          angle: targetAngle,
          duration: 2600,
          ease: "Cubic.Out",
          onComplete: () => this.resolveSpin(res)
        });
      })
      .catch((err) => this.handleSpinError(err));
  }

  private resolveSpin(res: Awaited<ReturnType<typeof api.playWheel>>) {
    gameState.hydrateFromServer(res.user);
    const { multiplier, payout } = res.result;

    if (payout > 0) {
      this.messageText.setText(`Landed on ${multiplier}x! +${payout} Tickets`).setColor(Theme.textAccent);
      popIn(this, this.legendText);
      showWinCelebration(this, payout);
    } else {
      this.messageText.setText("Landed on 0x - you lose").setColor(Theme.textDanger);
      playSfx(this, "lose");
    }

    this.updateBalance();
    this.spinning = false;
    this.spinBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
    Object.values(this.riskButtons).forEach((b) => b?.setEnabled(true));
  }

  private handleSpinError(err: unknown) {
    this.spinning = false;
    this.spinBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
    Object.values(this.riskButtons).forEach((b) => b?.setEnabled(true));

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Theme.textDanger);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Theme.textDanger);
    }
  }

  private updateBalance() {
    this.balanceText.setText(`🪙 ${gameState.goldCoins}   🎟️ ${gameState.tickets}`);
  }
}
