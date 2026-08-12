/**
 * The no-deposit signup bonus - one of the only two legitimate sources of
 * SC (the other being a package's bonus gift, see packages.ts). Granted
 * once, when a brand-new profile is created.
 *
 * #27: the GC leg is now a resolved amount (GC_MULTIPLIER_BASE *
 * multiplier, see economy/gcMultiplier.ts) driven by games/floor's
 * shuffle-cup mini-game (#28/#29), instead of the previous flat starting
 * balance. `multiplier` defaults to 1 (= 1000 GC), matching the old fixed
 * amount, so any call site that predates the mini-game keeps working
 * unchanged. The SC leg (SIGNUP_BONUS_SC = 25) is explicitly untouched by
 * #27 - still flat, still its own transaction type, still registers the
 * same playthrough requirement regardless of the GC multiplier.
 *
 * Both legs are now real ledger transactions (previously the GC leg was
 * just the ledger's initial balance, set directly rather than via
 * applyTransaction - a latent gap in "all balance changes go through the
 * ledger" for this one path). Fixed as part of #27 since the amount had to
 * become computed anyway.
 */

import { LedgerState, Transaction, applyTransaction } from "./ledger";
import { PlaythroughState, addPlaythroughRequirement } from "./playthrough";
import { GcMultiplier, resolveGcAmount } from "./gcMultiplier";

/** SC granted, no deposit required, on first login/profile creation. Fixed - does not scale with the GC multiplier (#27). */
export const SIGNUP_BONUS_SC = 25;

export interface SignupBonusResult {
  gcTransaction: Transaction;
  scTransaction: Transaction;
}

/**
 * Grants the no-deposit signup bonus - GC_MULTIPLIER_BASE * `multiplier`
 * GC (default 1x = 1000) plus a flat 25 SC - and registers the SC's 1x
 * playthrough requirement. Call exactly once, when a new profile is
 * created.
 */
export function grantSignupBonus(
  ledger: LedgerState,
  playthrough: PlaythroughState,
  multiplier: GcMultiplier = 1
): SignupBonusResult {
  const gcTransaction = applyTransaction(ledger, "GC", "SIGNUP_BONUS_GC", resolveGcAmount(multiplier), {
    source: "signup",
    multiplier
  });
  const scTransaction = applyTransaction(ledger, "SC", "SIGNUP_BONUS_SC", SIGNUP_BONUS_SC, {
    source: "signup"
  });
  addPlaythroughRequirement(playthrough, SIGNUP_BONUS_SC);
  return { gcTransaction, scTransaction };
}
