import Phaser from "phaser";
import { embeddedGame, loungePresentation } from "../mobile/arcadeBridge";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Tokens } from "../ui/DesignTokens";
import {
  makeButton,
  makeText,
  makeDivider,
  makeGameShell,
  formatBalance,
  drawCardSurface,
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
import type { HiLoGuess } from "../api/types";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";
import { createQuickplayStage, drawQuickLabel, makeQuickBackButton, makeQuickBetControl } from "../ui/quickplayGameUi";

// Stake-style layout: card/history/buttons centered in the shell's
// right-side display area (see ui/uiHelpers.ts's makeGameShell) - the
// sidebar now occupies the left third of the screen.
const DX = GAME_SHELL_DISPLAY_CENTER_X;
const DY = GAME_SHELL_DISPLAY_CENTER_Y;

/**
 * HI-LO, on the Stake-style direction (see ui/DesignTokens.ts).
 *
 * Cards are drawn with the shared card surfaces (uiHelpers' drawCardSurface)
 * so all four card games print the same card. HIGHER/LOWER are raised
 * SURFACES rather than accent buttons on purpose: this game's accent belongs
 * to the shell's START RUN and, mid-run, CASH OUT - the decision that
 * actually banks the money. Three green buttons on one screen would be
 * exactly the "if two things are accent-coloured, one of them is wrong"
 * failure direction note 2 warns about.
 */
const BOARD_W = 410;
const BOARD_H = 320;
const BOARD_LEFT = DX - BOARD_W / 2 + Tokens.space.xxl;
const BOARD_RIGHT = DX + BOARD_W / 2 - Tokens.space.xxl;

const CARD_W = 90;
const CARD_H = 122;
const CARD_Y = DY - 75;
const HISTORY_Y = DY - 2;
const HISTORY_CARD_W = 30;
const HISTORY_CARD_H = 42;
const HISTORY_MAX = 8;
const DIVIDER_Y = DY + 14;
const READOUT_Y = DY + 32;
const GUESS_BTN_Y = DY + 70;
const GUESS_BTN_H = 42;
const GUESS_BTN_W = (BOARD_RIGHT - BOARD_LEFT - Tokens.space.sm) / 2;

// #36: the deck, the current card, and the win/multiplier math are all
// resolved server-side (POST /games/hilo/start|guess|cashout) - the server
// only ever sends a card's rank (2-14, Ace high), never a suit (see
// server/src/games/hilo.ts's header comment for why: Unicode suit glyphs
// can't round-trip through the dev/test cluster's JSONB encoding). Suit
// here is purely a cosmetic, client-chosen-at-random display detail with no
// bearing on the outcome, same pattern as BaccaratScene's displayCard().
const HOUSE_EDGE = 0.02; // display-only mirror of server/src/games/hilo.ts's HOUSE_EDGE, used to reconstruct a "would-become" preview multiplier - never used to compute an actual payout, the server always returns that number directly
const MAX_MULTIPLIER = 100000;

const RANK_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS: Array<{ symbol: string; isRed: boolean }> = [
  { symbol: "♠", isRed: false },
  { symbol: "♥", isRed: true },
  { symbol: "♦", isRed: true },
  { symbol: "♣", isRed: false }
];

interface DisplayCard {
  value: number; // 2-14, Ace high
  label: string;
  suit: string;
  isRed: boolean;
}

/** Wraps a server-given rank in a randomly-chosen cosmetic suit for display - never affects scoring. */
function displayCard(value: number): DisplayCard {
  const suit = SUITS[Phaser.Math.Between(0, SUITS.length - 1)];
  return { value, label: RANK_LABELS[value - 2], suit: suit.symbol, isRed: suit.isRed };
}

export class HiLoScene extends Phaser.Scene {
  private currentCard: DisplayCard | null = null;
  private history: DisplayCard[] = [];
  private correctGuesses = 0;
  private multiplier = 1; // authoritative, from the server's state
  private higherCount = 0;
  private lowerCount = 0;
  private active = false;
  /** True while a start/guess/cash-out request is in flight - blocks further input without ending the run. */
  private busy = false;
  private roundId: string | null = null;

  private balanceText!: Phaser.GameObjects.Text;
  private multiplierText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private readoutText!: Phaser.GameObjects.Text;
  private cardBg!: Phaser.GameObjects.Graphics;
  private cardLabel!: Phaser.GameObjects.Text;
  private historyContainer!: Phaser.GameObjects.Container;
  private higherBtn?: UIButton;
  private lowerBtn?: UIButton;
  private startBtn?: UIButton;
  private cashOutBtn?: UIButton;
  private walkAwayBtn?: UIButton;
  private betControl?: BetControl;
  private shell!: GameShellHandle;
  private directQuickplay = false;
  private cardX = DX;
  private cardY = CARD_Y;
  private cardW = CARD_W;
  private cardH = CARD_H;
  private historyY = HISTORY_Y;
  private historyCardW = HISTORY_CARD_W;
  private historyCardH = HISTORY_CARD_H;

  constructor() {
    super("HiLoScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "infiniteDescent");
    this.currentCard = null;
    this.history = [];
    this.correctGuesses = 0;
    this.multiplier = 1;
    this.higherCount = 0;
    this.lowerCount = 0;
    this.active = false;
    this.busy = false;
    this.roundId = null;
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    this.directQuickplay = !!embeddedGame() && !loungePresentation();
    if (this.directQuickplay) {
      this.scale.once("resize", () => this.scene.restart());
      this.createDirectQuickplayLayout();
      this.updateBalance();
      return;
    }

    // Stake-style shell - see MinesScene.create()/ui/uiHelpers.ts's
    // makeGameShell doc comment. Higher/Lower/card/history live in the
    // display area below since they're specific to this game, not part
    // of the shared shell.
    this.shell = makeGameShell(this, "HI-LO", "START RUN", {
      onStart: () => this.startRun(),
      onCashOut: () => this.cashOut(),
      onWalkAway: () => this.leaveGame()
    });
    this.balanceText = this.shell.balanceText;
    this.multiplierText = this.shell.multiplierText;
    this.messageText = this.shell.messageText;
    this.startBtn = this.shell.startBtn;
    this.cashOutBtn = this.shell.cashOutBtn;
    this.walkAwayBtn = this.shell.walkAwayBtn;
    this.betControl = this.shell.betControl;
    this.multiplierText.setText("Multiplier: 1.00x");
    this.messageText.setText("Start a run to deal the first card");

    drawCabinetFrame(this, DX, DY, BOARD_W, BOARD_H);

    // Current card display
    this.cardBg = this.add.graphics();
    this.cardLabel = makeText(this, DX, CARD_Y, "", {
      size: Tokens.type.glyph.lg,
      weight: Tokens.type.weight.bold,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });
    this.paintCard(null);

    this.historyContainer = this.add.container(0, 0);

    makeDivider(this, BOARD_LEFT, DIVIDER_Y, BOARD_RIGHT);

    this.readoutText = makeText(this, DX, READOUT_Y, "", {
      size: Tokens.type.size.sm,
      color: Tokens.text.muted,
      align: "center",
      originX: 0.5
    });

    this.higherBtn = makeButton(
      this,
      BOARD_LEFT + GUESS_BTN_W / 2,
      GUESS_BTN_Y,
      GUESS_BTN_W,
      GUESS_BTN_H,
      "▲ HIGHER",
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => this.guess("higher"),
      Tokens.text.primary,
      Tokens.radius.md
    );
    this.lowerBtn = makeButton(
      this,
      BOARD_RIGHT - GUESS_BTN_W / 2,
      GUESS_BTN_Y,
      GUESS_BTN_W,
      GUESS_BTN_H,
      "▼ LOWER",
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => this.guess("lower"),
      Tokens.text.primary,
      Tokens.radius.md
    );

    this.setGuessButtonsVisible(false);

    this.updateBalance();
  }

  private createDirectQuickplayLayout() {
    const stage = createQuickplayStage(this);
    drawQuickLabel(this, stage, 18, "AMOUNT");
    this.balanceText = makeText(this, stage.right, stage.top + 18, "", { size: Tokens.type.size.xs, color: Tokens.text.muted, align: "right", originX: 1 }).setScrollFactor(0);
    this.betControl = makeQuickBetControl(this, stage, 48);
    this.startBtn = makeButton(this, stage.controls.x + stage.controls.w / 2, stage.top + 102, stage.contentW, 44, "PLAY", Tokens.color.info, Tokens.color.infoHover, () => this.startRun(), Tokens.text.primary, Tokens.radius.md);
    this.cashOutBtn = makeButton(this, stage.controls.x + stage.controls.w / 2, stage.top + 154, stage.contentW, 44, "CASH OUT", Tokens.color.accent, Tokens.color.accentHover, () => this.cashOut(), Tokens.text.onAccent, Tokens.radius.md);
    const gap = Tokens.space.sm;
    this.higherBtn = makeButton(this, stage.controls.x + stage.controls.w / 2, stage.top + 214, stage.contentW, 44, "HIGHER OR SAME  ▲", Tokens.color.surfaceHover, Tokens.color.info, () => this.guess("higher"), Tokens.text.primary, Tokens.radius.md);
    this.lowerBtn = makeButton(this, stage.controls.x + stage.controls.w / 2, stage.top + 266, stage.contentW, 44, "LOWER OR SAME  ▼", Tokens.color.surfaceHover, Tokens.color.info, () => this.guess("lower"), Tokens.text.primary, Tokens.radius.md);
    void gap;
    drawQuickLabel(this, stage, 304, "TOTAL NET GAIN");
    const multBg = this.add.graphics().setScrollFactor(0);
    multBg.fillStyle(Tokens.color.inset, 1).fillRoundedRect(stage.left, stage.top + 320, stage.contentW, 40, Tokens.radius.md);
    multBg.lineStyle(1, Tokens.color.hairline, 1).strokeRoundedRect(stage.left, stage.top + 320, stage.contentW, 40, Tokens.radius.md);
    this.multiplierText = makeText(this, stage.left + Tokens.space.md, stage.top + 340, "Multiplier: 1.00x", { size: Tokens.type.size.sm, weight: Tokens.type.weight.semibold, color: Tokens.text.primary, originY: 0.5 }).setScrollFactor(0);
    this.messageText = makeText(this, stage.left, stage.top + 374, "Start a run to deal the first card.", { size: Tokens.type.size.xs, color: Tokens.text.muted, wordWrapWidth: stage.contentW, originY: 0 }).setScrollFactor(0);
    this.walkAwayBtn = makeQuickBackButton(this, stage, () => this.leaveGame());
    for (const button of [this.startBtn, this.cashOutBtn, this.higherBtn, this.lowerBtn]) button.container.setScrollFactor(0);
    this.cashOutBtn.container.setVisible(false);
    this.cashOutBtn.setEnabled(false);

    const boardCx = stage.board.x + stage.board.w / 2;
    this.cardX = boardCx;
    this.cardY = stage.board.y + 142;
    this.cardW = 82;
    this.cardH = 120;
    this.historyY = stage.board.y + stage.board.h - 70;
    this.historyCardW = 44;
    this.historyCardH = 62;
    this.cardBg = this.add.graphics();
    this.cardLabel = makeText(this, this.cardX, this.cardY, "", { size: Tokens.type.glyph.lg, weight: Tokens.type.weight.bold, align: "center", originX: 0.5, originY: 0.5 });
    this.paintCard(null);
    this.historyContainer = this.add.container(0, 0);

    const hintY = this.cardY;
    const hintOffset = Math.min(250, stage.board.w * 0.33);
    this.drawRankHint(boardCx - hintOffset, hintY, "A", "ACE IS HIGHEST", true);
    this.drawRankHint(boardCx + hintOffset, hintY, "2", "TWO IS LOWEST", false);

    const gainY = stage.board.y + 318;
    const gainPanel = this.add.graphics();
    gainPanel.fillStyle(Tokens.color.surface, 1).fillRoundedRect(stage.board.x + 14, gainY - 48, stage.board.w - 28, 96, Tokens.radius.md);
    this.readoutText = makeText(this, boardCx, gainY, "", { size: Tokens.type.size.sm, color: Tokens.text.secondary, align: "center", originX: 0.5, originY: 0.5 });
    this.setGuessButtonsVisible(false);
  }

  private drawRankHint(x: number, y: number, rank: string, caption: string, higher: boolean) {
    const g = this.add.graphics();
    g.fillStyle(Tokens.color.inset, 1).fillRoundedRect(x - 42, y - 62, 84, 124, Tokens.radius.md);
    g.lineStyle(1, Tokens.color.hairline, 1).strokeRoundedRect(x - 42, y - 62, 84, 124, Tokens.radius.md);
    makeText(this, x, y - 30, rank, { size: Tokens.type.glyph.sm, weight: Tokens.type.weight.bold, color: Tokens.text.muted, align: "center", originX: 0.5, originY: 0.5 });
    makeText(this, x, y + 13, higher ? "▲" : "▼", { size: Tokens.type.size.xl, color: Tokens.text.muted, align: "center", originX: 0.5, originY: 0.5 });
    makeText(this, x, y + 79, caption, { size: Tokens.type.size.xs, color: Tokens.text.muted, align: "center", originX: 0.5, originY: 0.5 });
  }

  private setGuessButtonsVisible(visible: boolean) {
    this.higherBtn?.container.setVisible(visible);
    this.lowerBtn?.container.setVisible(visible);
  }

  private paintCard(card: DisplayCard | null) {
    this.cardBg.clear();
    if (!card) {
      drawCardSurface(this.cardBg, this.cardX, this.cardY, this.cardW, this.cardH, "empty", Tokens.radius.md);
      this.cardLabel.setText("?").setColor(Tokens.text.muted);
      return;
    }
    drawCardSurface(this.cardBg, this.cardX, this.cardY, this.cardW, this.cardH, "face", Tokens.radius.md);
    this.cardLabel
      .setText(`${card.label}${card.suit}`)
      .setColor(card.isRed ? Tokens.card.inkRed : Tokens.card.ink);
  }

  private renderHistory() {
    this.historyContainer.removeAll(true);
    const recent = this.history.slice(-HISTORY_MAX);
    const gap = Tokens.space.xs;
    const totalWidth = recent.length * this.historyCardW + (recent.length - 1) * gap;
    const startX = this.cardX - totalWidth / 2 + this.historyCardW / 2;
    recent.forEach((card, i) => {
      const x = startX + i * (this.historyCardW + gap);
      const bg = this.add.graphics();
      drawCardSurface(bg, x, this.historyY, this.historyCardW, this.historyCardH, "face", Tokens.radius.xs);
      const label = makeText(this, x, this.historyY, `${card.label}${card.suit}`, {
        size: Tokens.type.size.xs,
        weight: Tokens.type.weight.semibold,
        color: card.isRed ? Tokens.card.inkRed : Tokens.card.ink,
        align: "center",
        originX: 0.5,
        originY: 0.5
      });
      this.historyContainer.add([bg, label]);
    });
  }

  private updateReadout() {
    if (!this.active || !this.currentCard) {
      this.readoutText.setText("");
      return;
    }
    // Percentages are purely cosmetic context (out of higher+lower - ties on
    // the same rank are excluded from both, same as the server's own
    // countOutcomes) - the buttons' enabled state and the actual payout are
    // both server-authoritative, this is display-only.
    const remaining = this.higherCount + this.lowerCount;
    const higherPct = remaining > 0 ? ((this.higherCount / remaining) * 100).toFixed(1) : "0.0";
    const lowerPct = remaining > 0 ? ((this.lowerCount / remaining) * 100).toFixed(1) : "0.0";
    const higherMult = this.higherCount > 0 ? this.displayMultiplierFor(this.higherCount, remaining).toFixed(2) : "-";
    const lowerMult = this.lowerCount > 0 ? this.displayMultiplierFor(this.lowerCount, remaining).toFixed(2) : "-";
    this.readoutText.setText(
      `Higher: ${higherPct}% (${higherMult}x)      Lower: ${lowerPct}% (${lowerMult}x)`
    );

    this.higherBtn?.setEnabled(this.higherCount > 0);
    this.lowerBtn?.setEnabled(this.lowerCount > 0);
  }

  /** Cosmetic "would-become" preview if this guess (favorable `count` out of `total`) hits - reconstructs the server's cumulative fair-odds product from the current authoritative multiplier, so it stays in sync without the client needing to track it incrementally itself. */
  private displayMultiplierFor(count: number, total: number): number {
    if (count <= 0 || total <= 0) return 0;
    const cumulativeFair = this.multiplier / (1 - HOUSE_EDGE);
    const fair = cumulativeFair * (total / count);
    return Math.min(MAX_MULTIPLIER, fair * (1 - HOUSE_EDGE));
  }

  /**
   * #36: the deck and win/multiplier math are resolved server-side (POST
   * /games/hilo/start|guess|cashout) - this scene only ever knows a card's
   * rank once the server's response says so.
   */
  private startRun() {
    if (this.active || this.busy) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    const bet = gameState.betAmount;
    this.busy = true;
    this.startBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Starting...").setColor(Tokens.text.muted);
    playSfx(this, "cardShuffle");
    playSfx(this, "cardSlide");

    this.attemptStart(bet, true);
  }

  /** Task #43: see MinesScene.attemptStart's doc comment - same one-retry ROUND_ALREADY_ACTIVE recovery pattern. */
  private attemptStart(bet: number, allowRecovery: boolean) {
    api
      .startHiLo(bet, "GC")
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.roundId = res.roundId;
        this.active = true;
        this.busy = false;
        this.correctGuesses = res.state.correctGuesses;
        this.multiplier = res.state.multiplier;
        this.higherCount = res.state.higherCount;
        this.lowerCount = res.state.lowerCount;
        this.currentCard = displayCard(res.state.currentCard);
        this.history = [this.currentCard];

        this.paintCard(this.currentCard);
        this.renderHistory();
        this.multiplierText.setText(`Multiplier: ${this.multiplier.toFixed(2)}x`);
        this.messageText.setText("Higher or lower than this card?").setColor(Tokens.text.muted);

        this.startBtn?.container.setVisible(false);
        this.startBtn?.setEnabled(false);
        this.cashOutBtn?.container.setVisible(false);
        this.cashOutBtn?.setEnabled(false);
        this.setGuessButtonsVisible(true);

        this.updateBalance();
        this.updateReadout();
      })
      .catch((err) => {
        if (allowRecovery && err instanceof ApiError && err.code === "ROUND_ALREADY_ACTIVE") {
          api
            .abandonRound()
            .then((abandonRes) => {
              gameState.hydrateFromServer(abandonRes.user);
              this.attemptStart(bet, false);
            })
            .catch(() => {
              this.busy = false;
              this.startBtn?.setEnabled(true);
              this.betControl?.setEnabled(true);
              this.messageText
                .setText("Couldn't recover an unfinished round - please try again.")
                .setColor(Tokens.text.negative);
            });
          return;
        }
        this.busy = false;
        this.startBtn?.setEnabled(true);
        this.betControl?.setEnabled(true);
        this.showApiError(err, "Not enough Gold Coins!");
      });
  }

  /** Task #43: see MinesScene.leaveGame's doc comment - same forfeit-before-leaving pattern. */
  private leaveGame() {
    if (!this.active) {
      fadeToScene(this, "OverworldScene");
      return;
    }
    this.walkAwayBtn?.setEnabled(false);
    this.startBtn?.setEnabled(false);
    this.cashOutBtn?.setEnabled(false);
    this.setGuessButtonsVisible(false);
    api
      .abandonRound()
      .then((res) => gameState.hydrateFromServer(res.user))
      .catch(() => {
        // Best-effort - see MinesScene.leaveGame's doc comment.
      })
      .finally(() => fadeToScene(this, "OverworldScene"));
  }

  private guess(direction: HiLoGuess) {
    if (!this.active || this.busy || !this.roundId) return;
    if (direction === "higher" && this.higherCount <= 0) return; // guarded by button enable state, but double-check
    if (direction === "lower" && this.lowerCount <= 0) return;

    this.busy = true;
    this.setGuessButtonsVisible(false);
    this.cashOutBtn?.setEnabled(false);

    api
      .guessHiLo(this.roundId, direction)
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.busy = false;

        if (res.push) {
          const state = res.state!;
          this.higherCount = state.higherCount;
          this.lowerCount = state.lowerCount;
          const nextCard = displayCard(state.currentCard);
          this.currentCard = nextCard;
          this.history.push(nextCard);
          this.paintCard(nextCard);
          this.renderHistory();
          if (res.deckExhausted) {
            this.active = false;
            this.messageText.setText(`Final card matched - push and cash out +${res.payout ?? 0} Gold Coins`).setColor(Tokens.text.secondary);
            this.updateBalance();
            this.endRun();
            return;
          }
          this.messageText.setText(`${nextCard.label}${nextCard.suit} - push. Keep going.`).setColor(Tokens.text.secondary);
          this.cashOutBtn?.setEnabled(this.correctGuesses >= 1);
          this.setGuessButtonsVisible(true);
          this.updateReadout();
          return;
        }

        if (!res.won) {
          this.active = false;
          const nextCard = displayCard(res.nextCard!);
          this.currentCard = nextCard;
          this.history.push(nextCard);
          this.paintCard(nextCard);
          this.renderHistory();
          this.messageText
            .setText(`${nextCard.label}${nextCard.suit} - wrong guess. You lose your bet.`)
            .setColor(Tokens.text.negative);
          playSfx(this, "lose");
          this.updateBalance();
          this.endRun();
          return;
        }

        const state = res.state!;
        this.correctGuesses = state.correctGuesses;
        this.multiplier = state.multiplier;
        this.higherCount = state.higherCount;
        this.lowerCount = state.lowerCount;
        const nextCard = displayCard(state.currentCard);
        this.currentCard = nextCard;
        this.history.push(nextCard);
        this.paintCard(nextCard);
        this.renderHistory();

        this.multiplierText.setText(`Multiplier: ${this.multiplier.toFixed(2)}x`);
        popIn(this, this.multiplierText);

        if (res.deckExhausted) {
          this.active = false;
          this.messageText.setText(`Deck cleared! +${res.payout ?? 0} Gold Coins`).setColor(Tokens.text.accent);
          this.updateBalance();
          showWinCelebration(this, res.payout ?? 0);
          this.endRun();
          return;
        }

        this.cashOutBtn?.container.setVisible(true);
        this.cashOutBtn?.setEnabled(true);
        this.messageText
          .setText(`Correct! ${nextCard.label}${nextCard.suit} - cash out or keep guessing`)
          .setColor(Tokens.text.accent);
        this.setGuessButtonsVisible(true);
        this.updateReadout();

        if (this.higherCount === 0 && this.lowerCount === 0) {
          // No more valid guesses left (only same-rank cards remain, or the
          // server would reject any guess here) - force a cash out.
          this.setGuessButtonsVisible(false);
          this.messageText.setText("No more winning guesses left - cash out!").setColor(Tokens.text.secondary);
        }
      })
      .catch((err) => {
        this.busy = false;
        this.setGuessButtonsVisible(this.active);
        this.cashOutBtn?.setEnabled(this.active && this.correctGuesses >= 1);
        this.showApiError(err, "Something went wrong - please try again.");
      });
  }

  private cashOut() {
    if (!this.active || this.busy || this.correctGuesses < 1 || !this.roundId) return;

    this.busy = true;
    this.cashOutBtn?.setEnabled(false);
    this.setGuessButtonsVisible(false);

    api
      .cashOutHiLo(this.roundId)
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.busy = false;
        this.active = false;
        this.messageText.setText(`Cashed out! +${res.payout} Gold Coins`).setColor(Tokens.text.accent);
        this.updateBalance();
        showWinCelebration(this, res.payout);
        this.endRun();
      })
      .catch((err) => {
        this.busy = false;
        this.cashOutBtn?.setEnabled(true);
        this.setGuessButtonsVisible(true);
        this.showApiError(err, "Something went wrong - please try again.");
      });
  }

  private showApiError(err: unknown, insufficientBalanceMessage: string) {
    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText(insufficientBalanceMessage).setColor(Tokens.text.negative);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
    }
  }

  private endRun() {
    this.roundId = null;
    this.setGuessButtonsVisible(false);
    this.cashOutBtn?.container.setVisible(false);
    this.cashOutBtn?.setEnabled(false);
    this.startBtn?.container.setVisible(true);
    this.startBtn?.setEnabled(true);
    this.startBtn?.setLabel("NEW RUN");
    this.betControl?.setEnabled(true);
    this.readoutText.setText("");
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins));
  }
}
