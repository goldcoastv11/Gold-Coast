import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";

const TARGET_MIN = 5;
const TARGET_MAX = 95;
const TARGET_STEP = 5;
const DEFAULT_TARGET = 50;
const HOUSE_EDGE_NUMERATOR = 99; // 99 instead of 100 -> ~1% house edge baked into the multiplier - mirrors server/src/games/dice.ts exactly, used here only for the live win-chance/multiplier preview before rolling

const BAR_WIDTH = 340;
const BAR_X = 400;
const BAR_Y = 290;

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

  constructor() {
    super("DiceScene");
  }

  create() {
    fadeInOnCreate(this);
    this.target = DEFAULT_TARGET;
    this.rolling = false;
    this.rollTimer = undefined;
    this.lastRoll = null;
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.rollTimer) {
        this.rollTimer.remove(false);
        this.rollTimer = undefined;
      }
    });

    makePanel(this, 400, 300, 460, 420);

    this.add
      .text(400, 130, "DICE", {
        fontSize: "28px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    makeInset(this, 400, 163, 340, 32, 16);
    this.balanceText = this.add
      .text(400, 163, "", { fontSize: "13px", color: Theme.textPrimary })
      .setOrigin(0.5);

    this.betControl = makeBetControl(this, 400, 195, () => {});

    this.rollText = this.add
      .text(400, 240, "--", { fontSize: "44px", color: Theme.textPrimary, fontStyle: "bold" })
      .setOrigin(0.5);

    // Win/lose zone bar with a marker for the last roll
    this.zoneBar = this.add.graphics();
    this.marker = this.add
      .triangle(BAR_X, BAR_Y - 16, -6, 8, 6, 8, 0, -6, Theme.outline)
      .setVisible(false);

    this.minusBtn = makeButton(this, 300, 330, 44, 36, "-5", Theme.neutral, Theme.neutralHover, () =>
      this.adjustTarget(-TARGET_STEP)
    );
    this.targetLabel = this.add
      .text(400, 330, "", { fontSize: "15px", color: Theme.textPrimary, fontStyle: "bold" })
      .setOrigin(0.5);
    this.plusBtn = makeButton(this, 500, 330, 44, 36, "+5", Theme.neutral, Theme.neutralHover, () =>
      this.adjustTarget(TARGET_STEP)
    );

    this.statsText = this.add
      .text(400, 362, "", { fontSize: "13px", color: Theme.textMuted })
      .setOrigin(0.5);

    this.rollBtn = makeButton(this, 400, 412, 200, 52, "ROLL", Theme.accent, Theme.accentHover, () =>
      this.roll()
    );

    this.messageText = this.add
      .text(400, 452, "Roll under your target to win", { fontSize: "13px", color: Theme.textMuted })
      .setOrigin(0.5);

    makeButton(this, 400, 486, 200, 36, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      fadeToScene(this, "OverworldScene")
    );

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
    this.targetLabel.setText(`Roll Under: ${this.target}`);
    const mult = multiplierFor(this.target);
    this.statsText.setText(`Win Chance: ${this.target}%      Multiplier: ${mult.toFixed(2)}x`);
  }

  /** Draws the green (win) / red (lose) zone bar for the current target. */
  private redrawZoneBar() {
    const left = BAR_X - BAR_WIDTH / 2;
    const winWidth = (this.target / 100) * BAR_WIDTH;

    this.zoneBar.clear();
    this.zoneBar.fillStyle(Theme.winZone, 1);
    this.zoneBar.fillRoundedRect(left, BAR_Y - 9, winWidth, 18, 6);
    this.zoneBar.fillStyle(Theme.loseZone, 1);
    this.zoneBar.fillRoundedRect(left + winWidth, BAR_Y - 9, BAR_WIDTH - winWidth, 18, 6);
    this.zoneBar.lineStyle(2, Theme.panelBorder, 1);
    this.zoneBar.strokeRoundedRect(left, BAR_Y - 9, BAR_WIDTH, 18, 6);

    if (this.lastRoll !== null) {
      const markerX = left + (this.lastRoll / 99) * BAR_WIDTH;
      this.marker.setPosition(markerX, BAR_Y - 16).setVisible(true);
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
      this.messageText.setText("Not enough Tickets!").setColor(Theme.textDanger);
      return;
    }

    const bet = gameState.betAmount;
    const target = this.target;
    this.rolling = true;
    this.rollBtn?.setEnabled(false);
    this.minusBtn?.setEnabled(false);
    this.plusBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Rolling...").setColor(Theme.textMuted);

    this.rollTimer = this.time.addEvent({
      delay: 70,
      loop: true,
      callback: () => {
        if (this.rollText.active) {
          this.rollText.setText(String(Phaser.Math.Between(0, 99)));
        }
      }
    });

    api
      .playDice(bet, "GC", target)
      .then((res) => this.resolveRoll(res))
      .catch((err) => this.handleRollError(err));
  }

  private resolveRoll(res: Awaited<ReturnType<typeof api.playDice>>) {
    this.rollTimer?.remove(false);
    this.rollTimer = undefined;

    gameState.hydrateFromServer(res.user);

    const { roll, target, won, payout } = res.result;
    this.lastRoll = roll;
    this.rollText.setText(String(roll));
    this.redrawZoneBar();

    if (won) {
      this.rollText.setColor(Theme.textAccent);
      this.messageText.setText(`${roll} - under ${target}! +${payout} Tickets`).setColor(Theme.textAccent);
      popIn(this, this.rollText);
    } else {
      this.rollText.setColor(Theme.textDanger);
      this.messageText.setText(`${roll} - not under ${target}, you lose`).setColor(Theme.textDanger);
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
    this.rollText.setText("--");

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Tickets!").setColor(Theme.textDanger);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Theme.textDanger);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Theme.textDanger);
    }

    this.rolling = false;
    this.rollBtn?.setEnabled(true);
    this.minusBtn?.setEnabled(true);
    this.plusBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(`🎟️ ${gameState.goldCoins}   💰 ${gameState.stakeCoins}`);
  }
}
