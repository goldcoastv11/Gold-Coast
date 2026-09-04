/**
 * Unit tests for the live Blackjack round loop
 * (src/realtime/blackjackTable.ts).
 *
 * Driven with a fake clock and a STACKED deck, which is why that module has
 * no timers, no database and no sockets in it. A turn-based table that pays
 * real Gold Coins and runs unattended forever is not something to verify by
 * playing a few hands by hand.
 *
 * Deck note: the table draws with `pop()`, so the LAST element is dealt
 * first. `deckDealing([...])` below takes cards in dealing order and
 * reverses them, so each test reads as the order cards actually come out.
 */

import { describe, expect, it } from "vitest";
import {
  BETTING_MS,
  BlackjackEvent,
  BlackjackTable,
  DEALER_MS,
  DEALING_MS,
  MAX_SEATS,
  PAYOUT_MS,
  TURN_MS
} from "../src/realtime/blackjackTable";
import { BET_MAX, BET_MIN } from "../src/games/shared";

/**
 * Cards in the order they should be DEALT. The table draws with `pop()`, so
 * the first card dealt has to be last in the array - hence the reverse.
 * Padded underneath so a hand can never run the shoe dry mid-test.
 */
function deckDealing(cards: number[]): number[] {
  const padding = Array.from({ length: 40 }, () => 5);
  return [...padding, ...[...cards].reverse()];
}

function tableWith(cards: number[]) {
  return new BlackjackTable(() => deckDealing(cards));
}

function phases(events: BlackjackEvent[]): string[] {
  return events
    .filter((e) => e.kind === "phase")
    .map((e) => (e as Extract<BlackjackEvent, { kind: "phase" }>).snapshot.phase);
}

function settlements(events: BlackjackEvent[]) {
  return events.filter((e): e is Extract<BlackjackEvent, { kind: "settle" }> => e.kind === "settle");
}

/** Deals alice 10+10=20 and the dealer 9+9=18, with the next cards available for hits. */
const ALICE_20_DEALER_18 = [10, 9, 10, 9, 5, 5, 5, 5];

describe("the round loop", () => {
  it("refuses bets until the table is started", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    expect(table.running).toBe(false);
    expect(table.placeBet("u1", "alice", 20, 0)).toEqual({ ok: false, reason: "TABLE_CLOSED" });
  });

  it("opens in betting with an empty table", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    const snapshot = table.start(0);

    expect(snapshot.phase).toBe("betting");
    expect(snapshot.msRemaining).toBe(BETTING_MS);
    expect(snapshot.seats).toEqual([]);
    expect(snapshot.dealerUpCard).toBeNull();
  });

  it("opens a fresh betting round rather than dealing to an empty table", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    const first = table.start(0).roundId;

    const events = table.advance(BETTING_MS);

    // No hand is dealt, no cards are burned, and it is a NEW round - so a
    // player arriving a moment later gets a full betting window.
    expect(phases(events)).toEqual(["betting"]);
    expect(table.snapshot(BETTING_MS).roundId).not.toBe(first);
    expect(table.snapshot(BETTING_MS).dealerUpCard).toBeNull();
  });

  it("deals to whoever sat down, then runs betting -> dealing -> acting", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);

    expect(phases(table.advance(BETTING_MS))).toEqual(["dealing"]);

    const dealt = table.snapshot(BETTING_MS);
    expect(dealt.seats[0].hand).toHaveLength(2);
    expect(dealt.seats[0].total).toBe(20);
    // The up-card is visible from the deal; the hole card is not.
    expect(dealt.dealerUpCard).toBe(9);
    expect(dealt.dealerHand).toBeNull();

    expect(phases(table.advance(BETTING_MS + DEALING_MS))).toEqual(["acting"]);
    expect(table.snapshot(BETTING_MS + DEALING_MS).activeUserId).toBe("u1");
  });

  it("never leaks the dealer's hole card before the dealer plays", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    table.advance(BETTING_MS + DEALING_MS);

    // This is the constraint that forced the solo game to be stateful too
    // (see games/blackjack.ts) - a client must not be able to read the hole
    // card out of a payload and play perfectly against it.
    const acting = table.snapshot(BETTING_MS + DEALING_MS);
    expect(acting.phase).toBe("acting");
    expect(acting.dealerHand).toBeNull();
    expect(acting.dealerTotal).toBeNull();
    expect(JSON.stringify(acting)).not.toContain('"dealerHand":[');
  });
});

