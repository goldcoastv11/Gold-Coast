/**
 * The live Blackjack table: several players, one dealer, taking turns.
 *
 * Same shape as rouletteTable.ts - a pure state machine with no timers, no
 * database and no sockets, advanced by the realtime tick - and for the same
 * reason: this loop decides who gets paid, it runs unattended forever, and
 * the only practical way to trust it is to be able to push a hundred rounds
 * through it in a millisecond with a fixed deck.
 *
 * ## Why this isn't the Roulette table with different art
 *
 * Roulette is simultaneous: everyone bets, one wheel resolves everyone at
 * once, and no player can affect another's result. Blackjack is turn-based,
 * which adds three things that table has no concept of:
 *
 * 1. **A turn order, with a clock.** One seat acts at a time and everyone
 *    else waits, so a player who walks away must not freeze the table -
 *    hence TURN_MS and the auto-stand below.
 * 2. **Hidden state that must stay hidden.** The dealer's hole card cannot
 *    be in any payload a client receives before the dealer plays. That is
 *    the same constraint that forced the solo game to be stateful rather
 *    than one bet-and-resolve endpoint (see games/blackjack.ts's header).
 * 3. **Per-seat outcomes.** Every seat is playing its own hand against a
 *    shared dealer, so a round has one result per player rather than one
 *    result full stop.
 *
 * ## The money rules, which match Roulette's exactly
 *
 * Nothing here writes to the ledger and no bet or action arrives over a
 * WebSocket. Bets and hit/stand both come in over the authenticated HTTP
 * API; this module records them and computes the result. A seat's whole
 * round - the wager leg and the payout leg - settles in ONE transaction
 * when the hand ends, so a process restart mid-round costs nobody their
 * stake. See rouletteTable.ts's header for the full reasoning; it applies
 * here unchanged.
 *
 * ## Payouts
 *
 * Win 2x, push 1x, lose 0 - deliberately the same paytable as the solo
 * game (games/blackjack.ts's blackjackPayoutMultiplier), including for a
 * natural. Real blackjack pays a natural 3:2, but the solo game here does
 * not, and having the same hand pay differently on two screens of the same
 * product would be a worse surprise than the missing bonus. Change both
 * together or neither.
 */

import { randomUUID } from "node:crypto";
import { handValue, buildShuffledDeck, blackjackPayoutMultiplier } from "../games/blackjack";
import { BET_MAX, BET_MIN } from "../games/shared";
import {
  BlackjackOutcomeName,
  BlackjackPhase,
  BlackjackSeat,
  BlackjackSnapshot
} from "./protocol";

/** How long players have to get a bet down and take a seat. */
export const BETTING_MS = 15_000;
/** A beat for the deal animation before the first player has to act. */
export const DEALING_MS = 2_000;
/** How long one seat has to hit or stand before the table stands for them. */
export const TURN_MS = 12_000;
/** The dealer drawing out. */
export const DEALER_MS = 3_000;
/** How long results stay up before the next round opens. */
export const PAYOUT_MS = 6_000;

/** Seats at the table. Beyond this a bet is refused rather than the round becoming unreadable. */
export const MAX_SEATS = 5;

/**
 * Worst case for one round, used to detect a catastrophic stall (see
 * advance()). Every seat could take a full turn.
 */
export const MAX_CYCLE_MS = BETTING_MS + DEALING_MS + TURN_MS * MAX_SEATS + DEALER_MS + PAYOUT_MS;

export type PlaceBetOutcome =
  | { ok: true; snapshot: BlackjackSnapshot }
  | { ok: false; reason: "TABLE_CLOSED" | "BETTING_CLOSED" | "ALREADY_SEATED" | "TABLE_FULL" | "INVALID_AMOUNT" };

export type ActionOutcome =
  | { ok: true; snapshot: BlackjackSnapshot }
  | { ok: false; reason: "TABLE_CLOSED" | "NOT_ACTING" | "NOT_YOUR_TURN" | "HAND_FINISHED" };

export type BlackjackAction = "hit" | "stand";

/**
 * What `advance()` says happened. `settle` is emitted exactly once per
 * round; the caller turns it into ledger transactions.
 */
export type BlackjackEvent =
  | { kind: "phase"; snapshot: BlackjackSnapshot }
  | { kind: "settle"; roundId: string; seats: BlackjackSeat[] };

