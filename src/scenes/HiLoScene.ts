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

  private setGuessButtonsVisible(visible: boolean) {
    this.higherBtn?.container.setVisible(visible);
    this.lowerBtn?.container.setVisible(visible);
  }

  private paintCard(card: DisplayCard | null) {
    this.cardBg.clear();
    if (!card) {
      drawCardSurface(this.cardBg, DX, CARD_Y, CARD_W, CARD_H, "empty", Tokens.radius.md);
      this.cardLabel.setText("?").setColor(Tokens.text.muted);
      return;
    }
    drawCardSurface(this.cardBg, DX, CARD_Y, CARD_W, CARD_H, "face", Tokens.radius.md);
    this.cardLabel
      .setText(`${card.label}${card.suit}`)
      .setColor(card.isRed ? Tokens.card.inkRed : Tokens.card.ink);
  }

  private renderHistory() {
    this.historyContainer.removeAll(true);
    const recent = this.history.slice(-HISTORY_MAX);
    const gap = Tokens.space.xs;
    const totalWidth = recent.length * HISTORY_CARD_W + (recent.length - 1) * gap;
    const startX = DX - totalWidth / 2 + HISTORY_CARD_W / 2;
    recent.forEach((card, i) => {
      const x = startX + i * (HISTORY_CARD_W + gap);
      const bg = this.add.graphics();
      drawCardSurface(bg, x, HISTORY_Y, HISTORY_CARD_W, HISTORY_CARD_H, "face", Tokens.radius.xs);
      const label = makeText(this, x, HISTORY_Y, `${card.label}${card.suit}`, {
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
