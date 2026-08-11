import { describe, expect, it } from "vitest";
import { createLedger, getBalance } from "./ledger";
import { createPlaythroughState, isPlaythroughCleared } from "./playthrough";
import { GC_PACKAGES } from "./packages";
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

    const outcome = claimAttendantBonus(ledger, playthrough, null, 1_000_000);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.gcTransaction.type).toBe("PACKAGE_GC");
    expect(outcome.scBonusTransaction.type).toBe("PACKAGE_BONUS_SC");
    expect(getBalance(ledger, "GC")).toBe(ATTENDANT_CLAIM_PACKAGE.gcAmount);
    expect(getBalance(ledger, "SC")).toBe(ATTENDANT_CLAIM_PACKAGE.scBonus);
  });

  it("locks the granted SC behind a 1x playthrough requirement, same as any other package bonus", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    claimAttendantBonus(ledger, playthrough, null, 1_000_000);

    expect(playthrough.required).toBe(ATTENDANT_CLAIM_PACKAGE.scBonus);
    expect(isPlaythroughCleared(playthrough)).toBe(false);
  });

  it("is available immediately when never claimed before", () => {
    expect(attendantClaimCooldownRemaining(null, 1_000_000)).toBe(0);
  });

  it("blocks a second claim before the cooldown elapses, with an accurate remaining time", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    const first = claimAttendantBonus(ledger, playthrough, null, 1_000_000);
    expect(first.ok).toBe(true);

    const secondAttemptAt = 1_000_000 + 10_000; // 10s later, still on cooldown
    const second = claimAttendantBonus(ledger, playthrough, 1_000_000, secondAttemptAt);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("COOLDOWN");
    expect(second.remainingMs).toBe(ATTENDANT_CLAIM_COOLDOWN_MS - 10_000);

    // balance must be unchanged by the blocked attempt
    expect(getBalance(ledger, "GC")).toBe(ATTENDANT_CLAIM_PACKAGE.gcAmount);
    expect(getBalance(ledger, "SC")).toBe(ATTENDANT_CLAIM_PACKAGE.scBonus);
  });

  it("allows a claim again once the cooldown has fully elapsed", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    claimAttendantBonus(ledger, playthrough, null, 1_000_000);

    const readyAt = 1_000_000 + ATTENDANT_CLAIM_COOLDOWN_MS;
    const outcome = claimAttendantBonus(ledger, playthrough, 1_000_000, readyAt);
    expect(outcome.ok).toBe(true);
    expect(getBalance(ledger, "GC")).toBe(ATTENDANT_CLAIM_PACKAGE.gcAmount * 2);
    expect(getBalance(ledger, "SC")).toBe(ATTENDANT_CLAIM_PACKAGE.scBonus * 2);
  });
});
