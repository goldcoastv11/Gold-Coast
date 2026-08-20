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

export async function serializeMe(tx: TxClient, userId: string, username: string): Promise<MeResponse> {
  const [
    goldCoins,
    stakeCoins,
    skinsOwned,
    equippedSkin,
    lastPosition,
    playthrough,
    attendantClaim,
    adRewardClaim,
    activeRound
  ] = await Promise.all([
    getBalance(tx, userId, "GC"),
    getBalance(tx, userId, "SC"),
    listOwnedSkins(tx, userId),
    getEquippedSkin(tx, userId),
    tx.lastPosition.findUnique({ where: { userId } }),
    getPlaythroughState(tx, userId),
    tx.attendantClaim.findUnique({ where: { userId } }),
    // .catch(() => null): self-healing safety net for the window between
    // deploying this code and actually running `railway run npx prisma
    // migrate deploy` for the ad_reward_claim table in production (this
    // repo's migrations are NOT applied automatically on deploy anymore -
    // see DEPLOYMENT.md). Without this, EVERY authenticated response that
    // embeds MeResponse (signup/login/GET-me/skins/buy/etc. - not just
    // /ads/claim) 500s outright the instant this code goes live, because
    // Promise.all rejects the whole group if any one query fails - and
    // "relation ad_reward_claim does not exist" is a real Postgres error,
    // not a Prisma-level miss, so it can't be caught any narrower than
    // this. Once the migration has actually run, this query succeeds
    // normally and the catch never fires - safe to remove later, but not
    // urgent since it's a no-op post-migration.
    tx.adRewardClaim.findUnique({ where: { userId } }).catch(() => null),
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
      lastClaimedAt: adRewardClaim?.lastClaimedAt ? adRewardClaim.lastClaimedAt.toISOString() : null
    },
    activeRound: activeRound ? { game: activeRound.game, roundId: activeRound.id } : null
  };
}
