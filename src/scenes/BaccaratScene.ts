import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import type { BaccaratBetType } from "../api/types";

/**
 * Real published baccarat odds - no invented numbers. Standard 8-deck-shoe
 * baccarat probabilities are Player ~44.62%, Banker ~45.86%, Tie ~9.52%,
 * produced by the standard drawing rules now ported to
 * server/src/games/baccarat.ts (#36 - see that file for the full
 * derivation/Monte-Carlo verification; this scene only renders whatever
 * hand the server dealt).
 *
 * Payout multipliers below are the actual standard casino baccarat
 * paytable (total return per unit bet, matching this codebase's
 * `payout = bet * multiplier` convention) - display-only here (labels the
 * bet buttons), the server's copy is what actually resolves a round:
 *   Player 1:1 -> 2.0x   Banker 1:1 minus 5% commission -> 1.95x
 *   Tie 8:1 -> 9.0x
 * A Player/Banker bet pushes (multiplier 1.0, stake returned) if the
 * round ties - that's a real baccarat rule, not a simplification.
 */
const PLAYER_WIN_MULT = 2.0;
const BANKER_WIN_MULT = 1.95;
const TIE_WIN_MULT = 9.0;
const PUSH_MULT = 1.0;

const RANK_LABELS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: Array<{ symbol: string; isRed: boolean }> = [
  { symbol: "♠", isRed: false },
  { symbol: "♥", isRed: true },
  { symbol: "♦", isRed: true },
  { symbol: "♣", isRed: false }
];

interface Card {
  rank: number; // 1-13 (A-K)
  label: string;
  suit: string;
  isRed: boolean;
}

/** The server only tells us card *ranks* (all that baccarat scoring needs) - suit is purely cosmetic, so it's picked client-side for display only and never affects anything the player is paid. */
function displayCard(rank: number): Card {
  const suit = SUITS[Phaser.Math.Between(0, 3)];
  return { rank, label: RANK_LABELS[rank - 1], suit: suit.symbol, isRed: suit.isRed };
}

type BetType = BaccaratBetType;

interface CardSlot {
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  x: number;
  y: number;
}

export class BaccaratScene extends Phaser.Scene {
  private betType: BetType = "player";
  private dealing = false;
  private playerSlots: CardSlot[] = [];
  private bankerSlots: CardSlot[] = [];
  private betButtons: Partial<Record<BetType, UIButton>> = {};

  private balanceText!: Phaser.GameObjects.Text;
  private playerTotalText!: Phaser.GameObjects.Text;
  private bankerTotalText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private dealBtn?: UIButton;
  private betControl?: BetControl;

  constructor() {
    super("BaccaratScene");
  }

