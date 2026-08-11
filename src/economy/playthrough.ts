/**
 * Playthrough (wagering requirement) tracking.
 *
 * Economy rule: SC requires a 1x playthrough requirement before it becomes
 * redeemable. Every time SC bonus is granted (signup bonus or a package's
 * bonus gift), that amount is added to the cumulative requirement. As the
 * player wagers SC in games, progress accrues. SC is redeemable only once
 * cumulative wagering has caught up to cumulative requirement.
 *
 * Deliberately currency-agnostic about *how* wagering happens - it just
 * tracks two running totals. Game scenes call `recordScWager` whenever a
 * bet is placed using SC.
 */

export interface PlaythroughState {
  /** Cumulative SC wagering required across every SC bonus granted so far. */
  required: number;
  /** Cumulative SC wagering completed so far. Never exceeds `required`. */
  wagered: number;
}

export function createPlaythroughState(): PlaythroughState {
  return { required: 0, wagered: 0 };
}

/**
 * Call whenever an SC bonus is granted (signup bonus or package bonus) to
 * add its 1x wagering requirement. `scBonusAmount` must be positive.
 */
export function addPlaythroughRequirement(
  state: PlaythroughState,
  scBonusAmount: number
): void {
  if (!Number.isFinite(scBonusAmount) || scBonusAmount <= 0) return;
  state.required += scBonusAmount;
}

/**
 * Call whenever the player wagers SC in a game. Progress is capped at
 * `required` - wagering beyond what's owed doesn't roll over or go
 * negative, and doesn't let progress "bank" ahead of a future bonus grant.
 */
export function recordScWager(state: PlaythroughState, wagerAmount: number): void {
  if (!Number.isFinite(wagerAmount) || wagerAmount <= 0) return;
  state.wagered = Math.min(state.required, state.wagered + wagerAmount);
}

export function remainingPlaythrough(state: PlaythroughState): number {
  return Math.max(0, state.required - state.wagered);
}

export function isPlaythroughCleared(state: PlaythroughState): boolean {
  return remainingPlaythrough(state) <= 0;
}

/** 0-1 progress fraction, useful for a progress bar. Returns 1 if nothing is required. */
export function playthroughProgressFraction(state: PlaythroughState): number {
  if (state.required <= 0) return 1;
  return Math.min(1, state.wagered / state.required);
}