interface Seat {
  userId: string;
  username: string;
  bet: number;
  hand: number[];
  status: "playing" | "stood" | "busted" | "blackjack";
  outcome: BlackjackOutcomeName | null;
  payout: number;
  voided?: boolean;
}

interface Round {
  id: string;
  phase: BlackjackPhase;
  phaseEndsAt: number;
  seats: Seat[];
  deck: number[];
  dealerHand: number[];
  /** Index into `seats` of whoever is acting; -1 outside the `acting` phase. */
  actingIndex: number;
  /** Set once the dealer has drawn and outcomes are computed, so a hand can never be resolved (or paid) twice. */
  dealerPlayed: boolean;
}

export class BlackjackTable {
  private round: Round | null = null;
  private readonly makeDeck: () => number[];
  private readonly seatListeners = new Set<(roundId: string, seat: BlackjackSeat) => void>();

  /** `makeDeck` is injectable so tests can pin the cards. Production uses the same CSPRNG-shuffled shoe the solo game does. */
  constructor(makeDeck: () => number[] = buildShuffledDeck) {
    this.makeDeck = makeDeck;
  }

  get running(): boolean {
    return this.round !== null;
  }

  start(now = Date.now()): BlackjackSnapshot {
    this.round = this.newRound(now);
    return this.snapshot(now);
  }

  /** Closes the table. Open bets are dropped - they were never debited, so nothing is owed. */
  stop(): void {
    this.round = null;
  }

  /** Subscribes to seats being taken, so the table can be broadcast live rather than only at phase changes. */
  onSeat(listener: (roundId: string, seat: BlackjackSeat) => void): () => void {
    this.seatListeners.add(listener);
    return () => {
      this.seatListeners.delete(listener);
    };
  }

  /**
   * Takes a seat for this round by putting a bet down.
   *
   * Does NOT check the player's balance - that is the HTTP route's job,
   * because it is the side with a database. Keeping this module free of I/O
   * is what makes the round loop testable.
   */
  placeBet(
    userId: string,
    username: string,
    amount: number,
    now = Date.now()
  ): PlaceBetOutcome {
    const round = this.round;
    if (!round) return { ok: false, reason: "TABLE_CLOSED" };
    if (round.phase !== "betting") return { ok: false, reason: "BETTING_CLOSED" };
    if (!Number.isInteger(amount) || amount < BET_MIN || amount > BET_MAX) {
      return { ok: false, reason: "INVALID_AMOUNT" };
    }
    if (round.seats.some((s) => s.userId === userId)) return { ok: false, reason: "ALREADY_SEATED" };
    if (round.seats.length >= MAX_SEATS) return { ok: false, reason: "TABLE_FULL" };

    const seat: Seat = {
      userId,
      username,
      bet: amount,
      hand: [],
      status: "playing",
      outcome: null,
      payout: 0
    };
    round.seats.push(seat);

    const wire = toWireSeat(seat);
    for (const listener of [...this.seatListeners]) {
      try {
        listener(round.id, wire);
      } catch (err) {
        // A broken broadcaster must not fail the bet - it is already
        // accepted, and the next phase change re-sends the whole table.
        console.error("blackjack table: seat listener threw", err);
      }
    }

    return { ok: true, snapshot: this.snapshot(now) };
  }

  /**
   * Hit or stand for the seat whose turn it is.
   *
   * Turn ownership is enforced here rather than trusted from the caller:
   * this is the one place a player could otherwise act on someone else's
   * hand, which would be cheating that costs another player real Gold
   * Coins.
   */
  act(userId: string, action: BlackjackAction, now = Date.now()): ActionOutcome {
    const round = this.round;
    if (!round) return { ok: false, reason: "TABLE_CLOSED" };
    if (round.phase !== "acting") return { ok: false, reason: "NOT_ACTING" };

    const seat = round.seats[round.actingIndex];
    if (!seat || seat.userId !== userId) return { ok: false, reason: "NOT_YOUR_TURN" };
    if (seat.status !== "playing") return { ok: false, reason: "HAND_FINISHED" };

    if (action === "hit") {
      seat.hand.push(this.draw(round));
      if (handValue(seat.hand) > 21) {
        seat.status = "busted";
        this.advanceTurn(round, now);
      } else {
        // Still their turn, but the clock restarts - taking a card is a
        // sign of life, and a player thinking about a third card shouldn't
        // be timed out on the first card's clock.
        round.phaseEndsAt = now + TURN_MS;
      }
    } else {
      seat.status = "stood";
      this.advanceTurn(round, now);
    }

    return { ok: true, snapshot: this.snapshot(now) };
  }

