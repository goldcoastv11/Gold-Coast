/** Server-authoritative port of DragonTowerScene.ts (#36) - same "reveal repeatedly, cash out anytime" shape as Mines, one bad tile per row instead of a fixed mine count. */

import { randInt } from "../rng";

export const DRAGON_TOWER_ROWS = 6;
export const DRAGON_TOWER_TILES_PER_ROW = 4;
// Cumulative payout multiplier after successfully clearing row i (0-indexed) - hand-picked paytable, same as the client's.
export const DRAGON_TOWER_MULTIPLIERS = [1.3, 1.8, 2.7, 4, 7, 12];

export interface DragonTowerRoundState {
  badIndexPerRow: number[]; // length DRAGON_TOWER_ROWS, each 0..DRAGON_TOWER_TILES_PER_ROW-1
  currentRow: number; // rows successfully cleared so far
}

export function newDragonTowerState(): DragonTowerRoundState {
  const badIndexPerRow = Array.from({ length: DRAGON_TOWER_ROWS }, () => randInt(0, DRAGON_TOWER_TILES_PER_ROW - 1));
  return { badIndexPerRow, currentRow: 0 };
}

export interface DragonTowerPublicState {
  currentRow: number;
  multiplier: number;
}

export function publicDragonTowerState(state: DragonTowerRoundState): DragonTowerPublicState {
  return {
    currentRow: state.currentRow,
    multiplier: state.currentRow > 0 ? DRAGON_TOWER_MULTIPLIERS[state.currentRow - 1] : 1
  };
}

export class InvalidDragonTowerPickError extends Error {}

export interface DragonTowerPickResult {
  state: DragonTowerRoundState;
  isBad: boolean;
  reachedTop: boolean;
}

export function applyDragonTowerPick(state: DragonTowerRoundState, col: number): DragonTowerPickResult {
  if (!Number.isInteger(col) || col < 0 || col >= DRAGON_TOWER_TILES_PER_ROW) {
    throw new InvalidDragonTowerPickError(`Column out of range: ${col}`);
  }
  if (state.currentRow >= DRAGON_TOWER_ROWS) {
    throw new InvalidDragonTowerPickError("Tower already fully climbed");
  }

  const isBad = col === state.badIndexPerRow[state.currentRow];
  if (isBad) {
    return { state, isBad: true, reachedTop: false };
  }

  const nextRow = state.currentRow + 1;
  const reachedTop = nextRow >= DRAGON_TOWER_ROWS;
  return { state: { ...state, currentRow: nextRow }, isBad: false, reachedTop };
}
