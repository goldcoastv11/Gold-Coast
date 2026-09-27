/**
 * The live Roulette table: one wheel, one countdown, everybody betting on
 * the same spin.
 *
 * ## Why this is a state machine with no timers, database or sockets in it
 *
 * Same split as presence.ts, for the same reason - but here it matters
 * more, because this file decides who won money. `advance(now)` is called
 * by the realtime server's existing tick and returns a list of things that
 * happened; the caller does the broadcasting and the ledger writes. That
 * means a test can run a hundred rounds through this in a millisecond with
 * a fake clock and a fixed wheel, which is the only practical way to have
 * any confidence in a loop that pays out unattended, forever.
 *
 * ## The one hard rule about money here
 *
 * **Nothing in this file writes to the ledger, and no bet reaches it from a
 * WebSocket.** Bets arrive over the authenticated HTTP API
 * (`POST /games/roulette/table/bet`) exactly like every other wager in this
 * product; this module only records that one was accepted and computes the
 * result. The realtime channel is what it is everywhere else - a way to
 * tell people what happened, never a way to make something happen. See
 * protocol.ts's header on that boundary.
 *
 * ## Why bets are not debited when they are placed
 *
 * A player's whole round - the wager leg and the payout leg - is settled in
 * ONE transaction at spin time, through the same `settleSingleShotBet`
 * helper the solo game uses. The alternative (debit on bet, credit on
 * result) has a real failure mode: a process restart between the two legs
 * takes a player's stake and never resolves it, and this table runs
 * continuously and unattended. Settling atomically means a crash mid-round
 * costs everyone their (unplaced) bet and nobody their money.
 *
 * The cost of that choice is that a player can place a table bet and then
 * spend the same Gold Coins elsewhere before the wheel stops. Their balance
 * is checked when the bet is placed, so this needs deliberate effort rather
 * than being an easy accident - and when it does happen the ledger refuses
 * the debit and that ONE player's bet is voided, reported to them, and
 * everyone else's round settles normally. That is the honest outcome: a bet
 * you could not cover is not a bet you get to win.
 */

import { randomUUID } from "node:crypto";
import { randInt } from "../rng";
import { RouletteColor, ROULETTE_PAYOUTS, colorOf } from "../games/roulette";
import { BET_MAX, BET_MIN } from "../games/shared";
// The wire shapes live with the rest of the protocol (see protocol.ts's own
// note on why) - this module owns the behaviour, not the format.
import { TableBet, TablePhase, TableResult, TableSnapshot } from "./protocol";

export type { TableBet, TablePhase, TableResult, TableSnapshot };

/** How long players have to get a bet down. Long enough to read the table and change your mind, short enough that waiting isn't the game. */
export const BETTING_MS = 12_000;
/** The wheel animation. The client is told the winning number the moment betting closes and animates toward it, so this is purely how long the reveal takes. */
export const SPINNING_MS = 5_000;
/** How long results stay up before the next round opens. */
export const PAYOUT_MS = 5_000;

/** One full round, end to end. */
export const CYCLE_MS = BETTING_MS + SPINNING_MS + PAYOUT_MS;

export type PlaceBetOutcome =
  | { ok: true; bet: TableBet; snapshot: TableSnapshot }
  | { ok: false; reason: "TABLE_CLOSED" | "BETTING_CLOSED" | "ALREADY_BET" | "INVALID_AMOUNT" };

/**
 * What `advance()` says happened. The caller turns each into a broadcast
 * and, for `settle`, a set of ledger transactions.
 */
export type TableEvent =
  /** The phase changed; broadcast the new snapshot. */
  | { kind: "phase"; snapshot: TableSnapshot }
  /**
   * Betting just closed and the wheel has been drawn. The caller must
   * settle these through the ledger and then broadcast the outcome.
   * Emitted exactly once per round, and never with an empty bet list -
   * a round nobody bet on has nothing to settle.
   */
  | { kind: "settle"; roundId: string; number: number; color: RouletteColor; results: TableResult[] };

