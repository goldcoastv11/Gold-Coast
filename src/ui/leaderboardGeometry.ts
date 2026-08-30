/**
 * Pure scroll-content math for ui/LeaderboardPanel.ts's row list -
 * Phaser-free and unit-testable without a scene, same reasoning as
 * quickplayGrid.ts/magazineGeometry.ts. The actual pointer-drag/clamp
 * mechanics are quickplayGrid.ts's own `clampScroll`, reused as-is rather
 * than forked - a leaderboard row list and a card grid both just need "how
 * far can this scroll before it runs past its content".
 *
 * Rows got taller once each one grew a portrait next to the name (see
 * LeaderboardPanel.ts's own header comment) - too tall for all 10 top rows
 * to fit the panel's fixed y=[130,470] budget without scrolling any more,
 * which is why this module (and the drag-to-scroll it supports) exists.
 */

/** Vertical space one ranked row occupies, portrait included. */
export const ROW_STEP = 34;

/**
 * Extra scrollable height the pinned "where do I stand" footer row adds
 * when it's shown (see LeaderboardBoard.me's own doc comment on when that
 * is) - a gap, a divider, another gap, then one more row the same height
 * as ROW_STEP.
 */
export const FOOTER_H = ROW_STEP + 16;

/**
 * Total scrollable content height for a board with `rowCount` top rows
 * (each ROW_STEP tall) plus an optional footer row. 0 rows is always 0,
 * regardless of `hasFooter` - the empty-board state doesn't render a list
 * at all (see LeaderboardPanel.ts's own empty-state branch), so there is
 * nothing for a footer to sit below.
 */
export function leaderboardContentHeight(rowCount: number, hasFooter: boolean): number {
  if (rowCount <= 0) return 0;
  return rowCount * ROW_STEP + (hasFooter ? FOOTER_H : 0);
}

/** Local (container-relative) vertical center of top-list row `index`. */
export function leaderboardRowY(index: number): number {
  return index * ROW_STEP + ROW_STEP / 2;
}

/** Local y of the divider drawn above the pinned footer row, for a board with `rowCount` top rows. */
export function leaderboardFooterDividerY(rowCount: number): number {
  return rowCount * ROW_STEP + 8;
}

/** Local (container-relative) vertical center of the pinned footer row itself. */
export function leaderboardFooterRowY(rowCount: number): number {
  return rowCount * ROW_STEP + 16 + ROW_STEP / 2;
}
