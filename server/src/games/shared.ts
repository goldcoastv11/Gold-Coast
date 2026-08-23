/**
 * Shared plumbing for #36's game routes - the wager/payout ledger dance
 * every game needs, and the bet-amount validation every game (single-shot
 * or stateful) needs. Keeping this in one place means each individual
 * game's route file is just "validate params -> call the pure game
 * function -> settle the bet", not a re-implementation of the ledger calls
 * each time.
 *
 * "Arcade token" model (see repo-root CLAUDE.md and economy/ledger.ts's
 * doc comment): every bet is GC, spent regardless of outcome, and every
 * win pays out TICKETS - there's no currency choice any more (used to be
 * GC or SC), so these functions no longer take a `currency` parameter at
 * all. This is the ONLY place that mapping happens - every one of the 14
 * games' route handlers funnels through these three functions, so this
 * file is the entire currency-wiring surface for the whole economy
 * restructure.
 */

import { z } from "zod";
import { TxClient, applyTransaction } from "../economy/ledger";

// Mirrors casino-poc/src/GameState.ts's BET_MIN/BET_MAX (the client's bet
// stepper range) - not load-bearing for security (the server enforces its
// own bounds regardless of what a client claims), just keeping the two in
// sync so a legitimate client bet is never server-rejected as "too large/small".
export const BET_MIN = 5;
export const BET_MAX = 500;

export const BetAmountSchema = z.number().int().min(BET_MIN).max(BET_MAX);

/**
 * Debits `betAmount` GC as a wager, then credits `payout` (if > 0) TICKETS
 * as the win. Every single-shot game's whole round is exactly this shape.
 */
export async function settleSingleShotBet(
  tx: TxClient,
  userId: string,
  game: string,
  betAmount: number,
  payout: number,
  meta: Record<string, unknown>
): Promise<void> {
  await applyTransaction(tx, userId, "GC", "WAGER_GC", -betAmount, { game, ...meta });

  if (payout > 0) {
    await applyTransaction(tx, userId, "TICKETS", "GAME_WIN_TICKETS", payout, { game, ...meta });
  }
}

/** Just the wager leg (GC debit), for stateful games' `start` endpoint - payout happens later, at cashout/resolution. */
export async function placeWager(
  tx: TxClient,
  userId: string,
  game: string,
  betAmount: number,
  meta: Record<string, unknown>
): Promise<void> {
  await applyTransaction(tx, userId, "GC", "WAGER_GC", -betAmount, { game, ...meta });
}

/** Just the payout leg (TICKETS credit), for stateful games' resolution/cashout endpoints. No-op if payout <= 0. */
export async function settlePayout(
  tx: TxClient,
  userId: string,
  game: string,
  payout: number,
  meta: Record<string, unknown>
): Promise<void> {
  if (payout <= 0) return;
  await applyTransaction(tx, userId, "TICKETS", "GAME_WIN_TICKETS", payout, { game, ...meta });
}
