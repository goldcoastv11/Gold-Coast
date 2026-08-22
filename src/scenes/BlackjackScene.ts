import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import type { BlackjackOutcome } from "../api/types";

// #36: the deck, dealer AI, and win/payout math are all resolved
// server-side (POST /games/blackjack/start|hit|stand) - the server only
// ever sends a card's rank (1=A, 11=J, 12=Q, 13=K), never a suit (same
// "no Unicode in round state" precaution as Hi-Lo, see
// server/src/games/hilo.ts's header comment). Suit here is purely a
// cosmetic, client-chosen-at-random display detail with no bearing on the
// outcome.
const SUITS = ["♠", "♥", "♦", "♣"];
const RANK_LABELS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]; // index 0..12 for server rank 1..13

interface Card {
  rank: string;
  suit: string;
}

function isRed(card: Card): boolean {
  return card.suit === "♥" || card.suit === "♦";
}

/** Wraps a server-given rank (1-13) in a randomly-chosen cosmetic suit for display - never affects scoring. */
function displayCard(rank: number): Card {
  return { rank: RANK_LABELS[rank - 1], suit: SUITS[Phaser.Math.Between(0, SUITS.length - 1)] };
}

const CARD_W = 40;
const CARD_H = 56;
const CARD_GAP = 8;

export class BlackjackScene extends Phaser.Scene {
  private playerHand: Card[] = [];
  /** Index 0 is always the up-card, cached from the initial deal response so it never visually changes suit when the rest of the hand is revealed later. */
  private dealerHand: Card[] = [];
  private dealerHoleHidden = true;
  private active = false;
  /** True while a start/hit/stand request is in flight - blocks further input without ending the hand. */
  private busy = false;
  private roundId: string | null = null;

  private dealerCardObjects: Phaser.GameObjects.GameObject[] = [];
  private playerCardObjects: Phaser.GameObjects.GameObject[] = [];
  private dealerTotalText!: Phaser.GameObjects.Text;
  private playerTotalText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;

  private hitBtn?: UIButton;
  private standBtn?: UIButton;
  private newHandBtn?: UIButton;
  private walkAwayBtn?: UIButton;
  private betControl?: BetControl;

  constructor() {
    super("BlackjackScene");
  }

  create() {
    fadeInOnCreate(this);
    this.playerHand = [];
    this.dealerHand = [];
    this.dealerHoleHidden = true;
    this.active = false;
    this.busy = false;
    this.roundId = null;
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

    // Dealer - stands off to the side, "dealing" via a looping animation.
    const dealer = this.add.sprite(95, 150, "dealer_sheet", 1).setScale(4.8);
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
      "DEAL",
      Theme.accent,
      Theme.accentHover,
      () => this.startNewHand()
    );

    this.walkAwayBtn = makeButton(this, 130, 540, 150, 38, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      this.leaveGame()
    );

    this.betControl = makeBetControl(this, 400, 580, () => {});

