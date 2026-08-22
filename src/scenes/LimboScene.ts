import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";

const PRESET_TARGETS = [1.5, 2, 3, 5, 10, 25, 50, 100];
const DEFAULT_TARGET = 2;

export class LimboScene extends Phaser.Scene {
  private target = DEFAULT_TARGET;
  private running = false;
  private presetButtons: UIButton[] = [];

  private multiplierText!: Phaser.GameObjects.Text;
  private targetText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private playBtn?: UIButton;
  private betControl?: BetControl;

  constructor() {
    super("LimboScene");
  }

  create() {
    fadeInOnCreate(this);
    this.target = DEFAULT_TARGET;
    this.running = false;
    this.presetButtons = [];
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.tweens.killTweensOf(this);
    });

    makePanel(this, 400, 300, 460, 420);

    this.add
      .text(400, 130, "LIMBO", {
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

    this.multiplierText = this.add
      .text(400, 245, "1.00x", { fontSize: "40px", color: Theme.textPrimary, fontStyle: "bold" })
      .setOrigin(0.5);

    this.targetText = this.add
      .text(400, 280, "", { fontSize: "14px", color: Theme.textGold, fontStyle: "bold" })
      .setOrigin(0.5);

    this.playBtn = makeButton(this, 400, 430, 200, 46, "PLAY", Theme.accent, Theme.accentHover, () =>
      this.play()
    );

    this.messageText = this.add
      .text(400, 388, "Pick a target multiplier", { fontSize: "13px", color: Theme.textMuted })
      .setOrigin(0.5);

    makeButton(this, 400, 470, 200, 32, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      fadeToScene(this, "OverworldScene")
    );

    this.renderPresets();
    this.updateTargetText();
    this.updateBalance();
  }

  private renderPresets() {
    this.presetButtons.forEach((b) => b.destroy());
    this.presetButtons = [];

    const xs = [250, 350, 450, 550];
    PRESET_TARGETS.forEach((value, i) => {
      const row = i < 4 ? 0 : 1;
      const x = xs[i % 4];
      const y = row === 0 ? 315 : 350;
      const selected = value === this.target;
      const btn = makeButton(
        this,
        x,
        y,
        80,
        32,
        `${value}x`,
        selected ? Theme.accent : Theme.neutral,
        selected ? Theme.accentHover : Theme.neutralHover,
        () => {
          if (this.running) return;
          this.target = value;
          this.updateTargetText();
          this.renderPresets();
        }
      );
      this.presetButtons.push(btn);
    });
  }

  private updateTargetText() {
    this.targetText.setText(`Target: ${this.target.toFixed(2)}x`);
  }

  /** #36: the crash point is resolved server-side (POST /games/limbo/play) - the climbing-number animation here plays toward the server's real crashPoint once the response arrives, it doesn't determine the outcome. */
  private play() {
    if (this.running) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    const bet = gameState.betAmount;
    const target = this.target;
    this.running = true;
    this.playBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.presetButtons.forEach((b) => b.setEnabled(false));

    this.multiplierText.setText("1.00x").setColor(Theme.textPrimary);
    this.messageText.setText("Climbing...").setColor(Theme.textMuted);

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
      ease: "Cubic.Out",
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
      this.multiplierText.setColor(Theme.textAccent);
      this.messageText.setText(`Hit ${crashPoint.toFixed(2)}x - you win +${payout} GC`).setColor(
        Theme.textAccent
      );
      popIn(this, this.multiplierText);
    } else {
      this.multiplierText.setColor(Theme.textDanger);
      this.messageText
        .setText(`Stopped at ${crashPoint.toFixed(2)}x - under ${target.toFixed(2)}x, you lose`)
        .setColor(Theme.textDanger);
    }

    this.updateBalance();
    this.running = false;
    this.playBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
    this.presetButtons.forEach((b) => b.setEnabled(true));
  }

  private handlePlayError(err: unknown) {
    this.multiplierText.setText("1.00x").setColor(Theme.textPrimary);

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Theme.textDanger);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Theme.textDanger);
    }

    this.running = false;
    this.playBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
    this.presetButtons.forEach((b) => b.setEnabled(true));
  }

  private updateBalance() {
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
