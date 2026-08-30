/**
 * Pure layout/scroll math for the Quickplay grid. Deliberately Phaser-free
 * and side-effect-free (same reasoning as challengeDisplay.ts) so the two
 * things a scrollable touch grid can get wrong - "does the drag land on the
 * card I actually meant" and "does the scroll ever run past its content" -
 * are unit-testable without standing up a scene. QuickplayPanel.ts does the
 * drawing and the Phaser input wiring and nothing else.
 */

/** One entry in the Quickplay grid - a display-ready subset of OverworldScene's FurnitureStationDef. */
export interface QuickplayGame {
  sceneKey: string;
  label: string;
  textureKey: string;
}

/** Anything with at least a sceneKey/label/textureKey - matches FurnitureStationDef without importing it (see QuickplayPanel.ts's doc comment on why). */
interface StationLike {
  sceneKey: string;
  label: string;
  textureKey: string;
}

/**
 * Collapses GAME_STATIONS (one entry per walk-up cabinet, several per game -
 * e.g. five Slots machines) down to one entry per distinct game, in
 * first-seen order. This is what makes GAME_STATIONS a safe single source
 * of truth for Quickplay: a game added to the floor with a new sceneKey
 * shows up here automatically, and a game that reuses an existing sceneKey
 * (another cabinet for the same game) does not create a duplicate card.
 */
export function uniqueGames(stations: readonly StationLike[]): QuickplayGame[] {
  const seen = new Set<string>();
  const games: QuickplayGame[] = [];
  for (const s of stations) {
    if (seen.has(s.sceneKey)) continue;
    seen.add(s.sceneKey);
    games.push({ sceneKey: s.sceneKey, label: s.label, textureKey: s.textureKey });
  }
  return games;
}

export interface GridGeometry {
  cols: number;
  cardW: number;
  cardH: number;
  gap: number;
}

/** Total content height for `count` cards laid out at `geo`'s geometry, top row first. */
export function contentHeight(count: number, geo: GridGeometry): number {
  if (count <= 0) return 0;
  const rows = Math.ceil(count / geo.cols);
  return rows * geo.cardH + (rows - 1) * geo.gap;
}

/** Clamps a proposed scroll offset to [0, contentHeight - viewportHeight] (0 if content fits the viewport already - nothing to scroll). */
export function clampScroll(scrollY: number, contentH: number, viewportH: number): number {
  const max = Math.max(0, contentH - viewportH);
  if (scrollY < 0) return 0;
  if (scrollY > max) return max;
  return scrollY;
}

/**
 * Maps a tap's position (in the grid content's own local coordinate space -
 * i.e. already translated by the container's x/y, so (0,0) is the
 * top-left of the FIRST card) to the card index it landed on, or null if it
 * landed in a gap between cards, past the last card, or off the grid
 * entirely. Callers are expected to only call this for a tap (small total
 * drag distance) - this function has no opinion on drag-vs-tap itself.
 */
export function hitTestGrid(localX: number, localY: number, count: number, geo: GridGeometry): number | null {
  if (localX < 0 || localY < 0) return null;
  const cellW = geo.cardW + geo.gap;
  const cellH = geo.cardH + geo.gap;
  const col = Math.floor(localX / cellW);
  const row = Math.floor(localY / cellH);
  if (col < 0 || col >= geo.cols || row < 0) return null;
  const withinCol = localX - col * cellW;
  const withinRow = localY - row * cellH;
  if (withinCol > geo.cardW || withinRow > geo.cardH) return null;
  const index = row * geo.cols + col;
  if (index < 0 || index >= count) return null;
  return index;
}

/** Top-left (x, y) of card `index`'s cell, in the same local space hitTestGrid reads. */
export function cardPosition(index: number, geo: GridGeometry): { x: number; y: number } {
  const col = index % geo.cols;
  const row = Math.floor(index / geo.cols);
  return { x: col * (geo.cardW + geo.gap), y: row * (geo.cardH + geo.gap) };
}
