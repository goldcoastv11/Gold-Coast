import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BODY_PIECE_ID,
  WARDROBE_CATALOG,
  WARDROBE_SLOTS,
  WARDROBE_SLOT_ORDER,
  getPiece,
  getSlotDef,
  listPiecesBySlot,
  resolveLayers
} from "./wardrobeCatalog";
import {
  WARDROBE_CATALOG as SERVER_CATALOG,
  WARDROBE_SLOTS as SERVER_SLOTS
} from "../server/src/wardrobeCatalog";

/**
 * The layered wardrobe's client-side rules.
 *
 * Two things are worth testing here and they're both invariants rather than
 * behaviours: that a character can never resolve to nothing, and that draw
 * order comes from declared data rather than from whatever order things
 * happen to be in. Everything else about the wardrobe (ownership, prices,
 * the TICKETS debit) is server-authoritative and tested in
 * server/test/wardrobe.test.ts against a real database.
 */

describe("slot declarations", () => {
  it("gives every slot a distinct z, so draw order is never ambiguous", () => {
    const zs = WARDROBE_SLOTS.map((s) => s.z);
    expect(new Set(zs).size).toBe(zs.length);
  });

  it("draws the body underneath everything and the hat on top", () => {
    expect(WARDROBE_SLOT_ORDER[0]).toBe("BODY");
    expect(WARDROBE_SLOT_ORDER[WARDROBE_SLOT_ORDER.length - 1]).toBe("HAT");
  });

  it("layers clothing in dressing order - trousers, then shoes, then shirt", () => {
    // Shoes over trouser cuffs, shirt over the trouser waistband. Getting
    // this backwards is the classic layered-character bug and looks like
    // clipping rather than like a z-order mistake.
    const z = (slot: "LEGS" | "FEET" | "TORSO") => getSlotDef(slot)!.z;
    expect(z("LEGS")).toBeLessThan(z("FEET"));
    expect(z("FEET")).toBeLessThan(z("TORSO"));
  });

  it("makes BODY the only non-optional slot", () => {
    for (const slotDef of WARDROBE_SLOTS) {
      expect(slotDef.optional).toBe(slotDef.slot !== "BODY");
    }
  });
});

describe("catalogue", () => {
  it("has a free default body, priced at zero", () => {
    const body = getPiece(DEFAULT_BODY_PIECE_ID);
    expect(body).toBeDefined();
    expect(body!.slot).toBe("BODY");
    expect(body!.price).toBe(0);
  });

  it("prices every other piece above zero - only the default is free", () => {
    for (const piece of WARDROBE_CATALOG) {
      if (piece.id === DEFAULT_BODY_PIECE_ID) continue;
      expect(piece.price).toBeGreaterThan(0);
    }
  });

  it("has no duplicate piece ids - ids are the ownership and texture key", () => {
    const ids = WARDROBE_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers something to buy in every slot", () => {
    for (const slotDef of WARDROBE_SLOTS) {
      expect(listPiecesBySlot(slotDef.slot).length).toBeGreaterThan(0);
    }
  });
});

/**
 * The imported art, and the attribution it is conditional on.
 *
 * Almost every piece in the catalogue is real LPC art brought in by
 * scripts/import-lpc.mjs, and taken under either CC0 or OGA-BY. OGA-BY
 * REQUIRES attribution: shipping the art without the credits file is a
 * licence breach, not a missing nicety. The import writes both together, so
 * the way they come apart is someone hand-editing one of the generated
 * files, deleting a PNG, or adding a catalogue entry by hand and pointing it
 * at art that was never imported - which is exactly what these catch.
 */
describe("imported art ships with its credits", () => {
  const ART_ROOT = path.resolve(__dirname, "../public/assets/characters/lpc");
  const credits = fs.readFileSync(path.join(ART_ROOT, "CREDITS.txt"), "utf8");
  const imported = WARDROBE_CATALOG.filter((p) => p.file?.startsWith("wardrobe/"));

  it("actually imported something - the catalogue is not all placeholders", () => {
    expect(imported.length).toBeGreaterThan(0);
  });

  it("has the art file every piece points at", () => {
    for (const piece of imported) {
      expect(fs.existsSync(path.join(ART_ROOT, piece.file!)), piece.id).toBe(true);
    }
  });

  it("credits every imported piece by id", () => {
    for (const piece of imported) {
      expect(credits.includes(`(${piece.id})`), piece.id).toBe(true);
    }
  });

  it("declares a walk-only layout for each, so BootScene remaps their frames", () => {
    // A walk sheet left as "full" would have its frames looked up on a
    // 13-column grid it doesn't have, and render as garbage rather than
    // failing.
    for (const piece of imported) {
      expect(piece.sheetLayout, piece.id).toBe("walk");
    }
  });
});

