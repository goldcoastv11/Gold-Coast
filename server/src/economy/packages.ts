/**
 * Tiered GC purchase packages - server-authoritative port of
 * casino-poc/src/economy/packages.ts. Tier numbers (price/GC/SC bonus) are
 * copied verbatim from the client - do NOT invent new numbers here.
 *
 * Economy rules this file exists to satisfy:
 *   - SC is NEVER sold directly - it only ever arrives as a bonus gift
 *     alongside a GC purchase (or the separate no-deposit signup bonus).
 *   - SC bonus scaling across tiers must be non-linear (rises with tier,
 *     not a flat multiple of price) - see the SC-per-dollar comment below.
 *   - Every currency change flows through the ledger (economy/ledger.ts).
 *
 * priceUsd is display-only - there is no real payment gateway wired up yet,
 * so `purchasePackage` simulates "payment succeeded" and grants
 * immediately, exactly like the client's purchasePackage. Wiring a real
 * payment processor is a future task, not economy ledger logic.
 */

import { applyTransaction, TxClient } from "./ledger";
import { addPlaythroughRequirement } from "./playthrough";

export interface GcPackage {
  id: string;
  name: string;
  priceUsd: number;
  gcAmount: number;
  scBonus: number;
}

/**
 * SC-per-dollar (scBonus / priceUsd) rises with tier instead of staying
 * flat, so the scaling is genuinely non-linear:
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
  gcTransaction: Awaited<ReturnType<typeof applyTransaction>>;
  scBonusTransaction: Awaited<ReturnType<typeof applyTransaction>>;
}

export type PackagePurchaseOutcome =
  | ({ ok: true } & PackagePurchaseResult)
  | { ok: false; reason: "UNKNOWN_PACKAGE" };

/**
 * Grants a GcPackage's GC + SC bonus and registers the SC bonus's 1x
 * playthrough requirement. Exported separately from `purchasePackage` so a
 * caller with a package object that's *deliberately not* in GC_PACKAGES -
 * e.g. the attendant claim's internal, non-catalog, $0 package - can still
 * get the exact same purchase-bonus mechanics without it ever being
 * resolvable by id through `getPackage`/`listPackages` (see
 * economy/attendantClaim.ts). Real purchase flows should go through
 * `purchasePackage` below instead.
 */
export async function grantPackage(
  tx: TxClient,
  userId: string,
  pkg: GcPackage,
  extraMeta?: Record<string, unknown>
): Promise<PackagePurchaseResult> {
  const gcTransaction = await applyTransaction(tx, userId, "GC", "PACKAGE_GC", pkg.gcAmount, {
    packageId: pkg.id,
    ...extraMeta
  });
  const scBonusTransaction = await applyTransaction(tx, userId, "SC", "PACKAGE_BONUS_SC", pkg.scBonus, {
    packageId: pkg.id,
    ...extraMeta
  });
  await addPlaythroughRequirement(tx, userId, pkg.scBonus);

  return { pkg, gcTransaction, scBonusTransaction };
}

/**
 * "Purchases" a GC package (payment is assumed to have already succeeded -
 * no real payment gateway yet) and grants its GC + SC bonus gift, with a 1x
 * playthrough requirement registered for the SC bonus. Only resolves ids
 * from the real, purchasable GC_PACKAGES catalog.
 */
export async function purchasePackage(
  tx: TxClient,
  userId: string,
  packageId: string
): Promise<PackagePurchaseOutcome> {
  const pkg = getPackage(packageId);
  if (!pkg) return { ok: false, reason: "UNKNOWN_PACKAGE" };

  return { ok: true, ...(await grantPackage(tx, userId, pkg)) };
}
