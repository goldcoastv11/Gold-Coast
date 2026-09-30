/** Server-authoritative port of PlinkoScene.ts (#36). */

import { randInt } from "../rng";

export const PLINKO_ROWS = 8; // rows of pegs -> 9 landing slots
// Rebalance (2026-08-27): the old table [16, 9, 2, 1.4, 0.6, 1.4, 2, 9, 16] returned 190.2% -
// the binomial slot weights (1,8,28,56,70,56,28,8,1)/256 concentrate almost all drops in the
// middle, and the middle paid far too much. The 16x edges are kept (that's the game's whole
// appeal); the middle is cut instead, landing RTP at 97.3%.
// Client twin: src/scenes/PlinkoScene.ts's MULTIPLIERS.
export const PLINKO_MULTIPLIERS = [16, 5, 1.2, 0.5, 0.2, 0.5, 1.2, 5, 16];
export const PLINKO_MEDIUM_ROWS = 12;
/** 95.77% theoretical return across the 12-row binomial landing distribution. */
export const PLINKO_MEDIUM_MULTIPLIERS = [100, 20, 5, 2, 0.8, 0.4, 0.3, 0.4, 0.8, 2, 5, 20, 100];
export const PLINKO_HIGH_ROWS = 16;
/** 98.98% theoretical return across the 16-row binomial landing distribution. */
export const PLINKO_HIGH_MULTIPLIERS = [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000];
export type PlinkoDifficulty = "low" | "medium" | "high";

export interface PlinkoResult {
  slotIndex: number;
  multiplier: number;
  payout: number;
  /** Number of "right" bounces at each row, 0-indexed - lets the client replay the exact same visual bounce path the server used to land on slotIndex. */
  path: number[];
  rows: number;
  difficulty: PlinkoDifficulty;
}

export function playPlinko(
  betAmount: number,
  options: { rows?: number; difficulty?: PlinkoDifficulty } = {}
): PlinkoResult {
  const high = options.rows === PLINKO_HIGH_ROWS && options.difficulty === "high";
  const medium = options.rows === PLINKO_MEDIUM_ROWS && options.difficulty === "medium";
  const rows = high ? PLINKO_HIGH_ROWS : medium ? PLINKO_MEDIUM_ROWS : PLINKO_ROWS;
  const difficulty: PlinkoDifficulty = high ? "high" : medium ? "medium" : "low";
  const multipliers = high ? PLINKO_HIGH_MULTIPLIERS : medium ? PLINKO_MEDIUM_MULTIPLIERS : PLINKO_MULTIPLIERS;
  let rightCount = 0;
  const path: number[] = [];
  for (let step = 0; step < rows; step++) {
    if (randInt(0, 1) === 1) rightCount++;
    path.push(rightCount);
  }
  const multiplier = multipliers[rightCount];
  const payout = Math.round(betAmount * multiplier);
  return { slotIndex: rightCount, multiplier, payout, path, rows, difficulty };
}