  create() {
    this.betType = "player";
    this.dealing = false;
    this.playerSlots = [];
    this.bankerSlots = [];
    this.betButtons = {};
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    makePanel(this, 400, 300, 560, 500);

    this.add
      .text(400, 42, "BACCARAT", {
        fontSize: "26px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    makeInset(this, 400, 74, 420, 28, 14);
    this.balanceText = this.add
      .text(400, 74, "", { fontSize: "13px", color: Theme.textPrimary })
      .setOrigin(0.5);

    this.betControl = makeBetControl(this, 400, 104, () => {});

    this.renderBetButtons();

    // Player hand (left) / Banker hand (right)
    this.add
      .text(250, 172, "PLAYER", { fontSize: "14px", color: Theme.textPrimary, fontStyle: "bold" })
      .setOrigin(0.5);
    this.add
      .text(550, 172, "BANKER", { fontSize: "14px", color: Theme.textPrimary, fontStyle: "bold" })
      .setOrigin(0.5);

    this.playerSlots = this.buildCardSlots(250, 218);
    this.bankerSlots = this.buildCardSlots(550, 218);

    this.playerTotalText = this.add
      .text(250, 272, "", { fontSize: "15px", color: Theme.textGold, fontStyle: "bold" })
      .setOrigin(0.5);
    this.bankerTotalText = this.add
      .text(550, 272, "", { fontSize: "15px", color: Theme.textGold, fontStyle: "bold" })
      .setOrigin(0.5);

    this.messageText = this.add
      .text(400, 320, "Pick a bet, then deal", { fontSize: "13px", color: Theme.textMuted })
      .setOrigin(0.5);

    this.dealBtn = makeButton(this, 400, 366, 200, 48, "DEAL", Theme.accent, Theme.accentHover, () =>
      this.deal()
    );

    makeButton(this, 400, 424, 200, 34, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      this.scene.start("OverworldScene")
    );

    this.updateBalance();
  }

  private renderBetButtons() {
    Object.values(this.betButtons).forEach((b) => b?.destroy());
    this.betButtons = {};

    const options: Array<{ key: BetType; label: string }> = [
      { key: "player", label: `PLAYER ${PLAYER_WIN_MULT}x` },
      { key: "banker", label: `BANKER ${BANKER_WIN_MULT}x` },
      { key: "tie", label: `TIE ${TIE_WIN_MULT}x` }
    ];
    const xs = [250, 400, 550];
    options.forEach((opt, i) => {
      const selected = opt.key === this.betType;
      this.betButtons[opt.key] = makeButton(
        this,
        xs[i],
        134,
        140,
        30,
        opt.label,
        selected ? Theme.accent : Theme.neutral,
        selected ? Theme.accentHover : Theme.neutralHover,
        () => {
          if (this.dealing || this.betType === opt.key) return;
          this.betType = opt.key;
          this.renderBetButtons();
        }
      );
    });
  }

  private buildCardSlots(centerX: number, y: number): CardSlot[] {
    const slots: CardSlot[] = [];
    const w = 46;
    const h = 64;
    const gap = 6;
    for (let i = 0; i < 3; i++) {
      const x = centerX + (i - 1) * (w + gap);
      const bg = this.add.graphics();
      const label = this.add.text(x, y, "", { fontSize: "16px", fontStyle: "bold" }).setOrigin(0.5);
      slots.push({ bg, label, x, y });
      this.paintSlot(slots[i], null, w, h);
    }
    return slots;
  }

  private paintSlot(slot: CardSlot, card: Card | null, w = 46, h = 64) {
    slot.bg.clear();
    if (!card) {
      slot.bg.fillStyle(Theme.inset, 1);
      slot.bg.fillRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 6);
      slot.bg.lineStyle(1, Theme.panelBorder, 1);
      slot.bg.strokeRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 6);
      slot.label.setText("").setVisible(false);
      return;
    }
    slot.bg.fillStyle(Theme.cardFace, 1);
    slot.bg.fillRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 6);
    slot.bg.lineStyle(1.5, Theme.cardBorder, 1);
    slot.bg.strokeRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 6);
    slot.label
      .setText(`${card.label}${card.suit}`)
      .setColor(card.isRed ? Theme.cardTextRed : Theme.cardTextBlack)
      .setVisible(true);
  }

  private clearSlots() {
    this.playerSlots.forEach((s) => this.paintSlot(s, null));
    this.bankerSlots.forEach((s) => this.paintSlot(s, null));
    this.playerTotalText.setText("");
    this.bankerTotalText.setText("");
  }

  /** #36: the whole round (both hands' cards, every third-card draw, and the payout) is resolved server-side (POST /games/baccarat/play) in one request - the staggered card reveal here is purely cosmetic, replaying the server's real dealt cards one at a time. */
  private deal() {
    if (this.dealing) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    const bet = gameState.betAmount;
    this.dealing = true;
    this.dealBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    Object.values(this.betButtons).forEach((b) => b?.setEnabled(false));
    this.clearSlots();
    this.messageText.setText("Dealing...").setColor(Theme.textMuted);

    api
      .playBaccarat(bet, "GC", this.betType)
      .then((res) => this.animateDeal(res))
      .catch((err) => this.handleDealError(err));
  }

  private animateDeal(res: Awaited<ReturnType<typeof api.playBaccarat>>) {
    const { playerCards, bankerCards } = res.result;
    const playerDisplay = playerCards.map(displayCard);
    const bankerDisplay = bankerCards.map(displayCard);

    // Reveal cards with a short staggered delay for a "dealing" feel, then resolve.
    const reveals: Array<() => void> = [];
    playerDisplay.forEach((card, i) => reveals.push(() => this.paintSlot(this.playerSlots[i], card)));
    bankerDisplay.forEach((card, i) => reveals.push(() => this.paintSlot(this.bankerSlots[i], card)));

    let step = 0;
    this.time.addEvent({
      delay: 220,
      repeat: reveals.length - 1,
      callback: () => {
        reveals[step]();
        step++;
        if (step >= reveals.length) {
          this.playerTotalText.setText(`Total: ${res.result.playerTotal}`);
          this.bankerTotalText.setText(`Total: ${res.result.bankerTotal}`);
          this.resolveRound(res);
        }
      }
    });
  }

  private resolveRound(res: Awaited<ReturnType<typeof api.playBaccarat>>) {
    gameState.hydrateFromServer(res.user);

    const { outcome, multiplier, payout, playerTotal, bankerTotal } = res.result;
    const winnerLabel = outcome === "player" ? "Player wins" : outcome === "banker" ? "Banker wins" : "Tie";

    if (payout > 0) {
      if (multiplier === PUSH_MULT) {
        this.messageText.setText(`${winnerLabel} (${playerTotal}-${bankerTotal}) - push, bet returned`).setColor(
          Theme.textGold
        );
      } else {
        this.messageText
          .setText(`${winnerLabel} (${playerTotal}-${bankerTotal})! +${payout} GC`)
          .setColor(Theme.textAccent);
        popIn(this, this.messageText);
      }
    } else {
      this.messageText.setText(`${winnerLabel} (${playerTotal}-${bankerTotal}) - you lose`).setColor(Theme.textDanger);
    }

    this.updateBalance();
    this.dealing = false;
    this.dealBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
    Object.values(this.betButtons).forEach((b) => b?.setEnabled(true));
  }

  private handleDealError(err: unknown) {
    this.dealing = false;
    this.dealBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
    Object.values(this.betButtons).forEach((b) => b?.setEnabled(true));

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Theme.textDanger);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Theme.textDanger);
    }
  }

  private updateBalance() {
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
