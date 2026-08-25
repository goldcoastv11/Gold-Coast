import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import {
  makeButton,
  makeGameShell,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  GAME_SHELL_DISPLAY_CENTER_Y,
  popIn,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import type { BaccaratBetType } from "../api/types";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx } from "../ui/SoundManager";

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

// Stake-style layout: bet-type selector, player/banker hands, and totals
// centered in the shell's right-side display area (see
// ui/uiHelpers.ts's makeGameShell) - the sidebar now occupies the left
// third of the screen. Vertical offsets from the old canvas center
// (400,300) are unchanged (there's ample height to spare); horizontal
// spacing (bet buttons, player/banker groups) was narrowed to fit the
// ~430px-wide display area.
const DX = GAME_SHELL_DISPLAY_CENTER_X;
const DY = GAME_SHELL_DISPLAY_CENTER_Y;
const PLAYER_GROUP_X = DX - 115;
const BANKER_GROUP_X = DX + 115;

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
  private shell!: GameShellHandle;

  constructor() {
    super("BaccaratScene");
  }

  create() {
    fadeInOnCreate(this);
    this.betType = "player";
    this.dealing = false;
    this.playerSlots = [];
    this.bankerSlots = [];
    this.betButtons = {};
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    // Stake-style shell - see MinesScene.create()/ui/uiHelpers.ts's
    // makeGameShell doc comment. This game has no cash-out concept, so
    // onCashOut is a no-op and cashOutBtn is simply never shown/enabled.
    // The bet-type selector, hands, and totals live in the display area
    // below since they're specific to this game, not part of the shared
    // shell. dealBtn reuses the shell's own startBtn slot.
    this.shell = makeGameShell(this, "BACCARAT", "DEAL", {
      onStart: () => this.deal(),
      onCashOut: () => {},
      onWalkAway: () => fadeToScene(this, "OverworldScene")
    });
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.dealBtn = this.shell.startBtn;
    this.betControl = this.shell.betControl;

    this.renderBetButtons();

    // Player hand (left) / Banker hand (right)
    this.add
      .text(PLAYER_GROUP_X, DY - 128, "PLAYER", { fontSize: "14px", color: Theme.textPrimary, fontStyle: "bold" })
      .setOrigin(0.5);
    this.add
      .text(BANKER_GROUP_X, DY - 128, "BANKER", { fontSize: "14px", color: Theme.textPrimary, fontStyle: "bold" })
      .setOrigin(0.5);

    this.playerSlots = this.buildCardSlots(PLAYER_GROUP_X, DY - 82);
    this.bankerSlots = this.buildCardSlots(BANKER_GROUP_X, DY - 82);

    this.playerTotalText = this.add
      .text(PLAYER_GROUP_X, DY - 28, "", { fontSize: "15px", color: Theme.textGold, fontStyle: "bold" })
      .setOrigin(0.5);
    this.bankerTotalText = this.add
      .text(BANKER_GROUP_X, DY - 28, "", { fontSize: "15px", color: Theme.textGold, fontStyle: "bold" })
      .setOrigin(0.5);

    this.messageText.setText("Pick a bet, then deal");

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
    const xs = [DX - 120, DX, DX + 120];
    options.forEach((opt, i) => {
      const selected = opt.key === this.betType;
      this.betButtons[opt.key] = makeButton(
        this,
        xs[i],
        DY - 166,
        120,
        28,
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
    const w = 40;
    const h = 56;
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

  private paintSlot(slot: CardSlot, card: Card | null, w = 40, h = 56) {
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
    playSfx(this, "cardSlide");

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
        // A push still pays out TICKETS = the GC bet amount (the GC wager
        // itself was already spent at deal time, same as any other outcome
        // here - there's no "bet returned" in this currency, just a payout).
        this.messageText
          .setText(`${winnerLabel} (${playerTotal}-${bankerTotal}) - push! +${payout} Tickets`)
          .setColor(Theme.textGold);
      } else {
        this.messageText
          .setText(`${winnerLabel} (${playerTotal}-${bankerTotal})! +${payout} Tickets`)
          .setColor(Theme.textAccent);
        popIn(this, this.messageText);
      }
      showWinCelebration(this, payout);
    } else {
      this.messageText.setText(`${winnerLabel} (${playerTotal}-${bankerTotal}) - you lose`).setColor(Theme.textDanger);
      playSfx(this, "lose");
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
    this.balanceText.setText(`🪙 ${gameState.goldCoins}   🎟️ ${gameState.tickets}`);
  }
}
