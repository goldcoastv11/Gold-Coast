import { describe, expect, it } from "vitest";
import { gameState } from "../GameState";
import { createLedger, getBalance } from "./ledger";
import { GC_PACKAGES, purchasePackage } from "./packages";
import { grantSignupBonus } from "./signupBonus";
import { claimAdRewardGc } from "./adRewards";
import { purchaseSkin } from "./skinShop";
import { claimAttendantBonus } from "./attendantClaim";
import { isValidGcMultiplier, GC_MULTIPLIER_BASE, InvalidGcMultiplierError } from "./gcMultiplier";

/**
 * QA's independent verification of the CLAUDE.md economy-rule tripwires
 * against the current "arcade token" model (GC to play, TICKETS won from
 * playing, spent in the Item Shop - see ledger.ts's doc comment). Written
 * separately from economy/economy.test.ts on purpose (don't just re-run
 * their assertions - probe the boundaries and cross-module interactions
 * they'd be least likely to self-catch).
 *
 * This file used to tripwire the retired SC/playthrough/redemption
 * sweepstakes-style model (SC's two grant paths, non-linear SC bonus
 * scaling, playthrough gating redemption, a minimum redemption
 * threshold). All of that was removed along with the model itself - there
 * is no more SC, no more playthrough, no more redemption of anything for
 * real money. The tripwires below assert the new model's own invariants
 * instead.
 */
describe("QA tripwire: TICKETS has exactly one grant path - winning a game", () => {
  it("nothing outside a game win credits TICKETS: signup bonus, packages, ad rewards, and the Coin Kiosk claim all leave TICKETS at 0", () => {
    const ledger = createLedger(0, 0);

    grantSignupBonus(ledger);
    expect(getBalance(ledger, "TICKETS")).toBe(0);

    purchasePackage(ledger, "silver");
    expect(getBalance(ledger, "TICKETS")).toBe(0);

    claimAdRewardGc(ledger);
    expect(getBalance(ledger, "TICKETS")).toBe(0);

    claimAttendantBonus(ledger, null, 1, 1_000_000);
    expect(getBalance(ledger, "TICKETS")).toBe(0);
  });

  it("[hardening] GameState.tickets has no public setter", () => {
    // Runtime check that the `tickets` accessor on GameState's prototype
    // has a getter but no setter (a plain `foo.bar = x` on an object with
    // only a getter silently no-ops in non-strict mode / throws in strict
    // mode - either way it must not be able to change the balance).
    // Belt-and-suspenders alongside the compile-time guarantee: with no
    // `set tickets` in the class, `gameState.tickets = 5` is a TypeScript
    // compile error too, enforced by every `npx tsc --noEmit`.
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(gameState), "tickets");
    expect(desc).toBeDefined();
    expect(typeof desc?.get).toBe("function");
    expect(desc?.set).toBeUndefined();
  });
});

describe("QA tripwire: GC packages are a plain top-up, no other currency attached", () => {
  it("has exactly 6 tiers", () => {
    expect(GC_PACKAGES).toHaveLength(6);
  });

  it("purchasing every tier grants only that tier's GC amount, never any TICKETS", () => {
    for (const pkg of GC_PACKAGES) {
      const ledger = createLedger(0, 0);
      const outcome = purchasePackage(ledger, pkg.id);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(getBalance(ledger, "GC")).toBe(pkg.gcAmount);
      expect(getBalance(ledger, "TICKETS")).toBe(0);
    }
  });
});

describe("QA tripwire: skinShop.ts (Item Shop) has zero code path touching GC", () => {
  it("a skin purchase leaves GC balance byte-for-byte untouched, including at 0 GC", () => {
    const ledger = createLedger(0, 1000);
    const unlocked = ["player"];
    const outcome = purchaseSkin(ledger, unlocked, "skin_000"); // price 400
    expect(outcome.ok).toBe(true);
    expect(getBalance(ledger, "GC")).toBe(0);
  });
});

describe("QA tripwire: ad rewards only ever grant GC", () => {
  it("repeated ad-reward claims never move TICKETS even from a nonzero starting balance", () => {
    const ledger = createLedger(0, 777);
    for (let i = 0; i < 5; i++) claimAdRewardGc(ledger);
    expect(getBalance(ledger, "TICKETS")).toBe(777);
  });
});

describe("QA tripwire: the Coin Kiosk claim never touches TICKETS", () => {
  it("is not part of the real, purchasable GC_PACKAGES catalog (can't be bought)", () => {
    expect(GC_PACKAGES.some((p) => p.id === "attendant_claim_internal")).toBe(false);
  });

  it("grants zero TICKETS per claim, regardless of multiplier", () => {
    for (const multiplier of [0.5, 1, 2] as const) {
      const ledger = createLedger(0, 0);
      const outcome = claimAttendantBonus(ledger, null, multiplier, 1_000_000);
      expect(outcome.ok).toBe(true);
      expect(getBalance(ledger, "TICKETS")).toBe(0);
    }
  });

  it("repeated claims (cooldown bypassed by advancing nowMs, like a player waiting out 30s x5) never move TICKETS even as GC accumulates", () => {
    const ledger = createLedger(0, 0);
    let now = 1_000_000;
    let lastClaimAt: number | null = null;
    for (let i = 0; i < 5; i++) {
      const outcome = claimAttendantBonus(ledger, lastClaimAt, 1, now);
      expect(outcome.ok).toBe(true);
      lastClaimAt = now;
      now += 30_000;
    }
    expect(getBalance(ledger, "GC")).toBe(GC_MULTIPLIER_BASE * 5);
    expect(getBalance(ledger, "TICKETS")).toBe(0);
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
    const ledger = createLedger(0, 0);
    const outOfRange = 999 as unknown as Parameters<typeof grantSignupBonus>[1];
    expect(isValidGcMultiplier(999)).toBe(false);

    expect(() => grantSignupBonus(ledger, outOfRange)).toThrow(InvalidGcMultiplierError);
    // Nothing was granted - the throw happens before any applyTransaction call.
    expect(getBalance(ledger, "GC")).toBe(0);
    expect(getBalance(ledger, "TICKETS")).toBe(0);
    expect(ledger.transactions).toHaveLength(0);
  });

  it("claimAttendantBonus rejects a negative multiplier on an empty ledger with a clear InvalidGcMultiplierError, not an incidental InsufficientBalanceError", () => {
    const ledger = createLedger(0, 0);
    const outOfRange = -5 as unknown as Parameters<typeof claimAttendantBonus>[2];

    expect(() => claimAttendantBonus(ledger, null, outOfRange, 1_000_000)).toThrow(InvalidGcMultiplierError);
  });

  it("claimAttendantBonus rejects a negative multiplier on a well-funded ledger too - no more silent GC drain disguised as a successful claim", () => {
    const ledger = createLedger(100_000, 0); // plenty of balance - this is the case that used to silently succeed
    const outOfRange = -5 as unknown as Parameters<typeof claimAttendantBonus>[2];

    expect(() => claimAttendantBonus(ledger, null, outOfRange, 1_000_000)).toThrow(InvalidGcMultiplierError);
    // Balance is completely untouched - the rejection happens before applyTransaction ever runs.
    expect(getBalance(ledger, "GC")).toBe(100_000);
  });

  it("still accepts every real multiplier (0.5/1/2) without throwing", () => {
    for (const multiplier of [0.5, 1, 2] as const) {
      const ledger = createLedger(0, 0);
      expect(() => grantSignupBonus(ledger, multiplier)).not.toThrow();
    }
  });
});
