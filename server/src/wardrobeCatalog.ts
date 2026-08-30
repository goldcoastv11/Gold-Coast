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

import { LPC_WARDROBE_PIECES } from "./wardrobeLpcPieces";

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
  price: number; // Gold Coins. 0 = free (the default body).
}

/** The free default body every player owns implicitly. Never sold, never removable. */
export const DEFAULT_BODY_PIECE_ID = "body_default";

/**
 * The default body, then every piece the LPC art import brought in.
 *
 * `wardrobeLpcPieces.ts` is GENERATED, by scripts/import-lpc.mjs, from the
 * same pick-list that generates the client's copy - so the ids, names and
 * prices on the two sides come from one source and cannot drift apart by an
 * edit to one of them. (The client's copy carries the rendering fields this
 * one deliberately omits; see this file's header.) The catalogue-agreement
 * test still runs, because a hand edit to either generated file is exactly
 * the kind of drift it exists to catch.
 */
export const WARDROBE_CATALOG: readonly WardrobePieceDef[] = [
  { id: DEFAULT_BODY_PIECE_ID, slot: "BODY", name: "Classic", price: 0 },
  ...LPC_WARDROBE_PIECES
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
