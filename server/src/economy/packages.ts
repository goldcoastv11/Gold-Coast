/**
 * Tiered GC purchase packages - server-authoritative port of
 * casino-poc/src/economy/packages.ts. Tier numbers (price/GC) are copied
 * verbatim from the client - do NOT invent new numbers here.
 *
 * History: these used to each carry a non-linearly-scaled SC ("Sweeps
 * Coin") bonus gift, back when this game used a two-currency sweepstakes
 * model with a real-money redemption path. That whole model was replaced
 * with the current "arcade token" one (GC to play, TICKETS won from
 * playing, spent in the Item Shop, no real-money value at all) - see
 * repo-root CLAUDE.md and ledger.ts's doc comment. Packages are now a
 * plain GC top-up, nothing else attached.
 *
 * priceUsd is display-only - there is no real payment gateway wired up yet,
 * so `purchasePackage` simulates "payment succeeded" and grants
 * immediately, exactly like the client's purchasePackage. Wiring a real
 * payment processor is a future task, not economy ledger logic.
 */

import { applyTransaction, TxClient } from "./ledger";

export interface GcPackage {
  id: string;
  name: string;
  priceUsd: number;
  gcAmount: number;
}

export const GC_PACKAGES: readonly GcPackage[] = [
  { id: "starter", name: "Starter Pack", priceUsd: 4.99, gcAmount: 5000 },
  { id: "bronze", name: "Bronze Pack", priceUsd: 9.99, gcAmount: 12000 },
  { id: "silver", name: "Silver Pack", priceUsd: 19.99, gcAmount: 28000 },
  { id: "gold", name: "Gold Pack", priceUsd: 49.99, gcAmount: 80000 },
  { id: "platinum", name: "Platinum Pack", priceUsd: 99.99, gcAmount: 180000 },
  { id: "diamond", name: "Diamond Pack", priceUsd: 199.99, gcAmount: 400000 }
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
}

export type PackagePurchaseOutcome =
  | ({ ok: true } & PackagePurchaseResult)
  | { ok: false; reason: "UNKNOWN_PACKAGE" };

/**
 * Grants a GcPackage's GC amount. Exported separately from
 * `purchasePackage` so a caller with a package object that's *deliberately
 * not* in GC_PACKAGES - e.g. the Coin Kiosk claim's internal, non-catalog,
 * $0 package - can still get the exact same granting mechanics without it
 * ever being resolvable by id through `getPackage`/`listPackages` (see
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

  return { pkg, gcTransaction };
}

/**
 * "Purchases" a GC package (payment is assumed to have already succeeded -
 * no real payment gateway yet) and grants its GC amount. Only resolves ids
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
