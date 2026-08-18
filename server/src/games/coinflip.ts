/** Server-authoritative port of CoinFlipScene.ts (#36). Pays 2x on a correct guess, fair 50/50. */

import { randInt } from "../rng";

export type CoinSide = "heads" | "tails";

export interface CoinFlipResult {
  guess: CoinSide;
  result: CoinSide;
  won: boolean;
  payout: number;
}

export function playCoinFlip(betAmount: number, guess: CoinSide): CoinFlipResult {
  const result: CoinSide = randInt(0, 1) === 0 ? "heads" : "tails";
  const won = result === guess;
  const payout = won ? betAmount * 2 : 0;
  return { guess, result, won, payout };
}
