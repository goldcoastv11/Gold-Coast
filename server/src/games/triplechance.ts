/**
 * "Triple Chance" bonus round (#46) - offered after every shuffle-cup GC win
 * (signup bonus, attendant claim - see server/src/routes/auth.ts's/
 * economy.ts's claim-bonus route, and their client call sites in
 * LoginScene.ts/OverworldScene.ts). Reuses the exact same 3-cup
 * ShuffleCupReveal UI client-side (in forced-outcome mode), but this is a
 * genuinely separate wager/resolution from the shuffle-cup GC multiplier
 * itself - a single-shot game in its own right, same shape as Dice/CoinFlip
 * (#36), not a stateful round.
 *
 * Mechanic (spec from main, not derived): single pick, binary outcome.
 * 1-in-3 chance to WIN, paying exactly 3x the wagered amount; 2-in-3 chance
 * to LOSE the wagered amount entirely (0x). Flat 1/3 odds, deliberately NOT
 * scaled by whatever multiplier the original shuffle-cup landed on.
 *
 * House edge: explicitly 0%, by design - this is a bonus mini-game on
 * already-free GC (signup/attendant-claim grants), not a real wager, so
 * 3x @ 1-in-3 is exactly fair (RTP = 3 * 1/3 = 1.0 = 100%) rather than
 * shaved like every other game's edge. See test/games5.test.ts's RTP
 * invariant test, which asserts this lands at exactly 100% (not ~94%/~98%
 * like the edged games) within a tight statistical tolerance.
 *
 * Currency: GC only, enforced by the route (server/src/routes/games.ts) via
 * a hardcoded "GC" rather than accepting a currency param from the client -
 * this never touches SC in any way (CLAUDE.md: SC only via signup bonus or
 * GC-purchase bonus; this bonus round is neither and needs no new
 * exception since it simply never offers SC as an option at all).
 *
 * Repeatable/chainable by design: the client is free to call this again
 * using the previous round's payout as the next round's betAmount (offering
 * "Triple Chance again?" after a win) - this module and its route are
 * stateless per call, same as Dice/CoinFlip, so no special support is
 * needed for chaining beyond the client remembering the last payout.
 *
 * Bet bounds: deliberately NOT games/shared.ts's BET_MIN(5)/BET_MAX(500) -
 * those model the player's normal bet-size slider, but Triple Chance wagers
 * are shuffle-cup winnings (starting at 500-2000 GC, see
 * economy/gcMultiplier.ts's GC_MULTIPLIER_BASE/GC_MULTIPLIERS) which can
 * then compound 3x per chained win - already at or above BET_MAX from the
 * very first round. TRIPLE_CHANCE_MAX_AMOUNT is a generous sanity/overflow
 * rail only, not a real gameplay constraint - the real spending limit is
 * simply "can't wager more GC than you have" (enforced by the ledger's
 * insufficient-balance check, same as every other game).
 */

import { randInt } from "../rng";

export const TRIPLE_CHANCE_MIN_AMOUNT = 1;
export const TRIPLE_CHANCE_MAX_AMOUNT = 100_000_000;
export const TRIPLE_CHANCE_WIN_MULTIPLIER = 3;
export const TRIPLE_CHANCE_WIN_PROBABILITY = 1 / 3;

export interface TripleChancePlayResult {
  won: boolean;
  multiplier: number;
  payout: number;
}

/**
 * Plays one round: a fair 1-in-3 pick (crypto-backed, see ../rng) decides
 * win/lose directly - there's no separate "which of the 3 cups did the
 * player click" input, because which slot they click never changes the
 * outcome (same trust-boundary shape as the original shuffle-cup GC
 * multiplier reveal - see economy/gcMultiplier.ts's pickRandomGcMultiplier
 * doc comment: the server resolves the real outcome first, the client's cup
 * pick is purely presentational via ShuffleCupReveal's forcedMultiplier
 * mode).
 */
export function playTripleChance(betAmount: number): TripleChancePlayResult {
  const won = randInt(0, 2) === 0; // exactly 1 of 3 equally-likely outcomes
  const multiplier = won ? TRIPLE_CHANCE_WIN_MULTIPLIER : 0;
  const payout = won ? Math.round(betAmount * multiplier) : 0;
  return { won, multiplier, payout };
}
