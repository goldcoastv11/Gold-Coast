/**
 * Shared "user state" shape returned by GET /me and embedded in
 * POST /auth/signup and POST /auth/login's responses, so client-integration
 * can use one client-side type/handler for all three instead of three
 * slightly different shapes.
 */

import { TxClient } from "./economy/ledger";
import { getBalance } from "./economy/ledger";
import { listOwnedPieces, getEquippedWardrobe } from "./economy/wardrobe";
import { DEFAULT_BODY_PIECE_ID, WardrobeSlot } from "./wardrobeCatalog";
import { listOwnedPieces as listOwnedRoomPieces, getEquippedRoom } from "./economy/room";
import { DEFAULT_PIECE_ID as ROOM_DEFAULT_PIECE_ID, RoomSlot } from "./roomCatalog";
import { listOwnedFurniture, getPlacedFurniture } from "./economy/furniture";
import { FurnitureSlotId } from "./furnitureCatalog";
import { listOwnedItems, getEquippedItem } from "./economy/itemShop";
import { getProgressionForDisplay } from "./progression/progress";
import { prisma } from "./db";

export interface MeResponse {
  username: string;
  goldCoins: number;
  tickets: number;
  /**
   * The layered wardrobe (see economy/wardrobe.ts) - what replaced the old
   * `skinsOwned`/`equippedSkin` pair when the 17 monolithic skins were
   * removed. `owned` always contains the free default body; `equipped`
   * always has a BODY entry, so a client can render a character from this
   * payload alone with no special-casing for a brand-new account.
   *
   * Read defensively (see getWardrobeState's doc comment) - never breaks
   * the rest of this response if the wardrobe tables aren't migrated yet on
   * this environment.
   */
  wardrobe: {
    owned: string[];
    equipped: Partial<Record<WardrobeSlot, string>>;
  };
  /**
   * The Player Room's wallpaper + flooring (see economy/room.ts) -
   * furniture is a separate `furniture` field below, a different enough
   * shape to not live in this one (see furnitureCatalog.ts's header).
   * `owned` always contains both free defaults; `equipped` always has a
   * WALLPAPER and FLOORING entry, so a client can render the room from
   * this payload alone with no special-casing for a brand-new account.
   *
   * Read defensively (see getRoomState's doc comment) - never breaks the
   * rest of this response if the room tables aren't migrated yet on this
   * environment.
   */
  room: {
    owned: string[];
    equipped: Partial<Record<RoomSlot, string>>;
  };
  /**
   * The Player Room's furniture (see economy/furniture.ts) - the third
   * decor category, added alongside wallpaper/flooring above but
   * deliberately a different shape: `owned` has no free defaults (there
   * are none for furniture) and `placed` only has an entry for slots that
   * are actually occupied - a missing key means genuinely empty, not "fell
   * back to a default" the way `room.equipped` works.
   *
   * Read defensively (see getFurnitureState's doc comment) - never breaks
   * the rest of this response if the furniture tables aren't migrated yet
   * on this environment.
   */
  furniture: {
    owned: string[];
    placed: Partial<Record<FurnitureSlotId, string>>;
  };
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

/**
 * Same isolation as getItemShopState above, same reason, and it matters
 * more here: wardrobe_owned/equipped_wardrobe are a brand-new migration
 * that won't exist on any environment until someone runs
 * `railway run npx prisma migrate deploy` against it - which does NOT
 * happen automatically on a plain git push. Reading them on the caller's
 * shared `tx` would abort that whole transaction on an environment where
 * the migration hasn't been applied, 500ing every authenticated response in
 * the app rather than just this feature.
 *
 * The degraded fallback is deliberately not empty: it reports the free
 * default body as owned and worn, so a player on an un-migrated backend
 * sees a plain character with an empty wardrobe rather than an invisible
 * one. That's the same never-invisible-player invariant economy/wardrobe.ts
 * enforces, held on the failure path too.
 */
async function getWardrobeState(userId: string): Promise<MeResponse["wardrobe"]> {
  try {
    const [owned, equipped] = await Promise.all([
      listOwnedPieces(prisma, userId),
      getEquippedWardrobe(prisma, userId)
    ]);
    return { owned, equipped };
  } catch {
    return { owned: [DEFAULT_BODY_PIECE_ID], equipped: { BODY: DEFAULT_BODY_PIECE_ID } };
  }
}

/**
 * Same isolation as getWardrobeState above, same reason: room_owned/
 * room_equipped are a brand-new migration that won't exist on any
 * environment until someone runs `railway run npx prisma migrate deploy`
 * against it. The degraded fallback reports both free defaults as owned
 * and applied, so a player on an un-migrated backend sees a plain,
 * default-decorated room rather than a broken one - same
 * always-decorated-room invariant economy/room.ts enforces, held on the
 * failure path too.
 */
async function getRoomState(userId: string): Promise<MeResponse["room"]> {
  try {
    const [owned, equipped] = await Promise.all([
      listOwnedRoomPieces(prisma, userId),
      getEquippedRoom(prisma, userId)
    ]);
    return { owned, equipped };
  } catch {
    return {
      owned: [ROOM_DEFAULT_PIECE_ID.WALLPAPER, ROOM_DEFAULT_PIECE_ID.FLOORING],
      equipped: { WALLPAPER: ROOM_DEFAULT_PIECE_ID.WALLPAPER, FLOORING: ROOM_DEFAULT_PIECE_ID.FLOORING }
    };
  }
}

/**
 * Same isolation as getRoomState above, same reason: furniture_owned/
 * furniture_placed are a brand-new migration that won't exist on any
 * environment until someone runs `railway run npx prisma migrate deploy`
 * against it. The degraded fallback reports nothing owned and every slot
 * empty - unlike getRoomState's fallback, which reaches for a free
 * default, there IS no default here to fall back to, so "nothing" is
 * already the correct degraded state, not a compromise.
 */
async function getFurnitureState(userId: string): Promise<MeResponse["furniture"]> {
  try {
    const [owned, placed] = await Promise.all([
      listOwnedFurniture(prisma, userId),
      getPlacedFurniture(prisma, userId)
    ]);
    return { owned, placed };
  } catch {
    return { owned: [], placed: {} };
  }
}

export async function serializeMe(tx: TxClient, userId: string, username: string): Promise<MeResponse> {
  const [
    goldCoins,
    tickets,
    wardrobe,
    room,
    furniture,
    itemShopState,
    lastPosition,
    attendantClaim,
    adRewardLastClaimedAt,
    activeRound,
    progression
  ] = await Promise.all([
    getBalance(tx, userId, "GC"),
    getBalance(tx, userId, "TICKETS"),
    getWardrobeState(userId),
    getRoomState(userId),
    getFurnitureState(userId),
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
    wardrobe,
    room,
    furniture,
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