  /**
   * Drives the round loop. Called from the realtime tick, so this table
   * needs no timer of its own.
   */
  advance(now = Date.now()): BlackjackEvent[] {
    const events: BlackjackEvent[] = [];
    if (!this.round) return events;

    // More than a whole round behind: the process was blocked for a long
    // time. Replaying the missed phases would deal hands nobody could act
    // on, so start fresh. Safe to discard whatever was open - bets are not
    // debited until settlement, so a dropped round costs nobody anything.
    if (now - this.round.phaseEndsAt > MAX_CYCLE_MS) {
      this.round = this.newRound(now);
      events.push({ kind: "phase", snapshot: this.snapshot(now) });
      return events;
    }

    while (this.round && now >= this.round.phaseEndsAt) {
      const round = this.round;
      // Timed from when the last phase was DUE to end, not from `now`, so a
      // late tick doesn't stretch the round or accumulate drift.
      const dueAt = round.phaseEndsAt;

      switch (round.phase) {
        case "betting": {
          if (round.seats.length === 0) {
            // Nobody sat down. Open a fresh betting round rather than
            // dealing to an empty table.
            this.round = this.newRound(dueAt);
            events.push({ kind: "phase", snapshot: this.snapshot(now) });
            break;
          }
          this.deal(round);
          round.phase = "dealing";
          round.phaseEndsAt = dueAt + DEALING_MS;
          events.push({ kind: "phase", snapshot: this.snapshot(now) });
          break;
        }

        case "dealing": {
          round.actingIndex = -1;
          // Every seat may have been dealt a natural, in which case this
          // moves straight to the dealer - handled by the `dealer` case
          // below on the next pass of this same loop.
          this.advanceTurn(round, dueAt);
          events.push({ kind: "phase", snapshot: this.snapshot(now) });
          break;
        }

        case "acting": {
          // The clock ran out on whoever was acting. Standing for them is
          // the least damaging default: it never busts a hand they might
          // have won with, and it keeps everyone else's round moving.
          const seat = round.seats[round.actingIndex];
          if (seat && seat.status === "playing") seat.status = "stood";
          this.advanceTurn(round, dueAt);
          events.push({ kind: "phase", snapshot: this.snapshot(now) });
          break;
        }

        case "dealer": {
          // The dealer's turn arrives here from two directions: the acting
          // clock running out (above), and the last player standing via
          // act(), which is OUTSIDE this loop. Doing the draw here rather
          // than at either call site is what makes both paths identical -
          // an earlier version ran the dealer only on the timeout path, so
          // a table where everyone stood promptly never resolved at all.
          if (!round.dealerPlayed) {
            this.runDealer(round);
            round.dealerPlayed = true;
            round.phaseEndsAt = dueAt + DEALER_MS;
            // Phase first, so every screen sees the dealer's hand turn over
            // before the ledger is touched.
            events.push({ kind: "phase", snapshot: this.snapshot(now) });
            events.push({ kind: "settle", roundId: round.id, seats: round.seats.map(toWireSeat) });
            break;
          }

          round.phase = "payout";
          round.phaseEndsAt = dueAt + PAYOUT_MS;
          events.push({ kind: "phase", snapshot: this.snapshot(now) });
          break;
        }

        case "payout": {
          this.round = this.newRound(dueAt);
          events.push({ kind: "phase", snapshot: this.snapshot(now) });
          break;
        }
      }
    }

    return events;
  }

  snapshot(now = Date.now()): BlackjackSnapshot {
    const round = this.round;
    if (!round) {
      return {
        roundId: "",
        phase: "betting",
        msRemaining: 0,
        seats: [],
        activeUserId: null,
        dealerUpCard: null,
        dealerHand: null,
        dealerTotal: null
      };
    }

    // Keyed off the dealer having actually DRAWN, not off the phase name.
    // The last player standing flips the phase to `dealer` before the draw
    // happens, and a phase-based check would reveal the hole card in that
    // gap - to whoever is still acting, if the turn order ever changes.
    const revealed = round.dealerPlayed;

    return {
      roundId: round.id,
      phase: round.phase,
      msRemaining: Math.max(0, round.phaseEndsAt - now),
      seats: round.seats.map(toWireSeat),
      activeUserId:
        round.phase === "acting" ? round.seats[round.actingIndex]?.userId ?? null : null,
      dealerUpCard: round.dealerHand.length > 0 ? round.dealerHand[0] : null,
      dealerHand: revealed ? [...round.dealerHand] : null,
      dealerTotal: revealed ? handValue(round.dealerHand) : null
    };
  }

