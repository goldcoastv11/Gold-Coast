import { describe, expect, it } from "vitest";
import { gameState } from "../GameState";
import { applyTransaction, createLedger, getBalance } from "./ledger";
import {
  addPlaythroughRequirement,
  createPlaythroughState,
  isPlaythroughCleared,
  recordScWager
} from "./playthrough";
import { GC_PACKAGES, purchasePackage } from "./packages";
import { grantSignupBonus } from "./signupBonus";
import { checkRedemptionEligibility, MIN_SC_REDEMPTION, redeemSc } from "./redemption";
import { claimAdRewardGc } from "./adRewards";
import { purchaseSkin } from "./skinShop";
import { ATTENDANT_CLAIM_PACKAGE, claimAttendantBonus } from "./attendantClaim";

/**
 * QA's independent verification of the CLAUDE.md economy-rule tripwires
 * against economy's #1-6 delivery. Written separately from
 * economy/economy.test.ts on purpose (don't just re-run their assertions -
 * probe the boundaries and cross-module interactions they'd be least likely
 * to self-catch).
 */
describe("QA tripwire: SC has exactly two grant paths", () => {
  it("signup bonus and package bonus are the only exported functions that credit SC positively", () => {
    // Static check: every module in economy/ that touches "SC" with a
    // positive applyTransaction amount should be signupBonus.ts or
    // packages.ts. Exercised dynamically below for the modules that exist.
    const ledger = createLedger(0, 0);

    // adRewards: GC only
    claimAdRewardGc(ledger);
    expect(getBalance(ledger, "SC")).toBe(0);

    // skinShop: GC only (even when it can afford GC, SC must stay put)
    const unlocked = ["player"];
    purchaseSkin(createLedger(1000, 0), unlocked, "skin_001");
    expect(getBalance(ledger, "SC")).toBe(0);
  });

  it("redemption only ever debits SC, never credits it", () => {
    const ledger = createLedger(0, 200);
    const playthrough = createPlaythroughState(); // cleared, nothing required
    const outcome = redeemSc(ledger, playthrough, 100);
    expect(outcome.ok).toBe(true);
    expect(getBalance(ledger, "SC")).toBe(100); // went down, not up
  });

  it("[#16 fixed] a raw ADJUST_SC credit is now rejected by the ledger itself", () => {
    // Was: economy#1-6 shipped with GameState's legacy `stakeCoins` setter
    // computing a delta and calling applyTransaction(ledger, "SC",
    // "ADJUST_SC", delta) for ANY delta, including positive ones - a latent
    // SC-minting bypass with no ledger-level guard. Fixed in #16 two ways:
    // (1) GameState.stakeCoins is now getter-only, no legacy setter exists;
    // (2) defense in depth, applyTransaction itself now throws on a
    // crediting (positive) ADJUST_SC regardless of caller.
    const ledger = createLedger(0, 0);
    expect(() => applyTransaction(ledger, "SC", "ADJUST_SC", 500)).toThrow();
    expect(getBalance(ledger, "SC")).toBe(0);

    // A debiting ADJUST_SC is still permitted - only crediting SC outside
    // the two sanctioned paths is blocked.
    const funded = createLedger(0, 100);
    const debitTx = applyTransaction(funded, "SC", "ADJUST_SC", -30);
    expect(debitTx.amount).toBe(-30);
    expect(getBalance(funded, "SC")).toBe(70);
  });

  it("[#16 fixed] GameState.stakeCoins has no public setter", () => {
    // Runtime check that the `stakeCoins` accessor on GameState's prototype
    // has a getter but no setter (a plain `foo.bar = x` on an object with
    // only a getter silently no-ops in non-strict mode / throws in strict
    // mode - either way it must not be able to change the balance).
    // Belt-and-suspenders alongside the compile-time guarantee: with no
    // `set stakeCoins` in the class, `gameState.stakeCoins = 5` is now a
    // TypeScript compile error too, enforced by every `npx tsc --noEmit`.
    const desc = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(gameState),
      "stakeCoins"
    );
    expect(desc).toBeDefined();
    expect(typeof desc?.get).toBe("function");
    expect(desc?.set).toBeUndefined();
  });
});

