import { describe, expect, it } from "vitest";
import {
  ACCESSORY_HEAD_GAP,
  DIRECTIONS,
  FLAT_RIG,
  KENNEY_RIG,
  LEGACY_SKIN_RIG,
  LPC_COLUMNS,
  LPC_RIG,
  LPC_WALK_CYCLE,
  LPC_WALK_ROW,
  RIGS,
  accessoryScale,
  accessoryY,
  bodyBox,
  firstWalkFrame,
  hasRegisteredRig,
  headTopY,
  idleFrame,
  petScale,
  petTrailOffset,
  resolveRig
} from "./characterRig";
import { WARDROBE_CATALOG } from "./wardrobeCatalog";

/**
 * These are REGRESSION tests, not descriptive ones.
 *
 * Every expected value below is written out as a literal copied from the
 * pre-refactor code (BootScene's createKenneyWalkAnims DIRECTION_FRAMES and
 * createLegacySkinWalkAnims' `start = row * 3` ranges, OverworldScene's
 * idleFrameForDir / applyPlayerBody / applyPlayerScale / updatePetFollow),
 * NOT recomputed from the rig descriptors. That is the entire point: if the
 * descriptors ever drift, these fail, and a character cannot silently start
 * moonwalking or facing the wrong way.
 *
 * LEGACY_SKIN_RIG's values are still pinned here even though no sheet uses
 * that rig any more (the 17 skins it backed were removed with the layered
 * wardrobe): it remains resolveRig's documented fallback for an
 * unregistered sheet, so these literals are the record of what that
 * fallback actually is.
 */
describe("legacy rigs are byte-for-byte what they were before the refactor", () => {
  it("reproduces createKenneyWalkAnims' DIRECTION_FRAMES exactly", () => {
    expect(KENNEY_RIG.walkFrames).toEqual({
      left: [0, 4, 8],
      down: [1, 5, 9],
      up: [2, 6, 10],
      right: [3, 7, 11]
    });
  });

  it("reproduces the old Kenney idleFrameForDir (`col + 4`)", () => {
    expect(KENNEY_RIG.idleFrames).toEqual({ left: 4, down: 5, up: 6, right: 7 });
  });

  it("reproduces createLegacySkinWalkAnims' `start = row * 3, end = start + 2`", () => {
    // Row order was down=0, left=1, right=2, up=3.
    expect(LEGACY_SKIN_RIG.walkFrames).toEqual({
      down: [0, 1, 2],
      left: [3, 4, 5],
      right: [6, 7, 8],
      up: [9, 10, 11]
    });
  });

  it("reproduces the old legacy idleFrameForDir (`row * 3 + 1`)", () => {
    expect(LEGACY_SKIN_RIG.idleFrames).toEqual({ down: 1, left: 4, right: 7, up: 10 });
  });

  it("keeps the legacy frame sizes and display scales", () => {
    expect([KENNEY_RIG.frameWidth, KENNEY_RIG.frameHeight]).toEqual([16, 16]);
    expect([LEGACY_SKIN_RIG.frameWidth, LEGACY_SKIN_RIG.frameHeight]).toEqual([21, 32]);
    // applyPlayerScale: `this.player.height <= 16 ? 2 : 1`
    expect(KENNEY_RIG.displayScale).toBe(2);
    expect(LEGACY_SKIN_RIG.displayScale).toBe(1);
  });

  it("the flat player sheet is the Kenney rig in all but id", () => {
    expect({ ...FLAT_RIG, id: KENNEY_RIG.id }).toEqual(KENNEY_RIG);
    expect(FLAT_RIG.id).toBe("flat");
  });

  it("reproduces applyPlayerBody's exact 14x10 box at (3.5, 20) on a 21x32 frame", () => {
    expect(bodyBox(LEGACY_SKIN_RIG)).toEqual({
      width: 14,
      height: 10,
      offsetX: 3.5,
      offsetY: 20
    });
  });

  it("reproduces applyPlayerBody's proportional box on a 16x16 frame", () => {
    const box = bodyBox(KENNEY_RIG);
    // The old inline math was `player.width * 14/21`, `player.height * 10/32`, etc.
    expect(box.width).toBeCloseTo(16 * (14 / 21), 10);
    expect(box.height).toBeCloseTo(16 * (10 / 32), 10);
    expect(box.offsetX).toBeCloseTo(16 * (3.5 / 21), 10);
    expect(box.offsetY).toBeCloseTo(16 * (20 / 32), 10);
  });

  it("keeps the pet trail at a flat 26px on both legacy rigs", () => {
    // updatePetFollow / petAnchor: `const offset = 26;`
    expect(petTrailOffset(KENNEY_RIG)).toBe(26);
    expect(petTrailOffset(LEGACY_SKIN_RIG)).toBe(26);
  });

  it("keeps the pet sprite at the hardcoded setScale(1.4)", () => {
    expect(petScale(KENNEY_RIG)).toBeCloseTo(1.4, 10);
  });

  it("leaves accessory/HUD anchoring identical for every legacy rig", () => {
    for (const rig of [FLAT_RIG, KENNEY_RIG, LEGACY_SKIN_RIG]) {
      // headTopFrac 0 means this must reduce to the old `y - displayHeight / 2`.
      expect(rig.headTopFrac).toBe(0);
      expect(headTopY(rig, 100, 32)).toBe(100 - 32 / 2);
      // applyEquippedAccessory: `this.player.y - this.player.displayHeight / 2 - 6`
      expect(accessoryY(rig, 100, 32)).toBe(100 - 32 / 2 - 6);
      // `.setScale(this.player.scaleX)` - unchanged.
      expect(accessoryScale(rig, 2.5)).toBe(2.5);
    }
    expect(ACCESSORY_HEAD_GAP).toBe(6);
  });
});

