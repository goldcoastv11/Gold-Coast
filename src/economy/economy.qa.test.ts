import { describe, expect, it } from "vitest";
import { createLedger, getBalance } from "./ledger";
import { GC_PACKAGES, purchasePackage } from "./packages";
import { grantSignupBonus } from "./signupBonus";
import { claimAttendantBonus } from "./attendantClaim";
import { isValidGcMultiplier, GC_MULTIPLIER_BASE, InvalidGcMultiplierError } from "./gcMultiplier";

/**
 * QA's independent verification of the CLAUDE.md economy-rule tripwires
 * against the current GC-only model (see ledger.ts's doc comment). Written
 * separately from economy/economy.test.ts on purpose (don't just re-run
 * their assertions - probe the boundaries and cross-module interactions
 * they'd be least likely to self-catch).
 *
 * This file used to also tripwire the retired SC/playthrough/redemption
 * sweepstakes-style model, then the GC/TICKETS "arcade token" model that
 * replaced it (TICKETS's one grant path, ad rewards/packages/signup bonus
 * never touching it, etc.). Both are gone along with their models - GC is
 * the only currency now, so those tripwires no longer have anything to
 * guard and were removed with the code they tested (2026-08-30
 * roadmap/deadcode). The tripwires below assert the current model's own
 * invariants instead.
 */

describe("QA tripwire: GC packages are a plain top-up, one currency", () => {
  it("has exactly 6 tiers", () => {
    expect(GC_PACKAGES).toHaveLength(6);
  });

  it("purchasing every tier grants exactly that tier's GC amount", () => {
    for (const pkg of GC_PACKAGES) {
      const ledger = createLedger(0);
      const outcome = purchasePackage(ledger, pkg.id);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(getBalance(ledger, "GC")).toBe(pkg.gcAmount);
    }
  });
});

/**
 * The "skinShop.ts has zero code path touching GC" tripwire lived here.
 * skinShop.ts is gone along with the skins, and the layered wardrobe that
 * replaced it has no client-side purchase path to put a tripwire on. The
 * equivalent tripwire now runs server-side in server/test/wardrobe.test.ts.
 */

describe("QA tripwire: the Coin Kiosk claim is not part of the purchasable catalog", () => {
  it("is not part of the real, purchasable GC_PACKAGES catalog (can't be bought)", () => {
    expect(GC_PACKAGES.some((p) => p.id === "attendant_claim_internal")).toBe(false);
  });

  it("repeated claims (cooldown bypassed by advancing nowMs, like a player waiting out 30s x5) accumulate GC correctly", () => {
    const ledger = createLedger(0);
    let now = 1_000_000;
    let lastClaimAt: number | null = null;
    for (let i = 0; i < 5; i++) {
      const outcome = claimAttendantBonus(ledger, lastClaimAt, 1, now);
      expect(outcome.ok).toBe(true);
      lastClaimAt = now;
      now += 30_000;
    }
    expect(getBalance(ledger, "GC")).toBe(GC_MULTIPLIER_BASE * 5);
  });
});

/**
 * QA finding (#27, closed before #29 lands): the multiplier passed to
 * grantSignupBonus/claimAttendantBonus was only constrained at the
 * TypeScript type level (GcMultiplier = 0.5 | 1 | 2) -
 * gcMultiplier.ts's own `isValidGcMultiplier` runtime guard existed but
 * was never called anywhere. Fixed by wiring the guard into
 * `resolveGcAmount` itself (the one chokepoint both grantSignupBonus and
 * claimAttendantBonus use to turn a multiplier into an amount), so it's
 * enforced regardless of what any caller passes - including untrusted,
 * not-necessarily-TS-checked values #29's mini-game output will feed in.
 * These tests originally demonstrated the gap; now flipped to assert the
 * rejection per the original finding's own note that they should be.
 */
describe("QA finding: gcMultiplier's runtime validator is now enforced at the source", () => {
  it("grantSignupBonus rejects an out-of-range multiplier instead of granting a bogus amount", () => {
    const ledger = createLedger(0);
    const outOfRange = 999 as unknown as Parameters<typeof grantSignupBonus>[1];
    expect(isValidGcMultiplier(999)).toBe(false);

    expect(() => grantSignupBonus(ledger, outOfRange)).toThrow(InvalidGcMultiplierError);
    // Nothing was granted - the throw happens before any applyTransaction call.
    expect(getBalance(ledger, "GC")).toBe(0);
    expect(ledger.transactions).toHaveLength(0);
  });

  it("claimAttendantBonus rejects a negative multiplier on an empty ledger with a clear InvalidGcMultiplierError, not an incidental InsufficientBalanceError", () => {
    const ledger = createLedger(0);
    const outOfRange = -5 as unknown as Parameters<typeof claimAttendantBonus>[2];

    expect(() => claimAttendantBonus(ledger, null, outOfRange, 1_000_000)).toThrow(InvalidGcMultiplierError);
  });

  it("claimAttendantBonus rejects a negative multiplier on a well-funded ledger too - no more silent GC drain disguised as a successful claim", () => {
    const ledger = createLedger(100_000); // plenty of balance - this is the case that used to silently succeed
    const outOfRange = -5 as unknown as Parameters<typeof claimAttendantBonus>[2];

    expect(() => claimAttendantBonus(ledger, null, outOfRange, 1_000_000)).toThrow(InvalidGcMultiplierError);
    // Balance is completely untouched - the rejection happens before applyTransaction ever runs.
    expect(getBalance(ledger, "GC")).toBe(100_000);
  });

  it("still accepts every real multiplier (0.5/1/2) without throwing", () => {
    for (const multiplier of [0.5, 1, 2] as const) {
      const ledger = createLedger(0);
      expect(() => grantSignupBonus(ledger, multiplier)).not.toThrow();
    }
  });
});
