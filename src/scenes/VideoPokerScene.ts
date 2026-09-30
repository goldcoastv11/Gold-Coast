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
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";
import { createQuickplayStage, drawQuickLabel, drawQuickReadout, makeQuickBackButton, makeQuickBetControl } from "../ui/quickplayGameUi";
import type { VideoPokerCard } from "../api/types";

/**
 * Standard "9/6 Jacks or Better" paytable - the classic full-pay video
 * poker table (named for its Full House=9x/Flush=6x payouts), real
 * published numbers, not invented. Kept here purely to render the paytable
 * strip - the server (server/src/games/videopoker.ts's
 * VIDEO_POKER_PAYTABLE) holds the authoritative copy that actually decides
 * payouts; this local copy MUST stay in sync with it by hand (no shared
 * package between client/server - see server/src/games/videopoker.ts).
 */
interface PaytableEntry {
  rank: string;
  mult: number;
}

const PAYTABLE: PaytableEntry[] = [
  { rank: "Royal Flush", mult: 250 },
  { rank: "Straight Flush", mult: 50 },
  { rank: "Four of a Kind", mult: 25 },
  { rank: "Full House", mult: 9 },
  { rank: "Flush", mult: 6 },
  { rank: "Straight", mult: 4 },
  { rank: "Three of a Kind", mult: 3 },
  { rank: "Two Pair", mult: 2 },
  { rank: "Jacks or Better", mult: 1 },
  { rank: "Nothing", mult: 0 }
];

// #36: the deck, the dealt/drawn hand, and hand evaluation/payout are all
// resolved server-side (POST /games/videopoker/deal|draw) - the server only
// ever sends a card's rank (2-14, Ace high) and suit as a plain integer
// (0-3, never a Unicode glyph - same "no Unicode in round state" precaution
// as Hi-Lo/Blackjack). Unlike those two though, Video Poker's server DOES
// track suit (it needs it for flush/straight-flush detection) - it's just
// never rendered as-is; the client still assigns its own cosmetic suit
// glyph purely for display, independent of the server's integer.
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

