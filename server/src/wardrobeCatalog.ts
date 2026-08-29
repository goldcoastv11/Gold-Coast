/**
 * Wardrobe catalog - server-side copy of casino-poc/src/wardrobeCatalog.ts.
 *
 * Same deliberate duplication as itemCatalog.ts (and the skinCatalog.ts this
 * replaced): the client has no server package to import from, so this is a
 * copy, not a divergent source of truth. Keep the two in sync by hand - ids,
 * slots and prices below are copied verbatim. `wardrobe.catalog.test.ts`
 * pins the shape; the client's own test pins the same ids/prices, so a
 * one-sided edit shows up as a failing test rather than as players being
 * charged one price and shown another.
 *
 * The rendering-only fields (`file`, `placeholderColor`) are deliberately
 * NOT copied - the server never draws anything, and a field it can't use is
 * a field that can silently drift.
 *
 * See the client file for the full design rationale: why a character is a
 * stack of layers, why z-order is data, and why BODY is the one
 * non-optional slot with a free default that can never be un-equipped.
 */

export type WardrobeSlot = "BODY" | "LEGS" | "FEET" | "TORSO" | "HAIR" | "HAT";

export interface WardrobeSlotDef {
  slot: WardrobeSlot;
  name: string;
  /** Explicit draw order, low to high. Carried server-side so /wardrobe can serve it to any client. */
  z: number;
  /** Whether "wearing nothing here" is allowed. False for BODY only. */
  optional: boolean;
}

export const WARDROBE_SLOTS: readonly WardrobeSlotDef[] = [
  { slot: "BODY", name: "Body", z: 0, optional: false },
  { slot: "LEGS", name: "Trousers", z: 10, optional: true },
  { slot: "FEET", name: "Shoes", z: 20, optional: true },
  { slot: "TORSO", name: "Shirt", z: 30, optional: true },
  { slot: "HAIR", name: "Hair", z: 40, optional: true },
  { slot: "HAT", name: "Hat", z: 50, optional: true }
];

export interface WardrobePieceDef {
  id: string;
  slot: WardrobeSlot;
  name: string;
  price: number; // TICKETS. 0 = free (the default body).
}

/** The free default body every player owns implicitly. Never sold, never removable. */
export const DEFAULT_BODY_PIECE_ID = "body_default";

export const WARDROBE_CATALOG: readonly WardrobePieceDef[] = [
  { id: DEFAULT_BODY_PIECE_ID, slot: "BODY", name: "Classic", price: 0 },
  { id: "body_tan", slot: "BODY", name: "Tan", price: 150 },
  { id: "body_deep", slot: "BODY", name: "Deep", price: 150 },

  { id: "hair_short", slot: "HAIR", name: "Short Crop", price: 120 },
  { id: "hair_long", slot: "HAIR", name: "Long", price: 180 },
  { id: "hair_ponytail", slot: "HAIR", name: "Ponytail", price: 220 },
  { id: "hair_bleach", slot: "HAIR", name: "Bleached", price: 300 },

  { id: "torso_tee", slot: "TORSO", name: "Plain Tee", price: 200 },
  { id: "torso_hoodie", slot: "TORSO", name: "Hoodie", price: 380 },
  { id: "torso_vest", slot: "TORSO", name: "Dealer Vest", price: 600 },
  { id: "torso_suit", slot: "TORSO", name: "Suit Jacket", price: 1200 },

  { id: "legs_jeans", slot: "LEGS", name: "Jeans", price: 200 },
  { id: "legs_slacks", slot: "LEGS", name: "Slacks", price: 350 },
  { id: "legs_shorts", slot: "LEGS", name: "Shorts", price: 160 },

  { id: "feet_sneakers", slot: "FEET", name: "Sneakers", price: 150 },
  { id: "feet_boots", slot: "FEET", name: "Boots", price: 260 },
  { id: "feet_dress", slot: "FEET", name: "Dress Shoes", price: 400 },

  { id: "hat_cap", slot: "HAT", name: "Ball Cap", price: 250 },
  { id: "hat_visor", slot: "HAT", name: "Dealer Visor", price: 500 },
  { id: "hat_fedora", slot: "HAT", name: "Fedora", price: 900 }
];

export function getSlotDef(slot: WardrobeSlot): WardrobeSlotDef | undefined {
  return WARDROBE_SLOTS.find((s) => s.slot === slot);
}

export function getPiece(id: string): WardrobePieceDef | undefined {
  return WARDROBE_CATALOG.find((p) => p.id === id);
}

export function listPiecesBySlot(slot: WardrobeSlot): WardrobePieceDef[] {
  return WARDROBE_CATALOG.filter((p) => p.slot === slot);
}

/** True for the free default body - owned implicitly by everyone, never stored as an ownership row. */
export function isDefaultPiece(id: string): boolean {
  return id === DEFAULT_BODY_PIECE_ID;
}
