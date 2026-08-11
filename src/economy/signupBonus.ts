/**
 * The no-deposit signup bonus - one of the only two legitimate sources of
 * SC (the other being a package's bonus gift, see packages.ts). Granted
 * once, when a brand-new profile is created.
 */

import { LedgerState, Transaction, applyTransaction } from "./ledger";
import { PlaythroughState, addPlaythroughRequirement } from "./playthrough";

/** SC granted, no deposit required, on first login/profile creation. */
export const SIGNUP_BONUS_SC = 25;

/**
 * Grants the no-deposit SC signup bonus and registers its 1x playthrough
 * requirement. Call exactly once, when a new profile is created.
 */
export function grantSignupBonus(
  ledger: LedgerState,
  playthrough: PlaythroughState
): Transaction {
  const transaction = applyTransaction(ledger, "SC", "SIGNUP_BONUS_SC", SIGNUP_BONUS_SC, {
    source: "signup"
  });
  addPlaythroughRequirement(playthrough, SIGNUP_BONUS_SC);
  return transaction;
}
