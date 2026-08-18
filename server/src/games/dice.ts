/**
 * Server-authoritative port of casino-poc/src/scenes/DiceScene.ts's payout
 * math (#36) - byte-for-byte the same formula, just moved to the trust
 * boundary. See that file's comments for the house-edge rationale.
 */

import { randInt } from "../rng";

export const DICE_TARGET_MIN = 5;
export const DICE_TARGET_MAX = 95;
const HOUSE_EDGE_NUMERATOR = 99; // 99 instead of 100 -> ~1% house edge baked into the multiplier

export function diceMultiplier(target: number): number {
  return Math.round((HOUSE_EDGE_NUMERATOR / target) * 100) / 100;
}

export interface DicePlayResult {
  roll: number;
  target: number;
  won: boolean;
  multiplier: number;
  payout: number;
}

/** Plays one round: rolls 0-99, wins (pays betAmount * multiplier) if roll < target. */
export function playDice(betAmount: number, target: number): DicePlayResult {
  const roll = randInt(0, 99);
  const won = roll < target;
  const multiplier = diceMultiplier(target);
  const payout = won ? Math.round(betAmount * multiplier) : 0;
  return { roll, target, won, multiplier, payout };
}
