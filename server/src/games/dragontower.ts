/** Server-authoritative Dragon Tower with selectable trap difficulty. */

import { randInt } from "../rng";

export const DRAGON_TOWER_ROWS = 6;
export const DRAGON_TOWER_TILES_PER_ROW = 4;
export type DragonTowerDifficulty = "easy" | "medium" | "hard";

export const DRAGON_TOWER_MULTIPLIERS_BY_DIFFICULTY: Record<DragonTowerDifficulty, number[]> = {
  easy: [1.3, 1.8, 2.7, 4, 7, 12],
  medium: [1.9, 3.7, 7.2, 14, 27, 53],
  hard: [3.8, 15, 60, 235, 920, 3600]
};
export const DRAGON_TOWER_MULTIPLIERS = DRAGON_TOWER_MULTIPLIERS_BY_DIFFICULTY.easy;
const TRAPS_PER_ROW: Record<DragonTowerDifficulty, number> = { easy: 1, medium: 2, hard: 3 };

export interface DragonTowerRoundState {
  badIndicesPerRow: number[][];
  currentRow: number;
  difficulty: DragonTowerDifficulty;
}

/** Keeps unfinished easy rounds created before difficulty selection compatible. */
export function dragonTowerBadIndices(state: DragonTowerRoundState): number[][] {
  const modern = state.badIndicesPerRow;
  if (Array.isArray(modern)) return modern;
  const legacy = (state as unknown as { badIndexPerRow?: number[] }).badIndexPerRow ?? [];
  return legacy.map((index) => [index]);
}

export function dragonTowerDifficulty(state: DragonTowerRoundState): DragonTowerDifficulty {
  return state.difficulty ?? "easy";
}

function uniqueTrapColumns(count: number): number[] {
  const available = Array.from({ length: DRAGON_TOWER_TILES_PER_ROW }, (_, i) => i);
  const result: number[] = [];
  while (result.length < count) result.push(available.splice(randInt(0, available.length - 1), 1)[0]);
  return result;
}

export function newDragonTowerState(difficulty: DragonTowerDifficulty = "easy"): DragonTowerRoundState {
  const badIndicesPerRow = Array.from({ length: DRAGON_TOWER_ROWS }, () => uniqueTrapColumns(TRAPS_PER_ROW[difficulty]));
  return { badIndicesPerRow, currentRow: 0, difficulty };
}

export interface DragonTowerPublicState {
  currentRow: number;
  multiplier: number;
  difficulty: DragonTowerDifficulty;
}

export function publicDragonTowerState(state: DragonTowerRoundState): DragonTowerPublicState {
  return {
    currentRow: state.currentRow,
    multiplier: state.currentRow > 0 ? DRAGON_TOWER_MULTIPLIERS_BY_DIFFICULTY[dragonTowerDifficulty(state)][state.currentRow - 1] : 1,
    difficulty: dragonTowerDifficulty(state)
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
  if (state.currentRow >= DRAGON_TOWER_ROWS) throw new InvalidDragonTowerPickError("Tower already fully climbed");
  if (dragonTowerBadIndices(state)[state.currentRow].includes(col)) return { state, isBad: true, reachedTop: false };
  const nextRow = state.currentRow + 1;
  return { state: { ...state, currentRow: nextRow }, isBad: false, reachedTop: nextRow >= DRAGON_TOWER_ROWS };
}
