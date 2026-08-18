/**
 * Playthrough (wagering requirement) tracking - server-authoritative port
 * of casino-poc/src/economy/playthrough.ts.
 *
 * Economy rule: SC requires a 1x playthrough requirement before it becomes
 * redeemable. Every time SC bonus is granted (signup bonus or a package's
 * bonus gift), that amount is added to the cumulative requirement
 * (`playthrough_progress.sc_required`). As the player wagers SC,
 * `sc_wagered` accrues, capped at `sc_required`.
 *
 * Both operations below are single atomic UPSERTs (INSERT ... ON CONFLICT)
 * so concurrent grants/wagers for the same user can't lose an update to a
 * race - same pattern as economy/ledger.ts's balance updates.
 */

import { TxClient } from "./ledger";

export interface PlaythroughState {
  required: number;
  wagered: number;
}

export async function getPlaythroughState(tx: TxClient, userId: string): Promise<PlaythroughState> {
  const row = await tx.playthroughProgress.findUnique({ where: { userId } });
  return { required: row?.scRequired ?? 0, wagered: row?.scWagered ?? 0 };
}

/**
 * Call whenever an SC bonus is granted (signup bonus or package bonus) to
 * add its 1x wagering requirement. `scBonusAmount` must be positive - a
 * non-positive amount is a no-op, matching the client.
 */
export async function addPlaythroughRequirement(
  tx: TxClient,
  userId: string,
  scBonusAmount: number
): Promise<void> {
  if (!Number.isFinite(scBonusAmount) || scBonusAmount <= 0) return;

  await tx.$executeRaw`
    INSERT INTO playthrough_progress (user_id, sc_required, sc_wagered)
    VALUES (${userId}, ${scBonusAmount}, 0)
    ON CONFLICT (user_id) DO UPDATE
      SET sc_required = playthrough_progress.sc_required + ${scBonusAmount}
  `;
}

/**
 * Call whenever the player wagers SC. Progress is capped at `required` -
 * wagering beyond what's owed doesn't roll over or go negative, and
 * doesn't let progress "bank" ahead of a future bonus grant.
 */
export async function recordScWager(tx: TxClient, userId: string, wagerAmount: number): Promise<void> {
  if (!Number.isFinite(wagerAmount) || wagerAmount <= 0) return;

  await tx.$executeRaw`
    INSERT INTO playthrough_progress (user_id, sc_required, sc_wagered)
    VALUES (${userId}, 0, 0)
    ON CONFLICT (user_id) DO UPDATE
      SET sc_wagered = LEAST(
        playthrough_progress.sc_required,
        playthrough_progress.sc_wagered + ${wagerAmount}
      )
  `;
}

export function remainingPlaythrough(state: PlaythroughState): number {
  return Math.max(0, state.required - state.wagered);
}

export function isPlaythroughCleared(state: PlaythroughState): boolean {
  return remainingPlaythrough(state) <= 0;
}

export function playthroughProgressFraction(state: PlaythroughState): number {
  if (state.required <= 0) return 1;
  return Math.min(1, state.wagered / state.required);
}
