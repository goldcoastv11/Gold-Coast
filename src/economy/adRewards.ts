/**
 * Ad-reward GC refills. Economy rule: ad-reward refills grant GC only -
 * never SC. This module cannot touch the SC balance even by mistake, since
 * it only ever calls applyTransaction with currency "GC".
 */

import { LedgerState, Transaction, applyTransaction } from "./ledger";

/**
 * GC granted per ad-reward claim. Matches the existing overworld NPC's
 * "Claim 1000 Gold Coins?" copy (src/scenes/OverworldScene.ts) - if that
 * copy changes, update this constant to match (or vice versa).
 */
export const AD_REWARD_GC_AMOUNT = 1000;

/**
 * Grants a GC-only ad-reward refill. This POC has no cooldown/limit yet
 * (matches the existing NPC bonus-claim behavior) - a real build should
 * add a cooldown and verify the ad actually played server-side before
 * calling this.
 */
export function claimAdRewardGc(ledger: LedgerState): Transaction {
  return applyTransaction(ledger, "GC", "AD_REWARD_GC", AD_REWARD_GC_AMOUNT, {
    source: "ad_reward"
  });
}
