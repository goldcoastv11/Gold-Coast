/**
 * The no-deposit signup bonus - server-authoritative port of
 * casino-poc/src/economy/signupBonus.ts. A starting GC grant, given
 * exactly once, when a new user account is created (POST /auth/signup).
 *
 * The GC amount (GC_MULTIPLIER_BASE * multiplier) is driven by the
 * shuffle-cup mini-game - but unlike the client, `multiplier` here is never
 * taken from the request body. The caller (the signup route) must resolve
 * it itself via `pickRandomGcMultiplier()` (economy/gcMultiplier.ts)
 * BEFORE calling this function - see that module's header for the
 * trust-boundary reasoning.
 *
 * History: this used to also grant a flat 25 SC ("Sweeps Coin") bonus,
 * back when this game used a two-currency sweepstakes model with a real-
 * money redemption path. That whole model was replaced with the current
 * "arcade token" one (GC to play, TICKETS won from playing, spent in the
 * Item Shop, no real-money value at all) - see repo-root CLAUDE.md and
 * ledger.ts's doc comment. There's no SC-equivalent starting grant any
 * more: TICKETS are only ever won by playing, never gifted on signup.
 *
 * Caller contract: the user's `balances` row must already exist (with
 * 0/0) before this runs, since applyTransaction updates an existing row
 * rather than creating one.
 */

import { applyTransaction, TxClient } from "./ledger";
import { GcMultiplier, resolveGcAmount } from "./gcMultiplier";

export interface SignupBonusResult {
  gcAmount: number;
  gcTransaction: Awaited<ReturnType<typeof applyTransaction>>;
}

export async function grantSignupBonus(
  tx: TxClient,
  userId: string,
  multiplier: GcMultiplier
): Promise<SignupBonusResult> {
  const gcAmount = resolveGcAmount(multiplier);

  const gcTransaction = await applyTransaction(tx, userId, "GC", "SIGNUP_BONUS_GC", gcAmount, {
    source: "signup",
    multiplier
  });

  return { gcAmount, gcTransaction };
}