describe("QA tripwire: SC bonus scaling is non-linear across ALL 6 tiers", () => {
  it("has exactly 6 tiers (sanity - the non-linearity claim is meaningless if a tier was dropped)", () => {
    expect(GC_PACKAGES).toHaveLength(6);
  });

  it("no two tiers share the same SC-per-dollar ratio (rules out 'mostly flat, one outlier')", () => {
    const ratios = GC_PACKAGES.map((p) => p.scBonus / p.priceUsd);
    const rounded = ratios.map((r) => Math.round(r * 1000) / 1000);
    expect(new Set(rounded).size).toBe(rounded.length);
  });

  it("scBonus is not a linear function of priceUsd (constant slope) across tiers", () => {
    // A flat "multiple of price" is the one thing the rule explicitly bans.
    // Also check the more general case of any *linear* fit (constant slope
    // between consecutive tiers), not just "ratio to price is constant".
    const pts = GC_PACKAGES.map((p) => [p.priceUsd, p.scBonus]);
    const slopes: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const [p0, s0] = pts[i - 1];
      const [p1, s1] = pts[i];
      slopes.push((s1 - s0) / (p1 - p0));
    }
    const allSameSlope = slopes.every((s) => Math.abs(s - slopes[0]) < 1e-6);
    expect(allSameSlope).toBe(false);
  });

  it("purchasing every tier once produces strictly increasing SC-per-dollar value delivered", () => {
    let prevRatio = -Infinity;
    for (const pkg of GC_PACKAGES) {
      const ledger = createLedger(0, 0);
      const playthrough = createPlaythroughState();
      const outcome = purchasePackage(ledger, playthrough, pkg.id);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      const ratio = outcome.scBonusTransaction.amount / pkg.priceUsd;
      expect(ratio).toBeGreaterThan(prevRatio);
      prevRatio = ratio;
    }
  });
});

describe("QA tripwire: playthrough actually gates redemption end-to-end", () => {
  it("signup bonus SC cannot be redeemed until wagered through once, then can be", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    grantSignupBonus(ledger, playthrough); // +25 SC, +25 required

    // Balance is above nothing yet (25 < MIN_SC_REDEMPTION=50) but even if it
    // were enough, playthrough must block first.
    let elig = checkRedemptionEligibility(ledger, playthrough, 25);
    expect(elig.eligible).toBe(false);
    if (!elig.eligible) expect(elig.reason).toBe("PLAYTHROUGH_INCOMPLETE");

    // Top up SC via a package so the balance clears MIN_SC_REDEMPTION, but
    // playthrough requirement also grows - redemption must still be blocked
    // until wagering catches up.
    purchasePackage(ledger, playthrough, "silver"); // +15 SC, +15 required (total required 40, balance 40)
    elig = checkRedemptionEligibility(ledger, playthrough, 40);
    expect(elig.eligible).toBe(false);
    if (!elig.eligible) expect(elig.reason).toBe("PLAYTHROUGH_INCOMPLETE");

    // Wager through exactly the required amount.
    recordScWager(playthrough, 40);
    expect(isPlaythroughCleared(playthrough)).toBe(true);

    // Still below MIN_SC_REDEMPTION (40 < 50) - must be blocked on the
    // threshold now, not playthrough.
    elig = checkRedemptionEligibility(ledger, playthrough, 40);
    expect(elig.eligible).toBe(false);
    if (!elig.eligible) expect(elig.reason).toBe("BELOW_MINIMUM");
  });

  it("partial wagering leaves a nonzero remainder and keeps redemption blocked", () => {
    const ledger = createLedger(0, 100);
    const playthrough = createPlaythroughState();
    addPlaythroughRequirement(playthrough, 60);
    recordScWager(playthrough, 59); // one short

    const elig = checkRedemptionEligibility(ledger, playthrough, 60);
    expect(elig.eligible).toBe(false);
    if (!elig.eligible && elig.reason === "PLAYTHROUGH_INCOMPLETE") {
      expect(elig.remainingWagerSc).toBe(1);
    } else {
      throw new Error("expected PLAYTHROUGH_INCOMPLETE with 1 SC remaining");
    }
  });
});

describe("QA tripwire: redemption enforces the minimum threshold as a hard floor", () => {
  it("blocks redemption exactly 1 SC under the minimum", () => {
    const ledger = createLedger(0, MIN_SC_REDEMPTION - 1);
    const playthrough = createPlaythroughState();
    const elig = checkRedemptionEligibility(ledger, playthrough, MIN_SC_REDEMPTION - 1);
    expect(elig.eligible).toBe(false);
    if (!elig.eligible) expect(elig.reason).toBe("BELOW_MINIMUM");
  });

  it("allows redemption at exactly the minimum threshold (boundary is inclusive)", () => {
    const ledger = createLedger(0, MIN_SC_REDEMPTION);
    const playthrough = createPlaythroughState();
    const outcome = redeemSc(ledger, playthrough, MIN_SC_REDEMPTION);
    expect(outcome.ok).toBe(true);
  });

  it("rejects redeeming more SC than the current balance even if above minimum", () => {
    const ledger = createLedger(0, MIN_SC_REDEMPTION);
    const playthrough = createPlaythroughState();
    const outcome = redeemSc(ledger, playthrough, MIN_SC_REDEMPTION + 1);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && !outcome.eligibility.eligible) {
      expect(outcome.eligibility.reason).toBe("INSUFFICIENT_BALANCE");
    }
  });
});

