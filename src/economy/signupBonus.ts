/**
 * The no-deposit signup bonus - a starting GC grant, given once, when a
 * brand-new profile is created.
 *
 * #27: the GC amount is a resolved amount (GC_MULTIPLIER_BASE *
 * multiplier, see economy/gcMultiplier.ts) driven by games/floor's
 * shuffle-cup mini-game (#28/#29), instead of a flat starting balance.
 * `multiplier` defaults to 1 (= 1000 GC), matching the old fixed amount,
 * so any call site that predates the mini-game keeps working unchanged.
 *
 * History: this used to also grant a flat 25 SC ("Sweeps Coin") bonus,
 * back when this game used a two-currency sweepstakes model with a real-
 * money redemption path. That whole model was replaced with the current
 * "arcade token" one (GC to play, TICKETS won from playing, spent in the
 * Item Shop, no real-money value at all) - see repo-root CLAUDE.md and
 * ledger.ts's doc comment. There's no SC-equivalent starting grant any
 * more: TICKETS are only ever won by playing, never gifted on signup.
 */

import { LedgerState, Transaction, applyTransaction } from "./ledger";
import { GcMultiplier, resolveGcAmount } from "./gcMultiplier";

export interface SignupBonusResult {
  gcTransaction: Transaction;
}

/**
 * Grants the no-deposit signup bonus - GC_MULTIPLIER_BASE * `multiplier`
 * GC (default 1x = 1000). Call exactly once, when a new profile is
 * created.
 */
export function grantSignupBonus(ledger: LedgerState, multiplier: GcMultiplier = 1): SignupBonusResult {
  const gcTransaction = applyTransaction(ledger, "GC", "SIGNUP_BONUS_GC", resolveGcAmount(multiplier), {
    source: "signup",
    multiplier
  });
  return { gcTransaction };
}
