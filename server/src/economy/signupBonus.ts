/**
 * The no-deposit signup bonus - server-authoritative port of
 * casino-poc/src/economy/signupBonus.ts. One of the only two legitimate
 * sources of SC (the other being a package's bonus gift, see packages.ts).
 * Granted exactly once, when a new user account is created (POST
 * /auth/signup).
 *
 * The GC leg's amount (GC_MULTIPLIER_BASE * multiplier) is driven by the
 * shuffle-cup mini-game - but unlike the client, `multiplier` here is never
 * taken from the request body. The caller (the signup route) must resolve
 * it itself via `pickRandomGcMultiplier()` (economy/gcMultiplier.ts)
 * BEFORE calling this function - see that module's header for the
 * trust-boundary reasoning. The SC leg (SIGNUP_BONUS_SC = 25) is flat and
 * unaffected by the multiplier either way.
 *
 * Caller contract: the user's `balances` row must already exist (with
 * 0/0) before this runs, since applyTransaction updates an existing row
 * rather than creating one.
 */

import { applyTransaction, TxClient } from "./ledger";
import { addPlaythroughRequirement } from "./playthrough";
import { GcMultiplier, resolveGcAmount } from "./gcMultiplier";

/** SC granted, no deposit required, on account creation. Flat - does not scale with the GC multiplier. */
export const SIGNUP_BONUS_SC = 25;

export interface SignupBonusResult {
  gcAmount: number;
  scAmount: number;
  gcTransaction: Awaited<ReturnType<typeof applyTransaction>>;
  scTransaction: Awaited<ReturnType<typeof applyTransaction>>;
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
  const scTransaction = await applyTransaction(tx, userId, "SC", "SIGNUP_BONUS_SC", SIGNUP_BONUS_SC, {
    source: "signup"
  });
  await addPlaythroughRequirement(tx, userId, SIGNUP_BONUS_SC);

  return { gcAmount, scAmount: SIGNUP_BONUS_SC, gcTransaction, scTransaction };
}
