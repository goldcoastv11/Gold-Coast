/**
 * Transaction ledger - the single source of truth for GC (Gold Coin)
 * balances, server-side.
 *
 * Mirrors casino-poc/src/economy/ledger.ts's rules exactly (see repo-root
 * CLAUDE.md, GC-only economy):
 *   - GC is the one live currency - spent on every bet, win or lose, paid
 *     back out as GC on a win, and topped up via the Coin Kiosk, a package
 *     purchase, or a challenge/level reward. TICKETS (balances.tickets, the
 *     old win currency) is retired as of 2026-08-29 - every account's
 *     balance was zeroed via a one-time balancing transaction, and
 *     `applyTransaction` below refuses to touch it again (see that
 *     function). The `tickets` Prisma field stays mapped onto the
 *     pre-existing `stake_coins` physical column (schema.prisma's header
 *     comment) purely so historical rows stay readable.
 *   - No code anywhere is allowed to write balances.gold_coins/tickets
 *     directly - `applyTransaction` (below) is the ONLY function that may.
 *     It always inserts one `transactions` row in the same DB transaction
 *     as the balance update, so there's a complete, inspectable audit
 *     trail and a balance change can never happen without one.
 *
 * Concurrency: the balance update is a single atomic
 * `UPDATE ... WHERE balance + delta >= 0 RETURNING ...` statement, so two
 * concurrent debits against the same row can't race each other into a
 * negative balance (Postgres row-level locking serializes the second
 * writer behind the first automatically) - no explicit `SELECT ... FOR
 * UPDATE` or app-level locking needed. Every exported economy function
 * takes a Prisma "interactive transaction" client (`tx`) rather than the
 * top-level `prisma` client, so callers (routes) wrap a whole request's
 * worth of ledger + related-table writes (e.g. grant GC, grant SC bonus,
 * register a playthrough requirement) in one `prisma.$transaction(...)`
 * and get all-or-nothing semantics across the group, not just per call.
 */

import { Currency, Prisma, TransactionType } from "@prisma/client";

export type { Currency, TransactionType };
export type TxClient = Prisma.TransactionClient;

export class InsufficientBalanceError extends Error {
  constructor(
    public readonly currency: Currency,
    public readonly current: number,
    public readonly amount: number
  ) {
    super(`Insufficient ${currency} balance: have ${current}, tried to apply ${amount}`);
    this.name = "InsufficientBalanceError";
  }
}

export interface LedgerTransaction {
  id: string;
  currency: Currency;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Atomically applies `amount + current balance` for `currency` and returns
 * the new balance, or `null` if that would go negative (nothing is
 * written in that case). One currency-specific branch each so no dynamic
 * SQL identifier interpolation is needed anywhere near user input.
 */
async function creditOrDebitBalance(
  tx: TxClient,
  userId: string,
  currency: Currency,
  amount: number
): Promise<number | null> {
  if (currency === "GC") {
    const rows = await tx.$queryRaw<{ gold_coins: number }[]>`
      UPDATE balances
      SET gold_coins = gold_coins + ${amount}
      WHERE user_id = ${userId} AND gold_coins + ${amount} >= 0
      RETURNING gold_coins
    `;
    return rows.length > 0 ? rows[0].gold_coins : null;
  }

  // TICKETS - physical column is still named stake_coins, see this file's
  // header comment and schema.prisma's.
  const rows = await tx.$queryRaw<{ stake_coins: number }[]>`
    UPDATE balances
    SET stake_coins = stake_coins + ${amount}
    WHERE user_id = ${userId} AND stake_coins + ${amount} >= 0
    RETURNING stake_coins
  `;
  return rows.length > 0 ? rows[0].stake_coins : null;
}

/**
 * The one and only place a `balances` row is allowed to change. Applies
 * `amount` (positive = credit, negative = debit) of `currency` for
 * `userId` and inserts the matching `transactions` row in the same DB
 * transaction (`tx`). Throws `InsufficientBalanceError` rather than
 * letting a balance go negative.
 *
 * Hardening (economy rule: TICKETS are NEVER sold or minted - they're only
 * ever won by playing a game): a positive (crediting) amount is rejected
 * for every TransactionType except GAME_WIN_TICKETS.
 */
export async function applyTransaction(
  tx: TxClient,
  userId: string,
  currency: Currency,
  type: TransactionType,
  amount: number,
  meta?: Record<string, unknown>
): Promise<LedgerTransaction> {
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error(`applyTransaction: amount must be a non-zero finite number, got ${amount}`);
  }

  // TICKETS is retired (2026-08-29 GC-only economy restructure, see repo-
  // root CLAUDE.md and schema.prisma's header comment) - the ONLY legal
  // TICKETS transaction from here on is the one-time TICKETS_RETIRED debit
  // that zeroed every account's balance, and even that may only ever debit,
  // never credit. Every other TICKETS type (GAME_WIN_TICKETS,
  // SKIN_PURCHASE_TICKETS, etc.) still exists in the schema for historical
  // rows, but new code may never write another one.
  if (currency === "TICKETS") {
    if (type !== "TICKETS_RETIRED") {
      throw new Error(
        `applyTransaction: TICKETS is retired - the only legal TICKETS transaction is the one-time ` +
          `TICKETS_RETIRED balance zero-out (got type ${type}). See repo-root CLAUDE.md.`
      );
    }
    if (amount > 0) {
      throw new Error(
        "applyTransaction: TICKETS_RETIRED may only debit (zero out) a balance, never credit."
      );
    }
  }

  const balanceAfter = await creditOrDebitBalance(tx, userId, currency, amount);
  if (balanceAfter === null) {
    // Insufficient balance (or no balances row at all) - fetch the current
    // value just for a helpful error message; nothing was written above.
    const balance = await tx.balance.findUnique({ where: { userId } });
    const current = balance ? (currency === "GC" ? balance.goldCoins : balance.tickets) : 0;
    throw new InsufficientBalanceError(currency, current, amount);
  }

  const created = await tx.transaction.create({
    data: {
      userId,
      currency,
      type,
      amount,
      balanceAfter,
      meta: meta === undefined ? Prisma.JsonNull : (meta as Prisma.InputJsonValue)
    }
  });

  return {
    id: created.id,
    currency: created.currency,
    type: created.type,
    amount: created.amount,
    balanceAfter: created.balanceAfter,
    meta: (created.meta as Record<string, unknown> | null) ?? null,
    createdAt: created.createdAt
  };
}

export async function getBalance(tx: TxClient, userId: string, currency: Currency): Promise<number> {
  const balance = await tx.balance.findUnique({ where: { userId } });
  if (!balance) return 0;
  return currency === "GC" ? balance.goldCoins : balance.tickets;
}

export async function canAfford(
  tx: TxClient,
  userId: string,
  currency: Currency,
  amount: number
): Promise<boolean> {
  return (await getBalance(tx, userId, currency)) >= amount;
}
