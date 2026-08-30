/**
 * Player Room catalog - server-side copy of casino-poc/src/roomCatalog.ts.
 *
 * ## Why this exists
 *
 * The founder asked for exiting the casino floor to lead to a private
 * Room, decorated with wallpaper/flooring/furniture bought with GC. This
 * slice ships the Room plus its first two decor categories - wallpaper and
 * flooring. FURNITURE is intentionally not in this file yet: the founder
 * approved fixed placement SLOTS (not free drag-and-drop) for furniture,
 * which is a different shape (a slot INDEX per placed item, not just "one
 * piece per category") and is scoped as its own follow-up rather than
 * bolted on here half-finished.
 *
 * ## Why this mirrors wardrobeCatalog.ts almost exactly
 *
 * Same problem, same shape: a closed set of purchasable pieces, one
 * currently-active piece per category, a free default so the room is never
 * in an undecorated/undefined state. Copying that file's proven design
 * (rather than the itemCatalog.ts ACCESSORY/PET one, where "equipped: null"
 * is valid) is deliberate - a room's wall and floor are always SOMETHING,
 * the same way a body always is.
 *
 * ## Duplication with the client copy is deliberate
 *
 * Same reasoning as wardrobeCatalog.ts's own header: the server has no
 * shared package the client can import from, so this file and
 * src/roomCatalog.ts on the client are kept in sync by hand. Keep piece
 * ids, slots and prices identical between the two - the client uses this
 * only for display (what does the shop panel show, what does the swatch
 * look like); the server copy is what's actually charged and persisted.
 */

/** The two decor categories this slice covers. FURNITURE is a planned third slot - see this file's header. */
export type RoomSlot = "WALLPAPER" | "FLOORING";

export interface RoomSlotDef {
  slot: RoomSlot;
  /** Player-facing category name, e.g. "Wallpaper". */
  name: string;
  /** Whether "nothing applied" is a valid state. False for both current slots - a room always has some wall and some floor. */
  optional: boolean;
}

export const ROOM_SLOTS: readonly RoomSlotDef[] = [
  { slot: "WALLPAPER", name: "Wallpaper", optional: false },
  { slot: "FLOORING", name: "Flooring", optional: false }
];

export interface RoomPieceDef {
  /** Stable id - the ownership/equip key, and (client-side) the piece's texture key. */
  id: string;
  slot: RoomSlot;
  name: string;
  /** Price in Gold Coins. 0 = free (the default wallpaper/floor). */
  price: number;
  /** Swatch tint used by the shop panel and by the procedurally-drawn texture this piece maps to (see BootScene.ts's room decor generators). */
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
 * short. This room exists to read as visibly INCOMPLETE (see the roadmap
 * doc's design point): a small, affordable catalogue that a player can
 * plausibly finish is what makes "one piece bought" feel like progress
 * rather than a drop in an ocean.
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
