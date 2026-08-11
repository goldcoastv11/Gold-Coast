import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";

const HOUSE_EDGE = 0.02; // 2%, same edge as Mines, folded into the multiplier once at cash-out/loss time
const MAX_MULTIPLIER = 100000; // safety cap - a 52-card deck makes astronomical streaks vanishingly rare but not impossible

const RANK_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS: Array<{ symbol: string; isRed: boolean }> = [
  { symbol: "♠", isRed: false },
  { symbol: "♥", isRed: true },
  { symbol: "♦", isRed: true },
  { symbol: "♣", isRed: false }
];

interface Card {
  value: number; // 2-14, Ace high
  label: string;
  suit: string;
  isRed: boolean;
}

function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (let value = 2; value <= 14; value++) {
    for (const suit of SUITS) {
      deck.push({ value, label: RANK_LABELS[value - 2], suit: suit.symbol, isRed: suit.isRed });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Phaser.Math.Between(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Counts how many of the still-undrawn cards would beat ("higher") or lose
 * to ("lower") the current card. Cards of the same rank count toward
 * neither - a tie loses either guess, same as most real Hi-Lo
 * implementations - so total always equals deck.length (higher+lower+ties).
 */
function countOutcomes(current: Card, deck: Card[]): { higher: number; lower: number; total: number } {
  let higher = 0;
  let lower = 0;
  for (const c of deck) {
    if (c.value > current.value) higher++;
    else if (c.value < current.value) lower++;
  }
  return { higher, lower, total: deck.length };
}

type Guess = "higher" | "lower";

export class HiLoScene extends Phaser.Scene {
  private deck: Card[] = [];
  private currentCard: Card | null = null;
  private history: Card[] = [];
  private correctGuesses = 0;
  private cumulativeFair = 1; // running product of fair (1/P) factors, house edge applied only at display/payout time
  private active = false;
  private currentBet = 0;

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
  private betControl?: BetControl;

  constructor() {
    super("HiLoScene");
  }

  create() {
    this.deck = [];
    this.currentCard = null;
    this.history = [];
    this.correctGuesses = 0;
    this.cumulativeFair = 1;
    this.active = false;
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
      0xffe082,
      () => this.cashOut()
    );

    makeButton(this, 400, 488, 200, 34, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      this.scene.start("OverworldScene")
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

  private paintCard(card: Card | null) {
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
    this.cardBg.fillStyle(0xf5f2ea, 1);
    this.cardBg.fillRoundedRect(400 - w / 2, 225 - h / 2, w, h, 10);
    this.cardBg.lineStyle(2, 0x0e1015, 1);
    this.cardBg.strokeRoundedRect(400 - w / 2, 225 - h / 2, w, h, 10);
    this.cardLabel.setText(`${card.label}${card.suit}`).setColor(card.isRed ? "#c62828" : "#1a1a1a");
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
      bg.fillStyle(0xf5f2ea, 1);
      bg.fillRoundedRect(x - cw / 2, y - ch / 2, cw, ch, 5);
      bg.lineStyle(1, 0x0e1015, 1);
      bg.strokeRoundedRect(x - cw / 2, y - ch / 2, cw, ch, 5);
      const label = this.add
        .text(x, y, `${card.label}${card.suit}`, {
          fontSize: "10px",
          fontStyle: "bold",
          color: card.isRed ? "#c62828" : "#1a1a1a"
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
    const { higher, lower, total } = countOutcomes(this.currentCard, this.deck);
    const higherPct = total > 0 ? ((higher / total) * 100).toFixed(1) : "0.0";
    const lowerPct = total > 0 ? ((lower / total) * 100).toFixed(1) : "0.0";
    const higherMult = higher > 0 ? (this.displayMultiplierFor(higher, total)).toFixed(2) : "-";
    const lowerMult = lower > 0 ? (this.displayMultiplierFor(lower, total)).toFixed(2) : "-";
    this.readoutText.setText(
      `Higher: ${higherPct}% (${higherMult}x)      Lower: ${lowerPct}% (${lowerMult}x)`
    );

    this.higherBtn?.setEnabled(higher > 0);
    this.lowerBtn?.setEnabled(lower > 0);
  }

  /** What the *cumulative* multiplier would become if this single guess (favorable count `count` out of `total`) hits. */
  private displayMultiplierFor(count: number, total: number): number {
    if (count <= 0) return 0;
    const fair = this.cumulativeFair * (total / count);
    return Math.min(MAX_MULTIPLIER, fair * (1 - HOUSE_EDGE));
  }

  private currentDisplayMultiplier(): number {
    return Math.min(MAX_MULTIPLIER, Math.round(this.cumulativeFair * (1 - HOUSE_EDGE) * 100) / 100);
  }

  private startRun() {
    if (this.active) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    this.currentBet = gameState.betAmount;
    gameState.goldCoins -= this.currentBet;
    this.updateBalance();

    this.deck = buildDeck();
    this.currentCard = this.deck.pop() ?? null;
    this.history = [];
    this.correctGuesses = 0;
    this.cumulativeFair = 1;
    this.active = true;

    this.paintCard(this.currentCard);
    this.renderHistory();
    this.multiplierText.setText("Multiplier: 1.00x");
    this.messageText.setText("Higher or lower than this card?").setColor(Theme.textMuted);

    this.startBtn?.container.setVisible(false);
    this.startBtn?.setEnabled(false);
    this.cashOutBtn?.container.setVisible(false);
    this.cashOutBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.setGuessButtonsVisible(true);

    this.updateReadout();
  }

  private guess(direction: Guess) {
    if (!this.active || !this.currentCard) return;

    const { higher, lower, total } = countOutcomes(this.currentCard, this.deck);
    const favorable = direction === "higher" ? higher : lower;
    if (favorable <= 0 || total <= 0) return; // guarded by button enable state, but double-check

    const p = favorable / total;
    const fairFactor = 1 / p;

    const nextCard = this.deck.pop();
    if (!nextCard || !this.currentCard) return;

    const won =
      direction === "higher" ? nextCard.value > this.currentCard.value : nextCard.value < this.currentCard.value;

    this.history.push(nextCard);

    if (!won) {
      this.currentCard = nextCard;
      this.paintCard(this.currentCard);
      this.renderHistory();
      this.messageText.setText(`${nextCard.label}${nextCard.suit} - wrong guess. You lose your bet.`).setColor(
        Theme.textDanger
      );
      this.active = false;
      this.endRun();
      return;
    }

    this.cumulativeFair *= fairFactor;
    this.correctGuesses++;
    this.currentCard = nextCard;
    this.paintCard(this.currentCard);
    this.renderHistory();

    const displayMult = this.currentDisplayMultiplier();
    this.multiplierText.setText(`Multiplier: ${displayMult.toFixed(2)}x`);
    popIn(this, this.multiplierText);

    if (this.deck.length === 0) {
      // deck exhausted - auto cash out, nothing left to guess against
      this.active = false;
      const payout = Math.round(this.currentBet * displayMult);
      gameState.goldCoins += payout;
      this.messageText.setText(`Deck cleared! +${payout} GC`).setColor(Theme.textAccent);
      this.updateBalance();
      this.endRun();
      return;
    }

    this.cashOutBtn?.container.setVisible(true);
    this.cashOutBtn?.setEnabled(true);
    this.messageText.setText(`Correct! ${nextCard.label}${nextCard.suit} - cash out or keep guessing`).setColor(
      Theme.textAccent
    );
    this.updateReadout();

    // No more valid guesses left (only same-rank cards remain) - force a cash out
    const next = countOutcomes(this.currentCard, this.deck);
    if (next.higher === 0 && next.lower === 0 && this.deck.length > 0) {
      this.setGuessButtonsVisible(false);
      this.messageText.setText("No more winning guesses left - cash out!").setColor(Theme.textGold);
    }
  }

  private cashOut() {
    if (!this.active || this.correctGuesses < 1) return;

    const multiplier = this.currentDisplayMultiplier();
    const payout = Math.round(this.currentBet * multiplier);
    gameState.goldCoins += payout;
    this.updateBalance();
    this.messageText.setText(`Cashed out! +${payout} GC`).setColor(Theme.textAccent);
    this.active = false;
    this.endRun();
  }

  private endRun() {
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
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
