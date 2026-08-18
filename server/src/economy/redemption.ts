/**
 * SC redemption (cashing out Sweeps Coins) - server-authoritative port of
 * casino-poc/src/economy/redemption.ts.
 *
 * Economy rules enforced here:
 *   - Redemption requires hitting a minimum SC threshold.
 *   - SC must have cleared its 1x playthrough requirement first - bonus SC
 *     that hasn't been wagered through yet is not redeemable, even if the
 *     raw balance is above the minimum.
 *   - Redemption is a ledger debit like anything else - no direct balance
 *     mutation (applyTransaction's atomic UPDATE...RETURNING is also the
 *     final backstop against a race letting a redemption overdraw SC).
 */

import { applyTransaction, getBalance, TxClient } from "./ledger";
import { getPlaythroughState, isPlaythroughCleared, remainingPlaythrough } from "./playthrough";

/** Minimum SC balance required before any redemption is allowed. */
export const MIN_SC_REDEMPTION = 50;

export type RedemptionEligibility =
  | { eligible: true }
  | { eligible: false; reason: "PLAYTHROUGH_INCOMPLETE"; remainingWagerSc: number }
  | { eligible: false; reason: "BELOW_MINIMUM"; minimumSc: number; balanceSc: number }
  | { eligible: false; reason: "INSUFFICIENT_BALANCE"; balanceSc: number; requestedSc: number };

/**
 * Checks whether `amountSc` can be redeemed right now, without mutating
 * anything. Order of checks: playthrough first, then the minimum
 * threshold, then whether the requested amount fits the current balance.
 */
export async function checkRedemptionEligibility(
  tx: TxClient,
  userId: string,
  amountSc: number
): Promise<RedemptionEligibility> {
  const playthrough = await getPlaythroughState(tx, userId);
  if (!isPlaythroughCleared(playthrough)) {
    return {
      eligible: false,
      reason: "PLAYTHROUGH_INCOMPLETE",
      remainingWagerSc: remainingPlaythrough(playthrough)
    };
  }

  const balanceSc = await getBalance(tx, userId, "SC");

  if (balanceSc < MIN_SC_REDEMPTION) {
    return { eligible: false, reason: "BELOW_MINIMUM", minimumSc: MIN_SC_REDEMPTION, balanceSc };
  }

  if (amountSc > balanceSc) {
    return { eligible: false, reason: "INSUFFICIENT_BALANCE", balanceSc, requestedSc: amountSc };
  }

  return { eligible: true };
}

export type IneligibleRedemption = Extract<RedemptionEligibility, { eligible: false }>;

export type RedemptionOutcome =
  | { ok: true; amountSc: number; transaction: Awaited<ReturnType<typeof applyTransaction>> }
  | { ok: false; eligibility: IneligibleRedemption };

/**
 * Attempts to redeem `amountSc` for `userId`. Returns `{ ok: false,
 * eligibility }` with the specific reason if not currently allowed,
 * otherwise debits the ledger (REDEMPTION_SC transaction).
 */
export async function redeemSc(tx: TxClient, userId: string, amountSc: number): Promise<RedemptionOutcome> {
  if (!Number.isFinite(amountSc) || amountSc <= 0) {
    return {
      ok: false,
      eligibility: { eligible: false, reason: "INSUFFICIENT_BALANCE", balanceSc: 0, requestedSc: amountSc }
    };
  }

  const eligibility = await checkRedemptionEligibility(tx, userId, amountSc);
  if (!eligibility.eligible) {
    return { ok: false, eligibility };
  }

  const transaction = await applyTransaction(tx, userId, "SC", "REDEMPTION_SC", -amountSc, { amountSc });
  return { ok: true, amountSc, transaction };
}
