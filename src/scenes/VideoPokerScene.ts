import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import {
  makeGameShell,
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

/** Wraps a server-given rank in a randomly-chosen cosmetic suit for display - never affects scoring. */
function displayCard(value: number): Card {
  const suit = SUITS[Phaser.Math.Between(0, SUITS.length - 1)];
  return { value, label: RANK_LABELS[value - 2], suit: suit.symbol, isRed: suit.isRed };
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

// Stake-style layout: paytable strip and the 5-card hand centered in the
// shell's right-side display area (see ui/uiHelpers.ts's makeGameShell) -
// the sidebar now occupies the left third of the screen. The 5-card row
// (390px wide at its original card size) already fits the ~430px-wide
// display area, so only the paytable strip (previously a single wide line)
// picked up a wordWrap to stay inside the narrower width; every offset from
// the old canvas center (400,300) is otherwise unchanged.
const DX = GAME_SHELL_DISPLAY_CENTER_X;
const DY = GAME_SHELL_DISPLAY_CENTER_Y;

export class VideoPokerScene extends Phaser.Scene {
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
    this.cameras.main.setBackgroundColor(Theme.bgDark);

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

    // Full safe-zone height (see uiHelpers.ts's SAFE_ZONE_TOP/BOTTOM) - the
    // paytable strip above the cards already sits close to the top edge.
    drawCabinetFrame(this, DX, DY, 410, 340);

    this.paytableText = this.add
      .text(DX, DY - 185, "", {
        fontSize: "9px",
        color: Theme.textGold,
        align: "center",
        wordWrap: { width: 420 }
      })
      .setOrigin(0.5);
    this.renderPaytable();

    this.slots = this.buildCardSlots();

    this.messageText.setText("Deal to start a hand - 9/6 Jacks or Better");

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
    const startX = DX - totalWidth / 2 + w / 2;
    const y = DY - 80;

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
    slot.bg.fillStyle(Theme.cardFace, 1);
    slot.bg.fillRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
    slot.bg.lineStyle(held ? 3 : 2, held ? Theme.accent : Theme.cardBorder, 1);
    slot.bg.strokeRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
    slot.label
      .setText(`${card.label}${card.suit}`)
      .setColor(card.isRed ? Theme.cardTextRed : Theme.cardTextBlack)
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
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    const bet = gameState.betAmount;
    this.busy = true;
    this.actionBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Dealing...").setColor(Theme.textMuted);
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
        this.messageText.setText("Tap cards to HOLD, then draw").setColor(Theme.textMuted);
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
                .setColor(Theme.textDanger);
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
            // A push still pays TICKETS = the GC bet amount (the GC wager
            // itself was already spent at deal time) - no "bet returned" in
            // this currency, just a payout.
            this.messageText.setText(`${res.rank} - push! +${res.payout} Tickets`).setColor(Theme.textGold);
          } else {
            this.messageText.setText(`${res.rank}! +${res.payout} Tickets`).setColor(Theme.textAccent);
            popIn(this, this.messageText);
          }
          showWinCelebration(this, res.payout);
        } else {
          this.messageText.setText("No winning hand - you lose").setColor(Theme.textDanger);
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
      this.messageText.setText(insufficientBalanceMessage).setColor(Theme.textDanger);
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