    this.messageText.setText("Press DEAL to start a hand");
    this.setActionButtonsVisible(false);
    this.renderHands();
    this.updateBalance();
  }

  private startNewHand() {
    if (this.active || this.busy) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    const bet = gameState.betAmount;
    this.busy = true;
    this.newHandBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Dealing...").setColor(Theme.textMuted);

    this.attemptStart(bet, true);
  }

  /** Task #43: see MinesScene.attemptStart's doc comment - same one-retry ROUND_ALREADY_ACTIVE recovery pattern. */
  private attemptStart(bet: number, allowRecovery: boolean) {
    api
      .startBlackjack(bet, "GC")
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.busy = false;
        this.roundId = res.roundId;

        this.playerHand = res.state.playerHand.map(displayCard);
        this.dealerHand = [displayCard(res.state.dealerUpCard)];
        this.dealerHoleHidden = res.state.status === "playing";

        if (res.state.status === "resolved") {
          // Natural blackjack - the round auto-stood, dealer's hole card is
          // already revealed.
          this.dealerHand = this.revealDealerHand(res.state.dealerHand ?? []);
          this.active = false;
          this.resolveMessage(res.state.outcome, res.payout ?? 0);
          this.endHand();
        } else {
          this.active = true;
          this.messageText.setText("");
          this.setActionButtonsVisible(true);
          this.newHandBtn?.container.setVisible(false);
          this.newHandBtn?.setEnabled(false);
        }

        this.updateBalance();
        this.renderHands();
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
              this.newHandBtn?.setEnabled(true);
              this.betControl?.setEnabled(true);
              this.messageText
                .setText("Couldn't recover an unfinished round - please try again.")
                .setColor(Theme.textDanger);
            });
          return;
        }
        this.busy = false;
        this.newHandBtn?.setEnabled(true);
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
    this.setActionButtonsVisible(false);
    api
      .abandonRound()
      .then((res) => gameState.hydrateFromServer(res.user))
      .catch(() => {
        // Best-effort - see MinesScene.leaveGame's doc comment.
      })
      .finally(() => fadeToScene(this, "OverworldScene"));
  }

  /** Reveals the dealer's full hand once the server sends it - reuses the already-displayed up-card (index 0) so it never visually changes suit, and picks fresh cosmetic suits for the rest. */
  private revealDealerHand(fullRanks: number[]): Card[] {
    const upCard = this.dealerHand[0];
    return [upCard, ...fullRanks.slice(1).map(displayCard)];
  }

  private hit() {
    if (!this.active || this.busy || !this.roundId) return;

    this.busy = true;
    this.setActionButtonsVisible(false);

    api
      .hitBlackjack(this.roundId)
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.busy = false;

        const newRank = res.state.playerHand[res.state.playerHand.length - 1];
        this.playerHand.push(displayCard(newRank));

        if (res.state.status === "resolved") {
          this.active = false;
          this.dealerHand = this.revealDealerHand(res.state.dealerHand ?? []);
          this.dealerHoleHidden = false;
          this.messageText.setText("Bust! You lose your bet.").setColor(Theme.textDanger);
          this.updateBalance();
          this.endHand();
        } else {
          this.setActionButtonsVisible(true);
        }

        this.renderHands();
      })
      .catch((err) => {
        this.busy = false;
        this.setActionButtonsVisible(this.active);
        this.showApiError(err, "Something went wrong - please try again.");
      });
  }

  private stand() {
    if (!this.active || this.busy || !this.roundId) return;

    this.busy = true;
    this.setActionButtonsVisible(false);

    api
      .standBlackjack(this.roundId)
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.busy = false;
        this.active = false;

        this.dealerHand = this.revealDealerHand(res.state.dealerHand ?? []);
        this.dealerHoleHidden = false;
        this.resolveMessage(res.state.outcome, res.payout);
        this.updateBalance();
        this.endHand();
        this.renderHands();
      })
      .catch((err) => {
        this.busy = false;
        this.setActionButtonsVisible(this.active);
        this.showApiError(err, "Something went wrong - please try again.");
      });
  }

  private resolveMessage(outcome: BlackjackOutcome | null, payout: number) {
    if (outcome === "win") {
      this.messageText.setText(`You win! +${payout} GC`).setColor(Theme.textAccent);
      popIn(this, this.messageText);
    } else if (outcome === "push") {
      this.messageText.setText("Push - bet returned").setColor(Theme.textMuted);
    } else {
      this.messageText.setText("Dealer wins").setColor(Theme.textDanger);
    }
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

  private endHand() {
    this.roundId = null;
    this.setActionButtonsVisible(false);
    this.newHandBtn?.container.setVisible(true);
    this.newHandBtn?.setEnabled(true);
    this.newHandBtn?.setLabel("NEW HAND");
    this.betControl?.setEnabled(true);
  }

  private setActionButtonsVisible(visible: boolean) {
    this.hitBtn?.container.setVisible(visible);
    this.hitBtn?.setEnabled(visible);
    this.standBtn?.container.setVisible(visible);
    this.standBtn?.setEnabled(visible);
  }

  private renderHands() {
    this.drawHand(this.dealerCardObjects, this.dealerHand, 400, 190, this.dealerHoleHidden);
    this.drawHand(this.playerCardObjects, this.playerHand, 400, 400, false);

    this.dealerTotalText.setText(this.dealerHoleHidden ? "Dealer" : `Dealer: ${this.dealerTotal()}`);
    this.playerTotalText.setText(this.playerHand.length > 0 ? `You: ${this.playerTotal()}` : "");
  }

  /** Client-side display-only total (server always computes the authoritative one for payout) - fine here since suit never affects value and rank labels round-trip cleanly. */
  private playerTotal(): number {
    return handValueFromDisplay(this.playerHand);
  }

  private dealerTotal(): number {
    return handValueFromDisplay(this.dealerHand);
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

    if (hand.length === 0) return;

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
        .rectangle(x, y, CARD_W, CARD_H, Theme.secondary)
        .setStrokeStyle(2, Theme.cardBorder);
      const pattern = this.add
        .text(x, y, "?", { fontSize: "22px", color: Theme.textPrimary, fontStyle: "bold" })
        .setOrigin(0.5);
      return [back, pattern];
    }

    const bg = this.add.rectangle(x, y, CARD_W, CARD_H, Theme.cardFace).setStrokeStyle(2, Theme.cardBorder);
    const color = isRed(card) ? Theme.cardTextRed : Theme.cardTextBlack;
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

/** Standard blackjack hand value (Ace-adjusting) from display cards - display-only, the server holds the authoritative total used for every payout decision. */
function handValueFromDisplay(hand: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.rank === "A") {
      total += 11;
      aces++;
    } else if (card.rank === "J" || card.rank === "Q" || card.rank === "K") {
      total += 10;
    } else {
      total += parseInt(card.rank, 10);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}
