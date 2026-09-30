import Phaser from "phaser";
import { embeddedGame, loungePresentation } from '../mobile/arcadeBridge';
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
  private directQuickplay = false;
  private handCenterX = DX;
  private dealerHandY = DEALER_CARDS_Y;
  private playerHandY = PLAYER_CARDS_Y;
  private cardWidth = CARD_W;
  private cardHeight = CARD_H;
  private cardStep = CARD_W + CARD_GAP;
  private dealerScoreBg?: Phaser.GameObjects.Graphics;
  private playerScoreBg?: Phaser.GameObjects.Graphics;
  private splitBtn?: UIButton;
  private doubleBtn?: UIButton;

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

    this.directQuickplay = !!embeddedGame() && !loungePresentation();
    if (this.directQuickplay) {
      // The iframe can boot at 800x600 a fraction of a second before the
      // mobile shell applies its 500x1000 portrait game size. Recreate this
      // one scene after that real resize so the table and controls are laid
      // out from the final dimensions rather than retaining landscape
      // coordinates on a portrait canvas.
      this.scale.once("resize", () => this.scene.restart());
      this.createDirectQuickplayLayout();
      this.renderHands();
      this.updateBalance();
      return;
    }

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
    if (!embeddedGame()) this.add.image(DX, DY, "blackjack_table").setDisplaySize(BOARD_W, BOARD_H).setAlpha(TABLE_ART_ALPHA);

    // Dealer - stands off to the side, "dealing" via a looping animation.
    // Was at DY-190 (=110), above SAFE_ZONE_TOP and croppable on a phone;
    // now stands inside the band, in the board's own left gutter.
    if (!embeddedGame()) { const dealer = this.add
      .sprite(DEALER_SPRITE_X, DEALER_SPRITE_Y, "dealer_sheet", 1)
      .setScale(DEALER_SPRITE_SCALE);
    dealer.play("dealer_walk_down"); }

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

  /**
   * Direct Quickplay uses the open-table composition from the supplied
   * reference: a compact betting rail at the left in landscape (or below
   * the table in portrait), dealer cards high, player cards low, and the
   * rules plaque floating between them. Lounge Blackjack deliberately keeps
   * the existing dealer/table presentation above.
   */
  private createDirectQuickplayLayout() {
    const width = this.scale.width;
    const height = this.scale.height;
    const portrait = height > width;
    const controls = portrait
      ? { x: 0, y: 600, w: width, h: height - 600 }
      : { x: 0, y: 0, w: Math.max(236, Math.min(300, Math.round(width * 0.25))), h: height };
    const table = portrait
      ? { x: 0, y: 0, w: width, h: 600 }
      : { x: controls.w, y: 0, w: width - controls.w, h: height };
    const panelLeft = controls.x + Tokens.space.md;
    const panelRight = controls.x + controls.w - Tokens.space.md;
    const panelWidth = panelRight - panelLeft;
    const top = controls.y;

    this.handCenterX = table.x + table.w / 2;
    this.dealerHandY = table.y + (portrait ? 132 : 122);
    this.playerHandY = table.y + (portrait ? 466 : 458);
    this.cardWidth = portrait ? 70 : 72;
    this.cardHeight = portrait ? 102 : 106;
    this.cardStep = portrait ? 48 : 50;

    const ground = this.add.graphics().setDepth(-1000).setScrollFactor(0);
    ground.fillStyle(Tokens.color.bg, 1).fillRect(0, 0, width, height);

    const tableSurface = this.add.graphics().setDepth(-20);
    tableSurface.fillStyle(0x0d202d, 1).fillRect(table.x, table.y, table.w, table.h);
    tableSurface.fillStyle(Tokens.color.surface, 0.42).fillRect(table.x, table.y, table.w, 16);

    const controlSurface = this.add.graphics().setDepth(-10).setScrollFactor(0);
    controlSurface.fillStyle(Tokens.color.surface, 1).fillRect(controls.x, controls.y, controls.w, controls.h);
    if (portrait) {
      controlSurface.lineStyle(2, Tokens.color.hairline, 1).lineBetween(0, controls.y, width, controls.y);
    }

    makeText(this, panelLeft, top + 18, "BLACKJACK", {
      size: Tokens.type.size.sm,
      weight: Tokens.type.weight.semibold,
      color: Tokens.text.secondary,
      tracking: Tokens.type.tracking.caps
    }).setScrollFactor(0);
    makeText(this, panelLeft, top + 42, "AMOUNT", {
      size: Tokens.type.size.xs,
      weight: Tokens.type.weight.semibold,
      color: Tokens.text.secondary,
      tracking: Tokens.type.tracking.label
    }).setScrollFactor(0);
    this.balanceText = makeText(this, panelRight, top + 18, "", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      align: "right",
      originX: 1
    }).setScrollFactor(0);

    this.betControl = this.makeDirectBetControl(controls.x + controls.w / 2, top + 72, panelWidth);

    const gap = Tokens.space.sm;
    const buttonW = (panelWidth - gap) / 2;
    const leftX = panelLeft + buttonW / 2;
    const rightX = panelRight - buttonW / 2;
    this.hitBtn = makeButton(this, leftX, top + 126, buttonW, 44, "HIT  ↘", Tokens.color.surfaceHover, Tokens.color.info, () => this.hit(), Tokens.text.primary, Tokens.radius.md);
    this.standBtn = makeButton(this, rightX, top + 126, buttonW, 44, "STAND  ✋", Tokens.color.surfaceHover, Tokens.color.info, () => this.stand(), Tokens.text.primary, Tokens.radius.md);
    this.splitBtn = makeButton(this, leftX, top + 178, buttonW, 44, "SPLIT", Tokens.color.surfaceRaised, Tokens.color.surfaceRaised, () => {}, Tokens.text.secondary, Tokens.radius.md);
    this.doubleBtn = makeButton(this, rightX, top + 178, buttonW, 44, "DOUBLE  ×2", Tokens.color.surfaceRaised, Tokens.color.surfaceRaised, () => {}, Tokens.text.secondary, Tokens.radius.md);
    this.splitBtn.setEnabled(false);
    this.doubleBtn.setEnabled(false);

    this.newHandBtn = makeButton(this, controls.x + controls.w / 2, top + 232, panelWidth, 44, "PLAY", Tokens.color.info, Tokens.color.infoHover, () => this.startNewHand(), Tokens.text.primary, Tokens.radius.md);
    this.messageText = makeText(this, panelLeft, top + 264, "Place your bet and play a hand.", {
      size: Tokens.type.size.sm,
      color: Tokens.text.muted,
      wordWrapWidth: panelWidth,
      originY: 0
    }).setScrollFactor(0);
    this.walkAwayBtn = makeButton(this, controls.x + controls.w / 2, controls.y + controls.h - 28, panelWidth, 34, "BACK TO GAMES", Tokens.color.surfaceRaised, Tokens.color.surfaceHover, () => this.leaveGame(), Tokens.text.secondary, Tokens.radius.sm);

    for (const button of [this.hitBtn, this.standBtn, this.splitBtn, this.doubleBtn, this.newHandBtn, this.walkAwayBtn]) {
      button.container.setScrollFactor(0);
    }
    this.setActionButtonsVisible(false);

    const dealerLabelY = table.y + 38;
    makeText(this, this.handCenterX, dealerLabelY, "DEALER", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5
    });

    const rulesY = table.y + 300;
    const plaque = this.add.graphics();
    plaque.fillStyle(Tokens.color.surface, 1);
    plaque.fillTriangle(this.handCenterX - 170, rulesY - 18, this.handCenterX - 150, rulesY, this.handCenterX - 170, rulesY + 18);
    plaque.fillTriangle(this.handCenterX + 170, rulesY - 18, this.handCenterX + 150, rulesY, this.handCenterX + 170, rulesY + 18);
    plaque.fillRoundedRect(this.handCenterX - 145, rulesY - 22, 290, 44, Tokens.radius.sm);
    makeText(this, this.handCenterX, rulesY - 1, "BLACKJACK PAYS 3 TO 2", {
      size: Tokens.type.size.sm,
      weight: Tokens.type.weight.semibold,
      color: Tokens.text.secondary,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });
    makeText(this, this.handCenterX, rulesY + 34, "INSURANCE PAYS 2 TO 1", {
      size: Tokens.type.size.xs,
      weight: Tokens.type.weight.semibold,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5
    });

    this.drawDeck(table.x + table.w - 48, table.y + 38);
    this.dealerScoreBg = this.add.graphics();
    this.playerScoreBg = this.add.graphics();
    this.dealerTotalText = makeText(this, this.handCenterX, this.dealerHandY - this.cardHeight / 2 - 14, "", {
      size: Tokens.type.size.sm,
      weight: Tokens.type.weight.semibold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });
    this.playerTotalText = makeText(this, this.handCenterX, this.playerHandY - this.cardHeight / 2 - 14, "", {
      size: Tokens.type.size.sm,
      weight: Tokens.type.weight.semibold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });
  }

  private makeDirectBetControl(x: number, y: number, width: number): BetControl {
    const container = this.add.container(x, y).setScrollFactor(0);
    const cellW = 44;
    const gap = Tokens.space.xs;
    const fieldW = width - cellW * 2 - gap * 2;
    const left = -width / 2;
    const fieldX = left + fieldW / 2;
    const field = this.add.graphics();
    field.fillStyle(Tokens.color.inset, 1).fillRoundedRect(fieldX - fieldW / 2, -20, fieldW, 40, Tokens.radius.md);
    const amount = makeText(this, fieldX - fieldW / 2 + Tokens.space.md, 0, "", {
      size: Tokens.type.size.lg,
      weight: Tokens.type.weight.semibold,
      color: Tokens.text.primary,
      originY: 0.5
    });
    const coin = this.add.graphics();
    coin.fillStyle(0xffc800, 1).fillCircle(fieldX + fieldW / 2 - 15, 0, 9);
    const coinLabel = makeText(this, fieldX + fieldW / 2 - 15, 0, "G", {
      size: Tokens.type.size.xs,
      weight: Tokens.type.weight.bold,
      color: Tokens.text.onAccent,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });
    const half = makeButton(this, left + fieldW + gap + cellW / 2, 0, cellW, 40, "½", Tokens.color.surfaceRaised, Tokens.color.surfaceHover, () => {
      gameState.setBet(gameState.betAmount / 2);
      refresh();
    }, Tokens.text.secondary, Tokens.radius.sm);
    const twice = makeButton(this, left + fieldW + gap * 2 + cellW * 1.5, 0, cellW, 40, "2×", Tokens.color.surfaceRaised, Tokens.color.surfaceHover, () => {
      gameState.setBet(gameState.betAmount * 2);
      refresh();
    }, Tokens.text.secondary, Tokens.radius.sm);
    container.add([field, amount, coin, coinLabel, half.container, twice.container]);
    const refresh = () => amount.setText(gameState.betAmount.toFixed(2));
    refresh();
    return {
      container,
      refresh,
      setEnabled: (value: boolean) => {
        half.setEnabled(value);
        twice.setEnabled(value);
        container.setAlpha(value ? 1 : Tokens.motion.disabledAlpha);
      },
      destroy: () => container.destroy()
    };
  }

  private drawDeck(x: number, y: number) {
    for (let i = 0; i < 3; i++) {
      const g = this.add.graphics();
      const cy = y + i * 4;
      g.fillStyle(Tokens.card.face, 1).fillRoundedRect(x - this.cardWidth / 2, cy - this.cardHeight / 2, this.cardWidth, this.cardHeight, Tokens.radius.md);
      g.fillStyle(Tokens.color.info, 1).fillRoundedRect(x - this.cardWidth / 2 + 4, cy - this.cardHeight / 2 + 4, this.cardWidth - 8, this.cardHeight - 8, Tokens.radius.sm);
      g.lineStyle(1, Tokens.card.face, 0.85).strokeRoundedRect(x - this.cardWidth / 2 + 8, cy - this.cardHeight / 2 + 8, this.cardWidth - 16, this.cardHeight - 16, Tokens.radius.xs);
    }
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
          if (this.directQuickplay) this.newHandBtn?.setLabel("HAND IN PLAY");
          else this.newHandBtn?.container.setVisible(false);
          this.newHandBtn?.setEnabled(false);
        }

        this.updateBalance();
        this.animateInitialDeal();
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
    this.hitBtn?.container.setVisible(this.directQuickplay || visible);
    this.hitBtn?.setEnabled(visible);
    this.standBtn?.container.setVisible(this.directQuickplay || visible);
    this.standBtn?.setEnabled(visible);
  }

  private renderHands() {
    if (this.directQuickplay) {
      this.drawDirectHand(this.dealerCardObjects, this.dealerHand, this.handCenterX, this.dealerHandY, this.dealerHoleHidden);
      this.drawDirectHand(this.playerCardObjects, this.playerHand, this.handCenterX, this.playerHandY, false);
      const dealerScore = this.dealerHand.length > 0 ? String(this.dealerTotal()) : "";
      const playerScore = this.playerHand.length > 0 ? String(this.playerTotal()) : "";
      this.dealerTotalText.setText(dealerScore);
      this.playerTotalText.setText(playerScore);
      this.drawScoreBadge(this.dealerScoreBg, this.dealerTotalText.x, this.dealerTotalText.y, dealerScore !== "");
      this.drawScoreBadge(this.playerScoreBg, this.playerTotalText.x, this.playerTotalText.y, playerScore !== "");
      return;
    }

    this.drawHand(this.dealerCardObjects, this.dealerHand, DX, DEALER_CARDS_Y, this.dealerHoleHidden);
    this.drawHand(this.playerCardObjects, this.playerHand, DX, PLAYER_CARDS_Y, false);
    this.dealerTotalText.setText(this.dealerHoleHidden ? "DEALER" : `DEALER  ${this.dealerTotal()}`);
    this.playerTotalText.setText(this.playerHand.length > 0 ? `You  ${this.playerTotal()}` : "");
  }

  private animateInitialDeal() {
    this.renderHands();
    const objects = [...this.dealerCardObjects, ...this.playerCardObjects];
    objects.forEach((gameObject, index) => {
      const target = gameObject as Phaser.GameObjects.GameObject & {
        setAlpha: (alpha: number) => unknown;
        setScale: (scale: number) => unknown;
      };
      target.setAlpha(0);
      target.setScale(0.82);
      this.tweens.add({
        targets: target,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        delay: Math.floor(index / (this.directQuickplay ? 4 : 2)) * 130,
        duration: 240,
        ease: Tokens.motion.ease.out
      });
    });
  }

  private drawScoreBadge(bg: Phaser.GameObjects.Graphics | undefined, x: number, y: number, visible: boolean) {
    if (!bg) return;
    bg.clear();
    if (!visible) return;
    bg.fillStyle(Tokens.color.surfaceHover, 1).fillRoundedRect(x - 31, y - 11, 62, 22, 11);
  }

  private drawDirectHand(
    existing: Phaser.GameObjects.GameObject[],
    hand: Card[],
    centerX: number,
    y: number,
    hideHoleCard: boolean
  ) {
    existing.forEach((obj) => obj.destroy());
    existing.length = 0;
    if (hand.length === 0) return;

    const cards: Array<Card | null> = [...hand];
    if (hideHoleCard) cards.splice(1, 0, null);
    const totalWidth = this.cardWidth + (cards.length - 1) * this.cardStep;
    const startX = centerX - totalWidth / 2 + this.cardWidth / 2;
    cards.forEach((card, index) => {
      const objects = this.drawDirectCard(startX + index * this.cardStep, y, card);
      objects.forEach(obj => (obj as Phaser.GameObjects.GameObject & { setDepth: (depth: number) => unknown }).setDepth(index + 1));
      existing.push(...objects);
    });
  }

  private drawDirectCard(x: number, y: number, card: Card | null): Phaser.GameObjects.GameObject[] {
    const g = this.add.graphics();
    g.fillStyle(0x07131b, 0.42).fillRoundedRect(x - this.cardWidth / 2 + 3, y - this.cardHeight / 2 + 4, this.cardWidth, this.cardHeight, Tokens.radius.md);
    g.fillStyle(Tokens.card.face, 1).fillRoundedRect(x - this.cardWidth / 2, y - this.cardHeight / 2, this.cardWidth, this.cardHeight, Tokens.radius.md);
    g.lineStyle(1, Tokens.color.textMuted, 0.38).strokeRoundedRect(x - this.cardWidth / 2, y - this.cardHeight / 2, this.cardWidth, this.cardHeight, Tokens.radius.md);

    if (!card) {
      g.fillStyle(Tokens.color.info, 1).fillRoundedRect(x - this.cardWidth / 2 + 4, y - this.cardHeight / 2 + 4, this.cardWidth - 8, this.cardHeight - 8, Tokens.radius.sm);
      g.lineStyle(1, Tokens.card.face, 0.9).strokeRoundedRect(x - this.cardWidth / 2 + 8, y - this.cardHeight / 2 + 8, this.cardWidth - 16, this.cardHeight - 16, Tokens.radius.xs);
      const mark = makeText(this, x, y, "G", {
        size: Tokens.type.size.xl,
        weight: Tokens.type.weight.bold,
        color: Tokens.text.primary,
        align: "center",
        originX: 0.5,
        originY: 0.5
      });
      return [g, mark];
    }

    const color = isRed(card) ? Tokens.card.inkRed : Tokens.card.ink;
    const rank = makeText(this, x - this.cardWidth / 2 + 11, y - this.cardHeight / 2 + 9, card.rank, {
      size: Tokens.type.size.xxl,
      weight: Tokens.type.weight.bold,
      color,
      originX: 0.5,
      originY: 0
    });
    const cornerSuit = makeText(this, x - this.cardWidth / 2 + 11, y - this.cardHeight / 2 + 36, card.suit, {
      size: Tokens.type.size.md,
      color,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });
    const suit = makeText(this, x, y + 17, card.suit, {
      size: Tokens.type.glyph.lg,
      color,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });
    return [g, rank, cornerSuit, suit];
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
