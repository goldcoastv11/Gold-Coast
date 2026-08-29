/**
 * Wardrobe catalog - the layered character system that replaced the 17
 * monolithic character skins.
 *
 * ## What changed and why
 *
 * The Item Shop used to sell 17 complete characters, each its own separate
 * 21x32 spritesheet drawn from scratch. Buying one swapped the player's
 * whole texture. That model can't grow: every new look is a full character
 * redraw, and the looks share nothing with each other, so 17 outfits read
 * as 17 unrelated strangers rather than one person with a wardrobe.
 *
 * A character is now a STACK of images drawn in a fixed order over one
 * shared body - the native design of the LPC 64x64 format the rig system
 * already supports (see src/characterRig.ts's LPC_RIG). Players buy
 * individual pieces - hair, a shirt, trousers, shoes, a hat - and mix them
 * freely. One new shirt is one new PNG, not a new character.
 *
 * ## Z-order is DATA, not code order
 *
 * `WARDROBE_SLOTS` below declares each slot's `z` explicitly. Nothing may
 * infer draw order from array position, object key order, or the order
 * pieces happen to be equipped in - a shirt has to draw over trousers
 * whether it was bought first or last. Renderers sort by `z` (see
 * layeredCharacter.ts's `layerPlan`), and the ordering is pinned by tests.
 *
 * ## "Wearing nothing" and the always-there body
 *
 * Every slot except BODY is optional - no hat is a perfectly good look, and
 * the equip tables store absence as a missing row (same shape the
 * accessory/pet EquippedItem tables already use).
 *
 * BODY is different and deliberately so: it is `optional: false` with a
 * free `DEFAULT_BODY_PIECE_ID` that every player owns implicitly and can
 * never sell, un-equip or fail to have. That is the invariant that makes an
 * invisible player impossible - `resolveEquipped()` below falls back to it
 * for any missing, unknown or un-owned body.
 *
 * ## Adding a piece is a data change, never a code change
 *
 * Add one entry here (and the matching one in server/src/wardrobeCatalog.ts
 * - see that file on why the duplication is deliberate) plus a PNG in
 * public/assets/characters/lpc/, and the piece loads, layers, renders and
 * sells itself. No renderer, route or panel needs to know it exists. A
 * piece whose `file` is missing or fails to load falls back to generated
 * placeholder art rather than crashing or vanishing (see BootScene's
 * ensureWardrobePlaceholders) - which is what lets the whole catalogue
 * below exist before any real art does.
 */

/** Every layer a character is built from, drawn in `WARDROBE_SLOTS` z-order. */
export type WardrobeSlot = "BODY" | "LEGS" | "FEET" | "TORSO" | "HAIR" | "HAT";

export interface WardrobeSlotDef {
  slot: WardrobeSlot;
  /** Player-facing slot name, e.g. "Shirt". */
  name: string;
  /**
   * Explicit draw order, low to high - higher numbers draw ON TOP. Gaps of
   * 10 are deliberate so a future slot (a belt between LEGS and TORSO, a
   * backpack behind everything) can be inserted without renumbering
   * anything that already exists.
   */
  z: number;
  /** Whether "wearing nothing here" is allowed. False for BODY only. */
  optional: boolean;
}

/**
 * The layer stack, in draw order. BODY first/lowest, HAT last/highest.
 *
 * The order here matches the LPC generator's own layering convention:
 * trousers over the bare body, shoes over the trouser cuffs, shirt over the
 * trouser waistband, hair over the head, hat over the hair.
 */
export const WARDROBE_SLOTS: readonly WardrobeSlotDef[] = [
  { slot: "BODY", name: "Body", z: 0, optional: false },
  { slot: "LEGS", name: "Trousers", z: 10, optional: true },
  { slot: "FEET", name: "Shoes", z: 20, optional: true },
  { slot: "TORSO", name: "Shirt", z: 30, optional: true },
  { slot: "HAIR", name: "Hair", z: 40, optional: true },
  { slot: "HAT", name: "Hat", z: 50, optional: true }
];

export interface WardrobePieceDef {
  /** Stable id - the ownership/equip key, and the piece's texture key. */
  id: string;
  slot: WardrobeSlot;
  name: string;
  /** Price in TICKETS. 0 = free (the default body). */
  price: number;
  /**
   * Filename inside public/assets/characters/lpc/, once real art exists.
   * Optional: a piece with no file (or whose file fails to load) renders
   * generated placeholder art instead, so the catalogue is fully usable
   * before the founder exports anything. See docs/character-art-spec.md.
   */
  file?: string;
  /**
   * Placeholder tint, used ONLY by the generated stand-in art and by the
   * shop's swatch when a piece has no real image yet. Real art ignores it.
   */
  placeholderColor: number;
}

/**
 * The free default body every player starts with and always owns. Never
 * priced, never sold, never removable - see this file's header.
 */
export const DEFAULT_BODY_PIECE_ID = "body_default";

