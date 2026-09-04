/**
 * LIVE BLACKJACK - up to five players, one dealer, taking turns.
 *
 * The solo game (BlackjackScene) is untouched and still there. This is a
 * second screen against the same rules and the same paytable; you reach it
 * from a button in the solo game's sidebar, and go back the same way.
 *
 * ## What this screen is and isn't responsible for
 *
 * The server owns the clock, the deck, the turn order and the outcome. This
 * scene renders `blackjack` snapshots as they arrive and asks the server -
 * over HTTP - to seat you or to hit/stand. It never decides anything: not
 * when betting closes, not what a hand totals, not whose turn it is. That
 * is the same split the live Roulette table makes, for the same reason
 * (every outcome in this product is server-authoritative), and it matters
 * more here because a turn-based game gives a client far more opportunities
 * to lie about state.
 *
 *   betting   countdown; TAKE SEAT while you have no bet down
 *   dealing   cards land, dealer shows one card
 *   acting    one player at a time; HIT/STAND light up only on your turn
 *   dealer    the hole card turns over and the dealer draws
 *   payout    per-seat outcomes, balance refreshed
 *
 * ## Cards
 *
 * The server sends RANKS only - suits have no effect on blackjack scoring,
 * so it doesn't waste payload on them (see server/src/games/blackjack.ts).
 * This scene picks a suit per card purely for display, keyed off the card's
 * position so it doesn't flicker to a different suit on every repaint.
 */

