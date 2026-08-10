import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

interface Card {
  rank: string;
  suit: string;
}

function isRed(card: Card): boolean {
  return card.suit === "♥" || card.suit === "♦";
}

function cardValue(card: Card): number {
  if (card.rank === "A") return 11;
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  return parseInt(card.rank, 10);
}

function handValue(hand: Card[]): number {
  let total = hand.reduce((sum, c) => sum + cardValue(c), 0);
  let aces = hand.filter((c) => c.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10; // count an Ace as 1 instead of 11
    aces--;
  }
  return total;
}

type HandState = "playing" | "player_bust" | "dealer_turn" | "resolved";

const CARD_W = 40;
const CARD_H = 56;
const CARD_GAP = 8;

export class BlackjackScene extends Phaser.Scene {
  private deck: Card[] = [];
  private playerHand: Card[] = [];
  private dealerHand: Card[] = [];
  private state: HandState = "playing";

  private dealerCardObjects: Phaser.GameObjects.GameObject[] = [];
  private playerCardObjects: Phaser.GameObjects.GameObject[] = [];
  private dealerTotalText!: Phaser.GameObjects.Text;
  private playerTotalText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;

  private hitBtn?: UIButton;
  private standBtn?: UIButton;
  private newHandBtn?: UIButton;
  private betControl?: BetControl;
  private currentBet = 0;

  constructor() {
    super("BlackjackScene");
  }