  /** Marks seats as voided when the ledger refused their wager, so the broadcast tells the truth. */
  markVoided(roundId: string, userIds: string[]): void {
    const round = this.round;
    if (!round || round.id !== roundId) return;
    const voided = new Set(userIds);
    for (const seat of round.seats) {
      if (voided.has(seat.userId)) {
        seat.voided = true;
        seat.outcome = "lose";
        seat.payout = 0;
      }
    }
  }

  /** Everyone seated on the current round - used to decide who a broadcast concerns. */
  seatedUserIds(): string[] {
    return this.round ? this.round.seats.map((s) => s.userId) : [];
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private deal(round: Round): void {
    // Two cards each, players first then the dealer, the way it is dealt at
    // a real table. Order matters only for which card lands where, but
    // matching the physical deal keeps the client's animation honest.
    for (let pass = 0; pass < 2; pass++) {
      for (const seat of round.seats) seat.hand.push(this.draw(round));
      round.dealerHand.push(this.draw(round));
    }

    for (const seat of round.seats) {
      // A natural stands automatically - there is no decision to make on 21.
      if (handValue(seat.hand) === 21) seat.status = "blackjack";
    }
  }

  /**
   * Moves to the next seat that still has a decision to make, or to the
   * dealer if none do.
   */
  private advanceTurn(round: Round, from: number): void {
    for (let i = round.actingIndex + 1; i < round.seats.length; i++) {
      if (round.seats[i].status === "playing") {
        round.actingIndex = i;
        round.phase = "acting";
        round.phaseEndsAt = from + TURN_MS;
        return;
      }
    }

    round.actingIndex = -1;
    round.phase = "dealer";
    // Due immediately, so the next advance() plays the dealer out. This is
    // what lets act() hand off to the loop without needing to emit events
    // of its own.
    round.phaseEndsAt = from;
  }

  /** Plays the dealer out and resolves every seat. Emits nothing - advance() owns the events. */
  private runDealer(round: Round): void {
    // The dealer only draws if at least one hand can still be beaten -
    // exactly like a real table, where the dealer doesn't play out against
    // a board of busts. Saves nothing mechanically, but it stops the client
    // showing a pointless draw.
    const live = round.seats.some((s) => s.status === "stood" || s.status === "blackjack");
    if (live) {
      while (handValue(round.dealerHand) < 17) round.dealerHand.push(this.draw(round));
    }

    const dealerTotal = handValue(round.dealerHand);
    for (const seat of round.seats) {
      const total = handValue(seat.hand);
      let outcome: BlackjackOutcomeName;
      if (seat.status === "busted") outcome = "lose";
      else if (dealerTotal > 21 || total > dealerTotal) outcome = "win";
      else if (total === dealerTotal) outcome = "push";
      else outcome = "lose";

      seat.outcome = outcome;
      seat.payout = Math.round(seat.bet * blackjackPayoutMultiplier(outcome));
    }
  }

  /** Draws one card, reshuffling if the shoe empties mid-hand - mirrors the solo game's own fallback. */
  private draw(round: Round): number {
    let card = round.deck.pop();
    if (card === undefined) {
      round.deck = this.makeDeck();
      card = round.deck.pop()!;
    }
    return card;
  }

  private newRound(now: number): Round {
    return {
      id: randomUUID(),
      phase: "betting",
      phaseEndsAt: now + BETTING_MS,
      seats: [],
      deck: this.makeDeck(),
      dealerHand: [],
      actingIndex: -1,
      dealerPlayed: false
    };
  }
}

function toWireSeat(seat: Seat): BlackjackSeat {
  return {
    userId: seat.userId,
    username: seat.username,
    bet: seat.bet,
    hand: [...seat.hand],
    total: handValue(seat.hand),
    status: seat.status,
    outcome: seat.outcome,
    payout: seat.payout,
    ...(seat.voided ? { voided: true } : {})
  };
}
