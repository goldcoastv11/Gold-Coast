/**
 * Server-authoritative port of KenoScene.ts's combinatorial paytable (#36).
 *
 * #45 (QA-found bug, fixed here): the original formula split the target RTP
 * (1 - HOUSE_EDGE) into EQUAL shares across every paying tier, then derived
 * each tier's multiplier as share / P(hits). That's only sound when every
 * tier's fair multiplier actually fits under MAX_MULTIPLIER. For picks 7-10,
 * the top ("hit everything you picked") tier is astronomically rare - e.g.
 * picks=10, hits=10 has probability ~1.18e-9 (about 1 in 850 million) - so
 * its "fair" equal share would need a multiplier around 10^8, which the cap
 * silently clipped to 10000. That clipped tier then contributed almost
 * nothing to real RTP even though it was still being COUNTED as if it paid
 * its full equal share, so real RTP for picks 7-10 quietly fell to 67-82%
 * instead of the documented ~94%.
 *
 * Fix: `buildPayoutTable` uses iterative water-filling instead of a single
 * equal split. Any tier whose fair share would exceed MAX_MULTIPLIER is
 * capped, its (smaller) actual contribution is subtracted from the RTP
 * budget, and the remaining budget is re-split evenly across the tiers
 * still uncapped - repeated until stable. This converges to the SAME equal
 * split as before whenever nothing needs capping (picks 1-6, unchanged
 * behavior), and for picks 7-10 it pushes payout weight off the
 * infeasible/near-infeasible jackpot tier onto the tiers that can actually
 * carry it, so total real RTP still lands on ~94% instead of silently
 * degrading. See test/games2.test.ts's "keno RTP invariant" test, which
 * asserts this holds for every pick count 1-10 so this can't regress
 * unnoticed again.
 */

import { randInt } from "../rng";

export const KENO_TOTAL_NUMBERS = 40;
export const KENO_DRAWN_COUNT = 10;
export const KENO_MAX_PICKS = 10;
export const KENO_HOUSE_EDGE = 0.06; // exported: test/games2.test.ts's RTP invariant test asserts against 1 - KENO_HOUSE_EDGE directly, rather than hardcoding a duplicate copy of "0.94"
export const KENO_MAX_MULTIPLIER = 10000; // "sane practical max" per #45's fix - large enough that it only ever binds on the 1-2 rarest tiers for high pick counts (see buildPayoutTable), not a routine clip

function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

/** True hypergeometric probability of hitting exactly `hits` of `picks` numbers, given KENO_DRAWN_COUNT drawn out of KENO_TOTAL_NUMBERS. Exported so tests can independently verify real RTP against the payout table, rather than trusting the table's own derivation of itself. */
export function kenoHitProbability(hits: number, picks: number): number {
  const den = comb(KENO_TOTAL_NUMBERS, picks);
  if (den === 0) return 0;
  const num = comb(KENO_DRAWN_COUNT, hits) * comb(KENO_TOTAL_NUMBERS - KENO_DRAWN_COUNT, picks - hits);
  return num / den;
}

export function kenoMinPayHits(picks: number): number {
  return Math.max(1, Math.ceil(picks * 0.4));
}

/**
 * Builds the {hits -> multiplier} table for one `picks` count via iterative
 * water-filling: start by splitting the RTP budget equally across every
 * paying tier (hits = kenoMinPayHits(picks)..picks); any tier whose equal
 * share would need a multiplier over KENO_MAX_MULTIPLIER is capped instead,
 * its actual (smaller) contribution is subtracted from the budget, and the
 * remainder is re-split evenly across the tiers still uncapped. Repeats
 * until a pass caps nothing new. Converges in at most (tier count)
 * iterations - each iteration either caps at least one more tier or the
 * loop stops.
 */
function buildPayoutTable(picks: number): Map<number, number> {
  const minHits = kenoMinPayHits(picks);
  const tierHits: number[] = [];
  for (let h = minHits; h <= picks; h++) tierHits.push(h);

  const probs = tierHits.map((h) => kenoHitProbability(h, picks));
  const mult = new Array<number>(tierHits.length).fill(0);
  const capped = new Array<boolean>(tierHits.length).fill(false);
  let remainingBudget = 1 - KENO_HOUSE_EDGE;

  for (let iter = 0; iter < tierHits.length; iter++) {
    const uncappedIdx: number[] = [];
    for (let i = 0; i < tierHits.length; i++) if (!capped[i]) uncappedIdx.push(i);
    if (uncappedIdx.length === 0) break;

    const share = remainingBudget / uncappedIdx.length;
    let cappedSomethingThisPass = false;

    for (const i of uncappedIdx) {
      const raw = probs[i] > 0 ? share / probs[i] : Infinity;
      if (raw > KENO_MAX_MULTIPLIER) {
        mult[i] = KENO_MAX_MULTIPLIER;
        capped[i] = true;
        remainingBudget -= probs[i] * KENO_MAX_MULTIPLIER;
        cappedSomethingThisPass = true;
      }
    }

    if (!cappedSomethingThisPass) {
      // Stable - every remaining uncapped tier gets this pass's equal share
      // of the RTP budget, expressed as a multiplier (share is a probability-
      // weighted RTP contribution, so dividing by this tier's own probability
      // is what turns it into "how much this tier pays if it hits").
      for (const i of uncappedIdx) mult[i] = share / probs[i];
      break;
    }
  }

  const table = new Map<number, number>();
  tierHits.forEach((h, i) => table.set(h, Math.max(0, Math.round(mult[i] * 100) / 100)));
  return table;
}

const payoutTableCache = new Map<number, Map<number, number>>();

function getPayoutTable(picks: number): Map<number, number> {
  let table = payoutTableCache.get(picks);
  if (!table) {
    table = buildPayoutTable(picks);
    payoutTableCache.set(picks, table);
  }
  return table;
}

export function kenoMultiplier(picks: number, hits: number): number {
  if (picks <= 0 || picks > KENO_MAX_PICKS) return 0;
  if (hits < kenoMinPayHits(picks)) return 0;
  return getPayoutTable(picks).get(hits) ?? 0;
}

function drawNumbers(): number[] {
  const indices = Array.from({ length: KENO_TOTAL_NUMBERS }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, KENO_DRAWN_COUNT).sort((a, b) => a - b);
}

export interface KenoResult {
  picks: number[];
  drawn: number[];
  hits: number;
  multiplier: number;
  payout: number;
}

export function playKeno(betAmount: number, picks: number[]): KenoResult {
  const drawn = drawNumbers();
  const drawnSet = new Set(drawn);
  const hits = picks.filter((p) => drawnSet.has(p)).length;
  const multiplier = kenoMultiplier(picks.length, hits);
  const payout = Math.round(betAmount * multiplier);
  return { picks, drawn, hits, multiplier, payout };
}
