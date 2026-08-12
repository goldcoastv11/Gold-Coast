/**
 * The overworld Chip Attendant's free "Claim 1000 Gold Coins?" NPC
 * interaction (see src/scenes/OverworldScene.ts).
 *
 * Context (#18/#19): this claim is a placeholder stand-in for what will
 * later become a real "buy GC" purchase flow - the player isn't paying
 * anything today, but the interaction is shaped like a purchase (get a
 * lump of GC on demand). Because of that, its SC bonus belongs on the
 * purchase-bonus rule (SC gifted alongside a GC purchase), NOT the
 * ad-reward rule - src/economy/adRewards.ts is untouched and stays
 * GC-only; it remains the right module for an actual future "watch an ad"
 * feature, which this NPC is not.
 *
 * To get purchase-bonus mechanics (GC + non-catalog SC bonus + playthrough
 * lock) without polluting the real, purchasable package catalog, this
 * module defines its own package-shaped constant and grants it via
 * packages.ts's `grantPackage` - deliberately NOT registered in
 * GC_PACKAGES, so it can never be resolved by `getPackage`/`listPackages`
 * or shown in a real purchase-flow UI, and never perturbs the "SC bonus
 * scaling must be non-linear across tiers" invariant (which is checked
 * only across GC_PACKAGES).
 *
 * #19 adds a persisted 30s cooldown on top: `claimAttendantBonus` takes
 * the last-claimed timestamp explicitly (rather than reading a clock
 * itself) so it stays pure/testable; GameState is responsible for
 * persisting that timestamp across reloads.
 *
 * #27 makes the GC leg variable: `claimAttendantBonus` now takes a
 * `multiplier` (see economy/gcMultiplier.ts) resolved by games/floor's
 * shuffle-cup mini-game (#28/#29) and grants GC_MULTIPLIER_BASE *
 * multiplier instead of a hardcoded 1000. It defaults to 1 (= 1000,
 * identical to the old fixed behavior) so every call site that predates
 * the mini-game keeps working unchanged until floor wires the resolved
 * pick through. The SC leg (scBonus: 1) is explicitly untouched by #27 -
 * still flat, still PACKAGE_BONUS_SC, still registers the same
 * playthrough requirement either way.
 *
 * Authorization: this is a narrow, explicitly-scoped exception to the
 * "SC only via signup bonus or GC-purchase bonus" / "ad-reward refills are
 * GC only" rules - see repo-root CLAUDE.md, "Temporary POC exception -
 * attendant SC test grant (user-approved 2026-08-10)". Per that entry:
 * scoped ONLY to this function (do not reuse this pattern for any other
 * free/no-cost path without its own separate sign-off there), requires the
 * 30s cooldown above as an anti-spam measure, and must be removed/reworked
 * once a real GC-purchase payment flow exists (at that point this SC grant
 * belongs on the real purchase path instead).
 */

import { LedgerState } from "./ledger";
import { PlaythroughState } from "./playthrough";
import { GcPackage, PackagePurchaseResult, grantPackage } from "./packages";
import { GcMultiplier, resolveGcAmount } from "./gcMultiplier";

/**
 * Not a real purchasable tier - intentionally absent from GC_PACKAGES.
 * priceUsd is 0 because no money changes hands for this claim yet.
 * `gcAmount` here is just the at-1x reference value (mirrors the overworld
 * NPC's original "Claim 1000 Gold Coins?" copy) - the actual grant always
 * recomputes it from the caller's `multiplier` via `resolveGcAmount` (see
 * `claimAttendantBonus` below), this field is never read directly for a
 * real claim. scBonus is deliberately small and, per #27, fixed - it does
 * NOT scale with the GC multiplier.
 */
export const ATTENDANT_CLAIM_PACKAGE: GcPackage = {
  id: "attendant_claim_internal",
  name: "Attendant Claim (internal - not a real purchasable package)",
  priceUsd: 0,
  gcAmount: 1000,
  scBonus: 1
};

/** Cooldown between successful claims. */
export const ATTENDANT_CLAIM_COOLDOWN_MS = 30_000;

export type AttendantClaimOutcome =
  | ({ ok: true } & PackagePurchaseResult)
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
 * clear, grants GC_MULTIPLIER_BASE * `multiplier` GC (#27 - default 1x =
 * 1000, the pre-#27 fixed amount) plus the flat 1 SC bonus, via the same
 * mechanics as a real purchase (playthrough lock included). Does not
 * mutate/return a new lastClaimAtMs itself - the caller (GameState) is
 * responsible for recording `nowMs` as the new last-claim time on a
 * successful outcome.
 */
export function claimAttendantBonus(
  ledger: LedgerState,
  playthrough: PlaythroughState,
  lastClaimAtMs: number | null,
  multiplier: GcMultiplier = 1,
  nowMs: number = Date.now()
): AttendantClaimOutcome {
  const remainingMs = attendantClaimCooldownRemaining(lastClaimAtMs, nowMs);
  if (remainingMs > 0) {
    return { ok: false, reason: "COOLDOWN", remainingMs };
  }

  const pkg: GcPackage = { ...ATTENDANT_CLAIM_PACKAGE, gcAmount: resolveGcAmount(multiplier) };
  const result = grantPackage(ledger, playthrough, pkg, { multiplier });
  return { ok: true, ...result };
}
