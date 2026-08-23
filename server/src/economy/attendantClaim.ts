/**
 * The overworld Coin Kiosk's free claim - server-authoritative port of
 * casino-poc/src/economy/attendantClaim.ts. Formerly the "Chip Attendant's"
 * claim - see that module's doc comment for the full history of why this no
 * longer grants SC (the "Temporary POC exception" entry that used to
 * authorize it has been removed from repo-root CLAUDE.md, since nothing
 * needs it anymore). Now a plain GC-only claim, granted via `AD_REWARD_GC`
 * (same transaction type an ad-reward refill uses) instead of routing
 * through `grantPackage` - there's no SC leg left to justify the
 * purchase-bonus package machinery.
 *
 * Like the signup bonus, the GC leg's multiplier is resolved server-side
 * by the caller (via `pickRandomGcMultiplier`) and passed in - never taken
 * from the client.
 *
 * Cooldown is enforced as a single atomic UPSERT with a conditional WHERE
 * on the DO UPDATE branch: it only succeeds if there's no prior claim or
 * the cooldown has elapsed, so two concurrent claim requests for the same
 * user can't both slip through a check-then-write race - the second one's
 * UPDATE simply matches zero rows. (Table name `attendant_claim` is kept
 * as-is - renaming it would need a migration for zero behavioral benefit.)
 */

import { TxClient, applyTransaction, LedgerTransaction } from "./ledger";
import { GcMultiplier, resolveGcAmount } from "./gcMultiplier";

export const ATTENDANT_CLAIM_COOLDOWN_MS = 30_000;

export type AttendantClaimOutcome =
  | { ok: true; gcTransaction: LedgerTransaction }
  | { ok: false; reason: "COOLDOWN"; remainingMs: number };

/**
 * Attempts the claim for `userId`. Checks + records the 30s cooldown
 * atomically; if clear, grants GC_MULTIPLIER_BASE * `multiplier` GC via a
 * single `AD_REWARD_GC` transaction.
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

  const gcTransaction = await applyTransaction(tx, userId, "GC", "AD_REWARD_GC", resolveGcAmount(multiplier), {
    multiplier
  });
  return { ok: true, gcTransaction };
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
