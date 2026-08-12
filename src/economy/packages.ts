/**
 * Tiered GC purchase packages, each with an SC bonus gift attached.
 *
 * Economy rules this file exists to satisfy:
 *   - SC is NEVER sold directly - it only ever arrives as a bonus gift
 *     alongside a GC purchase (or the separate no-deposit signup bonus in
 *     signupBonus.ts). There is no package or code path here that lets a
 *     player buy SC on its own.
 *   - SC bonus scaling across tiers must be non-linear (not a flat
 *     multiple of price) - see the SC-per-dollar comment below.
 *   - Every currency change flows through the ledger (ledger.ts).
 *
 * priceUsd is a display-only figure for this POC - there is no real
 * payment gateway wired up, so `purchasePackage` simulates "payment
 * succeeded" and grants immediately. Wiring a real payment processor is a
 * future task, not economy ledger logic.
 */

import {
  LedgerState,
  Transaction,
  applyTransaction
} from "./ledger";
import { PlaythroughState, addPlaythroughRequirement } from "./playthrough";

export interface GcPackage {
  id: string;
  name: string;
  /** Display price in USD. No real payment processing in this POC. */
  priceUsd: number;
  gcAmount: number;
  /** SC bonus gifted alongside this package. Non-linear across tiers - see GC_PACKAGES comment. */
  scBonus: number;
}

/**
 * SC-per-dollar (scBonus / priceUsd) rises with tier instead of staying
 * flat, so the scaling is genuinely non-linear rather than "SC bonus =
 * price * constant":
 *   starter  2 / 4.99   = 0.40 SC per $
 *   bronze   6 / 9.99   = 0.60 SC per $
 *   silver  15 / 19.99  = 0.75 SC per $
 *   gold    45 / 49.99  = 0.90 SC per $
 *   platinum 110/99.99  = 1.10 SC per $
 *   diamond 260/199.99  = 1.30 SC per $
 */
export const GC_PACKAGES: readonly GcPackage[] = [
  { id: "starter", name: "Starter Pack", priceUsd: 4.99, gcAmount: 5000, scBonus: 2 },
  { id: "bronze", name: "Bronze Pack", priceUsd: 9.99, gcAmount: 12000, scBonus: 6 },
  { id: "silver", name: "Silver Pack", priceUsd: 19.99, gcAmount: 28000, scBonus: 15 },
  { id: "gold", name: "Gold Pack", priceUsd: 49.99, gcAmount: 80000, scBonus: 45 },
  { id: "platinum", name: "Platinum Pack", priceUsd: 99.99, gcAmount: 180000, scBonus: 110 },
  { id: "diamond", name: "Diamond Pack", priceUsd: 199.99, gcAmount: 400000, scBonus: 260 }
];

export function listPackages(): readonly GcPackage[] {
  return GC_PACKAGES;
}

export function getPackage(id: string): GcPackage | undefined {
  return GC_PACKAGES.find((p) => p.id === id);
}

export interface PackagePurchaseResult {
  pkg: GcPackage;
  gcTransaction: Transaction;
  scBonusTransaction: Transaction;
}

export type PackagePurchaseOutcome =
  | ({ ok: true } & PackagePurchaseResult)
  | { ok: false; reason: "UNKNOWN_PACKAGE" };

/**
 * Grants a GcPackage's GC + SC bonus and registers the SC bonus's 1x
 * playthrough requirement. Exported (not just used internally by
 * `purchasePackage`) so a caller with a package object that's
 * *deliberately not* in GC_PACKAGES - e.g. an internal, non-catalog,
 * $0 package - can still get the exact same purchase-bonus mechanics
 * without it ever being resolvable by id through `getPackage`/
 * `listPackages` (see src/economy/attendantClaim.ts for that use case).
 * Real purchase flows should go through `purchasePackage` below instead,
 * which only resolves ids from the real catalog.
 *
 * `extraMeta`, if given, is merged into both transactions' `meta` on top
 * of `{ packageId }` - e.g. attendantClaim.ts records the resolved
 * shuffle-cup multiplier (#27) there for audit purposes without needing
 * its own copy of this granting logic.
 */
export function grantPackage(
  ledger: LedgerState,
  playthrough: PlaythroughState,
  pkg: GcPackage,
  extraMeta?: Record<string, unknown>
): PackagePurchaseResult {
  const gcTransaction = applyTransaction(ledger, "GC", "PACKAGE_GC", pkg.gcAmount, {
    packageId: pkg.id,
    ...extraMeta
  });
  const scBonusTransaction = applyTransaction(ledger, "SC", "PACKAGE_BONUS_SC", pkg.scBonus, {
    packageId: pkg.id,
    ...extraMeta
  });
  addPlaythroughRequirement(playthrough, pkg.scBonus);

  return { pkg, gcTransaction, scBonusTransaction };
}

/**
 * "Purchases" a GC package (payment is assumed to have already succeeded -
 * this POC has no real payment gateway) and grants:
 *   1. the package's GC amount (PACKAGE_GC transaction)
 *   2. its SC bonus gift (PACKAGE_BONUS_SC transaction)
 * and registers a 1x playthrough requirement for that SC bonus so it can't
 * be redeemed until it's been wagered through once. Only resolves ids from
 * the real, purchasable GC_PACKAGES catalog - see `grantPackage` above for
 * granting a non-catalog package.
 */
export function purchasePackage(
  ledger: LedgerState,
  playthrough: PlaythroughState,
  packageId: string
): PackagePurchaseOutcome {
  const pkg = getPackage(packageId);
  if (!pkg) return { ok: false, reason: "UNKNOWN_PACKAGE" };

  return { ok: true, ...grantPackage(ledger, playthrough, pkg) };
}