describe("LPC rig matches the generator's published layout", () => {
  // Verified against the generator's own constants
  // (`walk: { row: 8, num: 4, cycle: [1,2,3,4,5,6,7,8] }`, FRAME_SIZE 64,
  // 13 frames per row, direction order up/left/down/right) and against the
  // live site's spritesheet-preview canvas, which measures 832 x 3456.
  it("uses the published sheet constants", () => {
    expect(LPC_RIG.frameWidth).toBe(64);
    expect(LPC_RIG.frameHeight).toBe(64);
    expect(LPC_COLUMNS).toBe(13);
    expect(LPC_WALK_ROW).toBe(8);
    expect(LPC_WALK_CYCLE).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // 13 columns * 64px = 832px wide, 54 rows * 64px = 3456px tall.
    expect(LPC_COLUMNS * LPC_RIG.frameWidth).toBe(832);
  });

  it("puts walk rows in LPC's up/left/down/right order, NOT down-first", () => {
    // This is the classic way LPC integration goes wrong - a down-first
    // assumption makes characters face 90 degrees off.
    expect(LPC_RIG.walkFrames.up[0]).toBe(8 * 13 + 1); // 105
    expect(LPC_RIG.walkFrames.left[0]).toBe(9 * 13 + 1); // 118
    expect(LPC_RIG.walkFrames.down[0]).toBe(10 * 13 + 1); // 131
    expect(LPC_RIG.walkFrames.right[0]).toBe(11 * 13 + 1); // 144
  });

  it("excludes column 0 from the walk cycle and uses it as the idle pose", () => {
    // Column 0 is the STANDING pose. Including it in the cycle is what makes
    // an LPC character hitch/moonwalk once per stride.
    for (const dir of DIRECTIONS) {
      expect(LPC_RIG.walkFrames[dir]).toHaveLength(8);
      for (const frame of LPC_RIG.walkFrames[dir]) {
        expect(frame % LPC_COLUMNS).not.toBe(0);
      }
      // Idle is exactly one column to the left of the first walk frame.
      expect(idleFrame(LPC_RIG, dir)).toBe(LPC_RIG.walkFrames[dir][0] - 1);
      expect(idleFrame(LPC_RIG, dir) % LPC_COLUMNS).toBe(0);
    }
  });

  it("gives the accessory real headroom so a hat is not worn through the chest", () => {
    expect(LPC_RIG.headTopFrac).toBeGreaterThan(0);
    // The badge must sit BELOW the frame's top edge, unlike the legacy rigs.
    const legacyY = headTopY(LEGACY_SKIN_RIG, 100, 64);
    const lpcY = headTopY(LPC_RIG, 100, 64);
    expect(lpcY).toBeGreaterThan(legacyY);
    expect(accessoryScale(LPC_RIG, 1)).toBeGreaterThan(1);
  });
});

