/**
 * Item catalog - client-side copy of server/src/itemCatalog.ts's
 * ITEM_CATALOG (same deliberate duplication as GameState.ts's SKIN_CATALOG/
 * server/src/skinCatalog.ts - no shared package between client/server, see
 * skinCatalog.ts's own doc comment). Keep the two in sync by hand.
 *
 * See server/src/itemCatalog.ts's doc comment for the "easier version to
 * test" rendering decisions this catalog implies:
 * - ACCESSORY: a floating emoji badge above the head (OverworldScene.ts's
 *   applyEquippedAccessory) - no per-direction art.
 * - PET: an already-loaded spare Kenney NPC spritesheet
 *   (npc2_sheet/npc3_sheet/npc4_sheet - see BootScene.ts) at a smaller
 *   scale, following the player (OverworldScene.ts's applyEquippedPet/
 *   updatePetFollow) using that sheet's existing walk anims.
 */

export type ItemCategory = "ACCESSORY" | "PET";

export interface ItemDef {
  id: string;
  category: ItemCategory;
  name: string;
  price: number; // TICKETS
  emoji?: string;
  textureKey?: string;
}

export const ITEM_CATALOG: ItemDef[] = [
  // Accessory textureKeys are drawn procedurally (BootScene.ts's
  // createAccessoryTextures) rather than sourced externally - no CC0 pack
  // was found that matched this project's specific 16x16 character
  // scale/palette closely enough to read as "worn" rather than a
  // mismatched sticker (a plain-emoji first pass confirmed that risk live:
  // it read as floating near the HUD, not on the person). `emoji` is kept
  // only as a display fallback/catalog label, no longer the actual render.
  { id: "acc_top_hat", category: "ACCESSORY", name: "Top Hat", price: 300, emoji: "🎩", textureKey: "acc_top_hat" },
  { id: "acc_shades", category: "ACCESSORY", name: "Shades", price: 250, emoji: "🕶️", textureKey: "acc_shades" },
  { id: "acc_crown", category: "ACCESSORY", name: "Crown", price: 800, emoji: "👑", textureKey: "acc_crown" },
  {
    id: "acc_headphones",
    category: "ACCESSORY",
    name: "Headphones",
    price: 200,
    emoji: "🎧",
    textureKey: "acc_headphones"
  },
  { id: "acc_bow", category: "ACCESSORY", name: "Bow", price: 150, emoji: "🎀", textureKey: "acc_bow" },

  { id: "pet_buddy", category: "PET", name: "Buddy", price: 500, textureKey: "npc2_sheet" },
  { id: "pet_scout", category: "PET", name: "Scout", price: 600, textureKey: "npc3_sheet" },
  { id: "pet_shadow", category: "PET", name: "Shadow", price: 700, textureKey: "npc4_sheet" }
];

export function getItem(id: string): ItemDef | undefined {
  return ITEM_CATALOG.find((i) => i.id === id);
}

export function listItemsByCategory(category: ItemCategory): ItemDef[] {
  return ITEM_CATALOG.filter((i) => i.category === category);
}

/** Kenney NPC sheet key -> its walk-anim prefix (see BootScene.ts's createKenneyWalkAnims("npc2_sheet", "npc2") calls - the prefix strips "_sheet"). */
export function walkAnimPrefixForTexture(textureKey: string): string {
  return textureKey.replace(/_sheet$/, "");
}
