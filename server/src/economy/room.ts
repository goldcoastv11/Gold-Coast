/**
 * Player Room backend - server-authoritative, mirroring
 * economy/wardrobe.ts's shape exactly (see that file's own doc comment).
 * Anyone who can read wardrobe.ts can read this.
 *
 * ## Economy
 *
 * GC only, always through the ledger, never a direct balance mutation -
 * repo-root CLAUDE.md's rule. Debits reuse SHOP_PURCHASE_GC, the same
 * transaction type wardrobe.ts and itemShop.ts both already use - a room
 * decor purchase is exactly the kind of thing that type's own schema.prisma
 * doc comment describes ("an Item Shop purchase"), and reusing it avoids a
 * per-shop enum migration, same reasoning wardrobe.ts's header gives.
 * Which piece and slot was bought is recorded in the transaction's `meta`
 * for audit, same as wardrobe/items record their own piece/slot ids.
 *
 * ## The always-decorated-room invariant
 *
 * Both slots (WALLPAPER, FLOORING) are non-optional with a free default
 * piece, owned implicitly by everyone and never written as an ownership
 * row - the same pattern wardrobe.ts's BODY slot uses, generalized to two
 * slots instead of one. There is no unequip route here to match: unlike
 * the wardrobe's five optional slots, neither of these can ever be
 * "nothing applied," so there's nothing to take off, only something to
 * swap.
 */

import { applyTransaction, getBalance, TxClient } from "./ledger";
import { awardXp, progressionAvailable, XP_ITEM_PURCHASE } from "../progression/progress";
import {
  DEFAULT_PIECE_ID,
  getPiece,
  isDefaultPiece,
  RoomPieceDef,
  RoomSlot,
  ROOM_SLOTS
} from "../roomCatalog";

export type { RoomPieceDef, RoomSlot };

/** Owned pieces as stored. Either free default is implicit and never a row. */
export async function ownsPiece(tx: TxClient, userId: string, id: string): Promise<boolean> {
  if (isDefaultPiece(id)) return true; // free default - always owned, never stored.
  const row = await tx.roomOwned.findUnique({ where: { userId_pieceId: { userId, pieceId: id } } });
  return row !== null;
}

/** Every decor piece id the player owns, with both implicit free defaults included. */
export async function listOwnedPieces(tx: TxClient, userId: string): Promise<string[]> {
  const rows = await tx.roomOwned.findMany({ where: { userId }, select: { pieceId: true } });
  return [DEFAULT_PIECE_ID.WALLPAPER, DEFAULT_PIECE_ID.FLOORING, ...rows.map((r) => r.pieceId)];
}

/**
 * What the room currently looks like, as a slot -> pieceId map.
 *
 * Both slots are always present in the result: a slot with no stored row,
 * or whose stored piece no longer exists in the catalogue, reports the
 * free default rather than being absent - mirrors wardrobe.ts's
 * getEquippedWardrobe, generalized from "just BODY" to "every slot here."
 */
export async function getEquippedRoom(tx: TxClient, userId: string): Promise<Record<RoomSlot, string>> {
  const rows = await tx.roomEquipped.findMany({
    where: { userId },
    select: { slot: true, pieceId: true }
  });

  const equipped: Partial<Record<RoomSlot, string>> = {};
  for (const row of rows) {
    // Skip a stored piece retired from the catalogue - same defensive
    // read wardrobe.ts's getEquippedWardrobe does.
    if (getPiece(row.pieceId)) equipped[row.slot as RoomSlot] = row.pieceId;
  }

  for (const slotDef of ROOM_SLOTS) {
    if (!equipped[slotDef.slot]) equipped[slotDef.slot] = DEFAULT_PIECE_ID[slotDef.slot];
  }

  return equipped as Record<RoomSlot, string>;
}

export type PurchasePieceOutcome =
  | { ok: true; piece: RoomPieceDef; transaction: Awaited<ReturnType<typeof applyTransaction>> }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "ALREADY_OWNED"; piece: RoomPieceDef }
  | { ok: false; reason: "INSUFFICIENT_GC"; piece: RoomPieceDef; balanceGc: number };

/**
 * Buys room piece `id` with GC and applies it immediately, in one DB
 * transaction - the same "a purchase is always also equipped" decision
 * wardrobe.ts/itemShop.ts both make, so a purchase can never land in an
 * "owned but not actually decorating the room" state.
 */
export async function purchasePiece(
  tx: TxClient,
  userId: string,
  id: string
): Promise<PurchasePieceOutcome> {
  const piece = getPiece(id);
  if (!piece) return { ok: false, reason: "NOT_FOUND" };
  if (await ownsPiece(tx, userId, id)) return { ok: false, reason: "ALREADY_OWNED", piece };

  const balanceGc = await getBalance(tx, userId, "GC");
  if (balanceGc < piece.price) {
    return { ok: false, reason: "INSUFFICIENT_GC", piece, balanceGc };
  }

  const transaction = await applyTransaction(tx, userId, "GC", "SHOP_PURCHASE_GC", -piece.price, {
    roomPieceId: piece.id,
    roomSlot: piece.slot
  });
  await tx.roomOwned.create({ data: { userId, pieceId: id } });
  await equipPiece(tx, userId, id);

  // Flat XP for buying - see economy/wardrobe.ts's purchasePiece for why
  // this is guarded separately (keeps the purchase itself working on an
  // environment where the progression migration hasn't landed yet).
  if (await progressionAvailable()) {
    await awardXp(tx, userId, XP_ITEM_PURCHASE);
  }

  return { ok: true, piece, transaction };
}

export type EquipPieceOutcome =
  | { ok: true; piece: RoomPieceDef }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "NOT_OWNED"; piece: RoomPieceDef };

/** Applies an owned piece to its slot, replacing whatever was there. */
export async function equipPiece(tx: TxClient, userId: string, id: string): Promise<EquipPieceOutcome> {
  const piece = getPiece(id);
  if (!piece) return { ok: false, reason: "NOT_FOUND" };
  if (!(await ownsPiece(tx, userId, id))) return { ok: false, reason: "NOT_OWNED", piece };

  await tx.roomEquipped.upsert({
    where: { userId_slot: { userId, slot: piece.slot } },
    create: { userId, slot: piece.slot, pieceId: id },
    update: { pieceId: id }
  });

  return { ok: true, piece };
}
