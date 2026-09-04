/**
 * Turning a finished Roulette round into ledger entries.
 *
 * Split out of realtime/server.ts so the money half of the live table can be
 * tested against a real database without standing up a WebSocket server and
 * waiting out a 12-second betting window. It is the only part of the
 * realtime feature that moves a balance, so it is the part worth being able
 * to drive directly.
 *
 * Every round settles through `settleSingleShotBet` - the same helper all 14
 * solo games use - so a live-table round lands in the ledger with the same
 * shape as a solo one and counts toward challenges and XP identically.
 * There is deliberately no bespoke currency wiring here; see games/shared.ts
 * on why that file is the entire currency surface.
 */

import { prisma } from "../db";
import { InsufficientBalanceError } from "../economy/ledger";
import { settleSingleShotBet } from "../games/shared";
import { TableColor, TableResult } from "./protocol";

export interface SettlementOutcome {
  /** Players whose round did not happen: nothing debited, nothing paid. See below for the two ways this occurs. */
  voidedUserIds: string[];
  /** The results as they actually settled - voided players zeroed out - ready to broadcast. */
  settled: TableResult[];
}

/**
 * Settles one round, one player at a time.
 *
 * **One transaction per player, not one for the table.** A single
 * transaction would mean one player who cannot cover their stake rolls back
 * everyone else's winnings, which is plainly the wrong outcome: their bet is
 * their problem. Per-player also keeps each round's ledger entries exactly
 * the same shape as a solo game's, which is what makes the audit trail
 * comparable.
 *
 * A bet is voided in two cases, and both are treated the same way, because
 * from the player's side they are the same thing - the round did not happen:
 *
 * 1. **They cannot afford it.** Balance is checked when the bet is placed,
 *    so this means they spent the Gold Coins somewhere else before the wheel
 *    stopped. The ledger refuses the wager and the bet is void. A bet you
 *    could not cover is not a bet you get to win.
 * 2. **Something failed.** The database is unreachable, or there is a bug.
 *    Voiding is the safe direction: reporting a win that was never paid is
 *    worse than reporting no round at all, and nothing was debited either.
 */
export async function settleTableRound(
  roundId: string,
  number: number,
  results: TableResult[]
): Promise<SettlementOutcome> {
  const voidedUserIds: string[] = [];

  for (const result of results) {
    try {
      await prisma.$transaction(async (tx) => {
        await settleSingleShotBet(tx, result.userId, "roulette", result.amount, result.payout, {
          bet: result.choice,
          number,
          // Marks this round as a live-table one in the transaction's audit
          // metadata. The game name stays "roulette" so the two modes share
          // a bucket for challenges and the daily metrics rundown - they are
          // the same wheel, played two ways.
          table: true,
          roundId
        });
      });
    } catch (err) {
      if (!(err instanceof InsufficientBalanceError)) {
        // Case 2 above. Logged because, unlike an unaffordable bet, this is
        // a fault rather than a player's own doing.
        console.error(`roulette table: settlement failed for ${result.userId}`, err);
      }
      voidedUserIds.push(result.userId);
    }
  }

  const voided = new Set(voidedUserIds);
  const settled = results.map((result) =>
    voided.has(result.userId) ? { ...result, won: false, payout: 0, voided: true } : result
  );

  return { voidedUserIds, settled };
}

/** Re-exported for the settlement caller's convenience - the colour is part of what gets broadcast alongside these results. */
export type { TableColor, TableResult };