interface Round {
  id: string;
  phase: TablePhase;
  phaseEndsAt: number;
  bets: Map<string, TableBet>;
  number: number | null;
  color: RouletteColor | null;
  results: TableResult[] | null;
}

export class RouletteTable {
  private round: Round | null = null;
  private readonly drawNumber: () => number;

  /**
   * Called when a bet is accepted, so the table can be broadcast live
   * instead of only at phase changes.
   *
   * A plain callback rather than this module reaching for the socket layer:
   * bets arrive over HTTP, on a route that has no business knowing about
   * WebSockets, and the realtime server subscribes here instead. It also
   * keeps this module free of protocol message shapes, which is what lets
   * the whole round loop be tested with no transport at all.
   */
  private readonly betListeners = new Set<(roundId: string, bet: TableBet) => void>();

  /**
   * `drawNumber` is injectable so tests can pin the wheel. Production always
   * uses the same CSPRNG-backed `randInt` the solo game does - a live table
   * must not be more predictable than the single-player one.
   */
  constructor(drawNumber: () => number = () => randInt(0, 36)) {
    this.drawNumber = drawNumber;
  }

  /** True once start() has been called and the round loop is being advanced. Bets are refused while false. */
  get running(): boolean {
    return this.round !== null;
  }

  /**
   * Opens the table. Called when the realtime channel attaches - so if that
   * attach failed, this never runs, `running` stays false, and the HTTP bet
   * route refuses cleanly instead of accepting stakes into a wheel that
   * will never spin.
   */
  start(now = Date.now()): TableSnapshot {
    this.round = this.newRound(now);
    return this.snapshot(now);
  }

  /** Closes the table. Any bets on the open round are dropped - they were never debited, so nothing is owed. */
  stop(): void {
    this.round = null;
  }

  /**
   * Records a bet on the open round.
   *
   * Deliberately does NOT check the player's balance - that is the HTTP
   * route's job, because it is the side with a database. Keeping this
   * module free of I/O is what makes the round loop testable, and a balance
   * check here would be the one thing that broke that.
   */
  placeBet(
    userId: string,
    username: string,
    choice: RouletteColor,
    amount: number,
    now = Date.now()
  ): PlaceBetOutcome {
    const round = this.round;
    if (!round) return { ok: false, reason: "TABLE_CLOSED" };
    if (round.phase !== "betting") return { ok: false, reason: "BETTING_CLOSED" };
    if (!Number.isInteger(amount) || amount < BET_MIN || amount > BET_MAX) {
      return { ok: false, reason: "INVALID_AMOUNT" };
    }
    // One bet per player per round. Not a technical limit - it keeps the
    // table readable (one row per person) and means a player's exposure on
    // a given spin is exactly the number they chose, which is the whole
    // reason the solo game has a single bet stepper too.
    if (round.bets.has(userId)) return { ok: false, reason: "ALREADY_BET" };

    const bet: TableBet = { userId, username, choice, amount };
    round.bets.set(userId, bet);

    for (const listener of [...this.betListeners]) {
      try {
        listener(round.id, bet);
      } catch (err) {
        // A broken broadcaster must not fail the bet - it has already been
        // accepted, and the next phase change re-sends the whole table
        // anyway, so the worst case is one player's row appearing a few
        // seconds late.
        console.error("roulette table: bet listener threw", err);
      }
    }

    return { ok: true, bet, snapshot: this.snapshot(now) };
  }

  /** Subscribes to accepted bets. Returns its own unsubscribe. */
  onBet(listener: (roundId: string, bet: TableBet) => void): () => void {
    this.betListeners.add(listener);
    return () => {
      this.betListeners.delete(listener);
    };
  }

  /** Drops a player's bet - used when the ledger refuses it at settlement, so a voided bet doesn't linger in the snapshot. */
  removeBet(userId: string): void {
    this.round?.bets.delete(userId);
  }

