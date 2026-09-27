/**
 * Turning a finished live Blackjack hand into ledger entries.
 *
 * The Blackjack twin of tableSettlement.ts, split out of the socket adapter
 * for the same reason: this is one of only two places in the whole
 * multiplayer feature that moves a balance, so it is worth being able to
 * drive directly from a test rather than through a WebSocket and a
 * 15-second betting window.
 *
 * Every seat settles through `settleSingleShotBet` - the same helper all 14
 * solo games use - so a live hand lands in the ledger with the same shape
 * as a solo one and counts toward challenges and XP identically. There is
 * deliberately no bespoke currency wiring here; games/shared.ts is the
 * entire currency surface.
 */

import { prisma } from "../db";
import { InsufficientBalanceError } from "../economy/ledger";
import { settleSingleShotBet } from "../games/shared";
import { BlackjackSeat } from "./protocol";

export interface BlackjackSettlementOutcome {
  /** Seats whose hand did not happen: nothing debited, nothing paid. */
  voidedUserIds: string[];
  /** The seats as they actually settled - voided ones zeroed - ready to broadcast. */
  settled: BlackjackSeat[];
}

/**
 * Settles one hand, one seat at a time.
 *
 * **One transaction per seat, not one for the table** - identical reasoning
 * to Roulette's: a single table-wide transaction would let one player who
 * cannot cover their stake roll back everyone else's winnings, which is
 * plainly the wrong outcome. Their bet is their problem.
 *
 * A seat is voided in two cases, treated the same way because from the
 * player's side they are the same thing - the hand did not happen:
 *
 * 1. **They cannot afford it.** Balance is checked when the bet is placed,
 *    so this means they spent the Gold Coins elsewhere while the hand was
 *    being dealt. The ledger refuses the wager and the seat is void.
 * 2. **Something failed.** The database is unreachable, or there is a bug.
 *    Voiding is the safe direction: reporting a win that was never paid is
 *    worse than reporting no hand at all, and nothing was debited either.
 *
 * A PUSH still settles rather than being skipped. It debits the stake and
 * credits it straight back, which nets to zero but leaves an honest pair of
 * ledger rows - a hand that was played and returned, not a hand that never
 * happened. That distinction is exactly what the audit trail is for.
 */
export async function settleBlackjackRound(
  roundId: string,
  seats: BlackjackSeat[]
): Promise<BlackjackSettlementOutcome> {
  const voidedUserIds: string[] = [];

  for (const seat of seats) {
    try {
      await prisma.$transaction(async (tx) => {
        await settleSingleShotBet(tx, seat.userId, "blackjack", seat.bet, seat.payout, {
          outcome: seat.outcome,
          total: seat.total,
          status: seat.status,
          // Marks this as a live-table hand in the audit metadata. The game
          // name stays "blackjack" so both modes share a bucket for
          // challenges and the daily metrics - it is the same game, played
          // two ways.
          table: true,
          roundId
        });
      });
    } catch (err) {
      if (!(err instanceof InsufficientBalanceError)) {
        // Case 2 above. Logged because, unlike an unaffordable bet, this is
        // a fault rather than a player's own doing.
        console.error(`blackjack table: settlement failed for ${seat.userId}`, err);
      }
      voidedUserIds.push(seat.userId);
    }
  }

  const voided = new Set(voidedUserIds);
  const settled = seats.map((seat) =>
    voided.has(seat.userId) ? { ...seat, outcome: "lose" as const, payout: 0, voided: true } : seat
  );

  return { voidedUserIds, settled };
}
