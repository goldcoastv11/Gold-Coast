/**
 * Transaction ledger — the single source of truth for GC (Gold Coin)
 * balances.
 *
 * Per the project economy rules (see repo-root CLAUDE.md), Gold Coins are
 * the only currency: bet GC, win GC, buy cosmetics with GC. This replaced
 * two earlier models entirely (an SC/"Sweeps Coin" sweepstakes model, then a
 * GC/TICKETS "arcade token" model) - there is no second currency and no
 * real-money redemption of anything in this game any more.
 *
 * No code anywhere should mutate a balance number directly - every change
 * (purchase, payout, wager, bonus) must go through `applyTransaction` so
 * there is always a full, inspectable audit trail.
 *
 * This module is intentionally pure/side-effect-free (no localStorage, no
 * DOM, no Phaser) so it's trivial to unit test - it just mutates the
 * LedgerState object it's given and returns the resulting Transaction.
 */

export type Currency = "GC";

/**
 * Every distinct reason a balance can change. Keeping this as a closed
 * union (rather than a free-text string) means a `grep` for a type tells
 * you every code path that can move money, and QA can assert on it.
 */
export type TransactionType =
  // GC leg of the signup bonus (#27 - resolved GC amount, see
  // economy/gcMultiplier.ts).
  | "SIGNUP_BONUS_GC"
  // Real-money GC purchase
  | "PACKAGE_GC"
  // GC-only ad-reward refill (Coin Kiosk's ad-gated claim)
  | "AD_REWARD_GC"
  // Gameplay wagers, always GC (every round's bet is spent whether it's
  // won or lost, exactly like inserting an arcade token)
  | "WAGER_GC"
  // Generic adjustment - used only as a bridge for legacy call sites
  // (existing game scenes that do `gameState.goldCoins -= bet`) until
  // they're migrated to call WAGER_GC explicitly. Still goes through the
  // ledger, still fully audited.
  | "ADJUST_GC";

export interface Transaction {
  id: string;
  /** ms since epoch */
  ts: number;
  currency: Currency;
  type: TransactionType;
  /** Signed amount: positive = credit, negative = debit. Never 0. */
  amount: number;
  /** Balance of `currency` immediately after this transaction. */
  balanceAfter: number;
  meta?: Record<string, unknown>;
}

export interface LedgerState {
  gc: number;
  transactions: Transaction[];
}

export class InsufficientBalanceError extends Error {
  constructor(currency: Currency, current: number, amount: number) {
    super(
      `Insufficient ${currency} balance: have ${current}, tried to apply ${amount}`
    );
    this.name = "InsufficientBalanceError";
  }
}

let txCounter = 0;

/** Monotonic-ish unique id for a transaction. Not cryptographic - just needs to be unique within a session. */
function nextTransactionId(): string {
  txCounter += 1;
  return `tx_${Date.now().toString(36)}_${txCounter.toString(36)}`;
}

export function createLedger(initialGc = 0): LedgerState {
  return { gc: initialGc, transactions: [] };
}

/**
 * The one and only place a GC balance number is allowed to change. Mutates
 * `state` in place and appends a Transaction record; returns that record.
 * Throws InsufficientBalanceError rather than letting a balance go negative
 * - callers that want a friendlier UX should check affordability (e.g. via
 * getBalance) before calling this and surface their own message.
 */
export function applyTransaction(
  state: LedgerState,
  currency: Currency,
  type: TransactionType,
  amount: number,
  meta?: Record<string, unknown>
): Transaction {
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error(
      `applyTransaction: amount must be a non-zero finite number, got ${amount}`
    );
  }

  const current = state.gc;
  const next = current + amount;

  if (next < 0) {
    throw new InsufficientBalanceError(currency, current, amount);
  }

  state.gc = next;

  const transaction: Transaction = {
    id: nextTransactionId(),
    ts: Date.now(),
    currency,
    type,
    amount,
    balanceAfter: next,
    meta
  };
  state.transactions.push(transaction);
  return transaction;
}

export function getBalance(state: LedgerState, currency: Currency): number {
  void currency; // only one currency exists; kept for call-site symmetry with the server ledger
  return state.gc;
}

/** True if a debit of `amount` from `currency` would succeed without throwing. */
export function canAfford(
  state: LedgerState,
  currency: Currency,
  amount: number
): boolean {
  return getBalance(state, currency) >= amount;
}

/** Returns transactions of the given currency/type (either omittable), most recent first. */
export function getTransactions(
  state: LedgerState,
  filter?: { currency?: Currency; type?: TransactionType }
): Transaction[] {
  let txs = state.transactions;
  if (filter?.currency) txs = txs.filter((t) => t.currency === filter.currency);
  if (filter?.type) txs = txs.filter((t) => t.type === filter.type);
  return [...txs].reverse();
}
