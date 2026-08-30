/**
 * GC-earned leaderboard - daily / weekly / all-time boards of "how much
 * Gold Coins has this player earned", computed straight from the
 * transaction ledger rather than a new tracking table: every GC gain is
 * already one row there with a timestamp (see economy/ledger.ts).
 *
 * "EARNED" (founder's own framing: "ALL Gold Coins gained... game winnings
 * plus challenge rewards, level rewards and Coin Kiosk claims. Not net
 * profit, not winnings alone") maps onto the closed TransactionType set as
 * EARNED_GC_TRANSACTION_TYPES below:
 *   - GAME_WIN_GC              - every one of the 14 games' shared
 *                                 settlement helpers' payout (games/shared.ts)
 *   - PAYOUT_GC                - Triple Chance's own payout (routes/games.ts).
 *                                 Also a real win paid to the player, just not
 *                                 routed through games/shared.ts (see that
 *                                 file's header comment on why Triple Chance
 *                                 keeps its own ledger calls) - included here
 *                                 as "game winnings" even though Triple
 *                                 Chance isn't counted among "the 14 games"
 *                                 elsewhere in the app. Worth the founder's
 *                                 own sanity check (called out in the PR).
 *   - CHALLENGE_REWARD_GC      - "challenge rewards"
 *   - LEVEL_REWARD_GC          - "level rewards"
 *   - LEVEL_MINIGAME_REWARD_GC - the level-up "stop the marker" minigame's
 *                                 bonus (progression/levelMinigameSession.ts)
 *                                 - also tied to levelling up, not called out
 *                                 by name in the founder's own list; included
 *                                 as a level reward, flagged in the PR
 *                                 alongside PAYOUT_GC for the same reason
 *   - AD_REWARD_GC              - "Coin Kiosk claims" (economy/adRewards.ts,
 *                                 economy/attendantClaim.ts)
 *
 * Deliberately EXCLUDED:
 *   - PACKAGE_GC      - a real-money purchase, not something "earned" - a
 *                        leaderboard that rewards spending real money is a
 *                        different feature the founder didn't ask for
 *   - SIGNUP_BONUS_GC - a one-time welcome grant, not tied to playing
 *   - ADJUST_GC       - a manual/admin balance correction, not organic play
 *   - WAGER_GC / SHOP_PURCHASE_GC / TICKETS_RETIRED - all debits, never gains
 *   - every SC/TICKETS-era type - fully retired, see repo-root CLAUDE.md;
 *     nothing may credit them any more regardless
 *
 * WINDOWS are derived from the current UTC instant, not a scheduled reset -
 * same no-job-scheduler precedent progression/periods.ts already set for
 * challenges (see that file's header comment for the full reasoning: UTC not
 * local time, Monday-start ISO week, no catch-up logic needed because
 * nothing is ever actually reset). startOfUtcDay/startOfUtcWeek live there,
 * not duplicated here, so "today"/"this week" can never mean two different
 * things between challenges and this leaderboard.
 *
 * PERFORMANCE: each window is one grouped SUM over `transactions`, filtered
 * by `type IN (...)` (and `created_at >=` for daily/weekly) - see
 * schema.prisma's Transaction model for the `[type, createdAt]` index added
 * alongside this file specifically so that filter doesn't become a full
 * table scan as the ledger grows.
 */

import { TransactionType } from "@prisma/client";
import { TxClient } from "./ledger";
import { startOfUtcDay, startOfUtcWeek } from "../progression/periods";

export type LeaderboardWindow = "daily" | "weekly" | "allTime";

/** See this file's header comment for what's included/excluded and why. */
export const EARNED_GC_TRANSACTION_TYPES: TransactionType[] = [
  "GAME_WIN_GC",
  "PAYOUT_GC",
  "CHALLENGE_REWARD_GC",
  "LEVEL_REWARD_GC",
  "LEVEL_MINIGAME_REWARD_GC",
  "AD_REWARD_GC"
];

export interface LeaderboardEntry {
  userId: string;
  username: string;
  earnedGc: number;
  /**
   * Standard competition ranking (1, 2, 2, 4 - a tie shares a rank and the
   * next rank skips ahead by the tie's size), not dense ranking (1, 2, 2,
   * 3): two players tied for 2nd both genuinely hold 2nd place, and the
   * next distinct player is 4th, not 3rd.
   */
  rank: number;
}

