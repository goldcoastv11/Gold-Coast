import { describe, expect, it } from "vitest";
import { ITEM_CATALOG } from "./itemCatalog";
import { ITEM_CATALOG as SERVER_CATALOG } from "../server/src/itemCatalog";

/**
 * The client and server each carry their own copy of this catalogue - no
 * shared package to import from, same reasoning as wardrobeCatalog.test.ts/
 * furnitureCatalog.test.ts/roomCatalog.test.ts's identical "catalogues
 * agree" tests, which this mirrors. The Item Shop UI that let a player buy
 * an accessory/pet was removed (2026-08-30 roadmap/deadcode) - what's left
 * of this catalogue only serves rendering an already-equipped one (see
 * OverworldScene.ts) and progression/levels.ts's LEVEL_COSMETIC_UNLOCKS
 * grants, both of which key off `id`. `textureKey` is deliberately NOT
 * compared - client-render-only, the server has no use for it (same
 * asymmetry wardrobeCatalog.test.ts's own test allows for `file`).
 */
describe("client and server item catalogues agree", () => {
  it("lists exactly the same items, with the same categories and prices", () => {
    const normalise = (items: readonly { id: string; category: string; name: string; price: number }[]) =>
      [...items]
        .map((i) => ({ id: i.id, category: i.category, name: i.name, price: i.price }))
        .sort((a, b) => a.id.localeCompare(b.id));

    expect(normalise(SERVER_CATALOG)).toEqual(normalise(ITEM_CATALOG));
  });
});
