/**
 * Item shop (accessories/pets) - READ-ONLY now. This used to also be the
 * server-authoritative purchase/equip/unequip backend (generalizing the
 * now-removed skin shop's pattern to the ItemOwned/EquippedItem tables -
 * see schema.prisma's doc comment on those), reachable via routes/items.ts
 * and ShopPanel.ts's openItemPanel.
 *
 * The founder removed the Accessories/Pets entry point from the Item Shop
 * menu (2026-08-30, ShopPanel.ts's openShopCategoryMenu) - the layered
 * wardrobe replaced it as the "buy a look" flow. With no UI able to reach
 * it, routes/items.ts and this module's purchaseItem/equipItem/unequipItem
 * were dead code and were removed (2026-08-30 roadmap/deadcode, see
 * repo-root CLAUDE.md).
 *
 * What's kept, and why: a player who already equipped an accessory/pet
 * before the menu entry was removed still wears it in the overworld (see
 * OverworldScene.ts's applyEquippedAccessory/applyEquippedPet) - the
 * founder's explicit call. `progression/progress.ts`'s level-up cosmetic
 * grants (LEVEL_COSMETIC_UNLOCKS) also still write `items_owned` rows
 * directly. Both need the read functions below to keep working, so they
 * stay; the ItemOwned/EquippedItem tables themselves are untouched
 * (additive-only, same precedent as everything else retired here).
 */

import { TxClient } from "./ledger";
import { ItemCategory } from "../itemCatalog";

export type { ItemCategory };

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
