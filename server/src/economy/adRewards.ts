/**
 * Ad-reward GC refills - server-authoritative port of
 * casino-poc/src/economy/adRewards.ts (that module is untouched and stays
 * exactly as it was; this is a fresh server implementation, not a copy of
 * its code, since it needs real DB-backed cooldown enforcement the old
 * client-only version never had).
 *
 * Economy rule (repo-root CLAUDE.md): "Ad-reward refills grant GC only -
 * never SC." This module cannot touch the SC balance even by mistake -
 * `claimAdReward` below only ever calls `applyTransaction` with currency
 * "GC". No playthrough interaction either (playthrough only gates SC
 * redemption; GC has no playthrough requirement of its own).
 *
 * IMPORTANT - what this actually is right now: this project has no real ad
 * network integration (no AdSense/AdMob/rewarded-video SDK, no publisher
 * account - creating one of those isn't something that can be done without
 * the project owner's own account/credentials). "Claiming" here is a
 * simulated "the ad finished playing" signal from the client (see
 * ui/AdRewardOffer.ts's countdown), exactly the same kind of placeholder
 * `packages.ts`'s `purchasePackage` already uses for "payment succeeded"
 * until a real payment gateway exists. Swapping in a real ad SDK later
 * means verifying a real ad-completion callback/server-to-server postback
 * before calling `claimAdReward` here - this function's own logic (cooldown
 * + GC grant) doesn't need to change.
 *
 * Cooldown is enforced as a single atomic UPSERT with a conditional WHERE
 * on the DO UPDATE branch, same technique as economy/attendantClaim.ts -
 * two concurrent claim requests for the same user can't both slip through
 * a check-then-write race.
 */

import { TxClient, applyTransaction, LedgerTransaction } from "./ledger";

/**
 * GC granted per ad-reward claim. Matches the client's legacy
 * AD_REWARD_GC_AMOUNT constant (src/economy/adRewards.ts) - kept in sync by
 * hand since the two aren't shared code (see that file's own doc comment).
 */
export const AD_REWARD_GC_AMOUNT = 1000;

/**
 * Cooldown between claims. Longer than the Chip Attendant's 30s
 * (economy/attendantClaim.ts) on purpose - these are two independently
 * gated sources, and a real ad network would enforce its own frequency
 * capping on top of this anyway once one exists. Tune freely; nothing else
 * depends on this exact value.
 */
export const AD_REWARD_COOLDOWN_MS = 60_000;

export type AdRewardClaimOutcome =
  | { ok: true; transaction: LedgerTransaction }
  | { ok: false; reason: "COOLDOWN"; remainingMs: number };

/**
 * Attempts the ad-reward claim for `userId`. Checks + records the cooldown
 * atomically; if clear, grants AD_REWARD_GC_AMOUNT GC.
 */
export async function claimAdReward(
  tx: TxClient,
  userId: string,
  nowMs: number = Date.now()
): Promise<AdRewardClaimOutcome> {
  const now = new Date(nowMs);
  const cutoff = new Date(nowMs - AD_REWARD_COOLDOWN_MS);

  const updatedRows = await tx.$executeRaw`
    INSERT INTO ad_reward_claim (user_id, last_claimed_at)
    VALUES (${userId}, ${now})
    ON CONFLICT (user_id) DO UPDATE
      SET last_claimed_at = ${now}
      WHERE ad_reward_claim.last_claimed_at IS NULL
         OR ad_reward_claim.last_claimed_at <= ${cutoff}
  `;

  if (updatedRows === 0) {
    const row = await tx.adRewardClaim.findUnique({ where: { userId } });
    const lastClaimedAtMs = row?.lastClaimedAt ? row.lastClaimedAt.getTime() : null;
    const remainingMs =
      lastClaimedAtMs === null ? 0 : Math.max(0, AD_REWARD_COOLDOWN_MS - (nowMs - lastClaimedAtMs));
    return { ok: false, reason: "COOLDOWN", remainingMs };
  }

  const transaction = await applyTransaction(tx, userId, "GC", "AD_REWARD_GC", AD_REWARD_GC_AMOUNT, {
    source: "ad_reward_simulated"
  });
  return { ok: true, transaction };
}

/** ms remaining before another claim is allowed for `userId`. 0 = available now. */
export async function adRewardCooldownRemaining(
  tx: TxClient,
  userId: string,
  nowMs: number = Date.now()
): Promise<number> {
  const row = await tx.adRewardClaim.findUnique({ where: { userId } });
  if (!row?.lastClaimedAt) return 0;
  const elapsed = nowMs - row.lastClaimedAt.getTime();
  return Math.max(0, AD_REWARD_COOLDOWN_MS - elapsed);
}
