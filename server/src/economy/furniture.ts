/**
 * Player Room furniture backend (roadmap/room-furniture) - server-
 * authoritative, mirroring economy/room.ts's shape where the two features
 * genuinely match (GC-only, always through the ledger) and deliberately
 * diverging where they don't (see below).
 *
 * ## Economy
 *
 * GC only, always through the ledger, never a direct balance mutation -
 * repo-root CLAUDE.md's rule. Debits reuse SHOP_PURCHASE_GC, the same
 * transaction type room.ts/wardrobe.ts/itemShop.ts all already use - a
 * furniture purchase is exactly the kind of thing that type's own
 * schema.prisma doc comment describes ("an Item Shop purchase"). Which
 * piece was bought is recorded in the transaction's `meta` for audit, same
 * as room.ts records its piece/slot.
 *
 * ## Why buying does NOT also place, unlike every other shop in this repo
 *
 * wardrobe.ts/room.ts/itemShop.ts all make "a purchase is always also
 * worn/applied/equipped" as a deliberate product decision. Furniture is
 * the one exception, per the founder's own framing (roadmap/room-furniture
 * task): "Owning a chair does not mean it is out; the player chooses which
 * slot it occupies." Two reasons this isn't just a style choice here:
 *   1. There's no single obvious slot to auto-place into the way
 *      "the WALLPAPER slot" is obvious for a wallpaper purchase - a newly
 *      bought chair could go in any of four positions, or none.
 *   2. All four slots might already be full. Auto-placing would then have
 *      to silently evict something the player placed on purpose, which is
 *      a worse default than just leaving the new piece in inventory.
 * So purchasePiece here ONLY debits GC and inserts a FurnitureOwned row;
 * placePiece is always a separate, explicit call.
 *
 * ## The "one piece, one slot" invariant
 *
 * A single owned piece can only occupy one slot at a time (there's only
 * one physical copy of it). placePiece enforces this by removing any
 * existing FurniturePlaced row for that (user, piece) - in whichever slot
 * it's currently in - before writing the new one, so placing an
 * already-placed piece elsewhere reads as a MOVE, not a duplicate.
 */

import { applyTransaction, getBalance, TxClient } from "./ledger";
import { awardXp, progressionAvailable, XP_ITEM_PURCHASE } from "../progression/progress";
import {
  FURNITURE_SLOTS,
  FurniturePieceDef,
  FurnitureSlotId,
  getFurniturePiece,
  isFurnitureSlotId
} from "../furnitureCatalog";

export type { FurniturePieceDef, FurnitureSlotId };

export async function ownsFurniturePiece(tx: TxClient, userId: string, id: string): Promise<boolean> {
  const row = await tx.furnitureOwned.findUnique({ where: { userId_pieceId: { userId, pieceId: id } } });
  return row !== null;
}

/** Every furniture piece id the player owns - unlike room.ts, no implicit free defaults to add in, furniture has none. */
export async function listOwnedFurniture(tx: TxClient, userId: string): Promise<string[]> {
  const rows = await tx.furnitureOwned.findMany({ where: { userId }, select: { pieceId: true } });
  return rows.map((r) => r.pieceId);
}

/**
 * What's currently placed, as a slot -> pieceId map. Unlike
 * room.ts's getEquippedRoom, a slot absent from the result means genuinely
 * EMPTY, not "falls back to a default" - furniture has no default. A
 * stored piece id no longer in the catalogue (retired) is dropped from the
 * result the same defensive way room.ts's getEquippedRoom drops a retired
 * wallpaper/floor.
 */
export async function getPlacedFurniture(
  tx: TxClient,
  userId: string
): Promise<Partial<Record<FurnitureSlotId, string>>> {
  const rows = await tx.furniturePlaced.findMany({
    where: { userId },
    select: { slot: true, pieceId: true }
  });

  const placed: Partial<Record<FurnitureSlotId, string>> = {};
  for (const row of rows) {
    if (getFurniturePiece(row.pieceId)) placed[row.slot as FurnitureSlotId] = row.pieceId;
  }
  return placed;
}

export type PurchaseFurnitureOutcome =
  | { ok: true; piece: FurniturePieceDef; transaction: Awaited<ReturnType<typeof applyTransaction>> }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "ALREADY_OWNED"; piece: FurniturePieceDef }
  | { ok: false; reason: "INSUFFICIENT_GC"; piece: FurniturePieceDef; balanceGc: number };