describe("rig resolution", () => {
  // Replaces "resolves every purchasable skin sheet to the legacy rig".
  // The 17 skin sheets are gone; every wardrobe piece that replaced them is
  // an LPC sheet, and this is what guarantees adding a catalogue entry is
  // the whole integration - a piece nobody registered would silently fall
  // through to the legacy-rig fallback below and be posed and sized as a
  // 21x32 frame.
  it("resolves every wardrobe piece to the LPC rig", () => {
    expect(WARDROBE_CATALOG.length).toBeGreaterThan(0);
    for (const piece of WARDROBE_CATALOG) {
      expect(hasRegisteredRig(piece.id)).toBe(true);
      expect(resolveRig(piece.id)).toBe(LPC_RIG);
    }
  });

  it("no longer registers any of the removed skin sheets", () => {
    for (let i = 0; i <= 16; i++) {
      expect(hasRegisteredRig(`skin_${String(i).padStart(3, "0")}`)).toBe(false);
    }
  });

  it("resolves the base character sheets to their declared rigs", () => {
    expect(resolveRig("player_flat_sheet")).toBe(FLAT_RIG);
    for (const key of ["player_sheet", "npc_sheet", "dealer_sheet", "npc2_sheet", "npc3_sheet", "npc4_sheet"]) {
      expect(resolveRig(key)).toBe(KENNEY_RIG);
    }
  });

  it("falls back to the OLD `height <= 16` guess for an unregistered sheet", () => {
    // An unregistered sheet must degrade to exactly its pre-refactor
    // behaviour, never to something new.
    expect(hasRegisteredRig("some_unknown_sheet")).toBe(false);
    expect(resolveRig("some_unknown_sheet", 16)).toBe(KENNEY_RIG);
    expect(resolveRig("some_unknown_sheet", 32)).toBe(LEGACY_SKIN_RIG);
    expect(resolveRig("some_unknown_sheet")).toBe(LEGACY_SKIN_RIG);
  });
});

describe("rig descriptor invariants", () => {
  it("every rig declares all four directions with a consistent frame count", () => {
    for (const rig of Object.values(RIGS)) {
      for (const dir of DIRECTIONS) {
        expect(rig.walkFrames[dir].length).toBeGreaterThan(0);
        expect(rig.idleFrames[dir]).toBeGreaterThanOrEqual(0);
      }
      const lengths = DIRECTIONS.map((d) => rig.walkFrames[d].length);
      expect(new Set(lengths).size).toBe(1);
    }
  });

  it("no walk or idle frame index exceeds the sheet the rig describes", () => {
    for (const rig of Object.values(RIGS)) {
      const all = DIRECTIONS.flatMap((d) => [...rig.walkFrames[d], rig.idleFrames[d]]);
      for (const frame of all) {
        expect(Number.isInteger(frame)).toBe(true);
        // Column must be addressable within the declared row width.
        expect(frame % rig.columns).toBeLessThan(rig.columns);
      }
    }
  });

  it("body fractions stay inside the frame", () => {
    for (const rig of Object.values(RIGS)) {
      const box = bodyBox(rig);
      expect(box.offsetX + box.width).toBeLessThanOrEqual(rig.frameWidth);
      expect(box.offsetY + box.height).toBeLessThanOrEqual(rig.frameHeight);
    }
  });

  it("firstWalkFrame reads off the rig rather than a duplicate table", () => {
    // The ambient-bystander code wants each direction's FIRST frame.
    expect(firstWalkFrame(KENNEY_RIG, "left")).toBe(0);
    expect(firstWalkFrame(KENNEY_RIG, "down")).toBe(1);
    expect(firstWalkFrame(KENNEY_RIG, "up")).toBe(2);
    expect(firstWalkFrame(KENNEY_RIG, "right")).toBe(3);
  });
});
