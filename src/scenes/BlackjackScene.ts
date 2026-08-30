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
  drawCabinetFrame,
  drawCardSurface,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  GAME_SHELL_DISPLAY_CENTER_Y,
  popIn,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import type { BlackjackOutcome } from "../api/types";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";

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
const CARD_GAP = Tokens.space.sm;

/**
 * BLACKJACK, on the Stake-style direction (see ui/DesignTokens.ts).
 *
 * The gold trim frame is gone - the board is the same flat surface every
 * other converted game sits on - and the two hands are separated by one
 * hairline instead of by a stack of boxes. Cards come from the shared card
 * surfaces (uiHelpers' drawCardSurface).
 *
 * PARTIALLY CONVERTED, deliberately: `blackjack_table` is a fixed felt
 * image asset and `dealer_sheet` is a fixed sprite sheet. Neither can be
 * re-toned from tokens without redrawing the art, so the felt is dropped to
 * a low alpha where it reads as texture over the token surface rather than
 * as its own warm colour, and the dealer is left exactly as drawn.
 *
 * This pass also fixed a real layout bug rather than just a colour one: HIT
 * and STAND used to sit at y=540, and the dealer's speech bubble at y=100,
 * both well outside the mobile-landscape safe zone (uiHelpers.ts's
 * SAFE_ZONE_TOP/BOTTOM = 130/470) - i.e. croppable on a real phone. Every
 * element now sits inside the band, and the bubble's instruction moved to
 * the shell's message line, which is where every other converted game puts
 * its "here's what to do" copy.
 */
const DX = GAME_SHELL_DISPLAY_CENTER_X;
const DY = GAME_SHELL_DISPLAY_CENTER_Y;
const BOARD_W = 410;
const BOARD_H = 330;
const BOARD_LEFT = DX - BOARD_W / 2 + Tokens.space.xxl;
const BOARD_RIGHT = DX + BOARD_W / 2 - Tokens.space.xxl;

