import Phaser from "phaser";
import { embeddedGame, loungePresentation } from '../mobile/arcadeBridge';
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
import type { RouletteBet, RouletteColor } from "../api/types";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";
import { createQuickplayStage, drawManualAuto, drawQuickLabel, makeQuickBackButton, makeQuickBetControl } from "../ui/quickplayGameUi";

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
const WHEEL_RADIUS = (DIVIDER_Y - RESULT_LABEL_Y) / 2 - Tokens.space.sm;
const POCKETS = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
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
  private wheel?: Phaser.GameObjects.Container;
  private directQuickplay = false;
  private selectedBet: RouletteBet = "red";
  private selectedBetLabel = "Red";
  private playBtn?: UIButton;
  private numberZones: Phaser.GameObjects.Zone[] = [];

  constructor() {
    super("RouletteScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "polkaTrain");
    this.spinning = false;
    this.spinTimer = undefined;
    this.betButtons = [];
    this.wheel = undefined;
    this.selectedBet = "red";
    this.selectedBetLabel = "Red";
    this.numberZones = [];
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.spinTimer) {
        this.spinTimer.remove(false);
        this.spinTimer = undefined;
      }
    });

    this.directQuickplay = !!embeddedGame() && !loungePresentation();
    if (this.directQuickplay) {
      this.scale.once("resize", () => this.scene.restart());
      this.createDirectQuickplayLayout();
      this.updateBalance();
      return;
    }

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
    if (!embeddedGame()) {
      this.add.image(DX, TABLE_ART_Y, "roulette_table")
        .setDisplaySize(TABLE_ART_W, TABLE_ART_H).setAlpha(TABLE_ART_ALPHA);
      const dealer = this.add.sprite(DEALER_SPRITE_X, DEALER_SPRITE_Y, "dealer_sheet", 1)
        .setScale(DEALER_SPRITE_SCALE);
      dealer.play("dealer_walk_down");
    }

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
    if (embeddedGame()) {
      this.wheel = this.add.container(DX, RESULT_WELL_Y);
      const pockets = this.add.graphics();
      const step = Math.PI * 2 / POCKETS.length;
      POCKETS.forEach((n, i) => {
        const start = i * step - Math.PI / 2 - step / 2;
        pockets.fillStyle(COLOR_NUM[colorOf(n)], 1);
        pockets.beginPath(); pockets.moveTo(0, 0);
        pockets.arc(0, 0, WHEEL_RADIUS, start, start + step - .014);
        pockets.closePath(); pockets.fillPath();
      });
      pockets.fillStyle(Tokens.color.inset, 1); pockets.fillCircle(0, 0, WHEEL_RADIUS * .64);
      pockets.lineStyle(2, Tokens.color.textSecondary, .7); pockets.strokeCircle(0, 0, WHEEL_RADIUS);
      this.wheel.add(pockets);
      this.add.circle(DX, RESULT_WELL_Y - WHEEL_RADIUS + Tokens.space.xs, 4, Tokens.color.textPrimary).setDepth(2);
    } else makeInset(this, DX, RESULT_WELL_Y, RESULT_WELL_W, RESULT_WELL_H, Tokens.radius.md);
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

  private createDirectQuickplayLayout() {
    const stage = createQuickplayStage(this);
    drawManualAuto(this, stage);
    drawQuickLabel(this, stage, 61, "TOTAL AMOUNT");
    this.balanceText = makeText(this, stage.right, stage.top + 61, "", { size: Tokens.type.size.xs, color: Tokens.text.muted, align: "right", originX: 1 }).setScrollFactor(0);
    this.betControl = makeQuickBetControl(this, stage, 89);
    this.messageText = makeText(this, stage.left, stage.top + 124, "Selected: Red", { size: Tokens.type.size.sm, color: Tokens.text.muted, wordWrapWidth: stage.contentW, originY: 0 }).setScrollFactor(0);
    this.playBtn = makeButton(this, stage.controls.x + stage.controls.w / 2, stage.top + 186, stage.contentW, 44, "PLAY", 0x1f7ae0, 0x2b8bf0, () => this.spin(this.selectedBet), Tokens.text.primary, Tokens.radius.md);
    makeQuickBackButton(this, stage, () => fadeToScene(this, "OverworldScene"));

    const centerX = stage.board.x + stage.board.w / 2;
    const radius = Math.min(112, stage.board.w * 0.18, stage.board.h * 0.22);
    const wheelY = stage.board.y + radius + 30;
    this.wheel = this.add.container(centerX, wheelY);
    const wheelGraphics = this.add.graphics();
    const step = Math.PI * 2 / POCKETS.length;
    POCKETS.forEach((number, index) => {
      const start = index * step - Math.PI / 2 - step / 2;
      wheelGraphics.fillStyle(COLOR_NUM[colorOf(number)], 1);
      wheelGraphics.beginPath();
      wheelGraphics.moveTo(0, 0);
      wheelGraphics.arc(0, 0, radius, start, start + step - 0.012);
      wheelGraphics.closePath();
      wheelGraphics.fillPath();
      const angle = start + step / 2;
      const label = makeText(this, Math.cos(angle) * radius * 0.84, Math.sin(angle) * radius * 0.84, String(number), { size: "7px", weight: Tokens.type.weight.bold, color: Tokens.text.primary, align: "center", originX: 0.5, originY: 0.5 });
      label.setRotation(angle + Math.PI / 2);
      this.wheel!.add(label);
    });
    wheelGraphics.fillStyle(Tokens.color.inset, 1).fillCircle(0, 0, radius * 0.62);
    wheelGraphics.lineStyle(6, Tokens.color.scrim, 0.8).strokeCircle(0, 0, radius + 3);
    this.wheel.addAt(wheelGraphics, 0);
    this.resultText = makeText(this, centerX, wheelY, "?", { size: Tokens.type.size.display, weight: Tokens.type.weight.bold, color: Tokens.text.primary, align: "center", originX: 0.5, originY: 0.5 });
    this.add.circle(centerX, wheelY - radius - 2, 5, 0xffc800).setDepth(5);

    const tableX = stage.board.x + 24;
    const tableY = stage.board.y + stage.board.h * 0.45;
    const tableW = stage.board.w - 48;
    const tableH = stage.board.h * 0.24;
    this.drawDirectRouletteGrid(tableX, tableY, tableW, tableH);
    this.drawDirectGroupBets(tableX, tableY + tableH + 7, tableW, Math.max(30, stage.board.h * 0.055));
  }

  private drawDirectRouletteGrid(x: number, y: number, width: number, height: number) {
    const rows = [
      [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
      [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
      [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]
    ];
    const gap = 3;
    const zeroW = Math.min(44, width * 0.065);
    const cellW = (width - zeroW - gap * 12) / 12;
    const cellH = (height - gap * 2) / 3;
    const zero = this.add.graphics();
    zero.fillStyle(COLOR_NUM.green, 0.7).fillRoundedRect(x, y, zeroW, height, Tokens.radius.sm);
    makeText(this, x + zeroW / 2, y + height / 2, "0", { size: Tokens.type.size.sm, weight: Tokens.type.weight.bold, color: Tokens.text.onAccent, align: "center", originX: 0.5, originY: 0.5 });
    this.makeNumberZone(x, y, zeroW, height, 0, zero);
    rows.forEach((row, rowIndex) => row.forEach((number, colIndex) => {
      const cx = x + zeroW + gap + colIndex * (cellW + gap);
      const cy = y + rowIndex * (cellH + gap);
      const g = this.add.graphics();
      g.fillStyle(COLOR_NUM[colorOf(number)], 0.95).fillRoundedRect(cx, cy, cellW, cellH, Tokens.radius.xs);
      makeText(this, cx + cellW / 2, cy + cellH / 2, String(number), { size: Tokens.type.size.xs, weight: Tokens.type.weight.bold, color: Tokens.text.primary, align: "center", originX: 0.5, originY: 0.5 });
      this.makeNumberZone(cx, cy, cellW, cellH, number, g);
    }));
  }

  private makeNumberZone(x: number, y: number, width: number, height: number, number: number, graphic: Phaser.GameObjects.Graphics) {
    const zone = this.add.zone(x + width / 2, y + height / 2, width, height).setInteractive({ useHandCursor: true });
    zone.on("pointerover", () => graphic.setAlpha(0.72));
    zone.on("pointerout", () => graphic.setAlpha(1));
    zone.on("pointerdown", () => this.selectBet(`number:${number}`, `Number ${number}`));
    this.numberZones.push(zone);
  }

  private drawDirectGroupBets(x: number, y: number, width: number, height: number) {
    const gap = 4;
    const addRow = (items: Array<{ bet: RouletteBet; label: string; color?: number }>, rowY: number) => {
      const buttonW = (width - gap * (items.length - 1)) / items.length;
      items.forEach((item, index) => this.betButtons.push(makeButton(
        this, x + buttonW / 2 + index * (buttonW + gap), rowY + height / 2, buttonW, height,
        item.label, item.color ?? Tokens.color.surfaceRaised, item.color ? item.color : Tokens.color.surfaceHover,
        () => this.selectBet(item.bet, item.label), Tokens.text.primary, Tokens.radius.xs
      )));
    };
    addRow([
      { bet: "dozen1", label: "1st 12" }, { bet: "dozen2", label: "2nd 12" }, { bet: "dozen3", label: "3rd 12" },
      { bet: "column1", label: "Col 1" }, { bet: "column2", label: "Col 2" }, { bet: "column3", label: "Col 3" }
    ], y);
    addRow([
      { bet: "low", label: "1–18" }, { bet: "even", label: "EVEN" }, { bet: "red", label: "RED", color: COLOR_NUM.red },
      { bet: "black", label: "BLACK", color: COLOR_NUM.black }, { bet: "odd", label: "ODD" }, { bet: "high", label: "19–36" }
    ], y + height + gap);
  }

  private selectBet(bet: RouletteBet, label: string) {
    if (this.spinning) return;
    this.selectedBet = bet;
    this.selectedBetLabel = label;
    this.messageText.setText(`Selected: ${label}`).setColor(Tokens.text.muted);
    playSfx(this, "chipBet");
  }

  /** #36: the winning number is resolved server-side (POST /games/roulette/play) - the spinning-digits animation here is purely cosmetic while the request is in flight. */
  private spin(bet: RouletteBet) {
    if (this.spinning) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    const wager = gameState.betAmount;
    this.spinning = true;
    this.betButtons.forEach((b) => b.setEnabled(false));
    this.playBtn?.setEnabled(false);
    this.numberZones.forEach((zone) => zone.disableInteractive());
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
          if (this.wheel) this.wheel.rotation += .35;
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
    const { number, color, won, payout } = res.result;

    // Retention Leg 1 - see src/api/track.ts. Server-settled result only;
    // betAmount and payout are both Gold Coins (GC-only economy).
    track(EVENTS.GAME_ROUND_PLAYED, {
      game: "roulette",
      betAmount: wager,
      outcome: won ? "win" : "loss",
      payout
    });
    const finish = () => {
      playSfx(this, "reelStop");
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
      this.playBtn?.setEnabled(true);
      this.numberZones.forEach((zone) => zone.setInteractive({ useHandCursor: true }));
      this.betControl?.setEnabled(true);
    };

    if (!this.wheel) return finish();
    const step = Math.PI * 2 / POCKETS.length;
    const landing = -POCKETS.indexOf(number) * step;
    const currentNormalized = Phaser.Math.Wrap(this.wheel.rotation, 0, Math.PI * 2);
    const landingNormalized = Phaser.Math.Wrap(landing, 0, Math.PI * 2);
    const delta = Phaser.Math.Wrap(landingNormalized - currentNormalized, 0, Math.PI * 2);
    this.tweens.add({ targets: this.wheel, rotation: this.wheel.rotation + Math.PI * 10 + delta, duration: 1650, ease: "Cubic.easeOut", onComplete: finish });
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
    this.playBtn?.setEnabled(true);
    this.numberZones.forEach((zone) => zone.setInteractive({ useHandCursor: true }));
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins));
  }
}