describe("taking a seat", () => {
  it("accepts a bet during betting and seats the player", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);

    const outcome = table.placeBet("u1", "alice", 25, 100);

    expect(outcome.ok).toBe(true);
    expect(table.snapshot(100).seats).toMatchObject([
      { userId: "u1", username: "alice", bet: 25, status: "playing" }
    ]);
  });

  it("refuses a second seat for the same player on one hand", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    table.placeBet("u1", "alice", 25, 0);

    expect(table.placeBet("u1", "alice", 25, 0)).toEqual({ ok: false, reason: "ALREADY_SEATED" });
    expect(table.snapshot(0).seats).toHaveLength(1);
  });

  it("refuses a seat once the table is full", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    for (let i = 0; i < MAX_SEATS; i++) {
      expect(table.placeBet(`u${i}`, `p${i}`, 20, 0).ok).toBe(true);
    }

    expect(table.placeBet("late", "late", 20, 0)).toEqual({ ok: false, reason: "TABLE_FULL" });
  });

  it("refuses a seat once betting has closed", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    table.advance(BETTING_MS);

    // Cards are already out. Joining now would be betting on a known board.
    expect(table.placeBet("u2", "bob", 20, BETTING_MS + 1)).toEqual({
      ok: false,
      reason: "BETTING_CLOSED"
    });
  });

  it("enforces the same bet bounds as every other game", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);

    expect(table.placeBet("a", "a", BET_MIN - 1, 0).ok).toBe(false);
    expect(table.placeBet("b", "b", BET_MAX + 1, 0).ok).toBe(false);
    expect(table.placeBet("c", "c", 12.5, 0).ok).toBe(false);
    expect(table.placeBet("d", "d", BET_MIN, 0).ok).toBe(true);
  });
});

