/**
 * Shared "user state" shape returned by GET /me and embedded in
 * POST /auth/signup and POST /auth/login's responses, so client-integration
 * can use one client-side type/handler for all three instead of three
 * slightly different shapes.
 */

import { TxClient } from "./economy/ledger";
import { getBalance } from "./economy/ledger";
import { getPlaythroughState } from "./economy/playthrough";
import { listOwnedSkins, getEquippedSkin } from "./economy/skinShop";
import { prisma } from "./db";

export interface MeResponse {
  username: string;
  goldCoins: number;
  stakeCoins: number;
  skinsOwned: string[];
  equippedSkin: string;
  lastPosition: { x: number; y: number } | null;
  playthrough: { required: number; wagered: number };
  attendantClaim: { lastClaimedAt: string | null };
  adReward: { lastClaimedAt: string | null };
  /**
   * The user's currently-active stateful-game round (Mines/Dragon Tower/
   * Hi-Lo/Blackjack/Video Poker), or null if none. Added alongside #42
   * (POST /games/abandon) so a client that lost its local roundId - reload,
   * crash, or the 401-auto-logout path re-authenticating later - can always
   * discover an orphaned round from `/me` alone and either resume it
   * (via the game's own resume/state endpoint, if any) or call
   * `POST /games/abandon` to forfeit it and unblock starting a new one,
   * without needing to have remembered which game/round it was.
   */
  activeRound: { game: string; roundId: string } | null;
}

/**
 * Reads the ad-reward claim row on the TOP-LEVEL `prisma` client -
 * deliberately NOT on the caller's `tx` (interactive transaction handle) -
 * and swallows any error into `null`.
 *
 * Why not just `tx.adRewardClaim.findUnique(...).catch(() => null)`: a
 * first attempt at that shipped and still 500'd every authenticated
 * response in production. Reason - once ANY query inside a Postgres
 * transaction errors (e.g. "relation ad_reward_claim does not exist",
 * because the migration for it hadn't been applied there yet - migrations
 * aren't automatic on deploy, see DEPLOYMENT.md), Postgres marks the WHOLE
 * transaction aborted; every other query sharing that same `tx` then fails
 * too ("current transaction is aborted, commands ignored until end of
 * transaction block"), no matter how the failing query's own promise is
 * caught in application code - the abort happens at the database
 * connection level, not the JS Promise level. Querying on a genuinely
 * separate connection (`prisma`, not `tx`) means a missing-table error
 * here can't poison whatever transaction the caller is in the middle of.
 * This is also just correct on its own merits, not only a migration-gap
 * workaround: this read is purely informational display data, not part of
 * the atomic write the rest of `serializeMe` might be participating in.
 */
async function getAdRewardLastClaimedAt(userId: string): Promise<string | null> {
  try {
    const row = await prisma.adRewardClaim.findUnique({ where: { userId } });
    return row?.lastClaimedAt ? row.lastClaimedAt.toISOString() : null;
  } catch {
    return null;
  }
}

export async function serializeMe(tx: TxClient, userId: string, username: string): Promise<MeResponse> {
  const [
    goldCoins,
    stakeCoins,
    skinsOwned,
    equippedSkin,
    lastPosition,
    playthrough,
    attendantClaim,
    adRewardLastClaimedAt,
    activeRound
  ] = await Promise.all([
    getBalance(tx, userId, "GC"),
    getBalance(tx, userId, "SC"),
    listOwnedSkins(tx, userId),
    getEquippedSkin(tx, userId),
    tx.lastPosition.findUnique({ where: { userId } }),
    getPlaythroughState(tx, userId),
    tx.attendantClaim.findUnique({ where: { userId } }),
    getAdRewardLastClaimedAt(userId),
    tx.gameRound.findFirst({ where: { userId, status: "active" }, select: { id: true, game: true } })
  ]);

  return {
    username,
    goldCoins,
    stakeCoins,
    skinsOwned,
    equippedSkin,
    lastPosition: lastPosition ? { x: lastPosition.x, y: lastPosition.y } : null,
    playthrough,
    attendantClaim: {
      lastClaimedAt: attendantClaim?.lastClaimedAt ? attendantClaim.lastClaimedAt.toISOString() : null
    },
    adReward: {
      lastClaimedAt: adRewardLastClaimedAt
    },
    activeRound: activeRound ? { game: activeRound.game, roundId: activeRound.id } : null
  };
}
