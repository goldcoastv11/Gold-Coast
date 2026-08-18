/**
 * Persistence layer for stateful games' round state (#36) - the
 * `game_rounds` table. Every stateful game (Mines, Dragon Tower, Hi-Lo,
 * Blackjack, Video Poker) stores its hidden state (mine positions, deck,
 * dealer hand, etc.) here as opaque JSON; each game module owns its own
 * state shape and casts through this generic layer.
 *
 * Concurrency note: "one active round per user" is enforced by a
 * check-then-create inside a single `tx`, not a DB constraint - Postgres's
 * default READ COMMITTED isolation means two truly simultaneous `start`
 * requests from the same user could theoretically both pass the check
 * before either commits (a real race, not eliminated here). Accepted as a
 * POC-level risk consistent with the rest of this project (single-user
 * testing, not concurrent production load) rather than adding a partial
 * unique index for a problem that requires a user racing themselves across
 * two tabs to trigger. Worth hardening (partial unique index on
 * (user_id) WHERE status = 'active') before this is ever real money.
 */

import { Currency, TxClient } from "../economy/ledger";

export class RoundAlreadyActiveError extends Error {
  constructor(public readonly existingGame: string) {
    super(`User already has an active ${existingGame} round`);
    this.name = "RoundAlreadyActiveError";
  }
}

export class NoActiveRoundError extends Error {
  constructor() {
    super("No active round found for this game/user");
    this.name = "NoActiveRoundError";
  }
}

export interface ActiveRound<TState> {
  id: string;
  betAmount: number;
  currency: Currency;
  state: TState;
}

/** Creates a new active round for `game`. Rejects (RoundAlreadyActiveError) if the user already has any active round, for any game. */
export async function createRound<TState>(
  tx: TxClient,
  userId: string,
  game: string,
  betAmount: number,
  currency: Currency,
  state: TState
): Promise<string> {
  const existing = await tx.gameRound.findFirst({ where: { userId, status: "active" } });
  if (existing) {
    throw new RoundAlreadyActiveError(existing.game);
  }

  const created = await tx.gameRound.create({
    data: {
      userId,
      game,
      betAmount,
      currency,
      state: state as object,
      status: "active"
    }
  });
  return created.id;
}

/** Loads the user's active round for `game`, verifying ownership + game + active status. Throws NoActiveRoundError otherwise (covers "not found", "not yours", "already resolved", and "wrong game" identically - none of those should leak which case it was to the client). */
export async function loadActiveRound<TState>(
  tx: TxClient,
  userId: string,
  game: string,
  roundId: string
): Promise<ActiveRound<TState>> {
  const round = await tx.gameRound.findUnique({ where: { id: roundId } });
  if (!round || round.userId !== userId || round.game !== game || round.status !== "active") {
    throw new NoActiveRoundError();
  }
  return {
    id: round.id,
    betAmount: round.betAmount,
    currency: round.currency,
    state: round.state as TState
  };
}

export async function updateRoundState<TState>(tx: TxClient, roundId: string, state: TState): Promise<void> {
  await tx.gameRound.update({ where: { id: roundId }, data: { state: state as object } });
}

/** Marks a round resolved (win, loss, or cash-out) - it stops being the user's "active round" and can no longer be picked/hit/guessed against. */
export async function closeRound(tx: TxClient, roundId: string): Promise<void> {
  await tx.gameRound.update({ where: { id: roundId }, data: { status: "resolved" } });
}

export interface ActiveRoundSummary {
  id: string;
  game: string;
  betAmount: number;
  currency: Currency;
}

/**
 * Loads the user's currently-active round, whichever game it belongs to -
 * unlike `loadActiveRound`, this doesn't require the caller to already know
 * which game/roundId it is. Backs `POST /games/abandon` (#42): a user who
 * hit ROUND_ALREADY_ACTIVE after a crash/refresh/walk-away has no reliable
 * client-side record of which round that was, only that `createRound`
 * enforces one active round per user *across every game* - so "find
 * whatever's active" is exactly what abandoning needs, and is the only
 * shape that also self-heals a round left behind by an interruption that
 * happened before the client could store a roundId at all (e.g. a refresh
 * immediately after `start`). Throws NoActiveRoundError if there is none.
 */
export async function loadAnyActiveRound(tx: TxClient, userId: string): Promise<ActiveRoundSummary> {
  const round = await tx.gameRound.findFirst({ where: { userId, status: "active" } });
  if (!round) {
    throw new NoActiveRoundError();
  }
  return { id: round.id, game: round.game, betAmount: round.betAmount, currency: round.currency };
}
