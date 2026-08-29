import { describe, expect, it } from "vitest";
import {
  applyTransaction,
  canAfford,
  createLedger,
  getBalance,
  InsufficientBalanceError
} from "./ledger";
import { GC_PACKAGES, purchasePackage } from "./packages";
import { grantSignupBonus } from "./signupBonus";
import { GC_MULTIPLIER_BASE } from "./gcMultiplier";
import { AD_REWARD_GC_AMOUNT, claimAdRewardGc } from "./adRewards";

describe("ledger", () => {
  it("credits and debits move the right currency and record a transaction", () => {
    const ledger = createLedger(100, 10);
    applyTransaction(ledger, "GC", "ADJUST_GC", 50);
    expect(getBalance(ledger, "GC")).toBe(150);
    expect(getBalance(ledger, "TICKETS")).toBe(10); // untouched - separate ledgers

    applyTransaction(ledger, "TICKETS", "GAME_WIN_TICKETS", -5);
    expect(getBalance(ledger, "TICKETS")).toBe(5);
    expect(ledger.transactions).toHaveLength(2);
    expect(ledger.transactions[1].balanceAfter).toBe(5);
  });

  it("throws InsufficientBalanceError instead of allowing a negative balance", () => {
    const ledger = createLedger(10, 0);
    expect(() => applyTransaction(ledger, "GC", "ADJUST_GC", -20)).toThrow(
      InsufficientBalanceError
    );
    expect(getBalance(ledger, "GC")).toBe(10); // unchanged - failed transaction is not recorded
    expect(ledger.transactions).toHaveLength(0);
  });

  it("rejects a zero amount", () => {
    const ledger = createLedger(10, 0);
    expect(() => applyTransaction(ledger, "GC", "ADJUST_GC", 0)).toThrow();
  });

  it("canAfford reflects the current balance", () => {
    const ledger = createLedger(100, 0);
    expect(canAfford(ledger, "GC", 100)).toBe(true);
    expect(canAfford(ledger, "GC", 101)).toBe(false);
  });
});

describe("GC packages - plain GC top-up, no bonus currency attached", () => {
  it("purchasePackage grants exactly the package's GC amount, nothing else", () => {
    const ledger = createLedger(0, 0);
    const outcome = purchasePackage(ledger, "silver");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(getBalance(ledger, "GC")).toBe(outcome.pkg.gcAmount);
    expect(getBalance(ledger, "TICKETS")).toBe(0); // packages never grant TICKETS
  });

  it("fails cleanly on an unknown package id", () => {
    const ledger = createLedger(0, 0);
    const outcome = purchasePackage(ledger, "not_a_real_tier");
    expect(outcome.ok).toBe(false);
    expect(getBalance(ledger, "GC")).toBe(0);
  });

  it("every real package resolves by id", () => {
    for (const pkg of GC_PACKAGES) {
      const ledger = createLedger(0, 0);
      const outcome = purchasePackage(ledger, pkg.id);
      expect(outcome.ok).toBe(true);
    }
  });
});

describe("signup bonus - GC only, no starting TICKETS", () => {
  it("grants GC (default 1x) and nothing else", () => {
    const ledger = createLedger(0, 0);
    const { gcTransaction } = grantSignupBonus(ledger);

    expect(gcTransaction.type).toBe("SIGNUP_BONUS_GC");
    expect(gcTransaction.amount).toBe(GC_MULTIPLIER_BASE); // default multiplier 1x
    expect(getBalance(ledger, "GC")).toBe(GC_MULTIPLIER_BASE);
    expect(getBalance(ledger, "TICKETS")).toBe(0); // TICKETS are only ever won by playing
  });

  it("#27: the GC leg scales with the resolved multiplier", () => {
    for (const [multiplier, expectedGc] of [
      [0.5, 500],
      [1, 1000],
      [2, 2000]
    ] as const) {
      const ledger = createLedger(0, 0);
      const { gcTransaction } = grantSignupBonus(ledger, multiplier);
      expect(gcTransaction.amount).toBe(expectedGc);
    }
  });
});

describe("ad rewards - GC only, never TICKETS", () => {
  it("grants GC and leaves TICKETS untouched", () => {
    const ledger = createLedger(0, 500);
    claimAdRewardGc(ledger);
    expect(getBalance(ledger, "GC")).toBe(AD_REWARD_GC_AMOUNT);
    expect(getBalance(ledger, "TICKETS")).toBe(500);
  });
});

/**
 * The "Item Shop (skin shop) - TICKETS only" block lived here and covered
 * src/economy/skinShop.ts, a client-side, in-memory skin purchase path.
 * Both are gone: the layered wardrobe that replaced skins has no local
 * purchase path at all - buying a piece is POST /wardrobe/buy, debited
 * through the real server ledger.
 *
 * That is a strictly stronger position than these tests described (a
 * client-side debit was never authoritative anyway), and the same
 * guarantees are now asserted against the real ledger and a real database
 * in server/test/wardrobe.test.ts: TICKETS-only, GC never touched,
 * already-owned refused, unaffordable refused. The pure layering rules that
 * DO still live on the client are covered in src/wardrobeCatalog.test.ts.
 */
