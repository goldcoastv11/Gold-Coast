import { describe, expect, it } from "vitest";
import {
  applyTransaction,
  canAfford,
  createLedger,
  getBalance,
  InsufficientBalanceError
} from "./ledger";
import {
  addPlaythroughRequirement,
  createPlaythroughState,
  isPlaythroughCleared,
  recordScWager,
  remainingPlaythrough
} from "./playthrough";
import { GC_PACKAGES, purchasePackage } from "./packages";
import { grantSignupBonus, SIGNUP_BONUS_SC } from "./signupBonus";
import { checkRedemptionEligibility, MIN_SC_REDEMPTION, redeemSc } from "./redemption";
import { AD_REWARD_GC_AMOUNT, claimAdRewardGc } from "./adRewards";
import { canAffordSkin, ownsSkin, purchaseSkin } from "./skinShop";

describe("ledger", () => {
  it("credits and debits move the right currency and record a transaction", () => {
    const ledger = createLedger(100, 10);
    applyTransaction(ledger, "GC", "ADJUST_GC", 50);
    expect(getBalance(ledger, "GC")).toBe(150);
    expect(getBalance(ledger, "SC")).toBe(10); // untouched - separate ledgers

    applyTransaction(ledger, "SC", "ADJUST_SC", -5);
    expect(getBalance(ledger, "SC")).toBe(5);
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

describe("GC packages - SC bonus is non-linear across tiers", () => {
  it("SC-per-dollar strictly increases from the cheapest to the priciest tier", () => {
    const ratios = GC_PACKAGES.map((p) => p.scBonus / p.priceUsd);
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
    }
  });

  it("is not a flat multiple of price (scBonus / priceUsd is not constant)", () => {
    const ratios = GC_PACKAGES.map((p) => p.scBonus / p.priceUsd);
    const allEqual = ratios.every((r) => Math.abs(r - ratios[0]) < 1e-9);
    expect(allEqual).toBe(false);
  });

  it("purchasePackage grants GC + SC bonus and registers a 1x playthrough requirement", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    const outcome = purchasePackage(ledger, playthrough, "silver");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(getBalance(ledger, "GC")).toBe(outcome.pkg.gcAmount);
    expect(getBalance(ledger, "SC")).toBe(outcome.pkg.scBonus);
    expect(playthrough.required).toBe(outcome.pkg.scBonus);
    expect(isPlaythroughCleared(playthrough)).toBe(false);
  });

  it("fails cleanly on an unknown package id", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    const outcome = purchasePackage(ledger, playthrough, "not_a_real_tier");
    expect(outcome.ok).toBe(false);
    expect(getBalance(ledger, "GC")).toBe(0);
  });
});

describe("signup bonus", () => {
  it("grants SC only and locks it behind a 1x playthrough requirement", () => {
    const ledger = createLedger(1000, 0);
    const playthrough = createPlaythroughState();
    grantSignupBonus(ledger, playthrough);

    expect(getBalance(ledger, "SC")).toBe(SIGNUP_BONUS_SC);
    expect(getBalance(ledger, "GC")).toBe(1000); // untouched
    expect(playthrough.required).toBe(SIGNUP_BONUS_SC);
    expect(isPlaythroughCleared(playthrough)).toBe(false);
  });
});

describe("playthrough", () => {
  it("wagering clears the requirement once cumulative wagers reach 1x", () => {
    const state = createPlaythroughState();
    addPlaythroughRequirement(state, 25);
    expect(isPlaythroughCleared(state)).toBe(false);
    expect(remainingPlaythrough(state)).toBe(25);

    recordScWager(state, 10);
    expect(isPlaythroughCleared(state)).toBe(false);
    expect(remainingPlaythrough(state)).toBe(15);

    recordScWager(state, 15);
    expect(isPlaythroughCleared(state)).toBe(true);
    expect(remainingPlaythrough(state)).toBe(0);
  });

  it("does not let wagering progress bank ahead of what's required", () => {
    const state = createPlaythroughState();
    addPlaythroughRequirement(state, 10);
    recordScWager(state, 9999);
    expect(state.wagered).toBe(10);
    expect(isPlaythroughCleared(state)).toBe(true);
  });

  it("with no requirement at all, is considered cleared", () => {
    const state = createPlaythroughState();
    expect(isPlaythroughCleared(state)).toBe(true);
  });
});

describe("redemption", () => {
  it("blocks redemption while playthrough is incomplete, even above the minimum", () => {
    const ledger = createLedger(0, 1000);
    const playthrough = createPlaythroughState();
    addPlaythroughRequirement(playthrough, 100);

    const eligibility = checkRedemptionEligibility(ledger, playthrough, MIN_SC_REDEMPTION);
    expect(eligibility.eligible).toBe(false);
    if (eligibility.eligible) return;
    expect(eligibility.reason).toBe("PLAYTHROUGH_INCOMPLETE");

    const outcome = redeemSc(ledger, playthrough, MIN_SC_REDEMPTION);
    expect(outcome.ok).toBe(false);
    expect(getBalance(ledger, "SC")).toBe(1000); // untouched
  });

  it("blocks redemption below the minimum threshold even once playthrough clears", () => {
    const ledger = createLedger(0, MIN_SC_REDEMPTION - 1);
    const playthrough = createPlaythroughState(); // no requirement -> cleared

    const outcome = redeemSc(ledger, playthrough, MIN_SC_REDEMPTION - 1);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.eligibility.eligible).toBe(false);
  });

  it("allows redemption once playthrough is cleared and the minimum is met, debiting SC via the ledger", () => {
    const ledger = createLedger(0, 200);
    const playthrough = createPlaythroughState();
    addPlaythroughRequirement(playthrough, 50);
    recordScWager(playthrough, 50);

    const outcome = redeemSc(ledger, playthrough, 100);
    expect(outcome.ok).toBe(true);
    expect(getBalance(ledger, "SC")).toBe(100);
    if (outcome.ok) {
      expect(outcome.transaction.type).toBe("REDEMPTION_SC");
      expect(outcome.transaction.amount).toBe(-100);
    }
  });
});

