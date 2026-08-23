import { describe, expect, it } from "vitest";
import { createLedger, getBalance } from "./ledger";
import { placeBet, resolveBet } from "./betting";

describe("placeBet (#20) - arcade token model, GC only", () => {
  it("debits GC and records a WAGER_GC transaction", () => {
    const ledger = createLedger(100, 0);

    const outcome = placeBet(ledger, 30);

    expect(outcome.ok).toBe(true);
    expect(getBalance(ledger, "GC")).toBe(70);
    if (outcome.ok) {
      expect(outcome.transaction.type).toBe("WAGER_GC");
      expect(outcome.transaction.amount).toBe(-30);
    }
  });

  it("rejects a bet larger than the GC balance, leaving state untouched", () => {
    const ledger = createLedger(10, 500);

    const outcome = placeBet(ledger, 11);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("INSUFFICIENT_BALANCE");
    expect(getBalance(ledger, "GC")).toBe(10);
    expect(getBalance(ledger, "TICKETS")).toBe(500); // other currency untouched
  });

  it("rejects a zero, negative, or non-finite bet amount without touching the ledger", () => {
    const ledger = createLedger(100, 100);

    for (const bad of [0, -5, NaN, Infinity]) {
      const outcome = placeBet(ledger, bad);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("INVALID_AMOUNT");
    }
    expect(getBalance(ledger, "GC")).toBe(100);
  });
});

describe("resolveBet (#20) - arcade token model, TICKETS only", () => {
  it("credits the payout and records GAME_WIN_TICKETS", () => {
    const ledger = createLedger(0, 0);
    const outcome = resolveBet(ledger, 40);
    expect(getBalance(ledger, "TICKETS")).toBe(40);
    expect(outcome.transaction?.type).toBe("GAME_WIN_TICKETS");
  });

  it("treats a 0 payout (total loss) as valid, with no transaction recorded", () => {
    const ledger = createLedger(0, 0);
    const outcome = resolveBet(ledger, 0);
    expect(outcome.ok).toBe(true);
    expect(outcome.payout).toBe(0);
    expect(outcome.transaction).toBeNull();
    expect(ledger.transactions).toHaveLength(0);
  });

  it("throws on a negative or non-finite payout (a caller bug, not a game outcome)", () => {
    const ledger = createLedger(0, 0);
    expect(() => resolveBet(ledger, -1)).toThrow();
    expect(() => resolveBet(ledger, NaN)).toThrow();
  });

  it("never touches the GC balance - a win only ever credits TICKETS", () => {
    const ledger = createLedger(500, 0);
    resolveBet(ledger, 30);
    expect(getBalance(ledger, "GC")).toBe(500);
  });
});

describe("placeBet + resolveBet round trip", () => {
  it("a full round: the GC bet is spent regardless of outcome, a win credits TICKETS separately", () => {
    const ledger = createLedger(1000, 0);

    const bet = placeBet(ledger, 100);
    expect(bet.ok).toBe(true);
    expect(getBalance(ledger, "GC")).toBe(900); // spent - never returned, win or lose

    resolveBet(ledger, 250); // a 2.5x-equivalent win, paid in TICKETS
    expect(getBalance(ledger, "GC")).toBe(900); // still just the spent bet - GC never grows from playing
    expect(getBalance(ledger, "TICKETS")).toBe(250);
  });

  it("a losing round: the GC bet is still spent, and nothing is credited", () => {
    const ledger = createLedger(1000, 0);

    placeBet(ledger, 100);
    resolveBet(ledger, 0); // lost the round entirely

    expect(getBalance(ledger, "GC")).toBe(900);
    expect(getBalance(ledger, "TICKETS")).toBe(0);
  });
});
