import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";

/**
 * Standard "9/6 Jacks or Better" paytable - the classic full-pay video
 * poker table (named for its Full House=9x/Flush=6x payouts), real
 * published numbers, not invented. With mathematically optimal play this
 * table returns ~99.54% RTP; actual return here depends on the player's
 * own hold choices, same as a real machine - we don't implement an
 * optimal-strategy solver, just the real deal/draw/evaluate mechanics and
 * the real paytable. Multipliers are TOTAL return per unit bet, matching
 * this codebase's `payout = bet * multiplier` convention (e.g. "Jacks or
 * Better" pays 1x = your stake back, a push - matches how a real machine
 * lists it).
 */
interface PaytableEntry {
  rank: string;
  mult: number;
  test: (h: HandInfo) => boolean;
}

const PAYTABLE: PaytableEntry[] = [
  { rank: "Royal Flush", mult: 250, test: (h) => h.isFlush && h.isStraight && h.highCard === 14 && !h.isWheel },
  { rank: "Straight Flush", mult: 50, test: (h) => h.isFlush && h.isStraight },
  { rank: "Four of a Kind", mult: 25, test: (h) => h.counts[0] === 4 },
  { rank: "Full House", mult: 9, test: (h) => h.counts[0] === 3 && h.counts[1] === 2 },
  { rank: "Flush", mult: 6, test: (h) => h.isFlush },
  { rank: "Straight", mult: 4, test: (h) => h.isStraight },
  { rank: "Three of a Kind", mult: 3, test: (h) => h.counts[0] === 3 },
  { rank: "Two Pair", mult: 2, test: (h) => h.counts[0] === 2 && h.counts[1] === 2 },
  { rank: "Jacks or Better", mult: 1, test: (h) => h.counts[0] === 2 && h.pairValue >= 11 },
  { rank: "Nothing", mult: 0, test: () => true }
];

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

