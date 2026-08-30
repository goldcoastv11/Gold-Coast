/**
 * Challenge progress, claiming, and XP/level grants.
 *
 * ============================ TRUST BOUNDARY ============================
 * The single most important thing in this file: challenge progress is
 * driven ONLY from server-computed game settlement - the wager and payout
 * amounts that games/shared.ts has just written to the ledger itself.
 *
 * It is deliberately NOT driven from the player-activity events in
 * routes/events.ts / src/api/track.ts. Those are client-reported, that
 * endpoint is `optionalAuth` and unauthenticated by design, and a caller
 * can post any batch of "I played a round / I won" events they like. That
 * is completely fine for telemetry, where a forged row costs a slightly
 * wrong retention chart. It is NOT fine here, because completing a
 * challenge pays real Gold Coins: driving progress from tracking events
 * would be a "type your own balance" endpoint with extra steps. Events
 * stay analytics-only; this file only ever counts what the server did.
 * =======================================================================
 *
 * Everything writes through the caller's interactive transaction (`tx`), so
 * a round's ledger entries and the challenge progress they produce commit
 * or roll back together - a settled round can never leave phantom progress
 * behind, and progress can never be credited for a round that failed.
 *
 * All rewards go through economy/ledger.ts's applyTransaction, in Gold
 * Coins. Never Tickets - see the note on CHALLENGE_REWARD_GC/LEVEL_REWARD_GC
 * in schema.prisma.
 */

import { prisma } from "../db";
import { TxClient, applyTransaction } from "../economy/ledger";
import {
  CHALLENGE_CATALOG,
  ChallengeDef,
  ChallengeMetric,
  getChallenge
} from "./challengeCatalog";
import { ChallengePeriod, periodEndsAt, periodKeyFor } from "./periods";
import {
  LevelState,
  cosmeticUnlockForLevel,
  levelForXp,
  levelRewardGc,
  levelState
} from "./levels";

// ---------------------------------------------------------------------
// Migration-gap guard
// ---------------------------------------------------------------------

/**
 * Whether this environment's database actually has the progression tables.
 *
 * Why this exists at all: migrations on this project are NOT automatic on
 * deploy (see server/DEPLOYMENT.md - someone has to run `prisma migrate
 * deploy` by hand), and recordWager/recordWin below run INSIDE the same
 * Postgres transaction as a game's ledger writes. Once any statement in a
 * Postgres transaction errors, the whole transaction is aborted at the
 * connection level and every later statement in it fails too - a JS
 * try/catch around the failing query does not save it (this exact trap is
 * documented at length in src/serializers.ts). So on an environment where
 * this migration hasn't been applied yet, an unguarded "relation
 * challenge_progress does not exist" wouldn't just break challenges: it
 * would break every game round in the casino.
 *
 * The probe runs once per process, on the top-level `prisma` client (a
 * separate connection from any caller's `tx`, so it can't poison one), and
 * the result is cached. Missing tables simply disable progress recording
 * until the migration is deployed and the server restarts; games keep
 * working untouched in the meantime.
 */
interface Readiness {
  challenges: boolean;
  items: boolean;
  /** `level_minigame_sessions` table (and, since it landed in the same migration, `player_progress.pending_minigame_level`) - see progression/levelMinigameSession.ts. */
  levelMinigame: boolean;
}

let readinessProbe: Promise<Readiness> | null = null;

function probeReadiness(): Promise<Readiness> {
  if (!readinessProbe) {
    readinessProbe = prisma
      .$queryRaw<
        { challenges: string | null; players: string | null; items: string | null; levelMinigame: string | null }[]
      >`
        SELECT to_regclass('public.challenge_progress')::text AS challenges,
               to_regclass('public.player_progress')::text AS players,
               to_regclass('public.items_owned')::text AS items,
               to_regclass('public.level_minigame_sessions')::text AS "levelMinigame"
      `
      .then((rows) => {
        const row = rows[0];
        return {
          challenges: Boolean(row?.challenges) && Boolean(row?.players),
          items: Boolean(row?.items),
          levelMinigame: Boolean(row?.levelMinigame)
        };
      })
      .catch(() => ({ challenges: false, items: false, levelMinigame: false }));
  }
  return readinessProbe;
}

