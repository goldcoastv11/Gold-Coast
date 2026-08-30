/**
 * DB flow for the level-up "stop the marker" timing minigame - see
 * levelMinigame.ts for the pure sweep/reward-curve math and
 * schema.prisma's LevelMinigameSession doc comment for the trust-boundary
 * writeup this whole module exists to enforce.
 *
 * TWO REQUESTS, ONE SESSION:
 *   1. `startLevelMinigame` - only creates a session if the player's
 *      PlayerProgress row actually says one is owed (pendingMinigameLevel
 *      set by progress.ts's grantPendingLevelRewards after a real XP
 *      grant). There is no client-supplied "I leveled up" input anywhere in
 *      this path - a call with nothing owed does nothing.
 *   2. `completeLevelMinigame` - computes the result entirely from the
 *      SERVER's own clock (`now - session.startedAt`) and the deterministic
 *      sweep formula, never from anything the client reports. See this
 *      file's and levelMinigame.ts's header comments for the latency
 *      caveat this implies.
 *
 * RESUMPTION, NOT RESET: if a session is already PENDING for a player
 * (they reloaded, or the request round-tripped twice), `startLevelMinigame`
 * returns that SAME session rather than minting a new one with a fresh
 * clock - the one exception is the anchor `level` field, which is bumped
 * up (never down) if a further level-up landed while the session sat
 * unplayed, so the payout still reflects the highest level reached. This
 * also means the clock keeps running across a reload rather than resetting
 * it - there is no "keep refreshing until the timing feels easy" move
 * available here.
 */

import { TxClient, applyTransaction } from "../economy/ledger";
import { levelMinigameAvailable } from "./progress";
import { accuracyFor, levelMinigameRewardGc, randomSweepPeriodMs, sweepPosition } from "./levelMinigame";

export interface LevelMinigameStartView {
  sessionId: string;
  level: number;
  sweepPeriodMs: number;
  /**
   * ISO instant the SERVER's clock started this session - included purely so
   * the client can re-derive the correct elapsed time on RESUMPTION (a
   * reload mid-game re-fetches the same still-PENDING session, whose clock
   * kept running - see this file's header). Exposing it changes nothing
   * about the trust boundary: `completeLevelMinigame` always recomputes
   * elapsed time from the DB row's own `startedAt` and the server's own
   * receive time, never from anything the client echoes back.
   */
  startedAt: string;
}

export type StartMinigameOutcome =
  | { ok: true; session: LevelMinigameStartView }
  | { ok: false; reason: "UNAVAILABLE" }
  | { ok: false; reason: "NONE_PENDING" };

/**
 * Starts (or resumes) the level-up minigame this player currently owes, per
 * PlayerProgress.pendingMinigameLevel. Returns NONE_PENDING - not an error,
 * just "nothing to do" - if the player doesn't owe one, which is also what
 * a forged call with no real level-up behind it gets.
 */
export async function startLevelMinigame(
  tx: TxClient,
  userId: string,
  now: Date = new Date()
): Promise<StartMinigameOutcome> {
  if (!(await levelMinigameAvailable())) return { ok: false, reason: "UNAVAILABLE" };

  const progress = await tx.playerProgress.findUnique({ where: { userId } });
  const owedLevel = progress?.pendingMinigameLevel ?? null;
  if (owedLevel == null) return { ok: false, reason: "NONE_PENDING" };

  const existing = await tx.levelMinigameSession.findFirst({
    where: { userId, status: "PENDING" },
    orderBy: { createdAt: "desc" }
  });

  if (existing) {
    const session =
      owedLevel > existing.level
        ? await tx.levelMinigameSession.update({ where: { id: existing.id }, data: { level: owedLevel } })
        : existing;
    return {
      ok: true,
      session: { sessionId: session.id, level: session.level, sweepPeriodMs: session.sweepPeriodMs, startedAt: session.startedAt.toISOString() }
    };
  }

  const session = await tx.levelMinigameSession.create({
    data: { userId, level: owedLevel, sweepPeriodMs: randomSweepPeriodMs(), startedAt: now }
  });
  return {
    ok: true,
    session: { sessionId: session.id, level: session.level, sweepPeriodMs: session.sweepPeriodMs, startedAt: session.startedAt.toISOString() }
  };
}

export type CompleteMinigameOutcome =
  | { ok: true; level: number; accuracy: number; rewardGc: number; position: number }
  | { ok: false; reason: "UNAVAILABLE" }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "ALREADY_CLAIMED" };

/**
 * Stops the marker and pays out. `sessionId` is the only thing the client
 * supplies - everything that decides the payout (elapsed time, marker
 * position, accuracy, Gold Coins) is computed here from the server's own
 * clock and the session's server-issued parameters.
 *
 * IDEMPOTENCY / NO-REPLAY (this credits real currency): the actual credit
 * is gated behind one atomic conditional `UPDATE ... WHERE status =
 * 'PENDING'`, the same idiom as progress.ts's challenge-claim and
 * level-reward guards - whichever request's UPDATE lands first wins and
 * flips the row to COMPLETED; a second call (retry, double-tap, replay)
 * matches zero rows and returns ALREADY_CLAIMED without crediting anything.
 */
export async function completeLevelMinigame(
  tx: TxClient,
  userId: string,
  sessionId: string,
  now: Date = new Date()
): Promise<CompleteMinigameOutcome> {
  if (!(await levelMinigameAvailable())) return { ok: false, reason: "UNAVAILABLE" };

  const session = await tx.levelMinigameSession.findUnique({ where: { id: sessionId } });
  // Scoped to this user - a forged sessionId belonging to someone else (or
  // one that never existed) reads as plain NOT_FOUND, same either way, so
  // there's no way to probe for a valid-but-not-yours id.
  if (!session || session.userId !== userId) return { ok: false, reason: "NOT_FOUND" };

  const elapsedMs = Math.max(0, now.getTime() - session.startedAt.getTime());
  const position = sweepPosition(elapsedMs, session.sweepPeriodMs);
  const accuracy = accuracyFor(position);
  const rewardGc = levelMinigameRewardGc(session.level, accuracy);

  const completed = await tx.$executeRaw`
    UPDATE level_minigame_sessions
    SET status = 'COMPLETED', completed_at = ${now}, accuracy = ${accuracy}, reward_gc = ${rewardGc}
    WHERE id = ${sessionId} AND user_id = ${userId} AND status = 'PENDING'
  `;
  if (completed === 0) return { ok: false, reason: "ALREADY_CLAIMED" };

  await applyTransaction(tx, userId, "GC", "LEVEL_MINIGAME_REWARD_GC", rewardGc, {
    sessionId,
    level: session.level,
    accuracy
  });

  // Clears the "owed" flag unconditionally. In the vanishingly rare case a
  // further level-up landed in the exact instant between this session being
  // issued and completed (e.g. a second browser tab claiming a challenge
  // mid-round), that later level-up's own minigame is simply picked up as
  // the NEXT one owed, the next time grantPendingLevelRewards runs - one
  // game per level-up event is the documented policy (see
  // PlayerProgress.pendingMinigameLevel), not a bug to special-case here.
  await tx.playerProgress.updateMany({ where: { userId }, data: { pendingMinigameLevel: null } });

  return { ok: true, level: session.level, accuracy, rewardGc, position };
}
