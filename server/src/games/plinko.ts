/** Server-authoritative port of PlinkoScene.ts (#36). */

import { randInt } from "../rng";

export const PLINKO_ROWS = 8; // rows of pegs -> 9 landing slots
// Rebalance (2026-08-27): the old table [16, 9, 2, 1.4, 0.6, 1.4, 2, 9, 16] returned 190.2% -
// the binomial slot weights (1,8,28,56,70,56,28,8,1)/256 concentrate almost all drops in the
// middle, and the middle paid far too much. The 16x edges are kept (that's the game's whole
// appeal); the middle is cut instead, landing RTP at 97.3%.
// Client twin: src/scenes/PlinkoScene.ts's MULTIPLIERS.
export const PLINKO_MULTIPLIERS = [16, 5, 1.2, 0.5, 0.2, 0.5, 1.2, 5, 16];

export interface PlinkoResult {
  slotIndex: number;
  multiplier: number;
  payout: number;
  /** Number of "right" bounces at each row, 0-indexed - lets the client replay the exact same visual bounce path the server used to land on slotIndex. */
  path: number[];
}

export function playPlinko(betAmount: number): PlinkoResult {
  let rightCount = 0;
  const path: number[] = [];
  for (let step = 0; step < PLINKO_ROWS; step++) {
    if (randInt(0, 1) === 1) rightCount++;
    path.push(rightCount);
  }
  const multiplier = PLINKO_MULTIPLIERS[rightCount];
  const payout = Math.round(betAmount * multiplier);
  return { slotIndex: rightCount, multiplier, payout, path };
}