interface HandInfo {
  isFlush: boolean;
  isStraight: boolean;
  isWheel: boolean;
  highCard: number;
  counts: number[]; // group sizes, sorted descending (e.g. [3,2] for a full house)
  pairValue: number; // value of the largest group (used for the Jacks-or-Better check)
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

function evaluateHand(cards: Card[]): PaytableEntry {
  const values = cards.map((c) => c.value).sort((a, b) => a - b);
  const isFlush = cards.every((c) => c.suit === cards[0].suit);

  const isWheel = values.join(",") === "2,3,4,5,14"; // A-2-3-4-5, the low "wheel" straight
  let isStraight: boolean;
  let highCard = values[4];
  if (isWheel) {
    isStraight = true;
    highCard = 5;
  } else {
    isStraight = values.every((v, i) => i === 0 || v === values[i - 1] + 1);
  }

  const countMap = new Map<number, number>();
  for (const v of values) countMap.set(v, (countMap.get(v) ?? 0) + 1);
  const entries = Array.from(countMap.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const counts = entries.map((e) => e.count);
  const pairValue = entries.length > 0 ? entries[0].value : 0;

  const info: HandInfo = { isFlush, isStraight, isWheel, highCard, counts, pairValue };
  for (const entry of PAYTABLE) {
    if (entry.test(info)) return entry;
  }
  return PAYTABLE[PAYTABLE.length - 1];
}

interface CardSlot {
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  holdLabel: Phaser.GameObjects.Text;
  hitZone: Phaser.GameObjects.Zone;
  x: number;
  y: number;
}

type Stage = "idle" | "holding";

export class VideoPokerScene extends Phaser.Scene {
  private deck: Card[] = [];
  private hand: Card[] = [];
  private held: boolean[] = [false, false, false, false, false];
  private stage: Stage = "idle";
  private currentBet = 0;
  private slots: CardSlot[] = [];

  private balanceText!: Phaser.GameObjects.Text;
  private paytableText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private actionBtn?: UIButton;
  private betControl?: BetControl;

  constructor() {
    super("VideoPokerScene");
  }

  create() {
    this.deck = [];
    this.hand = [];
    this.held = [false, false, false, false, false];
    this.stage = "idle";
    this.slots = [];
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    makePanel(this, 400, 300, 560, 480);

    this.add
      .text(400, 42, "VIDEO POKER", {
        fontSize: "24px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    makeInset(this, 400, 74, 420, 28, 14);
    this.balanceText = this.add
      .text(400, 74, "", { fontSize: "13px", color: Theme.textPrimary })
      .setOrigin(0.5);

    this.betControl = makeBetControl(this, 400, 104, () => {});

    this.paytableText = this.add
      .text(400, 132, "", { fontSize: "10px", color: Theme.textGold, align: "center" })
      .setOrigin(0.5);
    this.renderPaytable();

    this.slots = this.buildCardSlots();

    this.messageText = this.add
      .text(400, 330, "Deal to start a hand - 9/6 Jacks or Better", {
        fontSize: "13px",
        color: Theme.textMuted
      })
      .setOrigin(0.5);

    this.actionBtn = makeButton(this, 400, 380, 220, 48, "DEAL", Theme.accent, Theme.accentHover, () =>
      this.onActionButton()
    );

    makeButton(this, 400, 436, 200, 34, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      this.scene.start("OverworldScene")
    );

    this.updateBalance();
  }

  private renderPaytable() {
    const parts = PAYTABLE.filter((p) => p.mult > 0).map((p) => `${p.rank} ${p.mult}x`);
    this.paytableText.setText(parts.join("   "));
  }

  private buildCardSlots(): CardSlot[] {
    const slots: CardSlot[] = [];
    const w = 70;
    const h = 96;
    const gap = 10;
    const totalWidth = 5 * w + 4 * gap;
    const startX = 400 - totalWidth / 2 + w / 2;
    const y = 220;

    for (let i = 0; i < 5; i++) {
      const x = startX + i * (w + gap);
      const bg = this.add.graphics();
      const label = this.add.text(x, y, "", { fontSize: "22px", fontStyle: "bold" }).setOrigin(0.5);
      const holdLabel = this.add
        .text(x, y + h / 2 + 12, "", { fontSize: "12px", color: Theme.textAccent, fontStyle: "bold" })
        .setOrigin(0.5);
      const hitZone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
      const index = i;
      hitZone.on("pointerdown", () => this.toggleHold(index));
      const slot: CardSlot = { bg, label, holdLabel, hitZone, x, y };
      slots.push(slot);
      this.paintSlot(slot, null, false, w, h);
    }
    return slots;
  }

  private paintSlot(slot: CardSlot, card: Card | null, held: boolean, w = 70, h = 96) {
    slot.bg.clear();
    if (!card) {
      slot.bg.fillStyle(Theme.inset, 1);
      slot.bg.fillRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
      slot.bg.lineStyle(2, Theme.panelBorder, 1);
      slot.bg.strokeRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
      slot.label.setText("").setVisible(false);
      slot.holdLabel.setText("");
      return;
    }
    slot.bg.fillStyle(0xf5f2ea, 1);
    slot.bg.fillRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
    slot.bg.lineStyle(held ? 3 : 2, held ? Theme.accent : 0x0e1015, 1);
    slot.bg.strokeRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
    slot.label
      .setText(`${card.label}${card.suit}`)
      .setColor(card.isRed ? "#c62828" : "#1a1a1a")
      .setVisible(true);
    slot.holdLabel.setText(held ? "HELD" : "");
  }

  private renderHand() {
    for (let i = 0; i < 5; i++) {
      this.paintSlot(this.slots[i], this.hand[i] ?? null, this.held[i]);
    }
  }

  private toggleHold(index: number) {
    if (this.stage !== "holding") return;
    this.held[index] = !this.held[index];
    this.renderHand();
  }

  private onActionButton() {
    if (this.stage === "idle") this.deal();
    else this.draw();
  }

  private deal() {
    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    this.currentBet = gameState.betAmount;
    gameState.goldCoins -= this.currentBet;
    this.updateBalance();

    this.deck = buildDeck();
    this.hand = this.deck.splice(0, 5);
    this.held = [false, false, false, false, false];
    this.stage = "holding";

    this.renderHand();
    this.messageText.setText("Tap cards to HOLD, then draw").setColor(Theme.textMuted);
    this.actionBtn?.setLabel("DRAW");
    this.betControl?.setEnabled(false);
  }

  private draw() {
    for (let i = 0; i < 5; i++) {
      if (!this.held[i]) {
        this.hand[i] = this.deck.shift()!;
      }
    }
    this.held = [false, false, false, false, false];
    this.renderHand();

    const result = evaluateHand(this.hand);
    const payout = Math.round(this.currentBet * result.mult);

    if (payout > 0) {
      gameState.goldCoins += payout;
      if (result.mult === 1) {
        this.messageText.setText(`${result.rank} - push, bet returned`).setColor(Theme.textGold);
      } else {
        this.messageText.setText(`${result.rank}! +${payout} GC`).setColor(Theme.textAccent);
        popIn(this, this.messageText);
      }
    } else {
      this.messageText.setText("No winning hand - you lose").setColor(Theme.textDanger);
    }

    this.updateBalance();
    this.stage = "idle";
    this.actionBtn?.setLabel("DEAL");
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
