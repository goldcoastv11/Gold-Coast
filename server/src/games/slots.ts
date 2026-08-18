/** Server-authoritative port of SlotsScene.ts's weighted-reel paytable (#36). */

import { randInt } from "../rng";

export interface SlotSymbolDef {
  key: string;
  weight: number;
  pay3x: number;
  pay2x: number;
}

export const SLOT_SYMBOLS: SlotSymbolDef[] = [
  { key: "cherry", weight: 35, pay3x: 2, pay2x: 0.6 },
  { key: "lemon", weight: 28, pay3x: 4, pay2x: 1 },
  { key: "bell", weight: 20, pay3x: 20, pay2x: 2.4 },
  { key: "diamond", weight: 12, pay3x: 80, pay2x: 6 },
  { key: "seven", weight: 5, pay3x: 400, pay2x: 30 }
];

const TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);

function pickWeightedSymbol(): SlotSymbolDef {
  let roll = randInt(1, TOTAL_WEIGHT);
  for (const s of SLOT_SYMBOLS) {
    if (roll <= s.weight) return s;
    roll -= s.weight;
  }
  return SLOT_SYMBOLS[0];
}

export interface SlotsResult {
  reels: string[]; // symbol keys, one per reel
  payout: number;
  winKey: string | null;
  winCount: 2 | 3 | null;
}

export function playSlots(betAmount: number): SlotsResult {
  const results = [pickWeightedSymbol(), pickWeightedSymbol(), pickWeightedSymbol()];
  const counts = new Map<string, number>();
  results.forEach((s) => counts.set(s.key, (counts.get(s.key) ?? 0) + 1));

  let payout = 0;
  let winKey: string | null = null;
  let winCount: 2 | 3 | null = null;

  for (const [key, count] of counts.entries()) {
    const def = SLOT_SYMBOLS.find((s) => s.key === key)!;
    if (count === 3) {
      payout = Math.round(betAmount * def.pay3x);
      winKey = key;
      winCount = 3;
    } else if (count === 2 && payout === 0) {
      payout = Math.round(betAmount * def.pay2x);
      winKey = key;
      winCount = 2;
    }
  }

  return { reels: results.map((r) => r.key), payout, winKey, winCount };
}
