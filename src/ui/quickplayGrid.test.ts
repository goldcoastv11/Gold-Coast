import { describe, expect, it } from "vitest";
import { cardPosition, clampScroll, contentHeight, hitTestGrid, uniqueGames } from "./quickplayGrid";

describe("uniqueGames", () => {
  it("collapses repeated cabinets for the same game down to one card, in first-seen order", () => {
    const stations = [
      { sceneKey: "SlotsScene", label: "Slots", textureKey: "slot_machine" },
      { sceneKey: "SlotsScene", label: "Slots", textureKey: "slot_machine" },
      { sceneKey: "BlackjackScene", label: "Blackjack", textureKey: "blackjack_table" },
      { sceneKey: "SlotsScene", label: "Slots", textureKey: "slot_machine" },
      { sceneKey: "BlackjackScene", label: "Blackjack", textureKey: "blackjack_table" },
      { sceneKey: "MinesScene", label: "Mines", textureKey: "mines_machine" }
    ];
    expect(uniqueGames(stations)).toEqual([
      { sceneKey: "SlotsScene", label: "Slots", textureKey: "slot_machine" },
      { sceneKey: "BlackjackScene", label: "Blackjack", textureKey: "blackjack_table" },
      { sceneKey: "MinesScene", label: "Mines", textureKey: "mines_machine" }
    ]);
  });

  it("returns an empty grid for an empty station list rather than throwing", () => {
    expect(uniqueGames([])).toEqual([]);
  });
});

describe("contentHeight", () => {
  const geo = { cols: 4, cardW: 147, cardH: 170, gap: 12 };

  it("stacks rows of `cols` cards with a gap between rows, not after the last one", () => {
    // 14 cards / 4 cols = 4 rows (3 full + one of 2) -> 4*170 + 3*12
    expect(contentHeight(14, geo)).toBe(4 * 170 + 3 * 12);
  });

  it("is a single row's height for a count that fits in one row", () => {
    expect(contentHeight(3, geo)).toBe(170);
    expect(contentHeight(4, geo)).toBe(170);
  });

  it("is zero for no cards", () => {
    expect(contentHeight(0, geo)).toBe(0);
  });
});

describe("clampScroll", () => {
  it("never goes negative", () => {
    expect(clampScroll(-50, 700, 250)).toBe(0);
  });

  it("never scrolls past the content's bottom", () => {
    // max = 700 - 250 = 450
    expect(clampScroll(9999, 700, 250)).toBe(450);
  });

  it("passes an in-range value through unchanged", () => {
    expect(clampScroll(120, 700, 250)).toBe(120);
  });

  it("clamps to 0 (nothing to scroll) when content already fits the viewport", () => {
    expect(clampScroll(40, 200, 250)).toBe(0);
  });
});

describe("hitTestGrid + cardPosition round-trip", () => {
  const geo = { cols: 4, cardW: 147, cardH: 170, gap: 12 };
  const count = 14;

  it("finds every card's own index by tapping its top-left corner and its center", () => {
    for (let i = 0; i < count; i++) {
      const pos = cardPosition(i, geo);
      expect(hitTestGrid(pos.x + 1, pos.y + 1, count, geo)).toBe(i);
      expect(hitTestGrid(pos.x + geo.cardW / 2, pos.y + geo.cardH / 2, count, geo)).toBe(i);
    }
  });

  it("returns null for a tap in the gap between two cards", () => {
    const pos = cardPosition(0, geo);
    // Just past card 0's right edge, inside the gap before card 1.
    expect(hitTestGrid(pos.x + geo.cardW + geo.gap / 2, pos.y + 10, count, geo)).toBeNull();
  });

  it("returns null past the last card in an incomplete final row", () => {
    // Row 3 (0-indexed) only has cards at col 0 and col 1 (indices 12, 13).
    const pos = cardPosition(13, geo);
    const col2 = { x: pos.x + (geo.cardW + geo.gap), y: pos.y };
    expect(hitTestGrid(col2.x + 1, col2.y + 1, count, geo)).toBeNull();
  });

  it("returns null off the top-left and off the right edge of the grid", () => {
    expect(hitTestGrid(-5, 20, count, geo)).toBeNull();
    expect(hitTestGrid(20, -5, count, geo)).toBeNull();
    expect(hitTestGrid(geo.cols * (geo.cardW + geo.gap) + 5, 20, count, geo)).toBeNull();
  });
});
