/**
 * SC redemption (cashing out Sweeps Coins).
 *
 * Economy rules enforced here:
 *   - Redemption requires hitting a minimum SC threshold.
 *   - SC must have cleared its 1x playthrough requirement first (see
 *     playthrough.ts) - bonus SC that hasn't been wagered through yet is
 *     not redeemable, even if the raw balance is above the minimum.
 *   - Redemption is a ledger debit like anything else - no direct balance
 *     mutation.
 */

import { LedgerState, Transaction, applyTransaction, getBalance } from "./ledger";
import { PlaythroughState, isPlaythroughCleared, remainingPlaythrough } from "./playthrough";

/** Minimum SC balance required before any redemption is allowed. */
export const MIN_SC_REDEMPTION = 50;

export type RedemptionEligibility =
  | { eligible: true }
  | { eligible: false; reason: "PLAYTHROUGH_INCOMPLETE"; remainingWagerSc: number }
  | { eligible: false; reason: "BELOW_MINIMUM"; minimumSc: number; balanceSc: number }
  | { eligible: false; reason: "INSUFFICIENT_BALANCE"; balanceSc: number; requestedSc: number };

/**
 * Checks whether `amountSc` can be redeemed right now, without mutating
 * anything. Order of checks: playthrough first (a locked balance can't be
 * redeemed regardless of size), then the minimum threshold, then whether
 * the requested amount actually fits in the current balance.
 */
export function checkRedemptionEligibility(
  ledger: LedgerState,
  playthrough: PlaythroughState,
  amountSc: number
): RedemptionEligibility {
  if (!isPlaythroughCleared(playthrough)) {
    return {
      eligible: false,
      reason: "PLAYTHROUGH_INCOMPLETE",
      remainingWagerSc: remainingPlaythrough(playthrough)
    };
  }

  const balanceSc = getBalance(ledger, "SC");

  if (balanceSc < MIN_SC_REDEMPTION) {
    return { eligible: false, reason: "BELOW_MINIMUM", minimumSc: MIN_SC_REDEMPTION, balanceSc };
  }

  if (amountSc > balanceSc) {
    return { eligible: false, reason: "INSUFFICIENT_BALANCE", balanceSc, requestedSc: amountSc };
  }

  return { eligible: true };
}

export type RedemptionOutcome =
  | { ok: true; amountSc: number; transaction: Transaction }
  | { ok: false; eligibility: RedemptionEligibility };

/**
 * Attempts to redeem `amountSc`. Returns `{ ok: false, eligibility }` with
 * the specific reason if not currently allowed, otherwise debits the
 * ledger (REDEMPTION_SC transaction) and returns the result.
 */
export function redeemSc(
  ledger: LedgerState,
  playthrough: PlaythroughState,
  amountSc: number
): RedemptionOutcome {
  const eligibility = checkRedemptionEligibility(ledger, playthrough, amountSc);
  if (!eligibility.eligible) {
    return { ok: false, eligibility };
  }

  const transaction = applyTransaction(ledger, "SC", "REDEMPTION_SC", -amountSc, { amountSc });
  return { ok: true, amountSc, transaction };
}
