/** Server-authoritative port of SlotsScene.ts's weighted-reel paytable (#36). */

import { randInt } from "../rng";

export interface SlotSymbolDef {
  key: string;
  weight: number;
  pay3x: number;
  pay2x: number;
}

/**
 * Rebalance (2026-08-27): the old table returned 150.7%. The three-of-a-kind tier was never the
 * problem - it contributes only ~52 points of that, and the 400x seven is the cabinet's headline
 * prize - so every pay3x is untouched. The "exactly two matching" tier was: pairs land on ~55% of
 * all spins and used to carry ~98 points on their own. Halving the pair payouts (0.6 -> 0.2,
 * 1 -> 0.5, 2.4 -> 1.1, 6 -> 2.5, 30 -> 15) brings the pair tier to ~44 points and total RTP to
 * 96.2%, with the big-win shape of the game unchanged.
 *
 * There is deliberately no client twin of this table - src/scenes/SlotsScene.ts only maps the
 * server's symbol `key` to an emoji; the paytable lives here alone.
 */
export const SLOT_SYMBOLS: SlotSymbolDef[] = [
  { key: "cherry", weight: 35, pay3x: 2, pay2x: 0.2 },
  { key: "lemon", weight: 28, pay3x: 4, pay2x: 0.5 },
  { key: "bell", weight: 20, pay3x: 20, pay2x: 1.1 },
  { key: "diamond", weight: 12, pay3x: 80, pay2x: 2.5 },
  { key: "seven", weight: 5, pay3x: 400, pay2x: 15 }
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

/**
 * Scores an already-decided set of three reels. Split out of playSlots (which is unavoidably
 * random) so test/games2.test.ts's RTP invariant can enumerate all 125 possible reel combinations
 * against the *real* scoring rules rather than a second copy of them that could drift.
 */
export function scoreSlotsSpin(reels: SlotSymbolDef[], betAmount: number): Omit<SlotsResult, "reels"> {
  const counts = new Map<string, number>();
  reels.forEach((s) => counts.set(s.key, (counts.get(s.key) ?? 0) + 1));

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

  return { payout, winKey, winCount };
}

export function playSlots(betAmount: number): SlotsResult {
  const results = [pickWeightedSymbol(), pickWeightedSymbol(), pickWeightedSymbol()];
  return { reels: results.map((r) => r.key), ...scoreSlotsSpin(results, betAmount) };
}
