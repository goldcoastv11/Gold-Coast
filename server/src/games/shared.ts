/**
 * Shared plumbing for #36's game routes - the wager/payout ledger dance
 * every single-shot game needs, and the bet-amount validation every game
 * (single-shot or stateful) needs. Keeping this in one place means each
 * individual game's route file is just "validate params -> call the pure
 * game function -> settle the bet", not a re-implementation of the ledger
 * calls each time.
 */

import { z } from "zod";
import { Currency, TxClient, applyTransaction } from "../economy/ledger";
import { recordScWager } from "../economy/playthrough";

// Mirrors casino-poc/src/GameState.ts's BET_MIN/BET_MAX (the client's bet
// stepper range) - not load-bearing for security (the server enforces its
// own bounds regardless of what a client claims), just keeping the two in
// sync so a legitimate client bet is never server-rejected as "too large/small".
export const BET_MIN = 5;
export const BET_MAX = 500;

export const BetAmountSchema = z.number().int().min(BET_MIN).max(BET_MAX);
export const CurrencySchema = z.enum(["GC", "SC"]);

/**
 * Debits `betAmount` of `currency` as a wager (throws InsufficientBalanceError
 * if the player can't afford it - app.ts's central error handler turns that
 * into a 400 INSUFFICIENT_BALANCE response), records SC playthrough progress
 * if the wager was SC, then credits `payout` (if > 0) as a payout. Every
 * single-shot game's whole round is exactly this shape.
 */
export async function settleSingleShotBet(
  tx: TxClient,
  userId: string,
  game: string,
  currency: Currency,
  betAmount: number,
  payout: number,
  meta: Record<string, unknown>
): Promise<void> {
  const wagerType = currency === "GC" ? "WAGER_GC" : "WAGER_SC";
  await applyTransaction(tx, userId, currency, wagerType, -betAmount, { game, ...meta });

  if (currency === "SC") {
    await recordScWager(tx, userId, betAmount);
  }

  if (payout > 0) {
    const payoutType = currency === "GC" ? "PAYOUT_GC" : "PAYOUT_SC";
    await applyTransaction(tx, userId, currency, payoutType, payout, { game, ...meta });
  }
}

/** Just the wager leg (debit + playthrough), for stateful games' `start` endpoint - payout happens later, at cashout/resolution. */
export async function placeWager(
  tx: TxClient,
  userId: string,
  game: string,
  currency: Currency,
  betAmount: number,
  meta: Record<string, unknown>
): Promise<void> {
  const wagerType = currency === "GC" ? "WAGER_GC" : "WAGER_SC";
  await applyTransaction(tx, userId, currency, wagerType, -betAmount, { game, ...meta });
  if (currency === "SC") {
    await recordScWager(tx, userId, betAmount);
  }
}

/** Just the payout leg, for stateful games' resolution/cashout endpoints. No-op if payout <= 0. */
export async function settlePayout(
  tx: TxClient,
  userId: string,
  game: string,
  currency: Currency,
  payout: number,
  meta: Record<string, unknown>
): Promise<void> {
  if (payout <= 0) return;
  const payoutType = currency === "GC" ? "PAYOUT_GC" : "PAYOUT_SC";
  await applyTransaction(tx, userId, currency, payoutType, payout, { game, ...meta });
}