  /**
   * Drives the round loop. Called on the realtime server's existing tick,
   * so this table needs no timer of its own.
   *
   * Loops rather than returning after one transition, so a long stall (a
   * blocked event loop, a debugger pause) catches up instead of leaving the
   * table stuck one phase behind forever.
   */
  advance(now = Date.now()): TableEvent[] {
    const events: TableEvent[] = [];
    if (!this.round) return events;

    // More than a full cycle behind: the process was blocked for a long
    // time (a stop-the-world pause, a debugger, a suspended container).
    // Replaying the missed rounds at once would run betting windows nobody
    // could bet in, so the table simply starts fresh from now.
    //
    // Safe to discard whatever was open, including a round whose betting
    // had closed: bets are not debited until settlement (see this file's
    // header), so a dropped round costs nobody anything - nothing was
    // taken and nothing was paid.
    if (now - this.round.phaseEndsAt > CYCLE_MS) {
      this.round = this.newRound(now);
      events.push({ kind: "phase", snapshot: this.snapshot(now) });
      return events;
    }

    while (this.round && now >= this.round.phaseEndsAt) {
      const round = this.round;
      // Each phase is timed from when the LAST one was due to end, not from
      // `now` - so a tick that lands a few milliseconds late doesn't
      // stretch the round, and those milliseconds don't accumulate into
      // visible drift over a day of continuous play.
      const dueAt = round.phaseEndsAt;

      switch (round.phase) {
        case "betting": {
          const number = this.drawNumber();
          const color = colorOf(number);
          round.number = number;
          round.color = color;
          round.results = [...round.bets.values()].map((bet) => {
            const won = bet.choice === color;
            return { ...bet, won, payout: won ? bet.amount * ROULETTE_PAYOUTS[bet.choice] : 0 };
          });
          round.phase = "spinning";
          round.phaseEndsAt = dueAt + SPINNING_MS;

          // Phase first: the wheel starts turning on every screen the
          // instant betting closes, rather than after the database has
          // been written to.
          events.push({ kind: "phase", snapshot: this.snapshot(now) });
          if (round.results.length > 0) {
            events.push({ kind: "settle", roundId: round.id, number, color, results: round.results });
          }
          break;
        }

        case "spinning":
          round.phase = "payout";
          round.phaseEndsAt = dueAt + PAYOUT_MS;
          events.push({ kind: "phase", snapshot: this.snapshot(now) });
          break;

        case "payout":
          this.round = this.newRound(dueAt);
          events.push({ kind: "phase", snapshot: this.snapshot(now) });
          break;
      }
    }

    return events;
  }

  /** The current table state, or null if the table isn't running. */
  snapshot(now = Date.now()): TableSnapshot {
    const round = this.round;
    if (!round) {
      // A closed table is reported as a betting round with no time and no
      // bets rather than as null, so every client rendering path has a
      // shape to draw. `running` is what callers check for "can I bet".
      return {
        roundId: "",
        phase: "betting",
        msRemaining: 0,
        bets: [],
        number: null,
        color: null,
        results: null
      };
    }

    return {
      roundId: round.id,
      phase: round.phase,
      msRemaining: Math.max(0, round.phaseEndsAt - now),
      bets: [...round.bets.values()],
      number: round.number,
      color: round.color,
      results: round.results
    };
  }

  /** Marks the given players' bets as voided in the current round's results, so the broadcast tells the truth about what settled. */
  markVoided(roundId: string, userIds: string[]): void {
    const round = this.round;
    if (!round || round.id !== roundId || !round.results) return;
    const voided = new Set(userIds);
    for (const result of round.results) {
      if (voided.has(result.userId)) {
        result.voided = true;
        result.won = false;
        result.payout = 0;
      }
    }
  }

  private newRound(now: number): Round {
    return {
      id: randomUUID(),
      phase: "betting",
      phaseEndsAt: now + BETTING_MS,
      bets: new Map(),
      number: null,
      color: null,
      results: null
    };
  }
}

/**
 * There is deliberately NO module-level singleton here any more.
 *
 * There used to be one - one wheel for the whole product. Once servers
 * exist (see gameServers.ts) that is actively wrong: each server owns its
 * own table, and a shared instance would mean players on server A betting
 * on server B's spin. Every caller now gets its table from the registry,
 * resolved from where the player is actually sitting (see presence.ts's
 * `locate` and the live-table section of routes/games.ts).
 */