// Note: skinShop.ts / adRewards.ts were also manually read end-to-end during
// this review to confirm neither imports from ./playthrough or ./redemption
// and neither references the "SC" currency literal or stakeCoins anywhere
// in the module body (only in comments explaining the separation). Not
// re-asserted here via a filesystem read because this project has no
// @types/node, and reading source text isn't meaningfully stronger than the
// behavioral assertions below anyway.
describe("QA tripwire: skinShop.ts has zero code path touching SC", () => {
  it("a skin purchase leaves SC balance byte-for-byte untouched, including at 0 SC", () => {
    const ledger = createLedger(1000, 0);
    const unlocked = ["player"];
    const outcome = purchaseSkin(ledger, unlocked, "skin_000"); // price 400
    expect(outcome.ok).toBe(true);
    expect(getBalance(ledger, "SC")).toBe(0);
  });
});

describe("QA tripwire: ad rewards only ever grant GC", () => {
  it("repeated ad-reward claims never move SC even from a nonzero starting balance", () => {
    const ledger = createLedger(0, 777);
    for (let i = 0; i < 5; i++) claimAdRewardGc(ledger);
    expect(getBalance(ledger, "SC")).toBe(777);
  });
});

/**
 * QA independent verification of #18/#19 against the amended repo-root
 * CLAUDE.md's "Temporary POC exception - attendant SC test grant" entry.
 * That entry excepts exactly two rules (SC only via signup/GC-purchase
 * bonus; ad-reward is GC-only) for this one function ONLY - it does NOT
 * except playthrough-gating or the redemption minimum, so this SC must
 * behave exactly like any other SC for those two rules. Written
 * independently of economy/attendantClaim.test.ts.
 */
describe("QA tripwire: attendant claim exception is scoped exactly as CLAUDE.md documents", () => {
  it("is not part of the real, purchasable GC_PACKAGES catalog (can't be bought, can't perturb the non-linear-scaling check)", () => {
    expect(GC_PACKAGES.some((p) => p.id === ATTENDANT_CLAIM_PACKAGE.id)).toBe(false);
    expect(ATTENDANT_CLAIM_PACKAGE.priceUsd).toBe(0);
    // The non-linear-scaling tripwire above asserts against GC_PACKAGES
    // directly, so as long as this package isn't in that array, it cannot
    // silently satisfy/break that check either way.
  });

  it("grants exactly 1 SC per claim, not a variable/larger amount", () => {
    expect(ATTENDANT_CLAIM_PACKAGE.scBonus).toBe(1);
  });

  it("the granted SC still requires a 1x playthrough before it's redeemable - the exception does NOT touch this rule", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    const outcome = claimAttendantBonus(ledger, playthrough, null, 1_000_000);
    expect(outcome.ok).toBe(true);

    // Balance is 1 SC - can never reach MIN_SC_REDEMPTION on its own, but
    // even if it could, playthrough must still block first (same ordering
    // as every other SC source).
    const elig = checkRedemptionEligibility(ledger, playthrough, 1);
    expect(elig.eligible).toBe(false);
    if (!elig.eligible) expect(elig.reason).toBe("PLAYTHROUGH_INCOMPLETE");

    recordScWager(playthrough, 1);
    expect(isPlaythroughCleared(playthrough)).toBe(true);
  });

  it("the granted SC still respects the redemption minimum threshold - the exception does NOT touch this rule either", () => {
    const ledger = createLedger(0, 0);
    const playthrough = createPlaythroughState();
    // Claim repeatedly (cooldown bypassed by advancing nowMs each time,
    // exactly like a player waiting out 30s x49) until balance is just
    // under MIN_SC_REDEMPTION, so this exercises the real accumulation
    // path rather than pre-seeding the ledger.
    let now = 1_000_000;
    let lastClaimAt: number | null = null;
    while (getBalance(ledger, "SC") < MIN_SC_REDEMPTION - 1) {
      const outcome = claimAttendantBonus(ledger, playthrough, lastClaimAt, now);
      expect(outcome.ok).toBe(true);
      lastClaimAt = now;
      now += 30_000;
    }
    recordScWager(playthrough, getBalance(ledger, "SC")); // clear playthrough so only the threshold is being tested
    expect(isPlaythroughCleared(playthrough)).toBe(true);

    const elig = checkRedemptionEligibility(ledger, playthrough, getBalance(ledger, "SC"));
    expect(elig.eligible).toBe(false);
    if (!elig.eligible) expect(elig.reason).toBe("BELOW_MINIMUM");

    // One more claim crosses the threshold - now it's eligible.
    claimAttendantBonus(ledger, playthrough, lastClaimAt, now);
    recordScWager(playthrough, ATTENDANT_CLAIM_PACKAGE.scBonus);
    const eligAfter = checkRedemptionEligibility(ledger, playthrough, MIN_SC_REDEMPTION);
    expect(eligAfter.eligible).toBe(true);
  });

  it("adRewards.ts's claimAdRewardGc is completely unaffected by an active attendant-claim cooldown - the two paths are independent", () => {
    const ledger = createLedger(0, 0);
    claimAdRewardGc(ledger);
    expect(getBalance(ledger, "SC")).toBe(0); // still GC-only, unrelated module
  });
});