describe("taking turns", () => {
  /** Two players: alice 10+10=20, bob 6+6=12; dealer 9+9=18. */
  const TWO_PLAYERS = [10, 6, 9, 10, 6, 9, 5, 5, 5, 5];

  function twoSeated() {
    const table = tableWith(TWO_PLAYERS);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    table.placeBet("u2", "bob", 20, 0);
    table.advance(BETTING_MS + DEALING_MS);
    return table;
  }

  it("only the player whose turn it is may act", () => {
    const table = twoSeated();
    const now = BETTING_MS + DEALING_MS;

    expect(table.snapshot(now).activeUserId).toBe("u1");
    // The whole reason turn ownership is enforced inside the table: acting
    // on someone else's hand costs THEM real Gold Coins.
    expect(table.act("u2", "hit", now)).toEqual({ ok: false, reason: "NOT_YOUR_TURN" });
  });

  it("standing passes the turn to the next seat", () => {
    const table = twoSeated();
    const now = BETTING_MS + DEALING_MS;

    table.act("u1", "stand", now);

    expect(table.snapshot(now).activeUserId).toBe("u2");
    expect(table.snapshot(now).seats[0].status).toBe("stood");
  });

  it("busting ends that hand and passes the turn", () => {
    // alice 10+10, then hits into a 10 for 30.
    const table = tableWith([10, 6, 9, 10, 6, 9, 10]);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    table.placeBet("u2", "bob", 20, 0);
    const now = BETTING_MS + DEALING_MS;
    table.advance(now);

    table.act("u1", "hit", now);

    expect(table.snapshot(now).seats[0].status).toBe("busted");
    expect(table.snapshot(now).activeUserId).toBe("u2");
  });

  it("hitting without busting keeps the turn and restarts that seat's clock", () => {
    // bob draws a 2 onto 12 for 14 - still his decision.
    const table = tableWith([10, 6, 9, 10, 6, 9, 2]);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    table.placeBet("u2", "bob", 20, 0);
    const dealt = BETTING_MS + DEALING_MS;
    table.advance(dealt);
    table.act("u1", "stand", dealt);

    const midTurn = dealt + 5_000;
    table.act("u2", "hit", midTurn);

    const snapshot = table.snapshot(midTurn);
    expect(snapshot.activeUserId).toBe("u2");
    expect(snapshot.seats[1].total).toBe(14);
    // A player thinking about a third card shouldn't be timed out on the
    // first card's clock.
    expect(snapshot.msRemaining).toBe(TURN_MS);
  });

  it("stands for a player who runs out of time, rather than freezing the table", () => {
    const table = twoSeated();
    const dealt = BETTING_MS + DEALING_MS;

    const events = table.advance(dealt + TURN_MS);

    // Standing is the least damaging default - it never busts a hand they
    // might have won with, and everyone else's round keeps moving.
    expect(table.snapshot(dealt + TURN_MS).seats[0].status).toBe("stood");
    expect(phases(events)).toContain("acting");
    expect(table.snapshot(dealt + TURN_MS).activeUserId).toBe("u2");
  });

  it("refuses an action outside the acting phase", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);

    expect(table.act("u1", "hit", 0)).toEqual({ ok: false, reason: "NOT_ACTING" });
  });

  it("a natural 21 stands automatically and skips straight past that seat", () => {
    // alice A+K = 21 natural; bob 6+6 = 12; dealer 9+9.
    const table = tableWith([1, 6, 9, 13, 6, 9, 5, 5]);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    table.placeBet("u2", "bob", 20, 0);
    const dealt = BETTING_MS + DEALING_MS;
    table.advance(dealt);

    expect(table.snapshot(dealt).seats[0].status).toBe("blackjack");
    // There is no decision to make on 21, so the turn is bob's immediately.
    expect(table.snapshot(dealt).activeUserId).toBe("u2");
  });
});

