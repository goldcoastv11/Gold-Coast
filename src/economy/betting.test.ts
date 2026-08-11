import { describe, expect, it } from "vitest";
import { createLedger, getBalance } from "./ledger";
import { createPlaythroughState, isPlaythroughCleared, remainingPlaythrough } from "./playthrough";
import { placeBet, resolveBet } from "./betting";

describe("placeBet (#20)", () => {
  it("debits GC and records a WAGER_GC transaction", () => {
    const ledger = createLedger(100, 0);
    const playthrough = createPlaythroughState();

    const outcome = placeBet(ledger, playthrough, "GC", 30);

    expect(outcome.ok).toBe(true);
    expect(getBalance(ledger, "GC")).toBe(70);
    if (outcome.ok) {
      expect(outcome.transaction.type).toBe("WAGER_GC");
      expect(outcome.transaction.amount).toBe(-30);
    }
  });

  it("debits SC, records WAGER_SC, and counts toward the playthrough requirement", () => {
    const ledger = createLedger(0, 100);
    const playthrough = createPlaythroughState();
    playthrough.required = 50; // e.g. from a prior signup/package bonus

    const outcome = placeBet(ledger, playthrough, "SC", 20);

    expect(outcome.ok).toBe(true);
    expect(getBalance(ledger, "SC")).toBe(80);
    expect(playthrough.wagered).toBe(20);
    expect(remainingPlaythrough(playthrough)).toBe(30);
    if (outcome.ok) expect(outcome.transaction.type).toBe("WAGER_SC");
  });

  it("a GC bet does NOT count toward the SC playthrough requirement", () => {
    const ledger = createLedger(100, 100);
    const playthrough = createPlaythroughState();
    playthrough.required = 50;

    placeBet(ledger, playthrough, "GC", 30);

    expect(playthrough.wagered).toBe(0);
  });

  it("rejects a bet larger than the balance in that currency, leaving state untouched", () => {
    const ledger = createLedger(10, 500);
    const playthrough = createPlaythroughState();

    const outcome = placeBet(ledger, playthrough, "GC", 11);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("INSUFFICIENT_BALANCE");
    expect(getBalance(ledger, "GC")).toBe(10);
    expect(getBalance(ledger, "SC")).toBe(500); // other currency untouched
  });

  it("rejects a zero, negative, or non-finite bet amount without touching the ledger", () => {
    const ledger = createLedger(100, 100);
    const playthrough = createPlaythroughState();

    for (const bad of [0, -5, NaN, Infinity]) {
      const outcome = placeBet(ledger, playthrough, "GC", bad);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("INVALID_AMOUNT");
    }
    expect(getBalance(ledger, "GC")).toBe(100);
  });

  it("allows wagering SC that hasn't cleared playthrough yet - wagering is how it clears, not gated by it", () => {
    const ledger = createLedger(0, 25);
    const playthrough = createPlaythroughState();
    playthrough.required = 25; // freshly-granted bonus SC, not yet playthrough-cleared
    expect(isPlaythroughCleared(playthrough)).toBe(false);

    const outcome = placeBet(ledger, playthrough, "SC", 25);
    expect(outcome.ok).toBe(true); // must NOT be blocked by the incomplete playthrough
    expect(isPlaythroughCleared(playthrough)).toBe(true); // and this bet is what clears it
  });
});

describe("resolveBet (#20)", () => {
  it("credits the gross payout and records PAYOUT_GC/PAYOUT_SC", () => {
    const gc = createLedger(0, 0);
    const gcOutcome = resolveBet(gc, "GC", 40);
    expect(getBalance(gc, "GC")).toBe(40);
    expect(gcOutcome.transaction?.type).toBe("PAYOUT_GC");

    const sc = createLedger(0, 0);
    const scOutcome = resolveBet(sc, "SC", 15);
    expect(getBalance(sc, "SC")).toBe(15);
    expect(scOutcome.transaction?.type).toBe("PAYOUT_SC");
  });

  it("treats a 0 payout (total loss) as valid, with no transaction recorded", () => {
    const ledger = createLedger(0, 0);
    const outcome = resolveBet(ledger, "GC", 0);
    expect(outcome.ok).toBe(true);
    expect(outcome.payout).toBe(0);
    expect(outcome.transaction).toBeNull();
    expect(ledger.transactions).toHaveLength(0);
  });

  it("throws on a negative or non-finite payout (a caller bug, not a game outcome)", () => {
    const ledger = createLedger(0, 0);
    expect(() => resolveBet(ledger, "GC", -1)).toThrow();
    expect(() => resolveBet(ledger, "GC", NaN)).toThrow();
  });

  it("does not itself touch playthrough - only wagering (placeBet) does", () => {
    const ledger = createLedger(0, 100);
    const playthrough = createPlaythroughState();
    playthrough.required = 50;
    resolveBet(ledger, "SC", 30); // a big SC win, but never wagered via placeBet
    expect(playthrough.wagered).toBe(0);
  });
});

describe("placeBet + resolveBet round trip", () => {
  it("a full GC round: bet debits, win credits gross payout", () => {
    const ledger = createLedger(1000, 0);
    const playthrough = createPlaythroughState();

    const bet = placeBet(ledger, playthrough, "GC", 100);
    expect(bet.ok).toBe(true);
    expect(getBalance(ledger, "GC")).toBe(900);

    resolveBet(ledger, "GC", 250); // 2.5x win, gross payout
    expect(getBalance(ledger, "GC")).toBe(1150);
  });

  it("a full SC round that clears playthrough exactly, then a losing round changes nothing further for playthrough", () => {
    const ledger = createLedger(0, 25);
    const playthrough = createPlaythroughState();
    playthrough.required = 25;

    const bet = placeBet(ledger, playthrough, "SC", 25);
    expect(bet.ok).toBe(true);
    resolveBet(ledger, "SC", 0); // lost the round entirely

    expect(isPlaythroughCleared(playthrough)).toBe(true);
    expect(getBalance(ledger, "SC")).toBe(0);
  });
});
