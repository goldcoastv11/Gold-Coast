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
import type { BaccaratBetType } from "../api/types";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";

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

/**
 * BACCARAT, on the Stake-style direction (see ui/DesignTokens.ts).
 *
 * The board is one flat surface: a micro-label over the bet-type selector,
 * a single hairline, then the two hands. The selected bet type is marked by
 * a LIGHTER SURFACE and heavier text rather than by accent colour (the same
 * way Limbo marks its selected target), so the accent stays on DEAL alone.
 * Cards use the shared card surfaces so all four card games print the same
 * card, and the board was tightened from 340px tall to 260 - the old
 * version reserved the full safe zone and then left ~100px of empty surface
 * under the totals.
 */
const DX = GAME_SHELL_DISPLAY_CENTER_X;
const DY = GAME_SHELL_DISPLAY_CENTER_Y;
const BOARD_W = 410;
const BOARD_H = 260;
const BOARD_LEFT = DX - BOARD_W / 2 + Tokens.space.xxl;
const BOARD_RIGHT = DX + BOARD_W / 2 - Tokens.space.xxl;

const SECTION_LABEL_Y = 192;
const BET_BTN_Y = 220;
const BET_BTN_H = 32;
const BET_BTN_W = (BOARD_RIGHT - BOARD_LEFT - Tokens.space.sm * 2) / 3;
const DIVIDER_Y = 252;
const HAND_LABEL_Y = 274;
const CARD_Y = 326;
const TOTAL_Y = 380;

const CARD_W = 40;
const CARD_H = 56;
const CARD_GAP = Tokens.space.sm;
const HAND_GROUP_OFFSET = 115;
const PLAYER_GROUP_X = DX - HAND_GROUP_OFFSET;
const BANKER_GROUP_X = DX + HAND_GROUP_OFFSET;

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
    playMusic(this, "italianMom");
    this.betType = "player";
    this.dealing = false;
    this.playerSlots = [];
    this.bankerSlots = [];
    this.betButtons = {};
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

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

    drawCabinetFrame(this, DX, DY, BOARD_W, BOARD_H);

    makeText(this, BOARD_LEFT, SECTION_LABEL_Y, "BET ON", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps
    });
    this.renderBetButtons();

    makeDivider(this, BOARD_LEFT, DIVIDER_Y, BOARD_RIGHT);

    // Player hand (left) / Banker hand (right)
    for (const [x, label] of [
      [PLAYER_GROUP_X, "PLAYER"],
      [BANKER_GROUP_X, "BANKER"]
    ] as Array<[number, string]>) {
      makeText(this, x, HAND_LABEL_Y, label, {
        size: Tokens.type.size.xs,
        color: Tokens.text.muted,
        tracking: Tokens.type.tracking.caps,
        align: "center",
        originX: 0.5
      });
    }

    this.playerSlots = this.buildCardSlots(PLAYER_GROUP_X, CARD_Y);
    this.bankerSlots = this.buildCardSlots(BANKER_GROUP_X, CARD_Y);

    this.playerTotalText = makeText(this, PLAYER_GROUP_X, TOTAL_Y, "", {
      size: Tokens.type.size.xl,
      weight: Tokens.type.weight.semibold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5
    });
    this.bankerTotalText = makeText(this, BANKER_GROUP_X, TOTAL_Y, "", {
      size: Tokens.type.size.xl,
      weight: Tokens.type.weight.semibold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5
    });

    this.messageText.setText("Pick a bet, then deal.").setColor(Tokens.text.muted);

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
    options.forEach((opt, i) => {
      const selected = opt.key === this.betType;
      this.betButtons[opt.key] = makeButton(
        this,
        BOARD_LEFT + BET_BTN_W / 2 + i * (BET_BTN_W + Tokens.space.sm),
        BET_BTN_Y,
        BET_BTN_W,
        BET_BTN_H,
        opt.label,
        // Selection reads as a lighter surface plus brighter text - never as
        // accent colour, which belongs to DEAL (direction note 2).
        selected ? Tokens.color.surfaceHover : Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        () => {
          if (this.dealing || this.betType === opt.key) return;
          this.betType = opt.key;
          this.renderBetButtons();
        },
        selected ? Tokens.text.primary : Tokens.text.secondary,
        Tokens.radius.sm
      );
    });
  }

  private buildCardSlots(centerX: number, y: number): CardSlot[] {
    const slots: CardSlot[] = [];
    for (let i = 0; i < 3; i++) {
      const x = centerX + (i - 1) * (CARD_W + CARD_GAP);
      const bg = this.add.graphics();
      const label = makeText(this, x, y, "", {
        size: Tokens.type.glyph.xs,
        weight: Tokens.type.weight.semibold,
        align: "center",
        originX: 0.5,
        originY: 0.5
      });
      slots.push({ bg, label, x, y });
      this.paintSlot(slots[i], null);
    }
    return slots;
  }

  private paintSlot(slot: CardSlot, card: Card | null) {
    slot.bg.clear();
    if (!card) {
      drawCardSurface(slot.bg, slot.x, slot.y, CARD_W, CARD_H, "empty");
      slot.label.setText("").setVisible(false);
      return;
    }
    drawCardSurface(slot.bg, slot.x, slot.y, CARD_W, CARD_H, "face");
    slot.label
      .setText(`${card.label}${card.suit}`)
      .setColor(card.isRed ? Tokens.card.inkRed : Tokens.card.ink)
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
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    const bet = gameState.betAmount;
    this.dealing = true;
    this.dealBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    Object.values(this.betButtons).forEach((b) => b?.setEnabled(false));
    this.clearSlots();
    this.messageText.setText("Dealing...").setColor(Tokens.text.muted);
    playSfx(this, "cardShuffle");
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
      delay: Tokens.motion.duration.stagger,
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
          .setColor(Tokens.text.secondary);
      } else {
        this.messageText
          .setText(`${winnerLabel} (${playerTotal}-${bankerTotal})! +${payout} Tickets`)
          .setColor(Tokens.text.accent);
        popIn(this, this.messageText);
      }
      showWinCelebration(this, payout);
    } else {
      this.messageText.setText(`${winnerLabel} (${playerTotal}-${bankerTotal}) - you lose`).setColor(Tokens.text.negative);
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
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
    }
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins, gameState.tickets));
  }
}