export interface LeaderboardBoard {
  /** Top N by earnedGc, ties broken by username (ascending) for a stable, non-arbitrary order. */
  top: LeaderboardEntry[];
  /**
   * The requesting player's own row + rank, even when outside `top` - most
   * of the motivation for a leaderboard is "where do I stand", not just
   * "who's #1". Null means the player has genuinely earned nothing in this
   * window yet (a real, correctly-absent case - they never had a matching
   * transaction row - not a loading/error state).
   */
  me: LeaderboardEntry | null;
}

export interface LeaderboardResponse {
  daily: LeaderboardBoard;
  weekly: LeaderboardBoard;
  allTime: LeaderboardBoard;
}

/** Top-N size for each board's `top` list. */
const TOP_N = 10;

function windowStart(window: LeaderboardWindow, now: Date): Date | null {
  if (window === "daily") return startOfUtcDay(now);
  if (window === "weekly") return startOfUtcWeek(now);
  return null;
}

/**
 * Every user's total earned GC for one window, sorted descending
 * (ties by username ascending) - a user who earned nothing in the window
 * simply has no row, same as `groupBy` naturally returns.
 */
async function sortedEarners(
  tx: TxClient,
  window: LeaderboardWindow,
  now: Date
): Promise<Array<{ userId: string; username: string; earnedGc: number }>> {
  const start = windowStart(window, now);

  const grouped = await tx.transaction.groupBy({
    by: ["userId"],
    where: {
      currency: "GC",
      type: { in: EARNED_GC_TRANSACTION_TYPES },
      ...(start ? { createdAt: { gte: start } } : {})
    },
    _sum: { amount: true }
  });

  // Every included type is credit-only in practice (see this file's header
  // comment - each is only ever applied with a positive amount, several
  // behind an explicit `if (payout > 0)`/`if (amount > 0)` guard at the call
  // site), so a real row's sum should never be <= 0. Filtered anyway as a
  // defensive floor rather than trusted blindly - a leaderboard is exactly
  // the kind of surface where a future regression upstream (a stray
  // negative `amount` on one of these types) would otherwise become
  // publicly visible as a player mysteriously ranked with 0 or negative GC.
  const earners = grouped
    .map((g) => ({ userId: g.userId, earnedGc: g._sum.amount ?? 0 }))
    .filter((g) => g.earnedGc > 0);

  if (earners.length === 0) return [];

  const users = await tx.user.findMany({
    where: { id: { in: earners.map((e) => e.userId) } },
    select: { id: true, username: true }
  });
  const usernameOf = new Map(users.map((u) => [u.id, u.username]));

  return earners
    .map((e) => ({ userId: e.userId, username: usernameOf.get(e.userId) ?? "?", earnedGc: e.earnedGc }))
    .sort((a, b) => b.earnedGc - a.earnedGc || a.username.localeCompare(b.username));
}

/** Attaches standard competition rank (see LeaderboardEntry.rank's doc comment) to an already-sorted list. */
function withRanks(
  sorted: Array<{ userId: string; username: string; earnedGc: number }>
): LeaderboardEntry[] {
  const ranked: LeaderboardEntry[] = [];
  let rank = 0;
  let prevEarned: number | null = null;
  sorted.forEach((e, i) => {
    if (prevEarned === null || e.earnedGc !== prevEarned) {
      rank = i + 1;
      prevEarned = e.earnedGc;
    }
    ranked.push({ ...e, rank });
  });
  return ranked;
}

async function loadBoard(
  tx: TxClient,
  window: LeaderboardWindow,
  userId: string,
  now: Date
): Promise<LeaderboardBoard> {
  const ranked = withRanks(await sortedEarners(tx, window, now));
  const top = ranked.slice(0, TOP_N);
  const me = ranked.find((e) => e.userId === userId) ?? null;
  return { top, me };
}

/** The full three-window response for GET /leaderboard. */
export async function getLeaderboard(
  tx: TxClient,
  userId: string,
  now: Date = new Date()
): Promise<LeaderboardResponse> {
  // Same "multiple queries against the same interactive tx via Promise.all"
  // pattern already used by routes/progression.ts's GET /progression and
  // several serializers.ts helpers - three independent reads, no reason to
  // serialize them.
  const [daily, weekly, allTime] = await Promise.all([
    loadBoard(tx, "daily", userId, now),
    loadBoard(tx, "weekly", userId, now),
    loadBoard(tx, "allTime", userId, now)
  ]);
  return { daily, weekly, allTime };
}
