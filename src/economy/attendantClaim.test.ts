import { describe, expect, it } from "vitest";
import { createLedger, getBalance } from "./ledger";
import { GC_MULTIPLIER_BASE } from "./gcMultiplier";
import { ATTENDANT_CLAIM_COOLDOWN_MS, attendantClaimCooldownRemaining, claimAttendantBonus } from "./attendantClaim";

describe("Coin Kiosk claim (formerly the Chip Attendant's, #18/#19) - GC only, no SC", () => {
  it("grants GC only, via AD_REWARD_GC, no SC leg", () => {
    const ledger = createLedger(0);

    const outcome = claimAttendantBonus(ledger, null, 1, 1_000_000);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.gcTransaction.type).toBe("AD_REWARD_GC");
    expect(getBalance(ledger, "GC")).toBe(GC_MULTIPLIER_BASE); // default multiplier 1x
  });

  it("is available immediately when never claimed before", () => {
    expect(attendantClaimCooldownRemaining(null, 1_000_000)).toBe(0);
  });

  it("blocks a second claim before the cooldown elapses, with an accurate remaining time", () => {
    const ledger = createLedger(0);
    const first = claimAttendantBonus(ledger, null, 1, 1_000_000);
    expect(first.ok).toBe(true);

    const secondAttemptAt = 1_000_000 + 10_000; // 10s later, still on cooldown
    const second = claimAttendantBonus(ledger, 1_000_000, 1, secondAttemptAt);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("COOLDOWN");
    expect(second.remainingMs).toBe(ATTENDANT_CLAIM_COOLDOWN_MS - 10_000);

    // balance must be unchanged by the blocked attempt
    expect(getBalance(ledger, "GC")).toBe(GC_MULTIPLIER_BASE);
  });

  it("allows a claim again once the cooldown has fully elapsed", () => {
    const ledger = createLedger(0);
    claimAttendantBonus(ledger, null, 1, 1_000_000);

    const readyAt = 1_000_000 + ATTENDANT_CLAIM_COOLDOWN_MS;
    const outcome = claimAttendantBonus(ledger, 1_000_000, 1, readyAt);
    expect(outcome.ok).toBe(true);
    expect(getBalance(ledger, "GC")).toBe(GC_MULTIPLIER_BASE * 2);
  });
});

describe("Coin Kiosk claim GC multiplier (#27)", () => {
  it("defaults to 1x (1000 GC) when no multiplier is passed - unchanged pre-#27 behavior", () => {
    const ledger = createLedger(0);
    const outcome = claimAttendantBonus(ledger, null);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.gcTransaction.amount).toBe(1000);
  });

  it.each([
    [0.5, 500],
    [1, 1000],
    [2, 2000]
  ] as const)("multiplier %sx grants %s GC", (multiplier, expectedGc) => {
    const ledger = createLedger(0);
    const outcome = claimAttendantBonus(ledger, null, multiplier, 1_000_000);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.gcTransaction.amount).toBe(expectedGc);
      expect(getBalance(ledger, "GC")).toBe(expectedGc);
    }
  });

  it("records the resolved multiplier in the GC transaction's meta for audit purposes", () => {
    const ledger = createLedger(0);
    const outcome = claimAttendantBonus(ledger, null, 2, 1_000_000);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.gcTransaction.meta?.multiplier).toBe(2);
  });

  it("still respects the 30s cooldown regardless of multiplier", () => {
    const ledger = createLedger(0);
    claimAttendantBonus(ledger, null, 2, 1_000_000);
    const blocked = claimAttendantBonus(ledger, 1_000_000, 0.5, 1_000_000 + 5_000);
    expect(blocked.ok).toBe(false);
  });
});
