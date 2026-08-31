import { describe, expect, it } from "vitest";
import {
  DESIGN_WIDTH,
  DESIGN_HEIGHT,
  DESIGN_CENTER_X,
  DESIGN_CENTER_Y,
  SAFE_ZONE_TOP,
  SAFE_ZONE_BOTTOM,
  liveWidth,
  liveHeight,
  liveCenterX,
  liveCenterY,
  blockOffsetX,
  toLiveX,
  centerDesignBlock,
  GAME_SHELL_DISPLAY_CENTER_X
} from "./Layout";

/**
 * A bare-minimum stand-in for `Phaser.Scene` - these functions only ever
 * read `scene.scale.width/height` and (for `centerDesignBlock`)
 * `scene.cameras.main.scrollX`, so a real Phaser scene/canvas is not
 * needed to exercise the maths. Canvas screenshots don't render in this
 * environment (see repo CLAUDE.md's Verification section) - asserting on
 * the geometry directly, at the actual widths `main.ts` can produce, is
 * the real check here.
 */
function fakeScene(width: number, height = DESIGN_HEIGHT) {
  return {
    scale: { width, height },
    cameras: { main: { scrollX: 0 } }
  } as unknown as Phaser.Scene;
}

/**
 * The widths `main.ts`'s `computeLandscapeWidth()` actually produces
 * (`Math.round(600 * aspect)`, clamped to [800, 1600]) for the device
 * classes called out in the task:
 *   - the 800 floor (desktop, or a phone/tablet at or under 4:3)
 *   - a ~20:9 phone in landscape (e.g. a Samsung handset)
 *   - a ~21:9 phone in landscape
 *   - a 16:10 tablet in landscape
 * Desktop never resizes at all (`updateMobileLayoutMode` no-ops off
 * `isTouchDevice()`), so it always sits at the 800 floor too - covered by
 * the same case.
 */
const WIDTHS = {
  floorOrDesktop: 800,
  phone20by9: Math.round(600 * (20 / 9)),
  phone21by9: Math.round(600 * (21 / 9)),
  tablet16by10: Math.round(600 * 1.6)
};

describe("design constants", () => {
  it("match the canvas main.ts was originally authored against", () => {
    expect(DESIGN_WIDTH).toBe(800);
    expect(DESIGN_HEIGHT).toBe(600);
    expect(DESIGN_CENTER_X).toBe(400);
    expect(DESIGN_CENTER_Y).toBe(300);
  });

  it("keeps the safe zone symmetric around the design vertical center", () => {
    expect(SAFE_ZONE_TOP).toBeLessThan(DESIGN_CENTER_Y);
    expect(SAFE_ZONE_BOTTOM).toBeGreaterThan(DESIGN_CENTER_Y);
    expect(DESIGN_CENTER_Y - SAFE_ZONE_TOP).toBe(SAFE_ZONE_BOTTOM - DESIGN_CENTER_Y);
  });
});

describe("liveWidth / liveHeight / liveCenterX / liveCenterY", () => {
  it("read straight through to the scene's live scale at every device width", () => {
    for (const width of Object.values(WIDTHS)) {
      const scene = fakeScene(width);
      expect(liveWidth(scene)).toBe(width);
      expect(liveHeight(scene)).toBe(DESIGN_HEIGHT);
      expect(liveCenterX(scene)).toBe(width / 2);
      expect(liveCenterY(scene)).toBe(DESIGN_HEIGHT / 2);
    }
  });

  it("equals the design center exactly at the 800 floor - the bug this module exists to remove only appears above it", () => {
    const scene = fakeScene(WIDTHS.floorOrDesktop);
    expect(liveCenterX(scene)).toBe(DESIGN_CENTER_X);
  });

  it("is strictly greater than the design center on every wider device - a standalone panel centered on the design value alone would sit left-of-true-center by exactly this much", () => {
    for (const key of ["phone20by9", "phone21by9", "tablet16by10"] as const) {
      const scene = fakeScene(WIDTHS[key]);
      expect(liveCenterX(scene)).toBeGreaterThan(DESIGN_CENTER_X);
    }
  });
});

describe("blockOffsetX / toLiveX", () => {
  it("is 0 at the design width floor - nothing already laid out for 800x600 moves", () => {
    const scene = fakeScene(WIDTHS.floorOrDesktop);
    expect(blockOffsetX(scene)).toBe(0);
    expect(toLiveX(scene, DESIGN_CENTER_X)).toBe(DESIGN_CENTER_X);
    expect(toLiveX(scene, GAME_SHELL_DISPLAY_CENTER_X)).toBe(GAME_SHELL_DISPLAY_CENTER_X);
  });

  it("is exactly half the extra width beyond the floor, on both phone aspect ratios and the tablet", () => {
    for (const width of [WIDTHS.phone20by9, WIDTHS.phone21by9, WIDTHS.tablet16by10]) {
      const scene = fakeScene(width);
      expect(blockOffsetX(scene)).toBeCloseTo((width - DESIGN_WIDTH) / 2, 10);
    }
  });

  it("never goes negative even if a caller somehow passes a canvas narrower than the design width", () => {
    const scene = fakeScene(600);
    expect(blockOffsetX(scene)).toBe(0);
  });

  it("moving the design center by toLiveX always lands exactly on the live center - the two are the same point, just reached two different ways", () => {
    for (const width of Object.values(WIDTHS)) {
      const scene = fakeScene(width);
      expect(toLiveX(scene, DESIGN_CENTER_X)).toBeCloseTo(liveCenterX(scene), 10);
    }
  });

  it("preserves the distance-from-design-center of an arbitrary design-space point (e.g. the game shell's own 570 display center)", () => {
    for (const width of Object.values(WIDTHS)) {
      const scene = fakeScene(width);
      const offset = blockOffsetX(scene);
      expect(toLiveX(scene, GAME_SHELL_DISPLAY_CENTER_X)).toBeCloseTo(
        GAME_SHELL_DISPLAY_CENTER_X + offset,
        10
      );
    }
  });
});

describe("centerDesignBlock", () => {
  it("leaves the camera unscrolled and every screen-fixed object untouched at the design width floor", () => {
    const scene = fakeScene(WIDTHS.floorOrDesktop);
    const sidebarChrome = [{ x: 180 }, { x: 400 }, { x: 620 }];
    const originalXs = sidebarChrome.map((o) => o.x);

    centerDesignBlock(scene, sidebarChrome);

    // -0 is a legitimate result of `-blockOffsetX(scene)` when the offset
    // is exactly 0 - equal to 0 in every way that matters here, just not
    // under vitest's default Object.is-based `toBe`.
    expect(scene.cameras.main.scrollX).toBeCloseTo(0, 10);
    expect(sidebarChrome.map((o) => o.x)).toEqual(originalXs);
  });

  it("shifts every screen-fixed object right, and scrolls the camera left, by the identical amount on a wide phone - so the sidebar and the board it's paired with move together instead of pulling apart", () => {
    const scene = fakeScene(WIDTHS.phone21by9);
    const expectedOffset = blockOffsetX(scene);
    expect(expectedOffset).toBeGreaterThan(0);

    const sidebarChrome = [{ x: 180 }, { x: 400 }, { x: 620 }];
    const originalXs = sidebarChrome.map((o) => o.x);

    centerDesignBlock(scene, sidebarChrome);

    expect(scene.cameras.main.scrollX).toBeCloseTo(-expectedOffset, 10);
    sidebarChrome.forEach((o, i) => {
      expect(o.x).toBeCloseTo(originalXs[i] + expectedOffset, 10);
    });
  });
});
