/** Server-authoritative port of RouletteScene.ts (#36). */

import { randInt } from "../rng";

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type RouletteColor = "red" | "black" | "green";
export type RouletteBet =
  | RouletteColor
  | `number:${number}`
  | "low"
  | "high"
  | "even"
  | "odd"
  | "dozen1"
  | "dozen2"
  | "dozen3"
  | "column1"
  | "column2"
  | "column3";

export function colorOf(n: number): RouletteColor {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

// Rebalance (2026-08-27): green was 20x, which returned only 20/37 = 54.1% - roughly half of
// red/black's 36/37 = 97.3%. 36x matches a real single-zero wheel's straight-up number bet and
// lands green on the same 97.3% as the other two bets.
// Client twin: src/scenes/RouletteScene.ts's "GREEN (36x)" button label.
export const ROULETTE_PAYOUTS: Record<RouletteColor, number> = {
  red: 2,
  black: 2,
  green: 36
};

const GROUP_BETS = new Set<RouletteBet>([
  "red", "black", "green", "low", "high", "even", "odd",
  "dozen1", "dozen2", "dozen3", "column1", "column2", "column3"
]);

export function isRouletteBet(value: string): value is RouletteBet {
  if (GROUP_BETS.has(value as RouletteBet)) return true;
  const match = /^number:(\d+)$/.exec(value);
  return !!match && Number(match[1]) >= 0 && Number(match[1]) <= 36;
}

export function rouletteBetWins(bet: RouletteBet, number: number): boolean {
  if (bet === "red" || bet === "black" || bet === "green") return colorOf(number) === bet;
  if (bet.startsWith("number:")) return number === Number(bet.slice(7));
  if (number === 0) return false;
  if (bet === "low") return number <= 18;
  if (bet === "high") return number >= 19;
  if (bet === "even") return number % 2 === 0;
  if (bet === "odd") return number % 2 === 1;
  if (bet.startsWith("dozen")) return Math.ceil(number / 12) === Number(bet.slice(-1));
  if (bet.startsWith("column")) return ((number - 1) % 3) + 1 === Number(bet.slice(-1));
  return false;
}

export function roulettePayoutMultiplier(bet: RouletteBet): number {
  if (bet === "green" || bet.startsWith("number:")) return 36;
  if (bet.startsWith("dozen") || bet.startsWith("column")) return 3;
  return 2;
}

export interface RouletteResult {
  bet: RouletteBet;
  number: number;
  color: RouletteColor;
  won: boolean;
  payout: number;
}

export function playRoulette(betAmount: number, bet: RouletteBet): RouletteResult {
  const number = randInt(0, 36);
  const color = colorOf(number);
  const won = rouletteBetWins(bet, number);
  const payout = won ? betAmount * roulettePayoutMultiplier(bet) : 0;
  return { bet, number, color, won, payout };
}