import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Tokens } from "../ui/DesignTokens";
import {
  makeButton,
  makeText,
  makeDivider,
  makeGameShell,
  makeInset,
  formatBalance,
  drawCabinetFrame,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  GAME_SHELL_DISPLAY_CENTER_Y,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { track, EVENTS } from "../api/track";
import { realtime } from "../api/realtime";
import { BlackjackSeat, BlackjackSnapshot, ROOM_BLACKJACK } from "../api/realtimeProtocol";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";

const DX = GAME_SHELL_DISPLAY_CENTER_X;
const DY = GAME_SHELL_DISPLAY_CENTER_Y;
const BOARD_W = 410;
const BOARD_H = 320;
const BOARD_LEFT = DX - BOARD_W / 2 + Tokens.space.xxl;
const BOARD_RIGHT = DX + BOARD_W / 2 - Tokens.space.xxl;

const PHASE_Y = 152;
const DEALER_LABEL_Y = 178;
const DEALER_CARDS_Y = 200;
const SEATS_LABEL_Y = 244;
const SEATS_TOP_Y = 262;
const SEAT_ROW_H = 18;
/** Seats shown before the list summarises. Matches the server's MAX_SEATS, so it never actually truncates. */
const MAX_SEAT_ROWS = 5;
const DIVIDER_Y = 356;
const ACTION_Y = 396;
const ACTION_H = 42;
const ACTION_W = (BOARD_RIGHT - BOARD_LEFT - Tokens.space.sm * 2) / 3;

/** Display-only. The server sends ranks; suits never affect scoring. */
const SUITS = ["♠", "♥", "♦", "♣"];
const RANK_LABEL: Record<number, string> = { 1: "A", 11: "J", 12: "Q", 13: "K" };

function cardLabel(rank: number, index: number): string {
  const face = RANK_LABEL[rank] ?? String(rank);
  // Keyed off the card's position rather than random, so a repaint doesn't
  // reshuffle the suits in front of the player mid-hand.
  return `${face}${SUITS[index % SUITS.length]}`;
}

export class LiveBlackjackScene extends Phaser.Scene {
  private shell!: GameShellHandle;
  private balanceText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private betControl?: BetControl;

  private phaseText!: Phaser.GameObjects.Text;
  private dealerText!: Phaser.GameObjects.Text;
  private seatsLabel!: Phaser.GameObjects.Text;
  private seatRows: Phaser.GameObjects.Text[] = [];

  private seatBtn!: UIButton;
  private hitBtn!: UIButton;
  private standBtn!: UIButton;

  private table: BlackjackSnapshot | null = null;
  /** Ticked down locally from the server's `msRemaining` - see the protocol on why it's a duration. */
  private msRemaining = 0;
  /** The round this player has a seat in, so the seat button stays locked until the next hand. */
  private seatedRoundId: string | null = null;
  /** True while a bet/action request is in flight, so a double-tap isn't a second request. */
  private busy = false;
  /** The last round whose result was announced, so the payout message fires once rather than every repaint. */
  private announcedRoundId: string | null = null;

  private unsubscribes: Array<() => void> = [];

  constructor() {
    super("LiveBlackjackScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "polkaTrain");
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    // Phaser reuses the scene instance across visits - see CLAUDE.md's
    // trap #3. Every field below holds either state or a destroyed game
    // object from last time.
    this.table = null;
    this.msRemaining = 0;
    this.seatedRoundId = null;
    this.busy = false;
    this.announcedRoundId = null;
    this.seatRows = [];

    this.shell = makeGameShell(this, "LIVE BLACKJACK", "DEAL", {
      onStart: () => {},
      onCashOut: () => {},
      onWalkAway: () => fadeToScene(this, "OverworldScene")
    });
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.betControl = this.shell.betControl;
    this.shell.startBtn.container.setVisible(false);
    this.shell.startBtn.setEnabled(false);

    drawCabinetFrame(this, DX, DY, BOARD_W, BOARD_H);

    this.phaseText = makeText(this, DX, PHASE_Y, "CONNECTING…", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5
    });

    makeText(this, BOARD_LEFT, DEALER_LABEL_Y, "DEALER", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps
    });
    makeInset(this, DX, DEALER_CARDS_Y + 4, BOARD_W - 64, 34, Tokens.radius.md);
    this.dealerText = makeText(this, DX, DEALER_CARDS_Y + 4, "—", {
      size: Tokens.type.size.xl,
      weight: Tokens.type.weight.bold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });

    this.seatsLabel = makeText(this, BOARD_LEFT, SEATS_LABEL_Y, "AT THE TABLE", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps
    });
    for (let i = 0; i < MAX_SEAT_ROWS; i++) {
      this.seatRows.push(
        makeText(this, BOARD_LEFT, SEATS_TOP_Y + i * SEAT_ROW_H, "", {
          size: Tokens.type.size.sm,
          color: Tokens.text.secondary
        })
      );
    }

    makeDivider(this, BOARD_LEFT, DIVIDER_Y, BOARD_RIGHT);

    this.seatBtn = makeButton(
      this,
      BOARD_LEFT + ACTION_W / 2,
      ACTION_Y,
      ACTION_W,
      ACTION_H,
      "TAKE SEAT",
      Tokens.color.accent,
      Tokens.color.accentHover,
      () => this.takeSeat(),
      undefined,
      Tokens.radius.md
    );
    this.hitBtn = makeButton(
      this,
      BOARD_LEFT + ACTION_W * 1.5 + Tokens.space.sm,
      ACTION_Y,
      ACTION_W,
      ACTION_H,
      "HIT",
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => this.act("hit"),
      undefined,
      Tokens.radius.md
    );
    this.standBtn = makeButton(
      this,
      BOARD_LEFT + ACTION_W * 2.5 + Tokens.space.sm * 2,
      ACTION_Y,
      ACTION_W,
      ACTION_H,
      "STAND",
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => this.act("stand"),
      undefined,
      Tokens.radius.md
    );

    makeButton(
      this,
      BOARD_RIGHT - 52,
      PHASE_Y,
      104,
      26,
      "SOLO TABLE",
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => fadeToScene(this, "BlackjackScene"),
      undefined,
      Tokens.radius.sm
    );

    this.updateBalance();
    this.syncButtons();
    this.subscribe();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribes.forEach((off) => off());
      this.unsubscribes = [];
      // Stand up from the table; the socket itself stays open so walking
      // back out to the floor is instant.
      realtime.setRoom(null);
    });
  }

  update(_time: number, delta: number) {
    if (this.msRemaining > 0) {
      this.msRemaining = Math.max(0, this.msRemaining - delta);
      this.renderPhase();
    }
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  private subscribe() {
    this.unsubscribes = [
      realtime.on("blackjack", (snapshot) => this.applySnapshot(snapshot)),
      realtime.on("notice", (code, message) => {
        if (code === "BET_VOIDED") {
          this.messageText.setText(message).setColor(Tokens.text.negative);
          this.refreshBalance();
        }
      }),
      realtime.on("status", (status) => {
        if (status !== "online") this.showDisconnected();
      })
    ];

    realtime.start();
    realtime.setRoom(ROOM_BLACKJACK, gameState.activeServerId);

    // Belt and braces, same as the Roulette screen: with the socket up this
    // is redundant, with it down it's the difference between a readable
    // table and a blank screen.
    api
      .getBlackjackTable()
      .then((res) => {
        if (!this.table && res.running && res.table) this.applySnapshot(res.table);
      })
      .catch(() => {
        // The socket is the normal path; the status handler covers it being
        // down.
      });
  }

  private applySnapshot(snapshot: BlackjackSnapshot) {
    const previousRound = this.table?.roundId;
    this.table = snapshot;
    this.msRemaining = snapshot.msRemaining;

    // A new hand: last hand's seat is spent and the buttons come back.
    if (previousRound && previousRound !== snapshot.roundId) {
      this.seatedRoundId = null;
      this.messageText.setText("Take a seat to play this hand.").setColor(Tokens.text.muted);
    }

    // The payout snapshot is broadcast only after the ledger is written, so
    // this is the honest moment to report a result and re-read the balance.
    if (snapshot.phase === "payout" && this.announcedRoundId !== snapshot.roundId) {
      this.announcedRoundId = snapshot.roundId;
      this.announceOutcome(snapshot);
    }

    this.renderPhase();
    this.renderDealer();
    this.renderSeats();
    this.syncButtons();
  }

  private announceOutcome(snapshot: BlackjackSnapshot) {
    const mine = snapshot.seats.find((s) => s.userId === realtime.id);
    if (!mine) {
      this.messageText.setText("You sat this hand out.").setColor(Tokens.text.muted);
      return;
    }

    if (mine.voided) {
      this.messageText.setText("Your hand was voided - nothing was staked.").setColor(Tokens.text.negative);
    } else if (mine.outcome === "win") {
      this.messageText
        .setText(`You win with ${mine.total} — +${mine.payout} Gold Coins`)
        .setColor(Tokens.text.accent);
      showWinCelebration(this, mine.payout);
    } else if (mine.outcome === "push") {
      this.messageText.setText(`Push on ${mine.total} — your stake is returned`).setColor(Tokens.text.muted);
    } else {
      this.messageText
        .setText(mine.status === "busted" ? `Bust with ${mine.total}` : `Dealer wins with ${snapshot.dealerTotal}`)
        .setColor(Tokens.text.negative);
      playSfx(this, "lose");
    }

    if (!mine.voided) {
      // Retention Leg 1 (see api/track.ts). Server-settled result only, and
      // tagged as the live table so the two blackjack modes can be told
      // apart even though they share a game name.
      track(EVENTS.GAME_ROUND_PLAYED, {
        game: "blackjack",
        betAmount: mine.bet,
        outcome: mine.outcome === "win" ? "win" : mine.outcome === "push" ? "push" : "loss",
        payout: mine.payout,
        table: true
      });
    }

    this.refreshBalance();
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  private takeSeat() {
    if (this.busy || !this.table || this.table.phase !== "betting") return;
    if (this.seatedRoundId === this.table.roundId) return;

    const amount = gameState.betAmount;
    if (gameState.goldCoins < amount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    this.busy = true;
    this.syncButtons();
    playSfx(this, "chipBet");

    api
      .placeBlackjackTableBet(amount)
      .then((res) => {
        this.busy = false;
        this.seatedRoundId = res.table.roundId;
        this.applySnapshot(res.table);
        this.messageText.setText(`Seated for ${amount} Gold Coins`).setColor(Tokens.text.accent);
      })
      .catch((err) => {
        this.busy = false;
        this.handleError(err);
        this.syncButtons();
      });
  }

  private act(action: "hit" | "stand") {
    if (this.busy || !this.isMyTurn()) return;

    this.busy = true;
    this.syncButtons();
    playSfx(this, "click");

    api
      .actBlackjackTable(action)
      .then((res) => {
        this.busy = false;
        this.applySnapshot(res.table);
      })
      .catch((err) => {
        this.busy = false;
        this.handleError(err);
        this.syncButtons();
      });
  }

  private handleError(err: unknown) {
    if (err instanceof ApiError || err instanceof NetworkError) {
      // The server's own message is the specific one ("it isn't your turn",
      // "every seat is taken") - better than anything this scene could
      // guess at.
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
      return;
    }
    this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
  }

  private isMyTurn(): boolean {
    return (
      !!this.table && this.table.phase === "acting" && this.table.activeUserId === realtime.id
    );
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderPhase() {
    if (!this.table) return;
    const seconds = Math.ceil(this.msRemaining / 1000);

    switch (this.table.phase) {
      case "betting":
        this.phaseText.setText(`BETTING CLOSES IN ${seconds}`).setColor(Tokens.text.accent);
        return;
      case "dealing":
        this.phaseText.setText("DEALING…").setColor(Tokens.text.muted);
        return;
      case "acting": {
        const active = this.table.seats.find((s) => s.userId === this.table?.activeUserId);
        this.phaseText
          .setText(this.isMyTurn() ? `YOUR TURN — ${seconds}` : `${active?.username ?? "…"} TO ACT — ${seconds}`)
          .setColor(this.isMyTurn() ? Tokens.text.accent : Tokens.text.muted);
        return;
      }
      case "dealer":
        this.phaseText.setText("DEALER PLAYS").setColor(Tokens.text.muted);
        return;
      case "payout":
        this.phaseText.setText(`NEXT HAND IN ${seconds}`).setColor(Tokens.text.muted);
        return;
    }
  }

  private renderDealer() {
    if (!this.table) {
      this.dealerText.setText("—");
      return;
    }

    // The hole card is genuinely absent from the payload until the dealer
    // plays - this isn't the client choosing to hide it.
    if (this.table.dealerHand) {
      const cards = this.table.dealerHand.map((r, i) => cardLabel(r, i)).join("  ");
      this.dealerText.setText(`${cards}   (${this.table.dealerTotal})`).setColor(Tokens.text.primary);
      return;
    }
    if (this.table.dealerUpCard !== null) {
      this.dealerText.setText(`${cardLabel(this.table.dealerUpCard, 0)}  ??`).setColor(Tokens.text.primary);
      return;
    }
    this.dealerText.setText("—").setColor(Tokens.text.muted);
  }

  private renderSeats() {
    const seats = this.table?.seats ?? [];
    this.seatsLabel.setText(seats.length === 0 ? "AT THE TABLE" : `AT THE TABLE (${seats.length})`);

    if (seats.length === 0) {
      this.paintRows(["Nobody has taken a seat yet."], Tokens.text.muted);
      return;
    }

    const lines = seats.map((seat) => this.describeSeat(seat));
    this.paintRows(lines, Tokens.text.secondary);
  }

  private describeSeat(seat: BlackjackSeat): string {
    const you = seat.userId === realtime.id ? " (you)" : "";
    const turn = this.table?.activeUserId === seat.userId ? "▶ " : "  ";
    const name = `${turn}${seat.username}${you}`;

    if (this.table?.phase === "betting") return `${name} — ${seat.bet} GC`;

    const cards = seat.hand.map((r, i) => cardLabel(r, i)).join(" ");
    const total = seat.hand.length > 0 ? ` (${seat.total})` : "";

    if (seat.voided) return `${name} — voided`;
    if (seat.outcome === "win") return `${name} ${cards}${total} — won ${seat.payout}`;
    if (seat.outcome === "push") return `${name} ${cards}${total} — push`;
    if (seat.outcome === "lose") return `${name} ${cards}${total} — lost ${seat.bet}`;
    if (seat.status === "busted") return `${name} ${cards}${total} — bust`;
    if (seat.status === "blackjack") return `${name} ${cards}${total} — blackjack!`;
    if (seat.status === "stood") return `${name} ${cards}${total} — stands`;
    return `${name} ${cards}${total}`;
  }

  private paintRows(lines: string[], color: string) {
    this.seatRows.forEach((row, i) => row.setText(lines[i] ?? "").setColor(color));
  }

  /**
   * The buttons are the clearest signal of whose turn it is, so they are
   * driven straight off the snapshot rather than from local guesses: seat
   * only during betting and only if not already in, hit/stand only on your
   * own turn.
   */
  private syncButtons() {
    const online = realtime.currentStatus === "online";
    const canSeat =
      online &&
      !this.busy &&
      this.table?.phase === "betting" &&
      this.seatedRoundId !== this.table?.roundId;
    const canAct = online && !this.busy && this.isMyTurn();

    this.seatBtn.setEnabled(!!canSeat);
    this.hitBtn.setEnabled(canAct);
    this.standBtn.setEnabled(canAct);
    this.betControl?.setEnabled(!!canSeat);
  }

  private showDisconnected() {
    this.phaseText.setText("NOT CONNECTED").setColor(Tokens.text.negative);
    this.messageText.setText("Lost the live table - reconnecting…").setColor(Tokens.text.negative);
    this.syncButtons();
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins));
  }

  /**
   * Re-reads the balance after a settled hand.
   *
   * A table bet is one of the two wagers in this product whose HTTP
   * response does not carry a new balance - nothing is debited when the
   * seat is taken, and the hand settles server-side later. Silent on
   * failure: a briefly stale number beats an error banner over a win.
   */
  private refreshBalance() {
    api
      .getMe()
      .then((me) => {
        if (!this.scene.isActive()) return;
        gameState.hydrateFromServer(me);
        this.updateBalance();
      })
      .catch(() => {
        // See doc comment.
      });
  }
}
