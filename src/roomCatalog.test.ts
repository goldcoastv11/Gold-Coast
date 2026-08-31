import { describe, expect, it } from "vitest";
import { ROOM_CATALOG, ROOM_SLOTS } from "./roomCatalog";
import { ROOM_CATALOG as SERVER_CATALOG, ROOM_SLOTS as SERVER_SLOTS } from "../server/src/roomCatalog";

/**
 * The client and server each carry their own copy of this catalogue - no
 * shared package to import from (this file's own header explains why; see
 * also wardrobeCatalog.test.ts's identical "catalogues agree" test, which
 * this mirrors, and furnitureCatalog.test.ts's sibling for the third decor
 * category). Hand-written on both sides, not generated - so nothing else
 * catches a one-sided edit. This test is what makes that drift loud
 * instead of silent: a price (or id, or slot) changed on only one side
 * means the room shows one number and the ledger debits another.
 */
describe("client and server room catalogues agree", () => {
  it("lists exactly the same pieces, with the same slots and prices", () => {
    const normalise = (pieces: readonly { id: string; slot: string; name: string; price: number }[]) =>
      [...pieces]
        .map((p) => ({ id: p.id, slot: p.slot, name: p.name, price: p.price }))
        .sort((a, b) => a.id.localeCompare(b.id));

    expect(normalise(SERVER_CATALOG)).toEqual(normalise(ROOM_CATALOG));
  });

  it("declares the same slots", () => {
    const normalise = (slots: readonly { slot: string; name: string; optional: boolean }[]) =>
      [...slots]
        .map((s) => ({ slot: s.slot, name: s.name, optional: s.optional }))
        .sort((a, b) => a.slot.localeCompare(b.slot));

    expect(normalise(SERVER_SLOTS)).toEqual(normalise(ROOM_SLOTS));
  });
});