/** Converts the server's stable card identity into its display glyph. */
function displayCard(card: VideoPokerCard): Card {
  const suit = SUITS[card.suit];
  return { value: card.value, label: RANK_LABELS[card.value - 2], suit: suit.symbol, isRed: suit.isRed };
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

/**
 * VIDEO POKER, on the Stake-style direction (see ui/DesignTokens.ts).
 *
 * A micro-label over the paytable strip, one hairline, then the hand -
 * the same label/rule/content stack every converted game uses. Cards come
 * from the shared card surfaces; the accent ring on a HELD card is the one
 * stroke on the screen, and it earns it by marking a real player decision
 * rather than outlining a box (direction note 3).
 *
 * The paytable used to sit at y=115, above the mobile-landscape safe zone
 * (uiHelpers.ts's SAFE_ZONE_TOP = 130) and therefore croppable on a phone;
 * the board is also 80px shorter now, since the old one reserved the full
 * safe zone and left the bottom third empty.
 */
const DX = GAME_SHELL_DISPLAY_CENTER_X;
const DY = GAME_SHELL_DISPLAY_CENTER_Y;
const BOARD_W = 410;
const BOARD_H = 260;
const BOARD_LEFT = DX - BOARD_W / 2 + Tokens.space.xxl;
const BOARD_RIGHT = DX + BOARD_W / 2 - Tokens.space.xxl;

const SECTION_LABEL_Y = 176;
const PAYTABLE_Y = 198;
const DIVIDER_Y = 228;
const CARD_W = 70;
const CARD_H = 96;
const CARD_GAP = Tokens.space.sm;
const CARD_Y = 296;
const HOLD_LABEL_Y = CARD_Y + CARD_H / 2 + Tokens.space.md;

export class VideoPokerScene extends Phaser.Scene {
  private directQuickplay = false;
  private cardCenterX = DX;
  private cardY = CARD_Y;
  private cardW = CARD_W;
  private cardH = CARD_H;
  private hand: Card[] = [];
  private held: boolean[] = [false, false, false, false, false];
  private stage: Stage = "idle";
  /** True while a deal/draw request is in flight - blocks further input without ending the hand. */
  private busy = false;
  private roundId: string | null = null;
  private slots: CardSlot[] = [];

  private balanceText!: Phaser.GameObjects.Text;
  private paytableText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private actionBtn?: UIButton;
  private walkAwayBtn?: UIButton;
  private betControl?: BetControl;
  private shell!: GameShellHandle;

  constructor() {
    super("VideoPokerScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "swingingPants");
    this.hand = [];
    this.held = [false, false, false, false, false];
    this.stage = "idle";
    this.busy = false;
    this.roundId = null;
    this.slots = [];
    this.cameras.main.setBackgroundColor(Tokens.color.bg);
    this.directQuickplay = !!embeddedGame() && !loungePresentation();
    if (this.directQuickplay) this.scale.once("resize", () => this.scene.restart());

    if (this.directQuickplay) {
      this.createDirectQuickplay();
      return;
    }

    // Stake-style shell - see MinesScene.create()/ui/uiHelpers.ts's
    // makeGameShell doc comment. This game has no cash-out concept, so
    // onCashOut is a no-op and cashOutBtn is simply never shown/enabled.
    // actionBtn reuses the shell's own startBtn slot for BOTH phases -
    // onStart calls the same onActionButton() dispatcher the scene always
    // used, which itself decides deal() vs draw() from `stage` and swaps
    // the button's label via setLabel(), exactly as before.
    this.shell = makeGameShell(this, "VIDEO POKER", "DEAL", {
      onStart: () => this.onActionButton(),
      onCashOut: () => {},
      onWalkAway: () => this.leaveGame()
    });
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.actionBtn = this.shell.startBtn;
    this.walkAwayBtn = this.shell.walkAwayBtn;
    this.betControl = this.shell.betControl;

    drawCabinetFrame(this, DX, DY, BOARD_W, BOARD_H);

    makeText(this, BOARD_LEFT, SECTION_LABEL_Y, "9/6 JACKS OR BETTER", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps
    });
    this.paytableText = makeText(this, DX, PAYTABLE_Y, "", {
      size: Tokens.type.size.xs,
      color: Tokens.text.secondary,
      align: "center",
      originX: 0.5,
      wordWrapWidth: BOARD_RIGHT - BOARD_LEFT
    });
    this.renderPaytable();

    makeDivider(this, BOARD_LEFT, DIVIDER_Y, BOARD_RIGHT);

    this.slots = this.buildCardSlots();

    this.messageText.setText("Deal to start a hand.").setColor(Tokens.text.muted);

    this.updateBalance();
  }

  private createDirectQuickplay() {
    const stage = createQuickplayStage(this);
    drawQuickLabel(this, stage, 26, "Amount");
    this.betControl = makeQuickBetControl(this, stage, 68);
    this.actionBtn = makeButton(this, stage.controls.x + stage.controls.w / 2, stage.top + 122, stage.contentW, 44, "Play", 0x1f7ae0, 0x2b8bf0, () => this.onActionButton(), Tokens.text.primary, Tokens.radius.md);
    this.balanceText = makeText(this, -100, -100, "");
    this.messageText = drawQuickReadout(this, stage, 162, "Hand", "Deal to start");
    this.walkAwayBtn = makeQuickBackButton(this, stage, () => this.leaveGame());
    this.paytableText = makeText(this, -100, -100, "");

    const tableX = stage.board.x + 34;
    const tableY = stage.board.y + 28;
    const tableW = stage.board.w - 68;
    const rowH = Math.min(35, (stage.board.h * 0.46) / PAYTABLE.length);
    const payBg = this.add.graphics();
    payBg.fillStyle(Tokens.color.surface, 1).fillRoundedRect(tableX - 12, tableY - 10, tableW + 24, rowH * PAYTABLE.length + 20, Tokens.radius.md);
    PAYTABLE.filter((p) => p.mult > 0).forEach((p, i) => {
      const y = tableY + i * rowH + rowH / 2;
      this.add.rectangle(tableX, y, tableW * 0.5, rowH - 4, Tokens.color.inset).setOrigin(0, 0.5);
      this.add.rectangle(tableX + tableW * 0.5 + 4, y, tableW * 0.22, rowH - 4, Tokens.color.surfaceRaised).setOrigin(0, 0.5);
      makeText(this, tableX + 14, y, p.rank.toUpperCase(), { size: "13px", weight: Tokens.type.weight.bold, color: Tokens.text.primary, originY: 0.5 });
      makeText(this, tableX + tableW * 0.61, y, `${p.mult.toFixed(p.mult < 10 ? 2 : 0)}×`, { size: "13px", weight: Tokens.type.weight.bold, color: Tokens.text.primary, originX: 0.5, originY: 0.5 });
    });
    const dealY = tableY + rowH * PAYTABLE.length + 42;
    makeText(this, stage.board.x + stage.board.w / 2, dealY, "DEAL", { size: Tokens.type.size.sm, weight: Tokens.type.weight.bold, color: Tokens.text.secondary, originX: 0.5 });
    this.cardCenterX = stage.board.x + stage.board.w / 2;
    this.cardY = stage.board.y + stage.board.h - 92;
    this.cardW = Math.min(92, (stage.board.w - 100) / 5);
    this.cardH = Math.min(126, this.cardW * 1.38);
    this.slots = this.buildCardSlots();
    this.messageText.setText("Deal to start a hand.").setColor(Tokens.text.muted);
    this.updateBalance();
  }

  private renderPaytable() {
    const parts = PAYTABLE.filter((p) => p.mult > 0).map((p) => `${p.rank} ${p.mult}x`);
    this.paytableText.setText(parts.join("   "));
  }

  private buildCardSlots(): CardSlot[] {
    const slots: CardSlot[] = [];
    const totalWidth = 5 * this.cardW + 4 * CARD_GAP;
    const startX = this.cardCenterX - totalWidth / 2 + this.cardW / 2;

    for (let i = 0; i < 5; i++) {
      const x = startX + i * (this.cardW + CARD_GAP);
      const bg = this.add.graphics();
      const label = makeText(this, x, this.cardY, "", {
        size: Tokens.type.glyph.md,
        weight: Tokens.type.weight.semibold,
        align: "center",
        originX: 0.5,
        originY: 0.5
      });
      const holdLabel = makeText(this, x, this.cardY + this.cardH / 2 + Tokens.space.md, "", {
        size: Tokens.type.size.xs,
        weight: Tokens.type.weight.semibold,
        color: Tokens.text.accent,
        tracking: Tokens.type.tracking.caps,
        align: "center",
        originX: 0.5
      });
      const hitZone = this.add.zone(x, this.cardY, this.cardW, this.cardH).setInteractive({ useHandCursor: true });
      const index = i;
      hitZone.on("pointerdown", () => this.toggleHold(index));
      const slot: CardSlot = { bg, label, holdLabel, hitZone, x, y: this.cardY };
      slots.push(slot);
      this.paintSlot(slot, null, false);
    }
    return slots;
  }

  private paintSlot(slot: CardSlot, card: Card | null, held: boolean) {
    slot.bg.clear();
    if (!card) {
      drawCardSurface(slot.bg, slot.x, slot.y, this.cardW, this.cardH, this.directQuickplay ? "back" : "empty", Tokens.radius.md);
      slot.label.setText(this.directQuickplay ? "G" : "").setColor(Tokens.text.primary).setVisible(this.directQuickplay);
      slot.holdLabel.setText("");
      return;
    }
    drawCardSurface(slot.bg, slot.x, slot.y, this.cardW, this.cardH, held ? "held" : "face", Tokens.radius.md);
    slot.label
      .setText(`${card.label}${card.suit}`)
      .setColor(card.isRed ? Tokens.card.inkRed : Tokens.card.ink)
      .setVisible(true);
    slot.holdLabel.setText(held ? "HELD" : "");
  }

  private renderHand() {
    for (let i = 0; i < 5; i++) {
      this.paintSlot(this.slots[i], this.hand[i] ?? null, this.held[i]);
    }
  }

  private toggleHold(index: number) {
    if (this.stage !== "holding" || this.busy) return;
    this.held[index] = !this.held[index];
    this.renderHand();
  }

  private onActionButton() {
    if (this.busy) return;
    if (this.stage === "idle") this.deal();
    else this.draw();
  }

  private deal() {
    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    const bet = gameState.betAmount;
    this.busy = true;
    this.actionBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Dealing...").setColor(Tokens.text.muted);
    playSfx(this, "cardShuffle");
    playSfx(this, "cardSlide");

    this.attemptDeal(bet, true);
  }

  /** Task #43: see MinesScene.attemptStart's doc comment - same one-retry ROUND_ALREADY_ACTIVE recovery pattern. */
  private attemptDeal(bet: number, allowRecovery: boolean) {
    api
      .dealVideoPoker(bet, "GC")
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.busy = false;
        this.roundId = res.roundId;
        this.hand = res.hand.map(displayCard);
        this.held = [false, false, false, false, false];
        this.stage = "holding";

        this.renderHand();
        this.messageText.setText("Tap cards to HOLD, then draw").setColor(Tokens.text.muted);
        this.actionBtn?.setLabel("DRAW");
        this.actionBtn?.setEnabled(true);
        this.updateBalance();
      })
      .catch((err) => {
        if (allowRecovery && err instanceof ApiError && err.code === "ROUND_ALREADY_ACTIVE") {
          api
            .abandonRound()
            .then((abandonRes) => {
              gameState.hydrateFromServer(abandonRes.user);
              this.attemptDeal(bet, false);
            })
            .catch(() => {
              this.busy = false;
              this.actionBtn?.setEnabled(true);
              this.betControl?.setEnabled(true);
              this.messageText
                .setText("Couldn't recover an unfinished round - please try again.")
                .setColor(Tokens.text.negative);
            });
          return;
        }
        this.busy = false;
        this.actionBtn?.setEnabled(true);
        this.betControl?.setEnabled(true);
        this.showApiError(err, "Not enough Gold Coins!");
      });
  }

  /** Task #43: see MinesScene.leaveGame's doc comment - same forfeit-before-leaving pattern ("holding" = cards dealt, round in progress, equivalent to the other 4 scenes' `active`). */
  private leaveGame() {
    if (this.stage !== "holding") {
      fadeToScene(this, "OverworldScene");
      return;
    }
    this.walkAwayBtn?.setEnabled(false);
    this.actionBtn?.setEnabled(false);
    api
      .abandonRound()
      .then((res) => gameState.hydrateFromServer(res.user))
      .catch(() => {
        // Best-effort - see MinesScene.leaveGame's doc comment.
      })
      .finally(() => fadeToScene(this, "OverworldScene"));
  }

  private draw() {
    if (!this.roundId) return;

    this.busy = true;
    this.actionBtn?.setEnabled(false);

    api
      .drawVideoPoker(this.roundId, this.held)
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.busy = false;
        this.roundId = null;
        this.hand = res.hand.map(displayCard);
        this.held = [false, false, false, false, false];
        this.renderHand();

        if (res.payout > 0) {
          if (res.multiplier === 1) {
            // A push still pays out Gold Coins = the GC bet amount (the GC
            // wager itself was already spent at deal time) - no "bet
            // returned", just a payout.
            this.messageText.setText(`${res.rank} - push! +${res.payout} Gold Coins`).setColor(Tokens.text.secondary);
          } else {
            this.messageText.setText(`${res.rank}! +${res.payout} Gold Coins`).setColor(Tokens.text.accent);
            popIn(this, this.messageText);
          }
          showWinCelebration(this, res.payout);
        } else {
          this.messageText.setText("No winning hand - you lose").setColor(Tokens.text.negative);
          playSfx(this, "lose");
        }

        this.updateBalance();
        this.stage = "idle";
        this.actionBtn?.setLabel("DEAL");
        this.actionBtn?.setEnabled(true);
        this.betControl?.setEnabled(true);
      })
      .catch((err) => {
        this.busy = false;
        this.actionBtn?.setEnabled(true);
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

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins));
  }
}
