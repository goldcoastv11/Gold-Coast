/**
 * LIVE ROULETTE - one wheel, everyone at the table betting on the same spin.
 *
 * The solo game (RouletteScene) is untouched and still there. This is a
 * second screen against the same wheel and the same paytable; you reach it
 * from a button in the solo game's sidebar, and go back the same way.
 *
 * ## The shape of a round, from this screen's side
 *
 * The server owns the clock. This scene never decides when betting closes,
 * what the number is, or who won - it renders `table` snapshots as they
 * arrive and asks the server (over HTTP) to put a bet on. That split is
 * deliberate and is the same one the solo game already makes: every
 * outcome in this product is server-authoritative, and a live table where
 * a client could influence the timing would be strictly worse than one
 * where it cannot.
 *
 *   betting   countdown, bet buttons live, other players' bets appear
 *   spinning  the number is already known (sent when betting closed), the
 *             digits tumble toward it
 *   payout    results per player, balance refreshed
 *
 * ## Why the result is held back
 *
 * The server sends the winning number the instant betting closes, so every
 * screen can start its animation together rather than one per player.
 * `tableResult` (the settled outcomes, sent after the ledger is written)
 * therefore usually arrives while the wheel is still turning - so it is
 * stashed and applied when the animation finishes. Showing it on arrival
 * would spoil the reveal on every spin.
 *
 * ## Degrading
 *
 * With the socket down this screen still loads: it fetches the table over
 * HTTP so the wheel and countdown are right, and says plainly that it is
 * not connected rather than sitting on an empty table pretending.
 */

