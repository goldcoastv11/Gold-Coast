/**
 * Item shop (accessories/pets) backend - server-authoritative, generalizing
 * the (now-removed) skin shop's pattern to the ItemOwned/EquippedItem tables (see
 * schema.prisma's doc comment on those). Reuses the SHOP_PURCHASE_GC
 * transaction type the wardrobe also uses rather than adding a new enum
 * value - the whole panel is already branded "Item Shop", not "Skin Shop"
 * (see OverworldScene.ts's openSkinPanel title), so any purchase made there
 * is legitimately "an Item Shop purchase"; the specific item/category is
 * recorded in the transaction's `meta` JSON for audit purposes instead of a
 * new type. GC-only as of the 2026-08-29 GC-only economy restructure - this
 * used to be TICKETS-only (see economy/wardrobe.ts's header for why the
 * price band itself is unchanged).
 *
 * Unlike skins (exactly one always equipped, defaulting to "player"),
 * accessories/pets support genuinely equipping NOTHING - unequipItem
 * deletes the EquippedItem row for that category rather than falling back
 * to some default id.
 */

import { applyTransaction, getBalance, TxClient } from "./ledger";
import { awardXp, progressionAvailable, XP_ITEM_PURCHASE } from "../progression/progress";
import { getItem, ItemCategory, ItemDef } from "../itemCatalog";

export type { ItemDef, ItemCategory };

export async function ownsItem(tx: TxClient, userId: string, id: string): Promise<boolean> {
  const row = await tx.itemOwned.findUnique({ where: { userId_itemId: { userId, itemId: id } } });
  return row !== null;
}

export async function listOwnedItems(tx: TxClient, userId: string): Promise<string[]> {
  const rows = await tx.itemOwned.findMany({ where: { userId }, select: { itemId: true } });
  return rows.map((r) => r.itemId);
}

/** Currently-equipped item id for `category`, or null if nothing's equipped there. */
export async function getEquippedItem(
  tx: TxClient,
  userId: string,
  category: ItemCategory
): Promise<string | null> {
  const row = await tx.equippedItem.findUnique({ where: { userId_category: { userId, category } } });
  return row?.itemId ?? null;
}

export type PurchaseItemOutcome =
  | { ok: true; item: ItemDef; transaction: Awaited<ReturnType<typeof applyTransaction>> }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "ALREADY_OWNED"; item: ItemDef }
  | { ok: false; reason: "INSUFFICIENT_GC"; item: ItemDef; balanceGc: number };

/**
 * Attempts to buy item `id` with GC for `userId`. On success, debits
 * the ledger, inserts an items_owned row, and equips it immediately in the
 * same transaction (same "a purchase is always also a wear" product
 * decision economy/wardrobe.ts's purchasePiece also makes) - this REPLACES whatever was
 * previously equipped in that item's category, same as buying a new skin
 * replaces the worn one.
 */
export async function purchaseItem(tx: TxClient, userId: string, id: string): Promise<PurchaseItemOutcome> {
  const item = getItem(id);
  if (!item) return { ok: false, reason: "NOT_FOUND" };
  if (await ownsItem(tx, userId, id)) return { ok: false, reason: "ALREADY_OWNED", item };

  const balanceGc = await getBalance(tx, userId, "GC");
  if (balanceGc < item.price) {
    return { ok: false, reason: "INSUFFICIENT_GC", item, balanceGc };
  }

  const transaction = await applyTransaction(tx, userId, "GC", "SHOP_PURCHASE_GC", -item.price, {
    itemId: item.id,
    itemCategory: item.category
  });
  await tx.itemOwned.create({ data: { userId, itemId: id } });
  await equipItem(tx, userId, id);

  // Flat XP for buying - see economy/wardrobe.ts's purchasePiece for why
  // this is guarded separately (keeps the purchase itself working on an
  // environment where the progression migration hasn't landed yet).
  if (await progressionAvailable()) {
    await awardXp(tx, userId, XP_ITEM_PURCHASE);
  }

  return { ok: true, item, transaction };
}

export type EquipItemOutcome =
  | { ok: true; item: ItemDef }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "NOT_OWNED"; item: ItemDef };

/** Equips item `id` for `userId` - must already own it. Replaces whatever else was equipped in the same category (one accessory + one pet at a time, per schema.prisma's EquippedItem doc comment). */
export async function equipItem(tx: TxClient, userId: string, id: string): Promise<EquipItemOutcome> {
  const item = getItem(id);
  if (!item) return { ok: false, reason: "NOT_FOUND" };
  if (!(await ownsItem(tx, userId, id))) return { ok: false, reason: "NOT_OWNED", item };

  await tx.equippedItem.upsert({
    where: { userId_category: { userId, category: item.category } },
    create: { userId, category: item.category, itemId: id },
    update: { itemId: id }
  });

  return { ok: true, item };
}

export type UnequipItemOutcome = { ok: true } | { ok: false; reason: "INVALID_CATEGORY" };

/** Clears whatever's equipped in `category` (if anything) - "wear nothing" is a valid, common state for accessories/pets, unlike skins. */
export async function unequipItem(
  tx: TxClient,
  userId: string,
  category: ItemCategory
): Promise<UnequipItemOutcome> {
  if (category !== "ACCESSORY" && category !== "PET") return { ok: false, reason: "INVALID_CATEGORY" };
  await tx.equippedItem.deleteMany({ where: { userId, category } });
  return { ok: true };
}
