/**
 * The overworld Chip Attendant's free claim - server-authoritative port of
 * casino-poc/src/economy/attendantClaim.ts.
 *
 * Authorization: this is a narrow, explicitly-scoped exception to the "SC
 * only via signup bonus or GC-purchase bonus" / "ad-reward refills are GC
 * only" rules - see repo-root CLAUDE.md, "Temporary POC exception -
 * attendant SC test grant (user-approved 2026-08-10)". Per that entry:
 * scoped ONLY to this function, requires the 30s cooldown below as an
 * anti-spam measure (now DB-enforced via `attendant_claim.last_claimed_at`
 * instead of client localStorage - a client can no longer forge "cooldown
 * already elapsed"), and must be removed/reworked once a real GC-purchase
 * payment flow exists. Not a basis for adding SC grants anywhere else.
 *
 * Like the signup bonus, the GC leg's multiplier is resolved server-side
 * by the caller (via `pickRandomGcMultiplier`) and passed in - never taken
 * from the client. The SC leg (scBonus: 1) is fixed and untouched by the
 * multiplier.
 *
 * Cooldown is enforced as a single atomic UPSERT with a conditional WHERE
 * on the DO UPDATE branch: it only succeeds if there's no prior claim or
 * the cooldown has elapsed, so two concurrent claim requests for the same
 * user can't both slip through a check-then-write race - the second one's
 * UPDATE simply matches zero rows.
 */

import { TxClient } from "./ledger";
import { GcPackage, PackagePurchaseResult, grantPackage } from "./packages";
import { GcMultiplier, resolveGcAmount } from "./gcMultiplier";

/**
 * Not a real purchasable tier - intentionally absent from GC_PACKAGES.
 * priceUsd is 0 because no money changes hands for this claim. `gcAmount`
 * here is just the at-1x reference value - the actual grant always
 * recomputes it from the caller's `multiplier` via `resolveGcAmount`.
 * scBonus is deliberately small and fixed - it does NOT scale with the GC
 * multiplier.
 */
export const ATTENDANT_CLAIM_PACKAGE: GcPackage = {
  id: "attendant_claim_internal",
  name: "Attendant Claim (internal - not a real purchasable package)",
  priceUsd: 0,
  gcAmount: 1000,
  scBonus: 1
};

export const ATTENDANT_CLAIM_COOLDOWN_MS = 30_000;

export type AttendantClaimOutcome =
  | ({ ok: true } & PackagePurchaseResult)
  | { ok: false; reason: "COOLDOWN"; remainingMs: number };

/**
 * Attempts the claim for `userId`. Checks + records the 30s cooldown
 * atomically; if clear, grants GC_MULTIPLIER_BASE * `multiplier` GC plus
 * the flat 1 SC bonus via the same mechanics as a real package purchase
 * (playthrough lock included).
 */
export async function claimAttendantBonus(
  tx: TxClient,
  userId: string,
  multiplier: GcMultiplier,
  nowMs: number = Date.now()
): Promise<AttendantClaimOutcome> {
  const now = new Date(nowMs);
  const cutoff = new Date(nowMs - ATTENDANT_CLAIM_COOLDOWN_MS);

  const updatedRows = await tx.$executeRaw`
    INSERT INTO attendant_claim (user_id, last_claimed_at)
    VALUES (${userId}, ${now})
    ON CONFLICT (user_id) DO UPDATE
      SET last_claimed_at = ${now}
      WHERE attendant_claim.last_claimed_at IS NULL
         OR attendant_claim.last_claimed_at <= ${cutoff}
  `;

  if (updatedRows === 0) {
    const row = await tx.attendantClaim.findUnique({ where: { userId } });
    const lastClaimedAtMs = row?.lastClaimedAt ? row.lastClaimedAt.getTime() : null;
    const remainingMs =
      lastClaimedAtMs === null ? 0 : Math.max(0, ATTENDANT_CLAIM_COOLDOWN_MS - (nowMs - lastClaimedAtMs));
    return { ok: false, reason: "COOLDOWN", remainingMs };
  }

  const pkg: GcPackage = { ...ATTENDANT_CLAIM_PACKAGE, gcAmount: resolveGcAmount(multiplier) };
  const result = await grantPackage(tx, userId, pkg, { multiplier });
  return { ok: true, ...result };
}

/** ms remaining before another claim is allowed for `userId`. 0 = available now. */
export async function attendantClaimCooldownRemaining(
  tx: TxClient,
  userId: string,
  nowMs: number = Date.now()
): Promise<number> {
  const row = await tx.attendantClaim.findUnique({ where: { userId } });
  if (!row?.lastClaimedAt) return 0;
  const elapsed = nowMs - row.lastClaimedAt.getTime();
  return Math.max(0, ATTENDANT_CLAIM_COOLDOWN_MS - elapsed);
}
