/**
 * Item catalog - server-side copy of casino-poc/src/itemCatalog.ts's
 * ITEM_CATALOG (same deliberate duplication as wardrobeCatalog.ts - the client
 * has no server package to import from, so this is a copy, not a divergent
 * source of truth. Keep the two in sync by hand - ids/prices/render fields
 * below are copied verbatim).
 *
 * Two categories beyond skins, both TICKETS-only (repo-root CLAUDE.md's
 * economy rule) and both "wear nothing" is a valid state, unlike a skin:
 *
 * - ACCESSORY: a floating emoji badge worn just above the player's head in
 *   the Overworld - always faces the camera, no per-direction art needed.
 *   "Easier version to test" per user direction - a true fitted/directional
 *   hat-and-glasses overlay was considered and explicitly deferred.
 * - PET: a small companion sprite that follows the player around the
 *   Overworld. V1 reuses the game's existing spare Kenney character
 *   variants (npc2_sheet/npc3_sheet/npc4_sheet - see BootScene.ts, already
 *   loaded and already have walk animations via createKenneyWalkAnims) at
 *   a smaller scale, rather than sourcing new creature/animal art - same
 *   "start with the easier version to test" call. A real animal/creature
 *   pet pack is a natural follow-up once this is confirmed working.
 */

export type ItemCategory = "ACCESSORY" | "PET";

export interface ItemDef {
  id: string;
  category: ItemCategory;
  name: string;
  price: number; // TICKETS
  /** ACCESSORY only - the emoji rendered as a floating badge above the head. */
  emoji?: string;
  /** PET only - an already-loaded Kenney character spritesheet key (see BootScene.ts) shown at a smaller scale, walking via that key's existing `${textureKey-without-_sheet}_walk_${dir}` anims. */
  textureKey?: string;
}

export const ITEM_CATALOG: ItemDef[] = [
  { id: "acc_top_hat", category: "ACCESSORY", name: "Top Hat", price: 300, emoji: "🎩" },
  { id: "acc_shades", category: "ACCESSORY", name: "Shades", price: 250, emoji: "🕶️" },
  { id: "acc_crown", category: "ACCESSORY", name: "Crown", price: 800, emoji: "👑" },
  { id: "acc_headphones", category: "ACCESSORY", name: "Headphones", price: 200, emoji: "🎧" },
  { id: "acc_bow", category: "ACCESSORY", name: "Bow", price: 150, emoji: "🎀" },

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
