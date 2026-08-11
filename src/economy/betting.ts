/**
 * Foundational, currency-aware bet lifecycle (#20).
 *
 * Every game currently wagers GC only, going straight at
 * `gameState.goldCoins -=/+= amount` (which is itself ledger-backed
 * internally, just not currency-generic or semantically-typed as a wager -
 * see the ADJUST_GC comment in ledger.ts). This module is the ledger-side
 * foundation for letting games wager SC too, per the standard sweepstakes
 * model: SC is wagerable anytime (no playthrough gate on placing a bet -
 * that would be backwards, since wagering SC is HOW the playthrough
 * requirement clears), and only redemption is gated on playthrough being
 * cleared (see redemption.ts / playthrough.ts).
 *
 * Scope note: this is ledger-layer plumbing only. Wiring it into the bet
 * control UI (a GC/SC toggle) and into each game scene's win/lose flow is
 * an explicit follow-up for games/floor, not done here - see the
 * "Integration guide for games/floor" doc comment below.
 *
 * ---- Integration guide for games/floor ----
 * For each round of play:
 *   1. Call `placeBet(ledger, playthrough, currency, amount)` when the
 *      player commits to a bet. Check `.ok` - on `false`, the bet was
 *      rejected (bad amount or insufficient balance in that currency) and
 *      nothing was debited; show that in the UI and don't start the round.
 *      On `true`, `amount` has already been debited from `currency` and,
 *      if `currency === "SC"`, that amount already counted toward clearing
 *      the playthrough requirement (regardless of whether the round is won
 *      or lost - wagering is what counts, not winning).
 *   2. Run the game's own round logic (deal cards, spin reels, etc.) -
 *      unrelated to this module.
 *   3. Call `resolveBet(ledger, currency, payoutAmount)` with the same
 *      currency and however much the round paid out (0 for a total loss -
 *      that's valid and intentionally a no-op credit, not an error; pass
 *      the gross return, e.g. a 2x win on a 10 SC bet resolves with
 *      payoutAmount 20, not just the 10 profit).
 *
 * `placeBet`/`resolveBet` operate on one currency per call - a single game
 * round is either a GC round or an SC round, never a mix. If/when the UI
 * adds a GC/SC toggle, that's what should decide which `currency` a given
 * round's placeBet/resolveBet pair uses.
 *
 * On GameState, these are exposed as `gameState.placeBet(currency, amount)`
 * and `gameState.resolveBet(currency, payoutAmount)`.
 */

import {
  Currency,
  LedgerState,
  Transaction,
  applyTransaction,
  canAfford,
  getBalance
} from "./ledger";
import { PlaythroughState, recordScWager } from "./playthrough";

export type PlaceBetOutcome =
  | { ok: true; currency: Currency; amount: number; transaction: Transaction }
  | { ok: false; reason: "INVALID_AMOUNT"; currency: Currency; amount: number }
  | { ok: false; reason: "INSUFFICIENT_BALANCE"; currency: Currency; amount: number; balance: number };

/**
 * Debits `amount` of `currency` as a wager (WAGER_GC/WAGER_SC transaction).
 * If `currency` is "SC", also records `amount` toward the playthrough
 * requirement via `recordScWager` - wagering SC is what clears it,
 * independent of whether the round is later won or lost. Never throws;
 * check `.ok`.
 */
export function placeBet(
  ledger: LedgerState,
  playthrough: PlaythroughState,
  currency: Currency,
  amount: number
): PlaceBetOutcome {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "INVALID_AMOUNT", currency, amount };
  }

  if (!canAfford(ledger, currency, amount)) {
    return {
      ok: false,
      reason: "INSUFFICIENT_BALANCE",
      currency,
      amount,
      balance: getBalance(ledger, currency)
    };
  }

  const type = currency === "GC" ? "WAGER_GC" : "WAGER_SC";
  const transaction = applyTransaction(ledger, currency, type, -amount);

  if (currency === "SC") {
    recordScWager(playthrough, amount);
  }

  return { ok: true, currency, amount, transaction };
}

export type ResolveBetOutcome = {
  ok: true;
  currency: Currency;
  payout: number;
  /** null when payout is 0 (a total loss) - there's nothing to credit, so no transaction is recorded. */
  transaction: Transaction | null;
};

/**
 * Credits `payoutAmount` of `currency` as a round's payout (PAYOUT_GC/
 * PAYOUT_SC transaction). Pass the gross return (stake + winnings), not
 * just profit. `payoutAmount` of 0 is valid (a total loss) and simply
 * records no transaction, since applyTransaction rejects a zero amount -
 * callers can unconditionally call this after every round without special
 * casing a loss. Throws only on a malformed (negative/non-finite) amount,
 * which indicates a bug in the caller's payout math, not a normal game
 * outcome.
 */
export function resolveBet(
  ledger: LedgerState,
  currency: Currency,
  payoutAmount: number
): ResolveBetOutcome {
  if (!Number.isFinite(payoutAmount) || payoutAmount < 0) {
    throw new Error(
      `resolveBet: payoutAmount must be a non-negative finite number, got ${payoutAmount}`
    );
  }

  if (payoutAmount === 0) {
    return { ok: true, currency, payout: 0, transaction: null };
  }

  const type = currency === "GC" ? "PAYOUT_GC" : "PAYOUT_SC";
  const transaction = applyTransaction(ledger, currency, type, payoutAmount);

  return { ok: true, currency, payout: payoutAmount, transaction };
}