describe("settlement", () => {
  it("pays a winner 2x, matching the solo game's paytable", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    const dealt = BETTING_MS + DEALING_MS;
    table.advance(dealt);
    table.act("u1", "stand", dealt);

    // 20 beats the dealer's 18.
    const settle = settlements(table.advance(dealt + DEALER_MS))[0] ?? lastSettle(table, dealt);
    expect(settle.seats[0]).toMatchObject({ outcome: "win", payout: 40 });
  });

  it("returns the stake on a push", () => {
    // alice 10+9=19, dealer 10+9=19.
    const table = tableWith([10, 10, 9, 9]);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    const dealt = BETTING_MS + DEALING_MS;
    table.advance(dealt);
    table.act("u1", "stand", dealt);

    const settle = lastSettle(table, dealt);
    expect(settle.seats[0]).toMatchObject({ outcome: "push", payout: 20 });
  });

  it("pays nothing on a bust, whatever the dealer does", () => {
    const table = tableWith([10, 9, 10, 9, 10]);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    const dealt = BETTING_MS + DEALING_MS;
    table.advance(dealt);
    table.act("u1", "hit", dealt); // 20 + 10 = 30

    const settle = lastSettle(table, dealt);
    expect(settle.seats[0]).toMatchObject({ status: "busted", outcome: "lose", payout: 0 });
  });

  it("resolves each seat against the same dealer hand independently", () => {
    // alice 20, bob 12 (stands), dealer 18.
    const table = tableWith([10, 6, 9, 10, 6, 9, 5, 5]);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    table.placeBet("u2", "bob", 30, 0);
    const dealt = BETTING_MS + DEALING_MS;
    table.advance(dealt);
    table.act("u1", "stand", dealt);
    table.act("u2", "stand", dealt);

    const settle = lastSettle(table, dealt);
    expect(settle.seats.find((s) => s.userId === "u1")).toMatchObject({ outcome: "win", payout: 40 });
    expect(settle.seats.find((s) => s.userId === "u2")).toMatchObject({ outcome: "lose", payout: 0 });
  });

  it("emits settlement exactly once", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    const dealt = BETTING_MS + DEALING_MS;
    table.advance(dealt);
    table.act("u1", "stand", dealt);

    // Paying a hand twice is the worst bug this loop could have, and
    // advance() runs ten times a second forever.
    const first = settlements(table.advance(dealt + 1)).length;
    const rest =
      settlements(table.advance(dealt + DEALER_MS)).length +
      settlements(table.advance(dealt + DEALER_MS + PAYOUT_MS)).length;
    expect(first + rest).toBe(1);
  });

  it("keeps the hole card hidden in the gap between the last stand and the dealer drawing", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    const dealt = BETTING_MS + DEALING_MS;
    table.advance(dealt);

    table.act("u1", "stand", dealt);

    // Standing flips the phase to `dealer` immediately, but the draw
    // happens on the next tick. A phase-based reveal check would leak the
    // hole card in exactly this window.
    const between = table.snapshot(dealt);
    expect(between.phase).toBe("dealer");
    expect(between.dealerHand).toBeNull();
  });

  it("reveals the dealer's full hand once the dealer actually plays", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    const dealt = BETTING_MS + DEALING_MS;
    table.advance(dealt);
    table.act("u1", "stand", dealt);

    table.advance(dealt + 1);

    const snapshot = table.snapshot(dealt + 1);
    expect(snapshot.dealerHand).toEqual([9, 9]);
    expect(snapshot.dealerTotal).toBe(18);
  });

  it("comes back round to a fresh betting round", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    const dealt = BETTING_MS + DEALING_MS;
    table.advance(dealt);
    table.act("u1", "stand", dealt);
    table.advance(dealt + DEALER_MS + PAYOUT_MS);

    const snapshot = table.snapshot(dealt + DEALER_MS + PAYOUT_MS);
    expect(snapshot.phase).toBe("betting");
    expect(snapshot.seats).toEqual([]);
  });

  it("markVoided zeroes one seat without touching the others", () => {
    const table = tableWith([10, 10, 9, 10, 10, 9, 5, 5]);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);
    table.placeBet("u2", "bob", 20, 0);
    const dealt = BETTING_MS + DEALING_MS;
    table.advance(dealt);
    table.act("u1", "stand", dealt);
    table.act("u2", "stand", dealt);
    const roundId = table.snapshot(dealt).roundId;

    table.markVoided(roundId, ["u1"]);

    const seats = table.snapshot(dealt).seats;
    expect(seats.find((s) => s.userId === "u1")).toMatchObject({ voided: true, payout: 0 });
    expect(seats.find((s) => s.userId === "u2")?.voided).toBeUndefined();
  });

  it("restarts cleanly after a long stall instead of replaying missed hands", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);

    // The process was blocked for ages. Dealing hands nobody could act on
    // would be worse than starting over; nothing was debited, so nothing is
    // owed.
    const events = table.advance(60 * 60_000);

    expect(phases(events)).toEqual(["betting"]);
    expect(settlements(events)).toEqual([]);
    expect(table.snapshot(60 * 60_000).seats).toEqual([]);
  });

  it("stop() closes the table and drops the open hand", () => {
    const table = tableWith(ALICE_20_DEALER_18);
    table.start(0);
    table.placeBet("u1", "alice", 20, 0);

    table.stop();

    expect(table.running).toBe(false);
    expect(table.snapshot().seats).toEqual([]);
    expect(table.advance(BETTING_MS)).toEqual([]);
  });
});

/** Runs the table forward until it emits its settle event, and returns it. */
function lastSettle(table: BlackjackTable, from: number) {
  for (const at of [from + 1, from + DEALER_MS, from + DEALER_MS + PAYOUT_MS]) {
    const found = settlements(table.advance(at))[0];
    if (found) return found;
  }
  throw new Error("no settle event was emitted");
}
