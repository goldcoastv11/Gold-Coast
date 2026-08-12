import { describe, expect, it } from "vitest";
import { createLedger, getBalance } from "./ledger";
import { createPlaythroughState, isPlaythroughCleared } from "./playthrough";
import { GC_PACKAGES } from "./packages";
import { GC_MULTIPLIER_BASE } from "./gcMultiplier";
import {
  ATTENDANT_CLAIM_COOLDOWN_MS,
  ATTENDANT_CLAIM_PACKAGE,
  attendantClaimCooldownRemaining,
  claimAttendantBonus
} from "./attendantClaim";

describe("attendant claim (#18/#19)", () => {
  it("is not part of the real, purchasable package catalog", () => {
    expect(GC_PACKAGES.some((p) => p.id === ATTENDANT_CLAIM_PACKAGE.id)).toBe(false);
    expect(ATTENDANT_CLAIM_PACKAGE.priceUsd).toBe(0);
  });

  it("grants GC AND an SC bonus (routed through the purchase-bonus path, not ad-reward)", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();

    const outcome = claimAttendantBonus(ledger, playthrough, null, 1, 1_000_000);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.gcTransaction.type).toBe("PACKAGE_GC");
    expect(outcome.scBonusTransaction.type).toBe("PACKAGE_BONUS_SC");
    expect(getBalance(ledger, "GC")).toBe(GC_MULTIPLIER_BASE); // default multiplier 1x
    expect(getBalance(ledger, "SC")).toBe(ATTENDANT_CLAIM_PACKAGE.scBonus);
  });

  it("locks the granted SC behind a 1x playthrough requirement, same as any other package bonus", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    claimAttendantBonus(ledger, playthrough, null, 1, 1_000_000);

    expect(playthrough.required).toBe(ATTENDANT_CLAIM_PACKAGE.scBonus);
    expect(isPlaythroughCleared(playthrough)).toBe(false);
  });

  it("is available immediately when never claimed before", () => {
    expect(attendantClaimCooldownRemaining(null, 1_000_000)).toBe(0);
  });

  it("blocks a second claim before the cooldown elapses, with an accurate remaining time", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    const first = claimAttendantBonus(ledger, playthrough, null, 1, 1_000_000);
    expect(first.ok).toBe(true);

    const secondAttemptAt = 1_000_000 + 10_000; // 10s later, still on cooldown
    const second = claimAttendantBonus(ledger, playthrough, 1_000_000, 1, secondAttemptAt);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("COOLDOWN");
    expect(second.remainingMs).toBe(ATTENDANT_CLAIM_COOLDOWN_MS - 10_000);

    // balance must be unchanged by the blocked attempt
    expect(getBalance(ledger, "GC")).toBe(GC_MULTIPLIER_BASE);
    expect(getBalance(ledger, "SC")).toBe(ATTENDANT_CLAIM_PACKAGE.scBonus);
  });

  it("allows a claim again once the cooldown has fully elapsed", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    claimAttendantBonus(ledger, playthrough, null, 1, 1_000_000);

    const readyAt = 1_000_000 + ATTENDANT_CLAIM_COOLDOWN_MS;
    const outcome = claimAttendantBonus(ledger, playthrough, 1_000_000, 1, readyAt);
    expect(outcome.ok).toBe(true);
    expect(getBalance(ledger, "GC")).toBe(GC_MULTIPLIER_BASE * 2);
    expect(getBalance(ledger, "SC")).toBe(ATTENDANT_CLAIM_PACKAGE.scBonus * 2);
  });
});

describe("attendant claim GC multiplier (#27)", () => {
  it("defaults to 1x (1000 GC) when no multiplier is passed - unchanged pre-#27 behavior", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    const outcome = claimAttendantBonus(ledger, playthrough, null);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.gcTransaction.amount).toBe(1000);
  });

  it.each([
    [0.5, 500],
    [1, 1000],
    [2, 2000]
  ] as const)("multiplier %sx grants %s GC", (multiplier, expectedGc) => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    const outcome = claimAttendantBonus(ledger, playthrough, null, multiplier, 1_000_000);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.gcTransaction.amount).toBe(expectedGc);
      expect(getBalance(ledger, "GC")).toBe(expectedGc);
    }
  });

  it("the SC bonus stays flat at 1 regardless of the GC multiplier", () => {
    for (const multiplier of [0.5, 1, 2] as const) {
      const ledger = createLedger(0, 0);
      const playthrough = createPlaythroughState();
      const outcome = claimAttendantBonus(ledger, playthrough, null, multiplier, 1_000_000);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.scBonusTransaction.amount).toBe(1);
    }
  });

  it("records the resolved multiplier in the GC transaction's meta for audit purposes", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    const outcome = claimAttendantBonus(ledger, playthrough, null, 2, 1_000_000);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.gcTransaction.meta?.multiplier).toBe(2);
  });

  it("still respects the 30s cooldown regardless of multiplier", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    claimAttendantBonus(ledger, playthrough, null, 2, 1_000_000);
    const blocked = claimAttendantBonus(ledger, playthrough, 1_000_000, 0.5, 1_000_000 + 5_000);
    expect(blocked.ok).toBe(false);
  });
});
