/**
 * Unit tests for the live Roulette table's round loop
 * (src/realtime/rouletteTable.ts).
 *
 * Driven with a fake clock and a pinned wheel, which is the whole reason
 * that module has no timers, no database and no sockets in it. This loop
 * runs unattended and forever and decides who gets paid; being able to push
 * a hundred rounds through it in a millisecond is the only practical way to
 * have any confidence in it.
 *
 * The route-level behaviour (auth, balance checks, the ledger) is covered
 * in rouletteTableRoute.test.ts against the real HTTP API.
 */

import { describe, expect, it } from "vitest";
import {
  BETTING_MS,
  PAYOUT_MS,
  RouletteTable,
  SPINNING_MS,
  TableEvent
} from "../src/realtime/rouletteTable";
import { BET_MAX, BET_MIN } from "../src/games/shared";

/** A wheel that always lands on `n`. 7 is red, 8 is black, 0 is green - see games/roulette.ts's colorOf. */
function tableLandingOn(n: number) {
  return new RouletteTable(() => n);
}

const RED = 7;
const BLACK = 8;
const GREEN = 0;

function phases(events: TableEvent[]): string[] {
  return events.filter((e) => e.kind === "phase").map((e) => (e as { snapshot: { phase: string } }).snapshot.phase);
}

function settlements(events: TableEvent[]) {
  return events.filter((e): e is Extract<TableEvent, { kind: "settle" }> => e.kind === "settle");
}

describe("the round loop", () => {
  it("refuses bets until the table is started", () => {
    const table = tableLandingOn(RED);
    expect(table.running).toBe(false);
    // If the realtime channel failed to attach, `start()` never ran. Taking
    // stakes for a wheel that will never spin is the one outcome that must
    // not be possible.
    expect(table.placeBet("u1", "alice", "red", 10, 0)).toEqual({
      ok: false,
      reason: "TABLE_CLOSED"
    });
  });

  it("opens in betting with a full countdown and no bets", () => {
    const table = tableLandingOn(RED);
    const snapshot = table.start(0);

    expect(snapshot.phase).toBe("betting");
    expect(snapshot.msRemaining).toBe(BETTING_MS);
    expect(snapshot.bets).toEqual([]);
    // Nothing to know yet - the wheel is not drawn until betting closes.
    expect(snapshot.number).toBeNull();
  });

  it("runs betting -> spinning -> payout -> a fresh betting round", () => {
    const table = tableLandingOn(RED);
    table.start(0);

    expect(phases(table.advance(BETTING_MS))).toEqual(["spinning"]);
    expect(phases(table.advance(BETTING_MS + SPINNING_MS))).toEqual(["payout"]);
    expect(phases(table.advance(BETTING_MS + SPINNING_MS + PAYOUT_MS))).toEqual(["betting"]);

    const snapshot = table.snapshot(BETTING_MS + SPINNING_MS + PAYOUT_MS);
    expect(snapshot.bets).toEqual([]);
    expect(snapshot.number).toBeNull();
  });

  it("does nothing while a phase still has time left", () => {
    const table = tableLandingOn(RED);
    table.start(0);
    expect(table.advance(BETTING_MS - 1)).toEqual([]);
  });

  it("catches up rather than falling a phase behind after a stall", () => {
    const table = tableLandingOn(RED);
    table.start(0);

    // A blocked event loop or a debugger pause. The table must not be left
    // stuck one phase behind for the rest of the process's life.
    const events = table.advance(BETTING_MS + SPINNING_MS + PAYOUT_MS);
    expect(phases(events)).toEqual(["spinning", "payout", "betting"]);
  });

  it("gives every round a distinct id", () => {
    const table = tableLandingOn(RED);
    const first = table.start(0).roundId;
    table.advance(BETTING_MS + SPINNING_MS + PAYOUT_MS);
    expect(table.snapshot().roundId).not.toBe(first);
  });
});

describe("placing bets", () => {
  it("accepts a bet during betting and shows it on the table", () => {
    const table = tableLandingOn(RED);
    table.start(0);

    const outcome = table.placeBet("u1", "alice", "red", 25, 100);
    expect(outcome.ok).toBe(true);
    expect(table.snapshot(100).bets).toEqual([
      { userId: "u1", username: "alice", choice: "red", amount: 25 }
    ]);
  });

  it("refuses a second bet from the same player on one round", () => {
    const table = tableLandingOn(RED);
    table.start(0);
    table.placeBet("u1", "alice", "red", 25, 100);

    expect(table.placeBet("u1", "alice", "black", 25, 200)).toEqual({
      ok: false,
      reason: "ALREADY_BET"
    });
    expect(table.snapshot(200).bets).toHaveLength(1);
  });

  it("lets the same player bet again on the NEXT round", () => {
    const table = tableLandingOn(RED);
    table.start(0);
    table.placeBet("u1", "alice", "red", 25, 100);

    const end = BETTING_MS + SPINNING_MS + PAYOUT_MS;
    table.advance(end);
    expect(table.placeBet("u1", "alice", "black", 25, end + 100).ok).toBe(true);
  });

  it("refuses a bet once betting has closed", () => {
    const table = tableLandingOn(RED);
    table.start(0);
    table.advance(BETTING_MS);

    // The wheel is already drawn at this point. A late bet would be a bet
    // placed on a known outcome.
    expect(table.placeBet("u1", "alice", "red", 25, BETTING_MS + 1)).toEqual({
      ok: false,
      reason: "BETTING_CLOSED"
    });
  });

  it("enforces the same bet bounds as every other game", () => {
    const table = tableLandingOn(RED);
    table.start(0);

    expect(table.placeBet("u1", "alice", "red", BET_MIN - 1, 0).ok).toBe(false);
    expect(table.placeBet("u2", "bob", "red", BET_MAX + 1, 0).ok).toBe(false);
    expect(table.placeBet("u3", "carol", "red", 12.5, 0).ok).toBe(false);
    expect(table.placeBet("u4", "dave", "red", BET_MIN, 0).ok).toBe(true);
    expect(table.placeBet("u5", "erin", "red", BET_MAX, 0).ok).toBe(true);
  });

  it("notifies bet listeners, and a throwing listener doesn't fail the bet", () => {
    const table = tableLandingOn(RED);
    table.start(0);

    const seen: string[] = [];
    table.onBet(() => {
      throw new Error("broadcaster bug");
    });
    const off = table.onBet((_roundId, bet) => seen.push(bet.username));

    expect(table.placeBet("u1", "alice", "red", 25, 0).ok).toBe(true);
    expect(seen).toEqual(["alice"]);

    off();
    table.placeBet("u2", "bob", "red", 25, 0);
    expect(seen).toEqual(["alice"]);
  });
});

