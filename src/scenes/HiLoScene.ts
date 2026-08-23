import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import type { HiLoGuess } from "../api/types";

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

  constructor() {
    super("HiLoScene");
  }

  create() {
    fadeInOnCreate(this);
    this.currentCard = null;
    this.history = [];
    this.correctGuesses = 0;
    this.multiplier = 1;
    this.higherCount = 0;
    this.lowerCount = 0;
    this.active = false;
    this.busy = false;
    this.roundId = null;
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    makePanel(this, 400, 300, 480, 540);

    this.add
      .text(400, 50, "HI-LO", {
        fontSize: "26px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    makeInset(this, 400, 82, 380, 28, 14);
    this.balanceText = this.add
      .text(400, 82, "", { fontSize: "13px", color: Theme.textPrimary })
      .setOrigin(0.5);

    this.betControl = makeBetControl(this, 400, 112, () => {});

    this.multiplierText = this.add
      .text(400, 140, "Multiplier: 1.00x", { fontSize: "15px", color: Theme.textGold, fontStyle: "bold" })
      .setOrigin(0.5);

    this.messageText = this.add
      .text(400, 160, "Start a run to deal the first card", {
        fontSize: "13px",
        color: Theme.textMuted
      })
      .setOrigin(0.5);

    // Current card display
    this.cardBg = this.add.graphics();
    this.cardLabel = this.add.text(400, 225, "", { fontSize: "32px", fontStyle: "bold" }).setOrigin(0.5);
    this.paintCard(null);

    this.historyContainer = this.add.container(0, 0);

    this.readoutText = this.add
      .text(400, 330, "", { fontSize: "12px", color: Theme.textMuted })
      .setOrigin(0.5);

    this.higherBtn = makeButton(
      this,
      290,
      368,
      150,
      42,
      "▲ HIGHER",
      Theme.accent,
      Theme.accentHover,
      () => this.guess("higher")
    );
    this.lowerBtn = makeButton(this, 510, 368, 150, 42, "▼ LOWER", Theme.accent, Theme.accentHover, () =>
      this.guess("lower")
    );

    this.startBtn = makeButton(
      this,
      300,
      430,
      170,
      46,
      "START RUN",
      Theme.accent,
      Theme.accentHover,
      () => this.startRun()
    );
    this.cashOutBtn = makeButton(
      this,
      500,
      430,
      170,
      46,
      "CASH OUT",
      Theme.gold,
      Theme.goldHover,
      () => this.cashOut()
    );

    this.walkAwayBtn = makeButton(this, 400, 488, 200, 34, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      this.leaveGame()
    );

    this.setGuessButtonsVisible(false);
    this.cashOutBtn.setEnabled(false);
    this.cashOutBtn.container.setVisible(false);

    this.updateBalance();
  }

  private setGuessButtonsVisible(visible: boolean) {
    this.higherBtn?.container.setVisible(visible);
    this.lowerBtn?.container.setVisible(visible);
  }

  private paintCard(card: DisplayCard | null) {
    const w = 90;
    const h = 122;
    this.cardBg.clear();
    if (!card) {
      this.cardBg.fillStyle(Theme.inset, 1);
      this.cardBg.fillRoundedRect(400 - w / 2, 225 - h / 2, w, h, 10);
      this.cardBg.lineStyle(2, Theme.panelBorder, 1);
      this.cardBg.strokeRoundedRect(400 - w / 2, 225 - h / 2, w, h, 10);
      this.cardLabel.setText("?").setColor(Theme.textMuted);
      return;
    }
    this.cardBg.fillStyle(Theme.cardFace, 1);
    this.cardBg.fillRoundedRect(400 - w / 2, 225 - h / 2, w, h, 10);
    this.cardBg.lineStyle(2, Theme.cardBorder, 1);
    this.cardBg.strokeRoundedRect(400 - w / 2, 225 - h / 2, w, h, 10);
    this.cardLabel.setText(`${card.label}${card.suit}`).setColor(card.isRed ? Theme.cardTextRed : Theme.cardTextBlack);
  }

  private renderHistory() {
    this.historyContainer.removeAll(true);
    const recent = this.history.slice(-8);
    const cw = 30;
    const ch = 42;
    const gap = 6;
    const totalWidth = recent.length * cw + (recent.length - 1) * gap;
    const startX = 400 - totalWidth / 2 + cw / 2;
    recent.forEach((card, i) => {
      const x = startX + i * (cw + gap);
      const y = 298;
      const bg = this.add.graphics();
      bg.fillStyle(Theme.cardFace, 1);
      bg.fillRoundedRect(x - cw / 2, y - ch / 2, cw, ch, 5);
      bg.lineStyle(1, Theme.cardBorder, 1);
      bg.strokeRoundedRect(x - cw / 2, y - ch / 2, cw, ch, 5);
      const label = this.add
        .text(x, y, `${card.label}${card.suit}`, {
          fontSize: "10px",
          fontStyle: "bold",
          color: card.isRed ? Theme.cardTextRed : Theme.cardTextBlack
        })
        .setOrigin(0.5);
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
      this.messageText.setText("Not enough Tickets!").setColor(Theme.textDanger);
      return;
    }

    const bet = gameState.betAmount;
    this.busy = true;
    this.startBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Starting...").setColor(Theme.textMuted);

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
        this.messageText.setText("Higher or lower than this card?").setColor(Theme.textMuted);

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
                .setColor(Theme.textDanger);
            });
          return;
        }
        this.busy = false;
        this.startBtn?.setEnabled(true);
        this.betControl?.setEnabled(true);
        this.showApiError(err, "Not enough Tickets!");
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
            .setColor(Theme.textDanger);
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
          this.messageText.setText(`Deck cleared! +${res.payout ?? 0} Tickets`).setColor(Theme.textAccent);
          this.updateBalance();
          this.endRun();
          return;
        }

        this.cashOutBtn?.container.setVisible(true);
        this.cashOutBtn?.setEnabled(true);
        this.messageText
          .setText(`Correct! ${nextCard.label}${nextCard.suit} - cash out or keep guessing`)
          .setColor(Theme.textAccent);
        this.setGuessButtonsVisible(true);
        this.updateReadout();

        if (this.higherCount === 0 && this.lowerCount === 0) {
          // No more valid guesses left (only same-rank cards remain, or the
          // server would reject any guess here) - force a cash out.
          this.setGuessButtonsVisible(false);
          this.messageText.setText("No more winning guesses left - cash out!").setColor(Theme.textGold);
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
        this.messageText.setText(`Cashed out! +${res.payout} Tickets`).setColor(Theme.textAccent);
        this.updateBalance();
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
      this.messageText.setText(insufficientBalanceMessage).setColor(Theme.textDanger);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Theme.textDanger);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Theme.textDanger);
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
    this.balanceText.setText(`🎟️ ${gameState.goldCoins}   💰 ${gameState.stakeCoins}`);
  }
}