import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Tokens, toCss } from "../ui/DesignTokens";
import {
  makeButton,
  makeText,
  makeDivider,
  makeGameShell,
  makeInset,
  formatBalance,
  popIn,
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
import {
  ROOM_ROULETTE,
  TableBet,
  TableColor,
  TableResult,
  TableSnapshot
} from "../api/realtimeProtocol";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";

const COLOR_NUM: Record<TableColor, number> = {
  red: Tokens.game.roulette.red,
  black: Tokens.game.roulette.black,
  green: Tokens.game.roulette.green
};
const COLOR_NUM_HOVER: Record<TableColor, number> = {
  red: Tokens.game.roulette.redHover,
  black: Tokens.game.roulette.blackHover,
  green: Tokens.game.roulette.greenHover
};
const COLOR_HEX: Record<TableColor, string> = {
  red: toCss(COLOR_NUM.red),
  // The black pocket's own surface is too dark to read as text, so a
  // "black" number prints as plain primary text - same call the solo screen
  // makes.
  black: Tokens.text.primary,
  green: toCss(COLOR_NUM.green)
};

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/** Cosmetic only - colours the digits tumbling during the spin. The number that pays always comes from the server. */
function colorOf(n: number): TableColor {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

const DX = GAME_SHELL_DISPLAY_CENTER_X;
const DY = GAME_SHELL_DISPLAY_CENTER_Y;
const BOARD_W = 410;
const BOARD_H = 320;
const BOARD_LEFT = DX - BOARD_W / 2 + Tokens.space.xxl;
const BOARD_RIGHT = DX + BOARD_W / 2 - Tokens.space.xxl;

const PHASE_LABEL_Y = 152;
const RESULT_WELL_Y = 196;
const RESULT_WELL_W = 130;
const RESULT_WELL_H = 70;
const PLAYERS_LABEL_Y = 242;
/** Top of the seated-players list. */
const PLAYERS_TOP_Y = 260;
const PLAYERS_ROW_H = 17;
/** How many rows fit before the divider. Beyond this the table says "+N more" rather than overflowing. */
const PLAYERS_MAX_ROWS = 4;
const DIVIDER_Y = 336;
const BET_LABEL_Y = 352;
const BET_BTN_Y = 396;
const BET_BTN_H = 42;
const BET_BTN_W = (BOARD_RIGHT - BOARD_LEFT - Tokens.space.sm * 2) / 3;

/** How long the digits tumble. Kept just under the server's spin phase so results land while this screen is settled, not mid-animation. */
const SPIN_ANIM_MS = 4200;

export class LiveRouletteScene extends Phaser.Scene {
  private shell!: GameShellHandle;
  private balanceText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private betControl?: BetControl;

  private phaseText!: Phaser.GameObjects.Text;
  private resultText!: Phaser.GameObjects.Text;
  private playersLabel!: Phaser.GameObjects.Text;
  private playerRows: Phaser.GameObjects.Text[] = [];
  private betButtons: { color: TableColor; button: UIButton }[] = [];

  /** The last table state the server sent. Null until the first snapshot arrives. */
  private table: TableSnapshot | null = null;
  /** Local countdown, ticked down each frame from the server's `msRemaining` - see the class header on why it is a duration. */
  private msRemaining = 0;
  /** The round this player has a bet on, so the buttons stay locked until the next one opens. */
  private betRoundId: string | null = null;
  /** True while a bet request is in flight - stops a double-click becoming a second request the server will reject. */
  private betInFlight = false;

  private spinTimer?: Phaser.Time.TimerEvent;
  /**
   * Results that arrived while the wheel was still turning. Applied when the
   * animation ends - see the class header on why they are held.
   */
  private pendingResult: { number: number; color: TableColor; results: TableResult[] } | null = null;

  private unsubscribes: Array<() => void> = [];

  constructor() {
    super("LiveRouletteScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "polkaTrain");
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    // Phaser reuses the scene instance across start/stop cycles, so every
    // piece of state has to be reset here rather than only at its
    // declaration - the same care OverworldScene's create() documents.
    this.table = null;
    this.msRemaining = 0;
    this.betRoundId = null;
    this.betInFlight = false;
    this.pendingResult = null;
    this.playerRows = [];
    this.betButtons = [];
    this.spinTimer = undefined;

    this.shell = makeGameShell(this, "LIVE ROULETTE", "SPIN", {
      onStart: () => {},
      onCashOut: () => {},
      onWalkAway: () => fadeToScene(this, "OverworldScene")
    });
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.betControl = this.shell.betControl;
    // Like the solo screen: the three colour buttons ARE the action here,
    // so the shell's own primary button stays hidden.
    this.shell.startBtn.container.setVisible(false);
    this.shell.startBtn.setEnabled(false);

    drawCabinetFrame(this, DX, DY, BOARD_W, BOARD_H);
    this.add.image(DX, 250, "roulette_table").setDisplaySize(400, 224).setAlpha(0.18);

    this.phaseText = makeText(this, DX, PHASE_LABEL_Y, "CONNECTING…", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5
    });

    makeInset(this, DX, RESULT_WELL_Y, RESULT_WELL_W, RESULT_WELL_H, Tokens.radius.md);
    this.resultText = makeText(this, DX, RESULT_WELL_Y, "?", {
      size: Tokens.type.size.display,
      weight: Tokens.type.weight.bold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });

    this.playersLabel = makeText(this, BOARD_LEFT, PLAYERS_LABEL_Y, "AT THE TABLE", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps
    });

    for (let i = 0; i < PLAYERS_MAX_ROWS + 1; i++) {
      this.playerRows.push(
        makeText(this, BOARD_LEFT, PLAYERS_TOP_Y + i * PLAYERS_ROW_H, "", {
          size: Tokens.type.size.sm,
          color: Tokens.text.secondary
        })
      );
    }

    makeDivider(this, BOARD_LEFT, DIVIDER_Y, BOARD_RIGHT);

    makeText(this, BOARD_LEFT, BET_LABEL_Y, "BET ON", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps
    });

    const options: Array<{ color: TableColor; label: string }> = [
      { color: "red", label: "RED 2x" },
      { color: "black", label: "BLACK 2x" },
      // Same paytable as the solo game (server/src/games/roulette.ts's
      // ROULETTE_PAYOUTS) - this is the same wheel, played together.
      { color: "green", label: "GREEN 36x" }
    ];
    this.betButtons = options.map((opt, i) => ({
      color: opt.color,
      button: makeButton(
        this,
        BOARD_LEFT + BET_BTN_W / 2 + i * (BET_BTN_W + Tokens.space.sm),
        BET_BTN_Y,
        BET_BTN_W,
        BET_BTN_H,
        opt.label,
        COLOR_NUM[opt.color],
        COLOR_NUM_HOVER[opt.color],
        () => this.placeBet(opt.color),
        undefined,
        Tokens.radius.md
      )
    }));

    // A way back to the solo wheel, mirroring the button that got you here.
    makeButton(
      this,
      BOARD_RIGHT - 52,
      PHASE_LABEL_Y,
      104,
      26,
      "SOLO TABLE",
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => fadeToScene(this, "RouletteScene"),
      undefined,
      Tokens.radius.sm
    );

    this.updateBalance();
    this.setBetButtonsEnabled(false);
    this.subscribeToTable();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribes.forEach((off) => off());
      this.unsubscribes = [];
      this.spinTimer?.remove(false);
      this.spinTimer = undefined;
      // Stand up from the table. The socket itself stays open - see
      // api/realtime.ts.
      realtime.setRoom(null);
    });
  }

  update(_time: number, delta: number) {
    if (this.msRemaining > 0) {
      this.msRemaining = Math.max(0, this.msRemaining - delta);
      this.renderPhaseLine();
    }
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  private subscribeToTable() {
    this.unsubscribes = [
      realtime.on("table", (snapshot) => this.applySnapshot(snapshot)),
      realtime.on("tableBet", (roundId, bet) => this.applyLiveBet(roundId, bet)),
      realtime.on("tableResult", (_roundId, number, color, results) =>
        this.receiveResult(number, color, results)
      ),
      realtime.on("notice", (code, message) => {
        if (code === "BET_VOIDED") {
          this.messageText.setText(message).setColor(Tokens.text.negative);
          // The bet never happened, so the balance the scene is showing is
          // already right - but re-reading is cheap and removes any doubt.
          this.refreshBalance();
        }
      }),
      realtime.on("status", (status) => {
        if (status !== "online") this.showDisconnected();
      })
    ];

    realtime.start();
    realtime.setRoom(ROOM_ROULETTE);

    // Belt and braces: fetch the table over HTTP too. With the socket up
    // this is redundant (the snapshot arrives within a moment); with it
    // down, it is the difference between a working-but-read-only table and
    // a blank screen.
    api
      .getRouletteTable()
      .then((res) => {
        // A snapshot may already have arrived over the socket while this
        // was in flight - that one is fresher, so don't overwrite it.
        if (!this.table && res.running) this.applySnapshot(res.table);
      })
      .catch(() => {
        // The socket is the normal path; a failure here is only worth
        // reporting if that is down too, which the status handler covers.
      });
  }

  private applySnapshot(snapshot: TableSnapshot) {
    const previousPhase = this.table?.phase;
    const previousRound = this.table?.roundId;
    this.table = snapshot;
    this.msRemaining = snapshot.msRemaining;

    // A new round opened: this player's bet from the last one is spent, and
    // the buttons come back.
    if (previousRound && previousRound !== snapshot.roundId) this.betRoundId = null;

    if (snapshot.phase === "spinning" && previousPhase !== "spinning" && snapshot.number !== null) {
      this.startSpinAnimation(snapshot.number, snapshot.color ?? colorOf(snapshot.number));
    }

    if (snapshot.phase === "betting" && previousPhase !== "betting") {
      this.resultText.setText("?").setColor(Tokens.text.primary);
      this.messageText.setText("Place your bet - red, black or green.").setColor(Tokens.text.muted);
    }

    this.renderPhaseLine();
    this.renderPlayers();
    this.syncBetButtons();
  }

  /** A single bet arriving between phase changes - merged into the snapshot so the list fills in live. */
  private applyLiveBet(roundId: string, bet: TableBet) {
    if (!this.table || this.table.roundId !== roundId) return;
    // The server is the authority on the table; this is the same bet it
    // will include in the next snapshot, applied early so the row appears
    // as it is placed rather than up to a phase later.
    const others = this.table.bets.filter((b) => b.userId !== bet.userId);
    this.table = { ...this.table, bets: [...others, bet] };
    this.renderPlayers();
  }

  private receiveResult(number: number, color: TableColor, results: TableResult[]) {
    // Almost always still mid-spin - held until the animation finishes so
    // the reveal isn't spoiled. If the wheel has already stopped (a slow
    // settle, or this player joined mid-spin), show it now.
    if (this.spinTimer) {
      this.pendingResult = { number, color, results };
      return;
    }
    this.showResult(number, color, results);
  }

  private startSpinAnimation(number: number, color: TableColor) {
    this.setBetButtonsEnabled(false);
    playSfx(this, "ballDrop");
    this.spinTimer?.remove(false);

    const stopAt = this.time.now + SPIN_ANIM_MS;
    this.spinTimer = this.time.addEvent({
      delay: Tokens.motion.duration.instant,
      loop: true,
      callback: () => {
        if (this.time.now >= stopAt) {
          this.spinTimer?.remove(false);
          this.spinTimer = undefined;
          const pending = this.pendingResult;
          this.pendingResult = null;
          // No pending result means nobody at the table bet this round -
          // there is a winning number but no outcomes to report.
          this.showResult(number, color, pending?.results ?? []);
          return;
        }
        if (this.resultText.active) {
          const n = Phaser.Math.Between(0, 36);
          this.resultText.setText(String(n)).setColor(COLOR_HEX[colorOf(n)]);
        }
      }
    });
  }

  private showResult(number: number, color: TableColor, results: TableResult[]) {
    this.resultText.setText(String(number)).setColor(COLOR_HEX[color]);
    playSfx(this, "reelStop");

    const mine = results.find((r) => r.userId === realtime.id);
    if (!mine) {
      this.messageText
        .setText(`${number} ${color.toUpperCase()} — you sat this round out`)
        .setColor(Tokens.text.muted);
    } else if (mine.voided) {
      this.messageText
        .setText(`${number} ${color.toUpperCase()} — your bet was voided`)
        .setColor(Tokens.text.negative);
    } else if (mine.won) {
      this.messageText
        .setText(`${number} ${color.toUpperCase()} — you win +${mine.payout} Gold Coins`)
        .setColor(Tokens.text.accent);
      popIn(this, this.resultText);
      showWinCelebration(this, mine.payout);
    } else {
      this.messageText
        .setText(`${number} ${color.toUpperCase()} — you lose`)
        .setColor(Tokens.text.negative);
      playSfx(this, "lose");
    }

    if (mine && !mine.voided) {
      // Retention Leg 1 (see api/track.ts). Server-settled result only, and
      // tagged as the live table so the two roulette modes can be told
      // apart in the numbers even though they share a game name.
      track(EVENTS.GAME_ROUND_PLAYED, {
        game: "roulette",
        betAmount: mine.amount,
        outcome: mine.won ? "win" : "loss",
        payout: mine.payout,
        table: true
      });
    }

    this.renderResultRows(results);
    // The server settled before broadcasting, so a re-read now is the real
    // post-round balance.
    this.refreshBalance();
  }

  // -------------------------------------------------------------------------
  // Betting
  // -------------------------------------------------------------------------

  private placeBet(choice: TableColor) {
    if (this.betInFlight || !this.table || this.table.phase !== "betting") return;
    if (this.betRoundId === this.table.roundId) return;

    const amount = gameState.betAmount;
    if (gameState.goldCoins < amount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    this.betInFlight = true;
    this.setBetButtonsEnabled(false);
    playSfx(this, "chipBet");

    api
      .placeRouletteTableBet(amount, choice)
      .then((res) => {
        this.betInFlight = false;
        this.betRoundId = res.table.roundId;
        this.applySnapshot(res.table);
        this.messageText
          .setText(`${amount} Gold Coins on ${choice.toUpperCase()} — good luck`)
          .setColor(Tokens.text.accent);
      })
      .catch((err) => {
        this.betInFlight = false;
        this.handleBetError(err);
        this.syncBetButtons();
      });
  }

  private handleBetError(err: unknown) {
    if (err instanceof ApiError) {
      // The server's own message is the specific one ("betting has closed",
      // "you already have a bet on this round") - better than anything this
      // scene could guess at.
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
      return;
    }
    if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
      return;
    }
    this.messageText.setText("Couldn't place that bet - please try again.").setColor(Tokens.text.negative);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderPhaseLine() {
    if (!this.table) return;
    const seconds = Math.ceil(this.msRemaining / 1000);

    switch (this.table.phase) {
      case "betting":
        this.phaseText.setText(`BETTING CLOSES IN ${seconds}`).setColor(Tokens.text.accent);
        return;
      case "spinning":
        this.phaseText.setText("SPINNING…").setColor(Tokens.text.muted);
        return;
      case "payout":
        this.phaseText.setText(`NEXT ROUND IN ${seconds}`).setColor(Tokens.text.muted);
        return;
    }
  }

  /** The seated-players list during betting: who is on, for how much, on what. */
  private renderPlayers() {
    const bets = this.table?.bets ?? [];
    this.playersLabel.setText(bets.length === 0 ? "AT THE TABLE" : `AT THE TABLE (${bets.length})`);

    if (bets.length === 0) {
      this.setRows(["No bets yet this round."], Tokens.text.muted);
      return;
    }

    const shown = bets.slice(0, PLAYERS_MAX_ROWS);
    const lines = shown.map((bet) => {
      const you = bet.userId === realtime.id ? " (you)" : "";
      return `${bet.username}${you} — ${bet.amount} on ${bet.choice.toUpperCase()}`;
    });
    if (bets.length > shown.length) lines.push(`+${bets.length - shown.length} more`);
    this.setRows(lines, Tokens.text.secondary);
  }

  /** The same list after the wheel stops, showing what each player's bet came to. */
  private renderResultRows(results: TableResult[]) {
    if (results.length === 0) {
      this.setRows(["Nobody bet this round."], Tokens.text.muted);
      return;
    }

    const shown = results.slice(0, PLAYERS_MAX_ROWS);
    const lines = shown.map((result) => {
      const you = result.userId === realtime.id ? " (you)" : "";
      if (result.voided) return `${result.username}${you} — bet voided`;
      return result.won
        ? `${result.username}${you} — won ${result.payout}`
        : `${result.username}${you} — lost ${result.amount}`;
    });
    if (results.length > shown.length) lines.push(`+${results.length - shown.length} more`);
    this.setRows(lines, Tokens.text.secondary);
  }

  private setRows(lines: string[], color: string) {
    this.playerRows.forEach((row, i) => {
      row.setText(lines[i] ?? "").setColor(color);
    });
  }

  /** Bet buttons are live only during betting, only while connected, and only until this player has a bet down. */
  private syncBetButtons() {
    const canBet =
      realtime.currentStatus === "online" &&
      !this.betInFlight &&
      this.table?.phase === "betting" &&
      this.betRoundId !== this.table?.roundId;
    this.setBetButtonsEnabled(!!canBet);
    this.betControl?.setEnabled(!!canBet);
  }

  private setBetButtonsEnabled(enabled: boolean) {
    this.betButtons.forEach(({ button }) => button.setEnabled(enabled));
  }

  private showDisconnected() {
    this.phaseText.setText("NOT CONNECTED").setColor(Tokens.text.negative);
    this.messageText
      .setText("Lost the live table - reconnecting…")
      .setColor(Tokens.text.negative);
    this.setBetButtonsEnabled(false);
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins));
  }

  /**
   * Re-reads the balance after a settled round.
   *
   * A table bet is the one wager in this product whose HTTP response does
   * NOT carry the new balance - nothing is debited when it is placed, and
   * the round settles server-side later (see the live-table section of
   * server/src/routes/games.ts). So this is how the sidebar catches up.
   * Silent on failure: the number on screen being briefly stale is a much
   * smaller problem than an error banner over a win.
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