/** True when challenges/levels can safely be read and written on this environment. */
export async function progressionAvailable(): Promise<boolean> {
  return (await probeReadiness()).challenges;
}

/** True when the level-up minigame's table/column can safely be read and written on this environment (see LevelMinigameSession's schema.prisma doc comment). */
export async function levelMinigameAvailable(): Promise<boolean> {
  const ready = await probeReadiness();
  return ready.challenges && ready.levelMinigame;
}

// ---------------------------------------------------------------------
// Recording progress from real, server-side game settlement
// ---------------------------------------------------------------------

/** Definitions whose metric this kind of activity can move, honouring any per-game filter. */
function matchingChallenges(metric: ChallengeMetric, game: string): ChallengeDef[] {
  return CHALLENGE_CATALOG.filter((c) => c.metric === metric && (c.game === undefined || c.game === game));
}

/**
 * Adds `delta` to one challenge's counter for the current period, creating
 * the row on first touch.
 *
 * Raw SQL rather than a Prisma upsert because the whole point is that this
 * is ONE atomic statement: `INSERT ... ON CONFLICT DO UPDATE` can't lose an
 * increment to a concurrent round the way a read-then-write pair can. The
 * `WHERE claimed_at IS NULL` on the update branch freezes a challenge's
 * displayed progress at the moment it's claimed (so a claimed "10 rounds"
 * doesn't drift to 47/10) and skips pointless writes for the rest of the
 * period.
 */
async function bumpCounter(
  tx: TxClient,
  userId: string,
  challengeId: string,
  periodKey: string,
  delta: number
): Promise<void> {
  if (delta <= 0) return;
  await tx.$executeRaw`
    INSERT INTO challenge_progress (user_id, challenge_id, period_key, counter, seen, updated_at)
    VALUES (${userId}, ${challengeId}, ${periodKey}, ${delta}, ARRAY[]::text[], now())
    ON CONFLICT (user_id, challenge_id, period_key) DO UPDATE
      SET counter = challenge_progress.counter + ${delta}, updated_at = now()
      WHERE challenge_progress.claimed_at IS NULL
  `;
}

/**
 * Records `token` (a game id) in one challenge's distinct-set for the
 * current period, and keeps `counter` in sync with the set's size so every
 * metric can be read the same way. Re-playing the same game is a no-op, so
 * "play 5 different games" can't be farmed by spinning one machine.
 */
