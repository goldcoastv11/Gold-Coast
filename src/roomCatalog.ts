/**
 * Player Room catalog - the private space reached by exiting the casino
 * floor (see src/scenes/RoomScene.ts), decorated with GC-bought wallpaper
 * and flooring.
 *
 * ## Scope of this slice
 *
 * Furniture is the founder-approved third decor category, but it needs
 * fixed placement SLOTS (a slot INDEX per placed item, not just "one piece
 * per category" the way wallpaper/flooring work) - a different enough
 * shape that it's scoped as its own follow-up rather than bolted on here
 * half-finished. This file, RoomScene.ts and the server's mirror
 * (server/src/roomCatalog.ts) cover wallpaper + flooring only.
 *
 * ## Why this mirrors wardrobeCatalog.ts, not itemCatalog.ts
 *
 * A room's wall and floor are always SOME piece, never "nothing applied" -
 * same invariant the wardrobe's BODY slot has (always worn, has a free
 * default, can't be unequipped), unlike itemCatalog.ts's ACCESSORY/PET
 * categories where "equipped: null" is a normal, common state. Both slots
 * here are `optional: false` for that reason.
 *
 * ## Where the art comes from
 *
 * No art is sourced for this - per the founder's direction, matching how
 * BootScene.ts already draws the casino's own furniture procedurally in
 * code. Each piece's `id` doubles as its texture key; BootScene.ts's room
 * decor generators (createRoomWallpaperTextures/createRoomFlooringTextures)
 * register a texture under every id in ROOM_CATALOG, so adding a piece here
 * needs a matching generator added there - there is no PNG to place.
 *
 * ## Duplication with the server copy is deliberate
 *
 * Same reasoning as wardrobeCatalog.ts's own header: no shared package to
 * import from, so this file and server/src/roomCatalog.ts are kept in sync
 * by hand. Keep ids/slots/prices identical - the server copy is what's
 * actually charged and persisted; this one is what's shown and rendered.
 */

/** The two decor categories this slice covers. FURNITURE is a planned third slot - see this file's header. */
export type RoomSlot = "WALLPAPER" | "FLOORING";

export interface RoomSlotDef {
  slot: RoomSlot;
  /** Player-facing category name, e.g. "Wallpaper". */
  name: string;
  /** Whether "nothing applied" is a valid state. False for both current slots. */
  optional: boolean;
}

export const ROOM_SLOTS: readonly RoomSlotDef[] = [
  { slot: "WALLPAPER", name: "Wallpaper", optional: false },
  { slot: "FLOORING", name: "Flooring", optional: false }
];

export interface RoomPieceDef {
  /** Stable id - the ownership/equip key AND the texture key BootScene.ts registers for it. */
  id: string;
  slot: RoomSlot;
  name: string;
  /** Price in Gold Coins. 0 = free (the default wallpaper/floor). */
  price: number;
  /** Swatch tint for the shop panel, used before/instead of rendering the real tiled texture in a small UI thumbnail. */
  placeholderColor: number;
}

export const DEFAULT_WALLPAPER_ID = "room_wallpaper_plain";
export const DEFAULT_FLOORING_ID = "room_floor_plain";

/** Which free default piece a slot falls back to. Mirrors wardrobeCatalog.ts's DEFAULT_BODY_PIECE_ID, generalized to two slots. */
export const DEFAULT_PIECE_ID: Record<RoomSlot, string> = {
  WALLPAPER: DEFAULT_WALLPAPER_ID,
  FLOORING: DEFAULT_FLOORING_ID
};

const DEFAULT_WALLPAPER: RoomPieceDef = {
  id: DEFAULT_WALLPAPER_ID,
  slot: "WALLPAPER",
  name: "Plain",
  price: 0,
  placeholderColor: 0xe4d3b0
};

const DEFAULT_FLOORING: RoomPieceDef = {
  id: DEFAULT_FLOORING_ID,
  slot: "FLOORING",
  name: "Bare Wood",
  price: 0,
  placeholderColor: 0xb08e63
};

/**
 * The two free defaults, then two paid options per slot - deliberately
 * short. This room exists to read as visibly INCOMPLETE: a small,
 * affordable catalogue a player can plausibly finish is what makes "one
 * piece bought" feel like progress rather than a drop in an ocean.
 */
export const ROOM_CATALOG: readonly RoomPieceDef[] = [
  DEFAULT_WALLPAPER,
  { id: "room_wallpaper_stripe", slot: "WALLPAPER", name: "Sunset Stripe", price: 400, placeholderColor: 0xef8b3f },
  { id: "room_wallpaper_floral", slot: "WALLPAPER", name: "Garden Bloom", price: 650, placeholderColor: 0x8ade9f },
  DEFAULT_FLOORING,
  { id: "room_floor_checker", slot: "FLOORING", name: "Checkerboard", price: 400, placeholderColor: 0xd8bd94 },
  { id: "room_floor_rug", slot: "FLOORING", name: "Woven Rug", price: 650, placeholderColor: 0xb9724c }
];

export function getSlotDef(slot: RoomSlot): RoomSlotDef | undefined {
  return ROOM_SLOTS.find((s) => s.slot === slot);
}

export function getPiece(id: string): RoomPieceDef | undefined {
  return ROOM_CATALOG.find((p) => p.id === id);
}

export function listPiecesBySlot(slot: RoomSlot): RoomPieceDef[] {
  return ROOM_CATALOG.filter((p) => p.slot === slot);
}

/** True for either free default piece, which is owned implicitly and never sold. */
export function isDefaultPiece(id: string): boolean {
  return id === DEFAULT_WALLPAPER_ID || id === DEFAULT_FLOORING_ID;
}

/**
 * What the player has applied: one piece id per slot, always fully
 * populated (falls back to the free default for a missing/unknown entry -
 * mirrors wardrobeCatalog.ts's EquippedWardrobe/resolveLayers pattern, one
 * level simpler since neither slot here is ever "worn nothing").
 */
export type EquippedRoom = Partial<Record<RoomSlot, string>>;

/** Resolves a possibly-partial equipped map into one guaranteed piece id per slot, falling back to the free default for anything missing or retired from the catalogue. */
export function resolveRoomDecor(equipped: EquippedRoom): Record<RoomSlot, RoomPieceDef> {
  const result = {} as Record<RoomSlot, RoomPieceDef>;
  for (const slotDef of ROOM_SLOTS) {
    const id = equipped[slotDef.slot];
    const piece = id ? getPiece(id) : undefined;
    result[slotDef.slot] = piece && piece.slot === slotDef.slot ? piece : getPiece(DEFAULT_PIECE_ID[slotDef.slot])!;
  }
  return result;
}
