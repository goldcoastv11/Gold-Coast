/** Server-authoritative port of PlinkoScene.ts (#36). */

import { randInt } from "../rng";

export const PLINKO_ROWS = 8; // rows of pegs -> 9 landing slots
export const PLINKO_MULTIPLIERS = [16, 9, 2, 1.4, 0.6, 1.4, 2, 9, 16];

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