/**
 * Buys furniture piece `id` with GC. Debits the ledger and records
 * ownership only - deliberately does NOT place it anywhere (see this
 * file's header). The piece lands in inventory, unplaced, until the player
 * calls placePiece.
 */
export async function purchaseFurniture(
  tx: TxClient,
  userId: string,
  id: string
): Promise<PurchaseFurnitureOutcome> {
  const piece = getFurniturePiece(id);
  if (!piece) return { ok: false, reason: "NOT_FOUND" };
  if (await ownsFurniturePiece(tx, userId, id)) return { ok: false, reason: "ALREADY_OWNED", piece };

  const balanceGc = await getBalance(tx, userId, "GC");
  if (balanceGc < piece.price) {
    return { ok: false, reason: "INSUFFICIENT_GC", piece, balanceGc };
  }

  const transaction = await applyTransaction(tx, userId, "GC", "SHOP_PURCHASE_GC", -piece.price, {
    furniturePieceId: piece.id
  });
  await tx.furnitureOwned.create({ data: { userId, pieceId: id } });

  // Flat XP for buying - see economy/wardrobe.ts's purchasePiece for why
  // this is guarded separately (keeps the purchase itself working on an
  // environment where the progression migration hasn't landed yet). Fires
  // on the purchase itself, not on placePiece - buying is the spend, where
  // wardrobe/room/Item Shop wire the same purchase-then-wear moment.
  if (await progressionAvailable()) {
    await awardXp(tx, userId, XP_ITEM_PURCHASE);
  }

  return { ok: true, piece, transaction };
}

export type PlaceFurnitureOutcome =
  | { ok: true; piece: FurniturePieceDef; slot: FurnitureSlotId }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "SLOT_NOT_FOUND" }
  | { ok: false; reason: "NOT_OWNED"; piece: FurniturePieceDef };

/**
 * Places an owned piece into `slot`, replacing whatever piece was there
 * (mirrors room.ts's equipPiece "overwrite the slot" behavior - the
 * dislodged piece stays owned, just unplaced, same as it was before it was
 * ever placed). If the piece was already placed somewhere else, that other
 * slot is cleared first, so this reads as a MOVE rather than a duplicate -
 * see this file's header on the one-piece-one-slot invariant.
 */
export async function placeFurniture(
  tx: TxClient,
  userId: string,
  id: string,
  slot: string
): Promise<PlaceFurnitureOutcome> {
  const piece = getFurniturePiece(id);
  if (!piece) return { ok: false, reason: "NOT_FOUND" };
  if (!isFurnitureSlotId(slot)) return { ok: false, reason: "SLOT_NOT_FOUND" };
  if (!(await ownsFurniturePiece(tx, userId, id))) return { ok: false, reason: "NOT_OWNED", piece };

  // Clear any OTHER slot this same piece currently occupies (a move), then
  // clear whatever currently occupies the TARGET slot (an eviction back to
  // inventory), then write the new placement. Order doesn't matter for
  // correctness here since both are plain deletes keyed off different
  // fields, but doing the piece's own stale row first keeps a
  // piece-moved-into-its-own-slot no-op cheap and obviously safe.
  await tx.furniturePlaced.deleteMany({ where: { userId, pieceId: id } });
  await tx.furniturePlaced.upsert({
    where: { userId_slot: { userId, slot } },
    create: { userId, slot, pieceId: id },
    update: { pieceId: id }
  });

  return { ok: true, piece, slot };
}

export type RemoveFurnitureOutcome = { ok: true } | { ok: false; reason: "SLOT_NOT_FOUND" };

/**
 * Clears whatever's placed in `slot`, if anything - idempotent, same as
 * itemShop.ts's unequipItem: removing an already-empty slot is not an
 * error, it's just a no-op delete of zero rows.
 */
export async function removeFurniture(
  tx: TxClient,
  userId: string,
  slot: string
): Promise<RemoveFurnitureOutcome> {
  if (!isFurnitureSlotId(slot)) return { ok: false, reason: "SLOT_NOT_FOUND" };
  await tx.furniturePlaced.deleteMany({ where: { userId, slot } });
  return { ok: true };
}

export { FURNITURE_SLOTS };
