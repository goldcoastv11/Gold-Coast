/**
 * Transaction ledger — the single source of truth for GC (Gold Coin) and
 * TICKETS balances.
 *
 * Per the project economy rules (see repo-root CLAUDE.md), this is the
 * "arcade token" model: GC is what you spend to play (from the Coin Kiosk,
 * free, or a real-money package purchase - see packages.ts), and is always
 * spent whether a round is won or lost, exactly like inserting a token
 * into an arcade cabinet. Winning a round doesn't return/grow your GC - it
 * pays out TICKETS instead, a completely separate currency with no
 * real-money value, spendable only in the Item Shop. This replaced an
 * earlier GC/SC ("Sweeps Coin") sweepstakes-style model entirely - there
 * is no real-money redemption of anything in this game any more.
 *
 * GC and TICKETS are separate ledgers (tracked as two fields on one
 * LedgerState, never conflated or convertible into one another). No code
 * anywhere should mutate a balance number directly - every change
 * (purchase, payout, wager, bonus, skin buy) must go through
 * `applyTransaction` so there is always a full, inspectable audit trail.
 *
 * This module is intentionally pure/side-effect-free (no localStorage, no
 * DOM, no Phaser) so it's trivial to unit test - it just mutates the
 * LedgerState object it's given and returns the resulting Transaction.
 */

export type Currency = "GC" | "TICKETS";

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
  // A game round's TICKETS win - the only way TICKETS are ever credited.
  | "GAME_WIN_TICKETS"
  // TICKETS spent in the Item Shop - the only way TICKETS are ever debited.
  | "SKIN_PURCHASE_TICKETS"
  // Gameplay wagers, always GC (arcade token model - the bet is spent
  // whether the round is won or lost; see GAME_WIN_TICKETS for the payout)
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
  tickets: number;
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

export function createLedger(initialGc = 0, initialTickets = 0): LedgerState {
  return { gc: initialGc, tickets: initialTickets, transactions: [] };
}

/**
 * The one and only place a GC or TICKETS balance number is allowed to
 * change. Mutates `state` in place and appends a Transaction record;
 * returns that record. Throws InsufficientBalanceError rather than letting
 * a balance go negative - callers that want a friendlier UX should check
 * affordability (e.g. via getBalance) before calling this and surface
 * their own message.
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

  const balanceKey = currency === "GC" ? "gc" : "tickets";
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
  return currency === "GC" ? state.gc : state.tickets;
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