const DEALER_TOTAL_Y = 162;
const DEALER_CARDS_Y = 214;
const DIVIDER_Y = 262;
const PLAYER_CARDS_Y = 314;
const PLAYER_TOTAL_Y = 366;
const ACTION_BTN_Y = 412;
const ACTION_BTN_H = 40;
const ACTION_BTN_W = (BOARD_RIGHT - BOARD_LEFT - Tokens.space.sm) / 2;
const DEALER_SPRITE_X = DX - 168;
const DEALER_SPRITE_Y = 190;
const DEALER_SPRITE_SCALE = 2.4;
/** The felt asset can't be re-toned from tokens, so it runs quiet enough to read as texture. */
const TABLE_ART_ALPHA = 0.3;

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
  private shell!: GameShellHandle;

  constructor() {
    super("BlackjackScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "missionPlausible");
    this.playerHand = [];
    this.dealerHand = [];
    this.dealerHoleHidden = true;
    this.active = false;
    this.busy = false;
    this.roundId = null;
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    // Stake-style shell - see MinesScene.create()/ui/uiHelpers.ts's
    // makeGameShell doc comment. This game has no cash-out concept, so
    // onCashOut is a no-op and cashOutBtn is simply never shown/enabled.
    // The dealer/player hands and Hit/Stand buttons live in the display
    // area below since they're specific to this game, not part of the
    // shared shell. newHandBtn reuses the shell's own startBtn slot,
    // exactly like HiLoScene's startRun button.
    this.shell = makeGameShell(this, "BLACKJACK", "DEAL", {
      onStart: () => this.startNewHand(),
      onCashOut: () => {},
      onWalkAway: () => this.leaveGame()
    });
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.newHandBtn = this.shell.startBtn;
    this.walkAwayBtn = this.shell.walkAwayBtn;
    this.betControl = this.shell.betControl;

    // Flat board surface - the stroked gold trim frame is gone; the board is
    // defined by where the surface ends (direction note 3).
    drawCabinetFrame(this, DX, DY, BOARD_W, BOARD_H);

    // Real felt art as backdrop, over the token surface and under everything
    // else. It's fixed art and can't be re-toned from tokens, so it runs
    // quiet enough to read as texture rather than as its own warm colour.
    this.add.image(DX, DY, "blackjack_table").setDisplaySize(BOARD_W, BOARD_H).setAlpha(TABLE_ART_ALPHA);

    // Dealer - stands off to the side, "dealing" via a looping animation.
    // Was at DY-190 (=110), above SAFE_ZONE_TOP and croppable on a phone;
    // now stands inside the band, in the board's own left gutter.
    const dealer = this.add
      .sprite(DEALER_SPRITE_X, DEALER_SPRITE_Y, "dealer_sheet", 1)
      .setScale(DEALER_SPRITE_SCALE);
    dealer.play("dealer_walk_down");

    // --- Dealer hand ---------------------------------------------------
    // The dealer's "Get closer to 21 than me without busting!" speech bubble
    // is gone - that instruction now lives on the shell's message line,
    // which is where every other converted game puts its "here's what to
    // do" copy.
    this.dealerTotalText = makeText(this, DX, DEALER_TOTAL_Y, "", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5
    });

    makeDivider(this, BOARD_LEFT, DIVIDER_Y, BOARD_RIGHT);

    // --- Player hand ---------------------------------------------------
    this.playerTotalText = makeText(this, DX, PLAYER_TOTAL_Y, "", {
      size: Tokens.type.size.xl,
      weight: Tokens.type.weight.semibold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5
    });

    // HIT is the live action while a hand is in play, so it takes the accent
    // - the shell's own DEAL button is hidden for exactly that stretch, so
    // there is still only ever one accent on screen. STAND is the quiet
    // alternative beside it.
    this.hitBtn = makeButton(
      this,
      BOARD_LEFT + ACTION_BTN_W / 2,
      ACTION_BTN_Y,
      ACTION_BTN_W,
      ACTION_BTN_H,
      "HIT",
      Tokens.color.accent,
      Tokens.color.accentHover,
      () => this.hit(),
      Tokens.text.onAccent,
      Tokens.radius.md
    );
    this.standBtn = makeButton(
      this,
      BOARD_RIGHT - ACTION_BTN_W / 2,
      ACTION_BTN_Y,
      ACTION_BTN_W,
      ACTION_BTN_H,
      "STAND",
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => this.stand(),
      Tokens.text.secondary,
      Tokens.radius.md
    );

    this.messageText
      .setText("Get closer to 21 than the dealer without busting.")
      .setColor(Tokens.text.muted);
    this.setActionButtonsVisible(false);
    this.renderHands();
    this.updateBalance();
  }

  private startNewHand() {
    if (this.active || this.busy) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    const bet = gameState.betAmount;
    this.busy = true;
    this.newHandBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Dealing...").setColor(Tokens.text.muted);
    playSfx(this, "cardShuffle");
    playSfx(this, "cardSlide");

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
                .setColor(Tokens.text.negative);
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
          this.messageText.setText("Bust! You lose your bet.").setColor(Tokens.text.negative);
          playSfx(this, "lose");
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
      this.messageText.setText(`You win! +${payout} Gold Coins`).setColor(Tokens.text.accent);
      popIn(this, this.messageText);
      showWinCelebration(this, payout);
    } else if (outcome === "push") {
      // A push still pays out Gold Coins = the GC bet amount (the GC wager
      // itself was already spent at start time) - no "bet returned", just a
      // payout.
      this.messageText.setText(`Push! +${payout} Gold Coins`).setColor(Tokens.text.muted);
      showWinCelebration(this, payout);
    } else {
      this.messageText.setText("Dealer wins").setColor(Tokens.text.negative);
      playSfx(this, "lose");
    }
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
    this.drawHand(this.dealerCardObjects, this.dealerHand, DX, DEALER_CARDS_Y, this.dealerHoleHidden);
    this.drawHand(this.playerCardObjects, this.playerHand, DX, PLAYER_CARDS_Y, false);

    this.dealerTotalText.setText(this.dealerHoleHidden ? "DEALER" : `DEALER  ${this.dealerTotal()}`);
    this.playerTotalText.setText(this.playerHand.length > 0 ? `You  ${this.playerTotal()}` : "");
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

  /**
   * Draws a single playing-card visual, or a face-down back if card is null.
   *
   * Both come from the shared card surfaces (uiHelpers' drawCardSurface), so
   * all four card games in the project print the same card. Neither has an
   * outline any more - a card separates from the board by BEING a different
   * surface, and a face-down card is simply a raised surface, i.e. it reads
   * as a control, which is exactly what it is.
   */
  private drawCardVisual(x: number, y: number, card: Card | null): Phaser.GameObjects.GameObject[] {
    const g = this.add.graphics();

    if (!card) {
      drawCardSurface(g, x, y, CARD_W, CARD_H, "back");
      const pattern = makeText(this, x, y, "?", {
        size: Tokens.type.glyph.md,
        weight: Tokens.type.weight.semibold,
        color: Tokens.text.secondary,
        align: "center",
        originX: 0.5,
        originY: 0.5
      });
      return [g, pattern];
    }

    drawCardSurface(g, x, y, CARD_W, CARD_H, "face");
    const color = isRed(card) ? Tokens.card.inkRed : Tokens.card.ink;
    const label = makeText(this, x, y, `${card.rank}${card.suit}`, {
      size: Tokens.type.glyph.xs,
      weight: Tokens.type.weight.semibold,
      color,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });
    return [g, label];
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins));
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
