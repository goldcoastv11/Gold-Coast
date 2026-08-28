/**
 * Shared "user state" shape returned by GET /me and embedded in
 * POST /auth/signup and POST /auth/login's responses, so client-integration
 * can use one client-side type/handler for all three instead of three
 * slightly different shapes.
 */

import { TxClient } from "./economy/ledger";
import { getBalance } from "./economy/ledger";
import { listOwnedSkins, getEquippedSkin } from "./economy/skinShop";
import { listOwnedItems, getEquippedItem } from "./economy/itemShop";
import { getProgressionForDisplay } from "./progression/progress";
import { prisma } from "./db";

export interface MeResponse {
  username: string;
  goldCoins: number;
  tickets: number;
  skinsOwned: string[];
  equippedSkin: string;
  /** Accessory/pet ids owned - see economy/itemShop.ts. Read defensively (see getItemShopState's doc comment) - never breaks the rest of this response if the items_owned/equipped_items tables aren't migrated yet on this environment. */
  ownedItems: string[];
  equippedAccessory: string | null;
  equippedPet: string | null;
  lastPosition: { x: number; y: number } | null;
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
  /**
   * The player's level ("prestige number") and total XP - see
   * progression/levels.ts. Included here rather than left to GET
   * /progression so the level can be shown anywhere the player is shown
   * without a second round trip. Read defensively (see
   * getProgressionForDisplay) - degrades to level 1 rather than breaking
   * every authenticated response on an environment where the progression
   * migration hasn't been applied yet.
   */
  progression: { level: number; xp: number };
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

/**
 * Same isolation as getAdRewardLastClaimedAt above, same reason: items_owned/
 * equipped_items are a BRAND NEW migration (see schema.prisma's ItemOwned/
 * EquippedItem doc comment) that won't exist on any environment until
 * someone runs `railway run npx prisma migrate deploy` against it (see
 * server/DEPLOYMENT.md) - which does NOT happen automatically on a plain
 * `git push`/Netlify deploy. Reading these two tables on the caller's
 * shared `tx` would abort that WHOLE transaction the instant this ships to
 * an environment that hasn't had the migration applied yet - and
 * serializeMe's `tx` is shared by literally every authenticated response
 * (login, signup, /me, every skin/item/game route), so that single missing-
 * migration gap would 500 the entire app, not just the new items feature.
 * Reading on the separate top-level `prisma` client and swallowing to a
 * safe empty/unequipped default means a missing migration just degrades
 * this one feature (items show as empty/nothing-equipped) instead of
 * breaking everything else.
 */
async function getItemShopState(
  userId: string
): Promise<{ ownedItems: string[]; equippedAccessory: string | null; equippedPet: string | null }> {
  try {
    const [ownedItems, equippedAccessory, equippedPet] = await Promise.all([
      listOwnedItems(prisma, userId),
      getEquippedItem(prisma, userId, "ACCESSORY"),
      getEquippedItem(prisma, userId, "PET")
    ]);
    return { ownedItems, equippedAccessory, equippedPet };
  } catch {
    return { ownedItems: [], equippedAccessory: null, equippedPet: null };
  }
}

export async function serializeMe(tx: TxClient, userId: string, username: string): Promise<MeResponse> {
  const [
    goldCoins,
    tickets,
    skinsOwned,
    equippedSkin,
    itemShopState,
    lastPosition,
    attendantClaim,
    adRewardLastClaimedAt,
    activeRound,
    progression
  ] = await Promise.all([
    getBalance(tx, userId, "GC"),
    getBalance(tx, userId, "TICKETS"),
    listOwnedSkins(tx, userId),
    getEquippedSkin(tx, userId),
    getItemShopState(userId),
    tx.lastPosition.findUnique({ where: { userId } }),
    tx.attendantClaim.findUnique({ where: { userId } }),
    getAdRewardLastClaimedAt(userId),
    tx.gameRound.findFirst({ where: { userId, status: "active" }, select: { id: true, game: true } }),
    getProgressionForDisplay(userId)
  ]);

  return {
    username,
    goldCoins,
    tickets,
    skinsOwned,
    equippedSkin,
    ownedItems: itemShopState.ownedItems,
    equippedAccessory: itemShopState.equippedAccessory,
    equippedPet: itemShopState.equippedPet,
    lastPosition: lastPosition ? { x: lastPosition.x, y: lastPosition.y } : null,
    attendantClaim: {
      lastClaimedAt: attendantClaim?.lastClaimedAt ? attendantClaim.lastClaimedAt.toISOString() : null
    },
    adReward: {
      lastClaimedAt: adRewardLastClaimedAt
    },
    activeRound: activeRound ? { game: activeRound.game, roundId: activeRound.id } : null,
    progression
  };
}
