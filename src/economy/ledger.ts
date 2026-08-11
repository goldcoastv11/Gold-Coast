/**
 * Transaction ledger — the single source of truth for GC (Gold Coin) and
 * SC (Sweeps Coin) balances.
 *
 * Per the project economy rules (see repo-root CLAUDE.md):
 *   - GC and SC are separate ledgers (tracked as two fields on one
 *     LedgerState, never conflated or convertible into one another).
 *   - No code anywhere should mutate a balance number directly - every
 *     change (purchase, payout, wager, bonus, redemption, skin buy, ad
 *     reward) must go through `applyTransaction` so there is always a full,
 *     inspectable audit trail.
 *
 * This module is intentionally pure/side-effect-free (no localStorage, no
 * DOM, no Phaser) so it's trivial to unit test - it just mutates the
 * LedgerState object it's given and returns the resulting Transaction.
 */

export type Currency = "GC" | "SC";

/**
 * Every distinct reason a balance can change. Keeping this as a closed
 * union (rather than a free-text string) means a `grep` for a type tells
 * you every code path that can move money, and QA can assert on it.
 */
export type TransactionType =
  // SC bonus - the ONLY two legitimate sources of SC (never sold directly)
  | "SIGNUP_BONUS_SC"
  | "PACKAGE_BONUS_SC"
  // GC purchase
  | "PACKAGE_GC"
  // GC-only skin shop
  | "SKIN_PURCHASE_GC"
  // GC-only ad-reward refill
  | "AD_REWARD_GC"
  // SC redemption (cash-out), always a debit
  | "REDEMPTION_SC"
  // Gameplay wagers/payouts, tagged by currency
  | "WAGER_GC"
  | "WAGER_SC"
  | "PAYOUT_GC"
  | "PAYOUT_SC"
  // Generic adjustment - used only as a bridge for legacy call sites
  // (existing game scenes that do `gameState.goldCoins -= bet`) until
  // they're migrated to call WAGER_GC/PAYOUT_GC explicitly. Still goes
  // through the ledger, still fully audited.
  | "ADJUST_GC"
  | "ADJUST_SC";

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
  sc: number;
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

export function createLedger(initialGc = 0, initialSc = 0): LedgerState {
  return { gc: initialGc, sc: initialSc, transactions: [] };
}

/**
 * The one and only place a GC or SC balance number is allowed to change.
 * Mutates `state` in place and appends a Transaction record; returns that
 * record. Throws InsufficientBalanceError rather than letting a balance go
 * negative - callers that want a friendlier UX should check affordability
 * (e.g. via getBalance) before calling this and surface their own message.
 *
 * Hardening (economy rule: SC is NEVER sold/minted outside the signup
 * bonus and package-bonus paths): a positive (crediting) "ADJUST_SC" is
 * rejected outright. ADJUST_SC exists only as a debit-capable bridge for
 * legacy call sites - it must never be the thing that puts new SC into a
 * balance. Real SC credits must use SIGNUP_BONUS_SC or PACKAGE_BONUS_SC.
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

  if (currency === "SC" && type === "ADJUST_SC" && amount > 0) {
    throw new Error(
      "applyTransaction: ADJUST_SC cannot credit SC. SC may only be granted " +
        "via SIGNUP_BONUS_SC (signupBonus.ts) or PACKAGE_BONUS_SC " +
        "(packages.ts) - see repo-root CLAUDE.md. ADJUST_SC may only debit."
    );
  }

  const balanceKey = currency === "GC" ? "gc" : "sc";
  const current = state[balanceKey];
  const next = current + amount;

  if (next < 0) {
    throw new InsufficientBalanceError(currency, current, amount);
  }

  state[balanceKey] = next;

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
  return currency === "GC" ? state.gc : state.sc;
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