describe("settlement", () => {
  it("pays 2x on a winning colour and nothing on a loser, in one settle event", () => {
    const table = tableLandingOn(RED);
    table.start(0);
    table.placeBet("u1", "alice", "red", 20, 0);
    table.placeBet("u2", "bob", "black", 20, 0);

    const [settle] = settlements(table.advance(BETTING_MS));
    expect(settle.number).toBe(RED);
    expect(settle.color).toBe("red");
    expect(settle.results).toEqual([
      { userId: "u1", username: "alice", choice: "red", amount: 20, won: true, payout: 40 },
      { userId: "u2", username: "bob", choice: "black", amount: 20, won: false, payout: 0 }
    ]);
  });

  it("pays green at 36x, matching the solo game's paytable", () => {
    const table = tableLandingOn(GREEN);
    table.start(0);
    table.placeBet("u1", "alice", "green", 10, 0);

    const [settle] = settlements(table.advance(BETTING_MS));
    // Must match games/roulette.ts's ROULETTE_PAYOUTS - the live table is
    // the same wheel, not a differently-priced one.
    expect(settle.results[0].payout).toBe(360);
  });

  it("emits no settle event for a round nobody bet on", () => {
    const table = tableLandingOn(BLACK);
    table.start(0);

    const events = table.advance(BETTING_MS);
    expect(settlements(events)).toEqual([]);
    // The wheel still spins, so watchers see a result.
    expect(phases(events)).toEqual(["spinning"]);
    expect(table.snapshot(BETTING_MS).number).toBe(BLACK);
  });

  it("emits settlement exactly once, even if advance is called repeatedly", () => {
    const table = tableLandingOn(RED);
    table.start(0);
    table.placeBet("u1", "alice", "red", 20, 0);

    // Paying a round twice is the worst bug this loop could have. The
    // realtime tick calls advance() ten times a second, forever.
    expect(settlements(table.advance(BETTING_MS))).toHaveLength(1);
    expect(settlements(table.advance(BETTING_MS + 1))).toHaveLength(0);
    expect(settlements(table.advance(BETTING_MS + SPINNING_MS))).toHaveLength(0);
  });

  it("shows the drawn number and per-player results in the snapshot while spinning", () => {
    const table = tableLandingOn(BLACK);
    table.start(0);
    table.placeBet("u1", "alice", "black", 20, 0);
    table.advance(BETTING_MS);

    const snapshot = table.snapshot(BETTING_MS);
    expect(snapshot.phase).toBe("spinning");
    expect(snapshot.number).toBe(BLACK);
    expect(snapshot.color).toBe("black");
    expect(snapshot.results?.[0].won).toBe(true);
  });

  it("markVoided zeroes a player's outcome without touching anyone else's", () => {
    const table = tableLandingOn(RED);
    table.start(0);
    table.placeBet("u1", "alice", "red", 20, 0);
    table.placeBet("u2", "bob", "red", 20, 0);
    table.advance(BETTING_MS);

    const roundId = table.snapshot(BETTING_MS).roundId;
    table.markVoided(roundId, ["u1"]);

    const results = table.snapshot(BETTING_MS).results!;
    expect(results.find((r) => r.userId === "u1")).toMatchObject({ voided: true, won: false, payout: 0 });
    expect(results.find((r) => r.userId === "u2")).toMatchObject({ won: true, payout: 40 });
  });

  it("markVoided for a stale round id does nothing", () => {
    const table = tableLandingOn(RED);
    table.start(0);
    table.placeBet("u1", "alice", "red", 20, 0);
    table.advance(BETTING_MS);

    // A settlement finishing after the table has already moved on must not
    // reach into whatever round is now open.
    table.markVoided("some-other-round", ["u1"]);
    expect(table.snapshot(BETTING_MS).results![0].voided).toBeUndefined();
  });

  it("stop() closes the table and drops the open round's bets", () => {
    const table = tableLandingOn(RED);
    table.start(0);
    table.placeBet("u1", "alice", "red", 20, 0);

    table.stop();

    // Nothing was ever debited, so nothing is owed - see rouletteTable.ts's
    // header on why settlement is atomic at spin time.
    expect(table.running).toBe(false);
    expect(table.snapshot().bets).toEqual([]);
    expect(table.advance(BETTING_MS)).toEqual([]);
  });
});
