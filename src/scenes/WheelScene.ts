import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Tokens } from "../ui/DesignTokens";
import {
  makeButton,
  makeText,
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

const SEGMENT_COUNT = 20; // physical slices on the wheel - every risk level uses the same wheel
const HOUSE_EDGE = 0.03; // 3%, folded into every tier's multiplier below

/**
 * WHEEL, on the Stake-style direction (see ui/DesignTokens.ts).
 *
 * The wheel is one flat surface with no outer ring and no gold trim: it is
 * defined by where its slices end, and the slices are separated by a cut of
 * the page ground rather than by a stroked border (direction note 3). The
 * segment colours are the surface ladder with exactly one accent tier - see
 * Tokens.game.wheel for why - so a high-risk wheel reads as a dark disc
 * with a single bright jackpot slice instead of a carnival colour wheel.
 * Risk selection is marked by a lighter SURFACE and brighter text, the same
 * way Limbo/Baccarat mark a selection, so the accent stays on SPIN.
 *
 * The risk row deliberately carries no micro-label above it: Low/Medium/High
 * describe themselves, and the whole board has to fit the 130-470 mobile
 * safe zone (uiHelpers.ts's SAFE_ZONE_TOP/BOTTOM) around a 216px wheel.
 *
 * The display area is ~430px wide (x: 360-790), comfortably wider than the
 * wheel's diameter, so no scale-down is needed here.
 */
const BOARD_CX = GAME_SHELL_DISPLAY_CENTER_X;
const BOARD_CY = GAME_SHELL_DISPLAY_CENTER_Y;
const BOARD_W = 410;
/** Fills the safe zone exactly: 300 +/- 170 = 130-470. */
const BOARD_H = 340;
const BOARD_LEFT = BOARD_CX - BOARD_W / 2 + Tokens.space.xxl;
const BOARD_RIGHT = BOARD_CX + BOARD_W / 2 - Tokens.space.xxl;

const RISK_BTN_Y = 152;
const RISK_BTN_H = 30;
const RISK_BTN_W = (BOARD_RIGHT - BOARD_LEFT - Tokens.space.sm * 2) / 3;

const WHEEL_CENTER_X = BOARD_CX;
const WHEEL_CENTER_Y = 318;
const WHEEL_RADIUS = 108;
const WHEEL_HUB_RADIUS = 14;
/** Gap between the wheel's top edge and the tip of the fixed pointer. */
const POINTER_GAP = Tokens.space.lg;
const LEGEND_Y = 448;

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

/** Slice fill for a segment's multiplier - see Tokens.game.wheel for why these four steps. */
function colorForMultiplier(m: number): number {
  if (m <= 0) return Tokens.game.wheel.zero;
  if (m >= 8) return Tokens.game.wheel.jackpot;
  if (m >= 2) return Tokens.game.wheel.mid;
  return Tokens.game.wheel.low;
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
    playMusic(this, "retroPolka");
    this.risk = "low";
    this.spinning = false;
    this.riskButtons = {};
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

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
    this.messageText.setText("Pick a risk level and spin").setColor(Tokens.text.muted);

    drawCabinetFrame(this, BOARD_CX, BOARD_CY, BOARD_W, BOARD_H);

    this.renderRiskButtons();

    // Wheel visual: a rotating container of pie slices, plus a fixed pointer
    // at the top. The pointer is plain white so it stays legible over every
    // slice colour without claiming one of its own (same reasoning as Dice's
    // marker and Plinko's ball).
    this.wheelContainer = this.add.container(WHEEL_CENTER_X, WHEEL_CENTER_Y);
    this.add
      .triangle(
        WHEEL_CENTER_X,
        WHEEL_CENTER_Y - WHEEL_RADIUS - POINTER_GAP,
        -9,
        -12,
        9,
        -12,
        0,
        6,
        Tokens.color.textPrimary
      )
      .setDepth(10);

    this.legendText = makeText(this, BOARD_CX, LEGEND_Y, "", {
      size: Tokens.type.size.sm,
      color: Tokens.text.muted,
      align: "center",
      originX: 0.5
    });

    this.rebuildWheel();
    this.updateBalance();
  }

  private renderRiskButtons() {
    Object.values(this.riskButtons).forEach((b) => b?.destroy());
    this.riskButtons = {};

    (Object.keys(RISK_CONFIGS) as RiskKey[]).forEach((key, i) => {
      const cfg = RISK_CONFIGS[key];
      const selected = key === this.risk;
      this.riskButtons[key] = makeButton(
        this,
        BOARD_LEFT + RISK_BTN_W / 2 + i * (RISK_BTN_W + Tokens.space.sm),
        RISK_BTN_Y,
        RISK_BTN_W,
        RISK_BTN_H,
        cfg.label,
        // Selection reads as a lighter surface plus brighter text - never as
        // accent colour, which belongs to SPIN (direction note 2).
        selected ? Tokens.color.surfaceHover : Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        () => {
          if (this.spinning || this.risk === key) return;
          this.risk = key;
          this.renderRiskButtons();
          this.rebuildWheel();
        },
        selected ? Tokens.text.primary : Tokens.text.secondary,
        Tokens.radius.sm
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
      // A 1px cut of the page ground between slices, so adjacent same-tier
      // slices still read as separate segments. Not a decorative border -
      // there is deliberately no ring drawn around the wheel any more.
      g.lineStyle(1, Tokens.game.wheel.divider, 1);
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, WHEEL_RADIUS, startRad, endRad, false);
      g.closePath();
      g.strokePath();
    }
    this.wheelContainer.add(g);

    // Hub reads as a hole punched through the middle, so it drops to ground.
    const hub = this.add.circle(0, 0, WHEEL_HUB_RADIUS, Tokens.game.wheel.hub);
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
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    const bet = gameState.betAmount;
    this.spinning = true;
    this.spinBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    Object.values(this.riskButtons).forEach((b) => b?.setEnabled(false));
    this.messageText.setText("Spinning...").setColor(Tokens.text.muted);

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

        playSfx(this, "reelSpin");
        this.tweens.add({
          targets: this.wheelContainer,
          angle: targetAngle,
          duration: Tokens.motion.duration.spin,
          ease: Tokens.motion.ease.out,
          onComplete: () => this.resolveSpin(res)
        });
      })
      .catch((err) => this.handleSpinError(err));
  }

  private resolveSpin(res: Awaited<ReturnType<typeof api.playWheel>>) {
    gameState.hydrateFromServer(res.user);
    playSfx(this, "reelStop");
    const { multiplier, payout } = res.result;

    if (payout > 0) {
      this.messageText.setText(`Landed on ${multiplier}x! +${payout} Gold Coins`).setColor(Tokens.text.accent);
      popIn(this, this.legendText);
      showWinCelebration(this, payout);
    } else {
      this.messageText.setText("Landed on 0x - you lose").setColor(Tokens.text.negative);
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
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
    }
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins));
  }
}