export const WARDROBE_CATALOG: readonly WardrobePieceDef[] = [
  // --- BODY (free default + alternates) ---
  // The one piece with REAL art. `body_base.png` is a genuine 832x3456 LPC
  // sheet (13 columns x 54 rows of 64x64 frames - see
  // public/assets/characters/lpc/CREDITS.txt for the authors and licences),
  // so every player's default character is now 64x64 hand-drawn pixel art
  // rather than the flat block placeholder below. Nothing else had to
  // change to wire it in: declaring `file` is the whole integration, exactly
  // as this file's header promises.
  {
    id: DEFAULT_BODY_PIECE_ID,
    slot: "BODY",
    name: "Classic",
    price: 0,
    file: "body_base.png",
    placeholderColor: 0xffc999
  },
  { id: "body_tan", slot: "BODY", name: "Tan", price: 150, placeholderColor: 0xe0a878 },
  { id: "body_deep", slot: "BODY", name: "Deep", price: 150, placeholderColor: 0x8d5a3b },

  // --- HAIR ---
  { id: "hair_short", slot: "HAIR", name: "Short Crop", price: 120, placeholderColor: 0x4a3524 },
  { id: "hair_long", slot: "HAIR", name: "Long", price: 180, placeholderColor: 0x2c1e14 },
  { id: "hair_ponytail", slot: "HAIR", name: "Ponytail", price: 220, placeholderColor: 0xc98b3a },
  { id: "hair_bleach", slot: "HAIR", name: "Bleached", price: 300, placeholderColor: 0xf0e2b0 },

  // --- TORSO ---
  { id: "torso_tee", slot: "TORSO", name: "Plain Tee", price: 200, placeholderColor: 0x5b9fd6 },
  { id: "torso_hoodie", slot: "TORSO", name: "Hoodie", price: 380, placeholderColor: 0x37806a },
  { id: "torso_vest", slot: "TORSO", name: "Dealer Vest", price: 600, placeholderColor: 0x9e2f2f },
  { id: "torso_suit", slot: "TORSO", name: "Suit Jacket", price: 1200, placeholderColor: 0x2b2f3a },

  // --- LEGS ---
  { id: "legs_jeans", slot: "LEGS", name: "Jeans", price: 200, placeholderColor: 0x3a5f8a },
  { id: "legs_slacks", slot: "LEGS", name: "Slacks", price: 350, placeholderColor: 0x3d3d46 },
  { id: "legs_shorts", slot: "LEGS", name: "Shorts", price: 160, placeholderColor: 0xc98b5a },

  // --- FEET ---
  { id: "feet_sneakers", slot: "FEET", name: "Sneakers", price: 150, placeholderColor: 0xf0f0f0 },
  { id: "feet_boots", slot: "FEET", name: "Boots", price: 260, placeholderColor: 0x5a3d28 },
  { id: "feet_dress", slot: "FEET", name: "Dress Shoes", price: 400, placeholderColor: 0x1e1e24 },

  // --- HAT ---
  { id: "hat_cap", slot: "HAT", name: "Ball Cap", price: 250, placeholderColor: 0xef8b3f },
  { id: "hat_visor", slot: "HAT", name: "Dealer Visor", price: 500, placeholderColor: 0x2f7a4a },
  { id: "hat_fedora", slot: "HAT", name: "Fedora", price: 900, placeholderColor: 0x33291f }
];

/** Slot ids in draw order (low z first). */
export const WARDROBE_SLOT_ORDER: readonly WardrobeSlot[] = [...WARDROBE_SLOTS]
  .sort((a, b) => a.z - b.z)
  .map((s) => s.slot);

export function getSlotDef(slot: WardrobeSlot): WardrobeSlotDef | undefined {
  return WARDROBE_SLOTS.find((s) => s.slot === slot);
}

export function getPiece(id: string): WardrobePieceDef | undefined {
  return WARDROBE_CATALOG.find((p) => p.id === id);
}

export function listPiecesBySlot(slot: WardrobeSlot): WardrobePieceDef[] {
  return WARDROBE_CATALOG.filter((p) => p.slot === slot);
}

/** True for the free default body, which is owned implicitly and never sold. */
export function isDefaultPiece(id: string): boolean {
  return id === DEFAULT_BODY_PIECE_ID;
}

/** What a player is wearing: one optional piece id per slot. */
export type EquippedWardrobe = Partial<Record<WardrobeSlot, string | null>>;

/** One layer to draw: the piece and the explicit z it draws at. */
export interface WardrobeLayer {
  slot: WardrobeSlot;
  piece: WardrobePieceDef;
  z: number;
}

/**
 * Turns "what the player is wearing" into an ordered, render-ready layer
 * stack - the single place equip state becomes draw order, shared by the
 * overworld renderer and the wardrobe panel's preview so the two can never
 * disagree about what a character looks like.
 *
 * Guarantees, in order of how much they matter:
 *  1. The result ALWAYS contains a BODY layer. An absent, unknown or
 *     not-owned body falls back to the free default rather than producing
 *     an empty stack - there is no input to this function that yields an
 *     invisible character.
 *  2. Layers come back sorted by the slot's declared `z`, never by the key
 *     order of `equipped` or the order of the catalogue.
 *  3. A piece id that isn't in the catalogue any more (an old save, a
 *     retired piece) is skipped for optional slots rather than throwing.
 */
export function resolveLayers(equipped: EquippedWardrobe): WardrobeLayer[] {
  const layers: WardrobeLayer[] = [];

  for (const slotDef of WARDROBE_SLOTS) {
    const id = equipped[slotDef.slot] ?? null;
    const piece = id ? getPiece(id) : undefined;

    if (piece && piece.slot === slotDef.slot) {
      layers.push({ slot: slotDef.slot, piece, z: slotDef.z });
      continue;
    }

    // Nothing valid equipped here. Optional slots simply draw nothing; the
    // required BODY slot falls back to the free default so the character
    // always has something to render.
    if (!slotDef.optional) {
      const fallback = getPiece(DEFAULT_BODY_PIECE_ID);
      if (fallback) layers.push({ slot: slotDef.slot, piece: fallback, z: slotDef.z });
    }
  }

  return layers.sort((a, b) => a.z - b.z);
}
