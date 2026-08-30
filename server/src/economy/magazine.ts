/**
 * The Magazine (roadmap/magazine) - "a Magazine button that shows 5
 * players' rooms" (founder ask, confirmed usernames are shown - whose room
 * it is is part of the appeal).
 *
 * ## No job scheduler, so the daily rotation is DERIVED, not written
 *
 * Same constraint periods.ts's header explains for daily/weekly
 * challenges: this project has no cron/queue worker, so "pick 5 rooms and
 * rotate them once a day" can never be a nightly job writing today's
 * picks into a table - there is nothing that would run it. Instead, which
 * 5 rooms show is a pure function of (which rooms exist to show, today's
 * UTC calendar date) recomputed on every request. Reuses
 * progression/periods.ts's `dailyPeriodKey` for the date key itself,
 * rather than inventing a second "what day is it" helper, so this project
 * has exactly one definition of "today" (see that file's own doc comment
 * on why UTC, not local time).
 *
 * ## Selection is a seeded shuffle, not a stored pick
 *
 * `pickMagazineUserIds` hashes `${dateKey}:${userId}` (SHA-256) and sorts
 * candidates by that hash. This is deterministic (same inputs -> same
 * order, so every player who opens the Magazine on the same UTC day sees
 * the same five rooms), changes completely the next day (a fresh dateKey
 * hashes to a fresh order), and needs no stored state at all - the "seed"
 * is just today's date string. Pure and DB-free on purpose: exported
 * separately from getMagazineRooms so the rotation logic itself is
 * unit-testable without a database.
 *
 * ## Only rooms "worth showing"
 *
 * A brand-new account's room is the always-decorated-room free default
 * (economy/room.ts's invariant) with nothing placed - five of those would
 * be five identical beige boxes, which is a bad feature, not a small one.
 * `isRoomWorthShowing` requires the room to differ from a stock account in
 * some real way: a non-default WALLPAPER or FLOORING, or at least one
 * placed furniture piece. A player who bought nothing but placed one
 * lamp still qualifies; a player who owns pieces but never equipped/placed
 * any of them (room.ts auto-equips on purchase, so this is only reachable
 * via furniture, which does NOT auto-place - see furniture.ts's header)
 * does not.
 *
 * ## Fewer than 5 real candidates
 *
 * `pickMagazineUserIds` slices to `count` AFTER sorting, so if there are
 * only 2 decorated rooms it simply returns those 2 in their seeded order -
 * never padded with empty rooms, never a fabricated player. See
 * repo-root CLAUDE.md's "never invent fake players" instruction.
 */

import { createHash } from "crypto";
import { TxClient } from "./ledger";
import { getEquippedRoom } from "./room";
import { getPlacedFurniture } from "./furniture";
import { DEFAULT_WALLPAPER_ID, DEFAULT_FLOORING_ID } from "../roomCatalog";
import { FurnitureSlotId } from "../furnitureCatalog";
import { dailyPeriodKey } from "../progression/periods";

/** How many rooms the Magazine shows at once - the founder's own number. */
export const MAGAZINE_ROOM_COUNT = 5;

/** Everything a read-only viewer needs to draw one player's room - and nothing else (no balances, no email, no progression). */
export interface MagazineRoomEntry {
  username: string;
  wallpaperId: string;
  flooringId: string;
  furniture: Partial<Record<FurnitureSlotId, string>>;
}

export interface MagazineResponse {
  /** UTC calendar date this selection is stable for - "2026-08-30". Changes at UTC midnight, same rollover progression/periods.ts's daily challenges use. */
  dateKey: string;
  rooms: MagazineRoomEntry[];
}

/** Today's Magazine date key - just progression/periods.ts's own daily key, re-exported under this feature's name so callers don't have to know the two features share one clock. */
export function magazineDateKey(now: Date = new Date()): string {
  return dailyPeriodKey(now);
}

/** True if a room differs from a brand-new, undecorated account in some real way - see this file's header on why an all-default room never qualifies. */
export function isRoomWorthShowing(
  equipped: { WALLPAPER: string; FLOORING: string },
  placedFurniture: Partial<Record<FurnitureSlotId, string>>
): boolean {
  if (equipped.WALLPAPER !== DEFAULT_WALLPAPER_ID) return true;
  if (equipped.FLOORING !== DEFAULT_FLOORING_ID) return true;
  return Object.keys(placedFurniture).length > 0;
}

/** Deterministic per-(dateKey, userId) score - stable ordering with no stored state (see this file's header). Hex string, not a parsed number: fixed-length hex digests compare lexicographically exactly the way the underlying hash values would numerically, with no overflow/parsing edge cases. */
function magazineScore(dateKey: string, userId: string): string {
  return createHash("sha256").update(`${dateKey}:${userId}`).digest("hex");
}

/**
 * Orders `candidateIds` by a seeded shuffle keyed to `dateKey` and returns
 * the first `count` - the whole "same day same five, new day new five"
 * rotation in one pure, DB-free function (see this file's header). Fewer
 * than `count` candidates simply returns all of them, in the same seeded
 * order - never padded.
 */
export function pickMagazineUserIds(
  candidateIds: readonly string[],
  dateKey: string,
  count: number = MAGAZINE_ROOM_COUNT
): string[] {
  return [...candidateIds]
    .sort((a, b) => {
      const sa = magazineScore(dateKey, a);
      const sb = magazineScore(dateKey, b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    })
    .slice(0, count);
}

/**
 * Today's five (or fewer) Magazine rooms. Reads every user's equipped
 * room + placed furniture (cheap at this project's real scale - "about
 * five real accounts", per repo-root CLAUDE.md), filters to rooms worth
 * showing, then applies the seeded daily pick. Returns ONLY
 * username/wallpaper/flooring/furniture per room - see MagazineRoomEntry's
 * own doc comment on why nothing else is exposed here.
 */
export async function getMagazineRooms(tx: TxClient, now: Date = new Date()): Promise<MagazineResponse> {
  const dateKey = magazineDateKey(now);
  const users = await tx.user.findMany({ select: { id: true, username: true } });

  const candidates = await Promise.all(
    users.map(async (user) => {
      const [equipped, furniture] = await Promise.all([getEquippedRoom(tx, user.id), getPlacedFurniture(tx, user.id)]);
      return { id: user.id, username: user.username, equipped, furniture };
    })
  );

  const decorated = candidates.filter((c) => isRoomWorthShowing(c.equipped, c.furniture));
  const decoratedById = new Map(decorated.map((c) => [c.id, c]));

  const pickedIds = pickMagazineUserIds(
    decorated.map((c) => c.id),
    dateKey
  );

  const rooms: MagazineRoomEntry[] = pickedIds.map((id) => {
    const c = decoratedById.get(id)!;
    return {
      username: c.username,
      wallpaperId: c.equipped.WALLPAPER,
      flooringId: c.equipped.FLOORING,
      furniture: c.furniture
    };
  });

  return { dateKey, rooms };
}
