/**
 * The overworld Coin Kiosk's free "watch an ad, then claim" NPC interaction
 * (see src/scenes/OverworldScene.ts, src/ui/CoinKioskOffer.ts). Formerly the
 * "Chip Attendant" - same shuffle-cup-animated GC claim underneath, now
 * gated behind a simulated ad-watch instead of a plain confirm dialog, and
 * GC-only (no SC).
 *
 * History: this module used to also grant a flat 1 SC bonus alongside the
 * GC, under a narrow, explicit, user-approved exception to the "SC only via
 * signup bonus or GC-purchase bonus" rule (see repo-root CLAUDE.md's git
 * history for that entry - it's been removed now that this claim no longer
 * grants SC at all, so the exception it authorized no longer applies to
 * anything). Per that removal, this is now a plain GC-only free claim, no
 * different in kind from an ad-reward refill (src/economy/adRewards.ts) -
 * it just has a variable multiplier (via the shuffle-cup mini-game) instead
 * of a flat amount, and its own separately-tracked cooldown. It grants via
 * `AD_REWARD_GC` (the same transaction type ad-reward refills use), not
 * `PACKAGE_GC`/`grantPackage` - there's no SC leg left to justify routing
 * this through the purchase-bonus package machinery.
 *
 * #19's persisted 30s cooldown is unchanged: `claimAttendantBonus` takes
 * the last-claimed timestamp explicitly (rather than reading a clock
 * itself) so it stays pure/testable; GameState is responsible for
 * persisting that timestamp across reloads.
 *
 * #27's variable GC leg is unchanged: `claimAttendantBonus` takes a
 * `multiplier` (see economy/gcMultiplier.ts) resolved by games/floor's
 * shuffle-cup mini-game and grants GC_MULTIPLIER_BASE * multiplier instead
 * of a hardcoded 1000. Defaults to 1 (= 1000).
 */

import { LedgerState, applyTransaction, Transaction } from "./ledger";
import { GcMultiplier, resolveGcAmount } from "./gcMultiplier";

/** Cooldown between successful claims. */
export const ATTENDANT_CLAIM_COOLDOWN_MS = 30_000;

export type AttendantClaimOutcome =
  | { ok: true; gcTransaction: Transaction }
  | { ok: false; reason: "COOLDOWN"; remainingMs: number };

/**
 * Milliseconds remaining before another claim is allowed. 0 means the
 * claim is available right now. `lastClaimAtMs` is null if the player has
 * never claimed. `nowMs` defaults to Date.now() but is an explicit
 * parameter so this stays pure/testable without mocking the clock.
 */
export function attendantClaimCooldownRemaining(
  lastClaimAtMs: number | null,
  nowMs: number = Date.now()
): number {
  if (lastClaimAtMs === null) return 0;
  const elapsed = nowMs - lastClaimAtMs;
  return Math.max(0, ATTENDANT_CLAIM_COOLDOWN_MS - elapsed);
}

/**
 * Attempts the claim. Checks the cooldown first (using `lastClaimAtMs` +
 * `nowMs`, both explicit so the caller controls persistence/clock); if
 * clear, grants GC_MULTIPLIER_BASE * `multiplier` GC (default 1x = 1000)
 * via a single `AD_REWARD_GC` transaction. Does not mutate/return a new
 * lastClaimAtMs itself - the caller (GameState) is responsible for
 * recording `nowMs` as the new last-claim time on a successful outcome.
 */
export function claimAttendantBonus(
  ledger: LedgerState,
  lastClaimAtMs: number | null,
  multiplier: GcMultiplier = 1,
  nowMs: number = Date.now()
): AttendantClaimOutcome {
  const remainingMs = attendantClaimCooldownRemaining(lastClaimAtMs, nowMs);
  if (remainingMs > 0) {
    return { ok: false, reason: "COOLDOWN", remainingMs };
  }

  const gcTransaction = applyTransaction(ledger, "GC", "AD_REWARD_GC", resolveGcAmount(multiplier), { multiplier });
  return { ok: true, gcTransaction };
}
