import { describe, expect, it } from "vitest";
import { FURNITURE_CATALOG, FURNITURE_SLOTS } from "./furnitureCatalog";
import {
  FURNITURE_CATALOG as SERVER_CATALOG,
  FURNITURE_SLOTS as SERVER_SLOTS
} from "../server/src/furnitureCatalog";

/**
 * The client and server each carry their own copy of this catalogue - no
 * shared package to import from (this file's own header explains why; see
 * also wardrobeCatalog.test.ts's identical "catalogues agree" test, which
 * this mirrors). Unlike the wardrobe catalogue, this one is hand-written on
 * both sides, not generated from one shared pick-list - so nothing else
 * catches a one-sided edit. This test is what makes that drift loud instead
 * of silent: a price (or id, or slot) changed on only one side means the
 * room shows one number and the ledger debits another.
 */
describe("client and server furniture catalogues agree", () => {
  it("lists exactly the same pieces, with the same prices", () => {
    const normalise = (pieces: readonly { id: string; name: string; price: number }[]) =>
      [...pieces]
        .map((p) => ({ id: p.id, name: p.name, price: p.price }))
        .sort((a, b) => a.id.localeCompare(b.id));

    expect(normalise(SERVER_CATALOG)).toEqual(normalise(FURNITURE_CATALOG));
  });

  it("declares the same slots", () => {
    const normalise = (slots: readonly { id: string; name: string }[]) =>
      [...slots].map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.id.localeCompare(b.id));

    expect(normalise(SERVER_SLOTS)).toEqual(normalise(FURNITURE_SLOTS));
  });
});
