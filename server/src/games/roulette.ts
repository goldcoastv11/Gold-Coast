/** Server-authoritative port of RouletteScene.ts (#36). */

import { randInt } from "../rng";

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type RouletteColor = "red" | "black" | "green";

export function colorOf(n: number): RouletteColor {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

export const ROULETTE_PAYOUTS: Record<RouletteColor, number> = {
  red: 2,
  black: 2,
  green: 20
};

export interface RouletteResult {
  bet: RouletteColor;
  number: number;
  color: RouletteColor;
  won: boolean;
  payout: number;
}

export function playRoulette(betAmount: number, bet: RouletteColor): RouletteResult {
  const number = randInt(0, 36);
  const color = colorOf(number);
  const won = color === bet;
  const payout = won ? betAmount * ROULETTE_PAYOUTS[bet] : 0;
  return { bet, number, color, won, payout };
}
