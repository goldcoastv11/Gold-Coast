/**
 * Player Room furniture catalog (roadmap/room-furniture) - server-side copy
 * of casino-poc/src/furnitureCatalog.ts. The third decor category
 * alongside src/roomCatalog.ts's wallpaper/flooring, deliberately kept in
 * its own file rather than folded into that one - see this file's "Why
 * this is its own file" section.
 *
 * ## Why this is its own file, not a third RoomSlot
 *
 * Wallpaper/flooring are "one piece equipped per category, always
 * something there, never empty" (roomCatalog.ts's whole design). Furniture
 * is "many owned pieces, each optionally placed into one of a handful of
 * fixed POSITION slots, normally empty" - a genuinely different shape, not
 * a bigger version of the same one:
 *   - Buying a piece does NOT place it (roomCatalog.ts's purchasePiece
 *     always also equips; economy/furniture.ts's purchasePiece never does)
 *     - see economy/furniture.ts's header for why.
 *   - A slot's "nothing placed" is the default and permanently valid state,
 *     unlike WALLPAPER/FLOORING which can never be empty.
 *   - Slots are POSITIONS (WALL_LEFT, CORNER, ...), not categories - any
 *     piece can go in any slot, so there's no per-slot piece list the way
 *     listPiecesBySlot() gives roomCatalog.ts.
 *
 * ## Where the art comes from
 *
 * Same as roomCatalog.ts: no art is sourced, everything is drawn
 * procedurally in BootScene.ts (createFurnitureTextures) keyed by each
 * piece's `id`, matching the warm overworld palette.
 *
 * ## Duplication with the client copy is deliberate
 *
 * Same reasoning as roomCatalog.ts/wardrobeCatalog.ts's own headers: no
 * shared package to import from, so this file and src/furnitureCatalog.ts
 * on the client are kept in sync by hand. Keep ids/prices/slot ids
 * identical - the server copy is what's actually charged and persisted.
 */

/**
 * A fixed placement position in the Player Room. Stable, named identity
 * (not an array index) - matches schema.prisma's FurnitureSlot enum
 * exactly, so adding a slot later can never silently move an existing
 * placement (see that enum's own doc comment).
 */
export type FurnitureSlotId = "WALL_LEFT" | "WALL_RIGHT" | "CORNER" | "BY_DOOR";

export interface FurnitureSlotDef {
  id: FurnitureSlotId;
  /** Player-facing position name, e.g. "Left Wall". */
  name: string;
}

/**
 * Four sensible spots around the room, picked to stay clear of the
 * spawn-to-door walking corridor (see src/scenes/RoomScene.ts's
 * FURNITURE_SLOT_POSITIONS, which maps each id here to a world pixel
 * position). Every slot here is emptyable - there is no `optional` field
 * the way roomCatalog.ts's RoomSlotDef has one, because for furniture that
 * would always read `true`.
 */
export const FURNITURE_SLOTS: readonly FurnitureSlotDef[] = [
  { id: "WALL_LEFT", name: "Left Wall" },
  { id: "WALL_RIGHT", name: "Right Wall" },
  { id: "CORNER", name: "Corner" },
  { id: "BY_DOOR", name: "By the Door" }
];

export interface FurniturePieceDef {
  /** Stable id - the ownership/placement key AND the texture key BootScene.ts registers for it. */
  id: string;
  name: string;
  /** Price in Gold Coins. Furniture has no free default - every piece here costs something. */
  price: number;
  /** Swatch tint for the shop panel, used the same way roomCatalog.ts's placeholderColor is. */
  placeholderColor: number;
}

/**
 * Five pieces for four slots - deliberately one more piece than slot, same
 * "visibly incomplete, plausibly finishable" design point roomCatalog.ts's
 * own catalog comment makes, plus one extra so filling every slot is an
 * actual choice (which piece stays in the drawer) rather than a foregone
 * "buy exactly N things."
 */
export const FURNITURE_CATALOG: readonly FurniturePieceDef[] = [
  { id: "furniture_armchair", name: "Armchair", price: 350, placeholderColor: 0xef8b3f },
  { id: "furniture_floor_lamp", name: "Floor Lamp", price: 220, placeholderColor: 0xf0b95e },
  { id: "furniture_bookshelf", name: "Bookshelf", price: 480, placeholderColor: 0xd8bd94 },
  { id: "furniture_potted_plant", name: "Potted Plant", price: 200, placeholderColor: 0x5cc47f },
  { id: "furniture_side_table", name: "Side Table", price: 260, placeholderColor: 0xb08e63 }
];

export function getFurnitureSlotDef(slot: string): FurnitureSlotDef | undefined {
  return FURNITURE_SLOTS.find((s) => s.id === slot);
}

export function isFurnitureSlotId(slot: string): slot is FurnitureSlotId {
  return FURNITURE_SLOTS.some((s) => s.id === slot);
}

export function getFurniturePiece(id: string): FurniturePieceDef | undefined {
  return FURNITURE_CATALOG.find((p) => p.id === id);
}
