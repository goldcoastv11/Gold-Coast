/**
 * Foundational bet lifecycle (#20) - "arcade token" model.
 *
 * Every game wagers GC only (the token you spend to play, from the Coin
 * Kiosk or a real-money package purchase) and pays out TICKETS only (the
 * prize currency, spent in the Item Shop) - see repo-root CLAUDE.md and
 * ledger.ts's doc comment for the full model. GC is always spent whether a
 * round is won or lost, exactly like inserting an arcade token; a win
 * doesn't return/grow GC, it credits TICKETS instead.
 *
 * Real gameplay is server-authoritative (server/src/games/shared.ts's
 * settleSingleShotBet/placeWager/settlePayout are the equivalent that
 * actually runs) - this client-side module isn't wired into any scene's
 * win/lose flow, same as it never was. It exists as ledger-layer plumbing
 * and, more importantly now, as the surface economy.qa.test.ts's
 * independent invariant checks exercise.
 *
 * ---- Usage ----
 * For each round of play:
 *   1. Call `placeBet(ledger, amount)`. Check `.ok` - on `false`, the bet
 *      was rejected (bad amount or insufficient GC) and nothing was
 *      debited. On `true`, `amount` GC has already been debited.
 *   2. Run the game's own round logic (deal cards, spin reels, etc.) -
 *      unrelated to this module.
 *   3. Call `resolveBet(ledger, ticketsPayout)` with however many TICKETS
 *      the round paid out (0 for a loss - valid, a no-op).
 *
 * On GameState, these are exposed as `gameState.placeBet(amount)` and
 * `gameState.resolveBet(ticketsPayout)`.
 */

import { LedgerState, Transaction, applyTransaction, canAfford, getBalance } from "./ledger";

export type PlaceBetOutcome =
  | { ok: true; amount: number; transaction: Transaction }
  | { ok: false; reason: "INVALID_AMOUNT"; amount: number }
  | { ok: false; reason: "INSUFFICIENT_BALANCE"; amount: number; balance: number };

/** Debits `amount` GC as a wager (WAGER_GC transaction). Never throws; check `.ok`. */
export function placeBet(ledger: LedgerState, amount: number): PlaceBetOutcome {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "INVALID_AMOUNT", amount };
  }

  if (!canAfford(ledger, "GC", amount)) {
    return {
      ok: false,
      reason: "INSUFFICIENT_BALANCE",
      amount,
      balance: getBalance(ledger, "GC")
    };
  }

  const transaction = applyTransaction(ledger, "GC", "WAGER_GC", -amount);
  return { ok: true, amount, transaction };
}

export type ResolveBetOutcome = {
  ok: true;
  payout: number;
  /** null when payout is 0 (a total loss) - there's nothing to credit, so no transaction is recorded. */
  transaction: Transaction | null;
};

/**
 * Credits `ticketsPayout` TICKETS as a round's win (GAME_WIN_TICKETS
 * transaction). `ticketsPayout` of 0 is valid (a loss) and simply records
 * no transaction, since applyTransaction rejects a zero amount - callers
 * can unconditionally call this after every round without special-casing
 * a loss. Throws only on a malformed (negative/non-finite) amount, which
 * indicates a bug in the caller's payout math, not a normal game outcome.
 */
export function resolveBet(ledger: LedgerState, ticketsPayout: number): ResolveBetOutcome {
  if (!Number.isFinite(ticketsPayout) || ticketsPayout < 0) {
    throw new Error(
      `resolveBet: ticketsPayout must be a non-negative finite number, got ${ticketsPayout}`
    );
  }

  if (ticketsPayout === 0) {
    return { ok: true, payout: 0, transaction: null };
  }

  const transaction = applyTransaction(ledger, "TICKETS", "GAME_WIN_TICKETS", ticketsPayout);
  return { ok: true, payout: ticketsPayout, transaction };
}