async function bumpDistinct(
  tx: TxClient,
  userId: string,
  challengeId: string,
  periodKey: string,
  token: string
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO challenge_progress (user_id, challenge_id, period_key, counter, seen, updated_at)
    VALUES (${userId}, ${challengeId}, ${periodKey}, 1, ARRAY[${token}]::text[], now())
    ON CONFLICT (user_id, challenge_id, period_key) DO UPDATE
      SET seen = CASE
            WHEN ${token} = ANY (challenge_progress.seen) THEN challenge_progress.seen
            ELSE array_append(challenge_progress.seen, ${token})
          END,
          counter = CASE
            WHEN ${token} = ANY (challenge_progress.seen) THEN cardinality(challenge_progress.seen)
            ELSE cardinality(challenge_progress.seen) + 1
          END,
          updated_at = now()
      WHERE challenge_progress.claimed_at IS NULL
  `;
}

/**
 * A wager was placed and debited - i.e. a real round started. Called from
 * games/shared.ts's placeWager/settleSingleShotBet with the amount the
 * SERVER just moved on the ledger, never a client-supplied number.
 */
export async function recordWager(
  tx: TxClient,
  userId: string,
  game: string,
  betAmount: number,
  now: Date = new Date()
): Promise<void> {
  if (!(await progressionAvailable())) return;
  if (!Number.isFinite(betAmount) || betAmount <= 0) return;

  for (const def of matchingChallenges("ROUNDS_PLAYED", game)) {
    await bumpCounter(tx, userId, def.id, periodKeyFor(def.period, now), 1);
  }
  for (const def of matchingChallenges("GC_WAGERED", game)) {
    await bumpCounter(tx, userId, def.id, periodKeyFor(def.period, now), Math.floor(betAmount));
  }
  for (const def of matchingChallenges("DISTINCT_GAMES", game)) {
    await bumpDistinct(tx, userId, def.id, periodKeyFor(def.period, now), game);
  }
}

/**
 * A round paid out - i.e. a real win. Called from games/shared.ts's
 * settlePayout/settleSingleShotBet with the payout the SERVER computed and
 * credited, never a client-supplied number. A payout of 0 (a loss) is not
 * a win and records nothing.
 */
export async function recordWin(
  tx: TxClient,
  userId: string,
  game: string,
  payout: number,
  now: Date = new Date()
): Promise<void> {
  if (!(await progressionAvailable())) return;
  if (!Number.isFinite(payout) || payout <= 0) return;

  for (const def of matchingChallenges("WINS", game)) {
    // minPayout gates "land one big win" style challenges on the size of a
    // SINGLE payout, not a running total.
    if (def.minPayout !== undefined && payout < def.minPayout) continue;
    await bumpCounter(tx, userId, def.id, periodKeyFor(def.period, now), 1);
  }
  for (const def of matchingChallenges("TICKETS_WON", game)) {
    await bumpCounter(tx, userId, def.id, periodKeyFor(def.period, now), Math.floor(payout));
  }
}

// ---------------------------------------------------------------------
// Reading a player's challenges
// ---------------------------------------------------------------------

export interface ChallengeView {
  id: string;
  period: ChallengePeriod;
  name: string;
  description: string;
  progress: number;
  target: number;
  complete: boolean;
  claimed: boolean;
  /** Gold Coins paid on claim. Never Tickets. */
  rewardGc: number;
  rewardXp: number;
  /** When this challenge's period rolls over (ISO), or null for lifetime achievements. */
  periodEndsAt: string | null;
}

export interface ChallengeBoard {
  /** False when this environment hasn't had the progression migration applied yet. */
  available: boolean;
  daily: ChallengeView[];
  weekly: ChallengeView[];
  achievements: ChallengeView[];
}

function viewFor(
  def: ChallengeDef,
  row: { counter: number; seen: string[]; claimedAt: Date | null } | undefined,
  now: Date
): ChallengeView {
  const progress = row ? (def.metric === "DISTINCT_GAMES" ? row.seen.length : row.counter) : 0;
  const endsAt = periodEndsAt(def.period, now);
  return {
    id: def.id,
    period: def.period,
    name: def.name,
    description: def.description,
    progress: Math.min(progress, def.target),
    target: def.target,
    complete: progress >= def.target,
    claimed: row?.claimedAt != null,
    rewardGc: def.rewardGc,
    rewardXp: def.rewardXp,
    periodEndsAt: endsAt ? endsAt.toISOString() : null
  };
}

/**
 * The player's active challenge board. "Active" is derived purely from the
 * current instant - see periods.ts - so this is also what makes daily/weekly
 * reset happen: yesterday's rows simply aren't addressed any more.
 */
export async function getChallengeBoard(
  tx: TxClient,
  userId: string,
  now: Date = new Date()
): Promise<ChallengeBoard> {
  if (!(await progressionAvailable())) {
    return { available: false, daily: [], weekly: [], achievements: [] };
  }

  const periodKeys = Array.from(
    new Set((["DAILY", "WEEKLY", "LIFETIME"] as ChallengePeriod[]).map((p) => periodKeyFor(p, now)))
  );
  const rows = await tx.challengeProgress.findMany({
    where: { userId, periodKey: { in: periodKeys } }
  });
  // A challenge id belongs to exactly one period, so its id alone is a
  // unique key within the current-period rows.
  const byId = new Map(rows.map((r) => [r.challengeId, r]));

  const board: ChallengeBoard = { available: true, daily: [], weekly: [], achievements: [] };
  for (const def of CHALLENGE_CATALOG) {
    const view = viewFor(def, byId.get(def.id), now);
    if (def.period === "DAILY") board.daily.push(view);
    else if (def.period === "WEEKLY") board.weekly.push(view);
    else board.achievements.push(view);
  }
  return board;
}

// ---------------------------------------------------------------------
// XP, levels, and level rewards
// ---------------------------------------------------------------------

export interface LevelGrant {
  level: number;
  rewardGc: number;
  /** Cosmetic granted at this level (an items_owned row), if any. */
  cosmeticItemId: string | null;
}

/**
 * Pays out every level the player has reached but not yet been rewarded
 * for, and advances `rewardedLevel` to match.
 *
 * DOUBLE-PAY GUARD (this grants real currency, so it's the important part):
 * the advance is a conditional `updateMany ... WHERE rewardedLevel = <the
 * value we read>`. Postgres serializes concurrent writers on that row, and
 * the loser re-evaluates the predicate against the already-updated row and
 * matches nothing - so it returns count 0 and pays out nothing. Combined
 * with the whole thing running inside the caller's transaction, a level's
 * GC can be credited at most once even if two claims land simultaneously.
 */
export async function grantPendingLevelRewards(tx: TxClient, userId: string): Promise<LevelGrant[]> {
  const row = await tx.playerProgress.findUnique({ where: { userId } });
  if (!row) return [];

  const level = levelForXp(row.xp);
  if (level <= row.rewardedLevel) return [];

  const readiness = await probeReadiness();

  const advanced = await tx.playerProgress.updateMany({
    where: { userId, rewardedLevel: row.rewardedLevel },
    data: {
      rewardedLevel: level,
      // Flags the level-up minigame as owed, anchored to the highest level
      // just reached - see PlayerProgress.pendingMinigameLevel's schema.prisma
      // doc comment for why this always overwrites (never sums/queues) even
      // if a previous minigame was already owed and unplayed. Only written
      // once the migration adding this column is actually live (readiness
      // guard, same reasoning as `itemsReady` below) - this update runs
      // inside every game-settling transaction's blast radius (see this
      // file's TRUST BOUNDARY note), so writing a column that doesn't exist
      // yet on an un-migrated environment would abort far more than just
      // this feature.
      ...(readiness.levelMinigame ? { pendingMinigameLevel: level } : {})
    }
  });
  if (advanced.count !== 1) return [];

  const itemsReady = readiness.items;
  const grants: LevelGrant[] = [];

  for (let l = row.rewardedLevel + 1; l <= level; l += 1) {
    const rewardGc = levelRewardGc(l);
    if (rewardGc > 0) {
      await applyTransaction(tx, userId, "GC", "LEVEL_REWARD_GC", rewardGc, { level: l });
    }

    const cosmeticItemId = cosmeticUnlockForLevel(l);
    if (cosmeticItemId && itemsReady) {
      // Granted outright, not gated - see levels.ts's LEVEL_COSMETIC_UNLOCKS.
      // skipDuplicates so a cosmetic the player already bought is a no-op
      // rather than a unique-constraint error that would roll the claim back.
      await tx.itemOwned.createMany({ data: [{ userId, itemId: cosmeticItemId }], skipDuplicates: true });
    }

    grants.push({ level: l, rewardGc, cosmeticItemId });
  }

  return grants;
}

/**
 * The level-up minigame owed to this player right now, or null if none is.
 * Purely a read of PlayerProgress.pendingMinigameLevel - see that field's
 * doc comment. Used both right after a claim (so the client knows to route
 * into the minigame) and independently on GET /progression (so re-opening
 * the challenges panel later still finds a minigame the player closed the
 * tab on instead of it being silently lost).
 */
export async function getPendingLevelMinigame(tx: TxClient, userId: string): Promise<{ level: number } | null> {
  if (!(await levelMinigameAvailable())) return null;
  const row = await tx.playerProgress.findUnique({ where: { userId } });
  return row?.pendingMinigameLevel != null ? { level: row.pendingMinigameLevel } : null;
}

/** Adds XP, creating the player's progress row on first earn. */
async function addXp(tx: TxClient, userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await tx.playerProgress.upsert({
    where: { userId },
    create: { userId, xp: amount, rewardedLevel: 1 },
    update: { xp: { increment: amount } }
  });
}

export interface ProgressionState extends LevelState {
  /** Highest level already paid out - exposed mostly for debugging/QA. */
  rewardedLevel: number;
}

export async function getProgression(tx: TxClient, userId: string): Promise<ProgressionState> {
  if (!(await progressionAvailable())) {
    return { ...levelState(0), rewardedLevel: 1 };
  }
  const row = await tx.playerProgress.findUnique({ where: { userId } });
  return { ...levelState(row?.xp ?? 0), rewardedLevel: row?.rewardedLevel ?? 1 };
}

/**
 * `getProgression` for display-only call sites (serializeMe), read on the
 * top-level `prisma` client rather than a shared `tx` and degrading to a
 * level-1 default on any error. Exactly the same reasoning as
 * serializers.ts's getAdRewardLastClaimedAt/getItemShopState: a table this
 * environment hasn't migrated yet must degrade this one feature, not abort
 * the transaction behind every authenticated response.
 */
export async function getProgressionForDisplay(userId: string): Promise<{ level: number; xp: number }> {
  try {
    if (!(await progressionAvailable())) return { level: 1, xp: 0 };
    const row = await prisma.playerProgress.findUnique({ where: { userId } });
    const state = levelState(row?.xp ?? 0);
    return { level: state.level, xp: state.xp };
  } catch {
    return { level: 1, xp: 0 };
  }
}

// ---------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------

export type ClaimOutcome =
  | {
      ok: true;
      challengeId: string;
      rewardGc: number;
      rewardXp: number;
      progression: ProgressionState;
      levelsGained: LevelGrant[];
      /** Set when this claim's level-up(s) now owe a "stop the marker" minigame - see getPendingLevelMinigame. */
      pendingLevelMinigame: { level: number } | null;
    }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "UNAVAILABLE" }
  | { ok: false; reason: "NOT_COMPLETE"; progress: number; target: number }
  | { ok: false; reason: "ALREADY_CLAIMED" };

/**
 * Claims one completed challenge: latches it as claimed, credits its Gold
 * Coins through the ledger, adds its XP, and pays out any level rewards
 * that XP just unlocked. Must be called inside a `prisma.$transaction` -
 * all four of those either happen together or not at all.
 *
 * IDEMPOTENCY (this pays real currency, so it's the whole design):
 * the first thing it does is a single conditional
 * `UPDATE ... SET claimed_at = now() WHERE claimed_at IS NULL AND counter >=
 * target`. That one statement is both the "is it complete" check and the
 * "has it already been claimed" check, and it's atomic - there is no
 * read-then-write window for a second request to slip through. If it
 * updates zero rows, nothing is credited and the reason is worked out
 * afterwards purely to return a helpful error.
 */
export async function claimChallenge(
  tx: TxClient,
  userId: string,
  challengeId: string,
  now: Date = new Date()
): Promise<ClaimOutcome> {
  const def = getChallenge(challengeId);
  if (!def) return { ok: false, reason: "NOT_FOUND" };
  if (!(await progressionAvailable())) return { ok: false, reason: "UNAVAILABLE" };

  const periodKey = periodKeyFor(def.period, now);

  const claimed = await tx.$executeRaw`
    UPDATE challenge_progress
    SET claimed_at = now(), updated_at = now()
    WHERE user_id = ${userId}
      AND challenge_id = ${challengeId}
      AND period_key = ${periodKey}
      AND claimed_at IS NULL
      AND counter >= ${def.target}
  `;

  if (claimed === 0) {
    const row = await tx.challengeProgress.findUnique({
      where: { userId_challengeId_periodKey: { userId, challengeId, periodKey } }
    });
    if (row?.claimedAt) return { ok: false, reason: "ALREADY_CLAIMED" };
    const progress = row ? (def.metric === "DISTINCT_GAMES" ? row.seen.length : row.counter) : 0;
    return { ok: false, reason: "NOT_COMPLETE", progress, target: def.target };
  }

  await applyTransaction(tx, userId, "GC", "CHALLENGE_REWARD_GC", def.rewardGc, {
    challengeId,
    periodKey,
    period: def.period,
    rewardXp: def.rewardXp
  });

  await addXp(tx, userId, def.rewardXp);
  const levelsGained = await grantPendingLevelRewards(tx, userId);
  const progression = await getProgression(tx, userId);
  const pendingLevelMinigame = await getPendingLevelMinigame(tx, userId);

  return {
    ok: true,
    challengeId,
    rewardGc: def.rewardGc,
    rewardXp: def.rewardXp,
    progression,
    levelsGained,
    pendingLevelMinigame
  };
}

// Re-exported for the routes layer's convenience; keeps route files from
// reaching into three modules for one response shape.
export type { ChallengeDef };