describe("ad rewards - GC only, never SC", () => {
  it("grants GC and leaves SC untouched", () => {
    const ledger = createLedger(0, 500);
    claimAdRewardGc(ledger);
    expect(getBalance(ledger, "GC")).toBe(AD_REWARD_GC_AMOUNT);
    expect(getBalance(ledger, "SC")).toBe(500);
  });
});

describe("skin shop - GC only, fully separate from SC/redemption", () => {
  it("purchases with GC, unlocks the skin, and never reads/writes SC", () => {
    const ledger = createLedger(1000, 999);
    const unlocked: string[] = ["player"];

    expect(canAffordSkin(ledger, "skin_001")).toBe(true); // price 250
    const outcome = purchaseSkin(ledger, unlocked, "skin_001");

    expect(outcome.ok).toBe(true);
    expect(getBalance(ledger, "GC")).toBe(750);
    expect(getBalance(ledger, "SC")).toBe(999); // untouched by a skin purchase
    expect(ownsSkin(unlocked, "skin_001")).toBe(true);
  });

  it("refuses to re-purchase an already-owned skin", () => {
    const ledger = createLedger(1000, 0);
    const unlocked: string[] = ["player", "skin_001"];
    const outcome = purchaseSkin(ledger, unlocked, "skin_001");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("ALREADY_OWNED");
    expect(getBalance(ledger, "GC")).toBe(1000);
  });

  it("refuses a purchase it can't afford, leaving the balance untouched", () => {
    const ledger = createLedger(10, 0);
    const unlocked: string[] = ["player"];
    const outcome = purchaseSkin(ledger, unlocked, "skin_002"); // price 1000
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("INSUFFICIENT_GC");
    expect(getBalance(ledger, "GC")).toBe(10);
  });
});