  create() {
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    makePanel(this, 400, 300, 560, 520);

    this.add
      .text(400, 55, "BLACKJACK", {
        fontSize: "28px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    // Real table art as backdrop, inset within the panel
    this.add.image(400, 300, "blackjack_table").setDisplaySize(560, 320).setAlpha(0.85);

    // Dealer - stands off to the side, "dealing" via a looping animation
    const dealer = this.add.sprite(95, 150, "dealer_sheet", 1).setScale(2.4);
    dealer.play("dealer_walk_down");

    makeInset(this, 245, 115, 210, 50, 12);
    this.add
      .text(245, 115, "Get closer to 21 than\nme without busting!", {
        fontSize: "11px",
        color: Theme.textPrimary,
        align: "center"
      })
      .setOrigin(0.5);

    this.dealerTotalText = this.add
      .text(400, 145, "", { fontSize: "14px", color: Theme.textGold, fontStyle: "bold" })
      .setOrigin(0.5);

    this.playerTotalText = this.add
      .text(400, 450, "", { fontSize: "14px", color: Theme.textGold, fontStyle: "bold" })
      .setOrigin(0.5);

    this.messageText = this.add
      .text(400, 300, "", { fontSize: "20px", color: Theme.textGold, fontStyle: "bold" })
      .setOrigin(0.5)
      .setDepth(50);

    // Balance pill
    makeInset(this, 400, 490, 380, 30, 15);
    this.balanceText = this.add
      .text(400, 490, "", { fontSize: "13px", color: Theme.textPrimary })
      .setOrigin(0.5);

    this.hitBtn = makeButton(this, 260, 540, 130, 44, "HIT", Theme.accent, Theme.accentHover, () =>
      this.hit()
    );
    this.standBtn = makeButton(this, 400, 540, 130, 44, "STAND", Theme.neutral, Theme.neutralHover, () =>
      this.stand()
    );
    this.newHandBtn = makeButton(
      this,
      540,
      540,
      150,
      44,
      "NEW HAND",
      Theme.accent,
      Theme.accentHover,
      () => this.startNewHand()
    );

    makeButton(this, 130, 540, 150, 38, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      this.scene.start("OverworldScene")
    );

    this.betControl = makeBetControl(this, 400, 580, () => {});

    this.startNewHand();
  }

  private buildShuffledDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit });
      }
    }
    // simple Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Phaser.Math.Between(0, i);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  private startNewHand() {
    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      this.setActionButtonsVisible(false);
      this.updateBalance();
      return;
    }

    this.currentBet = gameState.betAmount;
    gameState.goldCoins -= this.currentBet;
    this.updateBalance();

    this.deck = this.buildShuffledDeck();
    this.playerHand = [this.drawCard(), this.drawCard()];
    this.dealerHand = [this.drawCard(), this.drawCard()];
    this.state = "playing";

    this.messageText.setText("");
    this.setActionButtonsVisible(true);
    this.newHandBtn?.container.setVisible(false);
    this.newHandBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);

    this.renderHands();

    // Natural blackjack check
    if (handValue(this.playerHand) === 21) {
      this.stand();
    }
  }

  private drawCard(): Card {
    const card = this.deck.pop();
    if (!card) {
      // extremely unlikely with a single 52-card deck in one hand, but stay safe
      this.deck = this.buildShuffledDeck();
      return this.deck.pop()!;
    }
    return card;
  }

  private hit() {
    if (this.state !== "playing") return;
    this.playerHand.push(this.drawCard());

    const total = handValue(this.playerHand);
    if (total > 21) {
      this.state = "player_bust";
      this.renderHands();
      this.messageText.setText("Bust! You lose.").setColor(Theme.textDanger);
      this.endHand();
    } else {
      this.renderHands();
    }
  }

  private stand() {
    if (this.state !== "playing") return;
    this.state = "dealer_turn";

    while (handValue(this.dealerHand) < 17) {
      this.dealerHand.push(this.drawCard());
    }

    this.resolveHand();
  }

  private resolveHand() {
    const playerTotal = handValue(this.playerHand);
    const dealerTotal = handValue(this.dealerHand);

    let outcome: "win" | "lose" | "push";
    if (dealerTotal > 21 || playerTotal > dealerTotal) {
      outcome = "win";
    } else if (playerTotal === dealerTotal) {
      outcome = "push";
    } else {
      outcome = "lose";
    }

    if (outcome === "win") {
      const payout = this.currentBet * 2;
      gameState.goldCoins += payout;
      this.messageText.setText(`You win! +${payout} GC`).setColor(Theme.textAccent);
      popIn(this, this.messageText);
    } else if (outcome === "push") {
      gameState.goldCoins += this.currentBet;
      this.messageText.setText("Push - bet returned").setColor(Theme.textMuted);
    } else {
      this.messageText.setText("Dealer wins").setColor(Theme.textDanger);
    }

    this.state = "resolved";
    this.renderHands();
    this.endHand();
  }

  private endHand() {
    this.setActionButtonsVisible(false);
    this.newHandBtn?.container.setVisible(true);
    this.newHandBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
    this.updateBalance();
  }

  private setActionButtonsVisible(visible: boolean) {
    this.hitBtn?.container.setVisible(visible);
    this.hitBtn?.setEnabled(visible);
    this.standBtn?.container.setVisible(visible);
    this.standBtn?.setEnabled(visible);
  }

  private renderHands() {
    const showDealerHole = this.state === "playing";

    this.drawHand(this.dealerCardObjects, this.dealerHand, 400, 190, showDealerHole);
    this.drawHand(this.playerCardObjects, this.playerHand, 400, 400, false);

    this.dealerTotalText.setText(showDealerHole ? "Dealer" : `Dealer: ${handValue(this.dealerHand)}`);
    this.playerTotalText.setText(`You: ${handValue(this.playerHand)}`);
  }

  /** Draws a hand as a row of real card visuals, replacing any previous cards for that hand. */
  private drawHand(
    existing: Phaser.GameObjects.GameObject[],
    hand: Card[],
    centerX: number,
    y: number,
    hideSecondCard: boolean
  ) {
    existing.forEach((obj) => obj.destroy());
    existing.length = 0;

    const totalWidth = hand.length * CARD_W + (hand.length - 1) * CARD_GAP;
    const startX = centerX - totalWidth / 2 + CARD_W / 2;

    hand.forEach((card, i) => {
      const x = startX + i * (CARD_W + CARD_GAP);
      const hidden = hideSecondCard && i === 1;
      existing.push(...this.drawCardVisual(x, y, hidden ? null : card));
    });
  }

  /** Draws a single playing-card visual (white rounded box + rank/suit), or a face-down back if card is null. */
  private drawCardVisual(x: number, y: number, card: Card | null): Phaser.GameObjects.GameObject[] {
    if (!card) {
      const back = this.add
        .rectangle(x, y, CARD_W, CARD_H, 0x1a3a6b)
        .setStrokeStyle(2, 0xffffff);
      const pattern = this.add
        .text(x, y, "?", { fontSize: "22px", color: "#6fa8ff", fontStyle: "bold" })
        .setOrigin(0.5);
      return [back, pattern];
    }

    const bg = this.add.rectangle(x, y, CARD_W, CARD_H, 0xffffff).setStrokeStyle(2, 0x333333);
    const color = isRed(card) ? "#d32f2f" : "#1a1a1a";
    const rankText = this.add
      .text(x, y - 8, card.rank, { fontSize: "18px", color, fontStyle: "bold" })
      .setOrigin(0.5);
    const suitText = this.add
      .text(x, y + 14, card.suit, { fontSize: "14px", color })
      .setOrigin(0.5);
    return [bg, rankText, suitText];
  }

  private updateBalance() {
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}   Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
