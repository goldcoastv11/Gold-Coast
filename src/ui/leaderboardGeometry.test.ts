import { describe, expect, it } from "vitest";
import {
  ROW_STEP,
  FOOTER_H,
  leaderboardContentHeight,
  leaderboardRowY,
  leaderboardFooterDividerY,
  leaderboardFooterRowY
} from "./leaderboardGeometry";
import { clampScroll } from "./quickplayGrid";

describe("leaderboardContentHeight", () => {
  it("is 0 for an empty board regardless of footer", () => {
    expect(leaderboardContentHeight(0, false)).toBe(0);
    expect(leaderboardContentHeight(0, true)).toBe(0);
  });

  it("is rowCount * ROW_STEP with no footer", () => {
    expect(leaderboardContentHeight(10, false)).toBe(10 * ROW_STEP);
    expect(leaderboardContentHeight(1, false)).toBe(ROW_STEP);
  });

  it("adds FOOTER_H when a pinned footer row is shown", () => {
    expect(leaderboardContentHeight(10, true)).toBe(10 * ROW_STEP + FOOTER_H);
  });
});

describe("leaderboardRowY", () => {
  it("centers each row inside its own ROW_STEP-tall slot, in order", () => {
    expect(leaderboardRowY(0)).toBe(ROW_STEP / 2);
    expect(leaderboardRowY(1)).toBe(ROW_STEP + ROW_STEP / 2);
    expect(leaderboardRowY(9)).toBe(9 * ROW_STEP + ROW_STEP / 2);
    // Strictly increasing - no two rows can land on the same y.
    for (let i = 1; i < 10; i += 1) {
      expect(leaderboardRowY(i)).toBeGreaterThan(leaderboardRowY(i - 1));
    }
  });
});

describe("footer placement", () => {
  it("sits below every top row, and the row sits below the divider", () => {
    const rowCount = 10;
    const lastRowBottom = leaderboardRowY(rowCount - 1) + ROW_STEP / 2;
    const dividerY = leaderboardFooterDividerY(rowCount);
    const footerRowY = leaderboardFooterRowY(rowCount);
    expect(dividerY).toBeGreaterThanOrEqual(lastRowBottom);
    expect(footerRowY).toBeGreaterThan(dividerY);
    // The whole footer (divider + its row) fits inside the height
    // leaderboardContentHeight actually reserves for it.
    expect(footerRowY + ROW_STEP / 2).toBeLessThanOrEqual(rowCount * ROW_STEP + FOOTER_H);
  });

  it("moves down with more top rows", () => {
    expect(leaderboardFooterDividerY(5)).toBeLessThan(leaderboardFooterDividerY(10));
    expect(leaderboardFooterRowY(5)).toBeLessThan(leaderboardFooterRowY(10));
  });
});

describe("scrolling a full 10-row board with a footer", () => {
  it("needs to scroll (content taller than a realistic viewport) and clamps at both ends", () => {
    const contentH = leaderboardContentHeight(10, true);
    const viewportH = 220; // LeaderboardPanel.ts's VIEW_H
    expect(contentH).toBeGreaterThan(viewportH); // this is WHY the list scrolls now

    const maxScroll = contentH - viewportH;
    expect(clampScroll(-50, contentH, viewportH)).toBe(0);
    expect(clampScroll(0, contentH, viewportH)).toBe(0);
    expect(clampScroll(maxScroll + 999, contentH, viewportH)).toBe(maxScroll);
  });

  it("a short board (a couple of rows) never needs to scroll", () => {
    const contentH = leaderboardContentHeight(2, false);
    const viewportH = 220;
    expect(clampScroll(999, contentH, viewportH)).toBe(0);
  });
});