/**
 * The client and server each carry their own copy of the catalogue - there
 * is no shared package between them, the same deliberate duplication
 * itemCatalog.ts already lives with. Duplication is only safe if drift is
 * loud, so these tests are the thing that makes it loud.
 *
 * The failure this prevents is specific and nasty: a price edited on one
 * side only means the shop shows one number and the ledger debits another.
 */
describe("client and server catalogues agree", () => {
  it("lists exactly the same pieces, with the same slots and prices", () => {
    const normalise = (pieces: readonly { id: string; slot: string; name: string; price: number }[]) =>
      [...pieces]
        .map((p) => ({ id: p.id, slot: p.slot, name: p.name, price: p.price }))
        .sort((a, b) => a.id.localeCompare(b.id));

    expect(normalise(SERVER_CATALOG)).toEqual(normalise(WARDROBE_CATALOG));
  });

  it("declares the same slots, draw order and optionality", () => {
    const normalise = (slots: readonly { slot: string; name: string; z: number; optional: boolean }[]) =>
      [...slots]
        .map((s) => ({ slot: s.slot, name: s.name, z: s.z, optional: s.optional }))
        .sort((a, b) => a.slot.localeCompare(b.slot));

    expect(normalise(SERVER_SLOTS)).toEqual(normalise(WARDROBE_SLOTS));
  });
});

describe("resolveLayers - the never-invisible-player invariant", () => {
  it("always produces a body, even from a completely empty wardrobe", () => {
    const layers = resolveLayers({});
    expect(layers.length).toBe(1);
    expect(layers[0].slot).toBe("BODY");
    expect(layers[0].piece.id).toBe(DEFAULT_BODY_PIECE_ID);
  });

  it("falls back to the default body when the equipped body is unknown", () => {
    // A piece retired from the catalogue after someone equipped it.
    const layers = resolveLayers({ BODY: "body_that_no_longer_exists" });
    expect(layers[0].piece.id).toBe(DEFAULT_BODY_PIECE_ID);
  });

  it("falls back to the default body when BODY is explicitly null", () => {
    const layers = resolveLayers({ BODY: null });
    expect(layers.some((l) => l.slot === "BODY")).toBe(true);
  });

  it("never returns an empty stack for any single-slot input", () => {
    for (const slotDef of WARDROBE_SLOTS) {
      expect(resolveLayers({ [slotDef.slot]: null }).length).toBeGreaterThan(0);
    }
  });
});

describe("resolveLayers - ordering and skipping", () => {
  it("returns layers sorted by declared z, not by the order they were equipped", () => {
    // Deliberately built hat-first, i.e. the exact reverse of draw order.
    const layers = resolveLayers({
      HAT: "hat_cap",
      HAIR: "hair_short",
      TORSO: "torso_tee",
      FEET: "feet_boots",
      LEGS: "legs_jeans",
      BODY: DEFAULT_BODY_PIECE_ID
    });

    expect(layers.map((l) => l.slot)).toEqual(["BODY", "LEGS", "FEET", "TORSO", "HAIR", "HAT"]);
    // And the z values themselves come back ascending.
    const zs = layers.map((l) => l.z);
    expect([...zs].sort((a, b) => a - b)).toEqual(zs);
  });

  it("draws nothing for an optional slot left empty", () => {
    const layers = resolveLayers({ BODY: DEFAULT_BODY_PIECE_ID, TORSO: "torso_tee" });
    expect(layers.map((l) => l.slot)).toEqual(["BODY", "TORSO"]);
  });

  it("skips an unknown piece in an optional slot rather than throwing", () => {
    const layers = resolveLayers({ BODY: DEFAULT_BODY_PIECE_ID, HAT: "hat_retired" });
    expect(layers.map((l) => l.slot)).toEqual(["BODY"]);
  });

  it("ignores a piece equipped into the wrong slot", () => {
    // A shirt id stored under HAT - malformed state that should degrade to
    // "no hat", not to a shirt drawn on someone's head.
    const layers = resolveLayers({ BODY: DEFAULT_BODY_PIECE_ID, HAT: "torso_tee" });
    expect(layers.map((l) => l.slot)).toEqual(["BODY"]);
  });

  it("resolves a full outfit to one layer per worn slot", () => {
    const layers = resolveLayers({
      BODY: "body_tan",
      HAIR: "hair_long",
      TORSO: "torso_suit",
      LEGS: "legs_slacks",
      FEET: "feet_dress",
      HAT: "hat_fedora"
    });
    expect(layers.length).toBe(6);
    expect(layers.map((l) => l.piece.id)).toEqual([
      "body_tan",
      "legs_slacks",
      "feet_dress",
      "torso_suit",
      "hair_long",
      "hat_fedora"
    ]);
  });
});
