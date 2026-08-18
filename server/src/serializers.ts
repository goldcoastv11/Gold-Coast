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
  const [goldCoins, stakeCoins, skinsOwned, equippedSkin, lastPosition, playthrough, attendantClaim, activeRound] =
    await Promise.all([
      getBalance(tx, userId, "GC"),
      getBalance(tx, userId, "SC"),
      listOwnedSkins(tx, userId),
      getEquippedSkin(tx, userId),
      tx.lastPosition.findUnique({ where: { userId } }),
      getPlaythroughState(tx, userId),
      tx.attendantClaim.findUnique({ where: { userId } }),
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
    activeRound: activeRound ? { game: activeRound.game, roundId: activeRound.id } : null
  };
}
