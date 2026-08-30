/**
 * The level-up "stop the marker" timing minigame - pure math only, no DB,
 * no I/O (mirrors levels.ts's split: the curve lives here so it can be
 * unit-tested and retuned freely; progression/levelMinigameSession.ts owns
 * the DB flow and the trust boundary around it).
 *
 * WHAT THIS IS: after a level-up, a marker sweeps back and forth across a
 * bar; the player taps once to stop it; landing closer to the bar's centre
 * pays more Gold Coins. See schema.prisma's LevelMinigameSession doc
 * comment for the full trust-boundary writeup - in short, `sweepPosition`
 * below is evaluated SERVER-SIDE against the SERVER's own elapsed-time
 * measurement, never against a client-reported accuracy number, so this
 * module's output can't be forged from the browser.
 *
 * The client (src/scenes/LevelUpMinigameScene.ts) renders the exact same
 * `sweepPosition` formula for the visual, seeded from the same
 * `sweepPeriodMs` the server hands back on start - that's what makes the
 * bar the player sees line up with what the server actually scores. Only
 * the server's copy of this function, fed the server's own elapsed time,
 * ever decides money.
 */

/** Sweep speed is randomized per session within this range - fast enough to be a real test, slow enough a careful player can land it. */
export const SWEEP_PERIOD_MIN_MS = 1200;
export const SWEEP_PERIOD_MAX_MS = 1800;

/** Picks a random sweep period for a new session. `rand` is injectable for deterministic tests. */
export function randomSweepPeriodMs(rand: () => number = Math.random): number {
  const t = Math.max(0, Math.min(1, rand()));
  return Math.round(SWEEP_PERIOD_MIN_MS + t * (SWEEP_PERIOD_MAX_MS - SWEEP_PERIOD_MIN_MS));
}

/**
 * The marker's position on the bar at `elapsedMs` since the sweep started,
 * as a triangle wave in [-1, 1] (-1 and +1 are the two ends of the bar, 0 is
 * dead centre) that repeats every `periodMs`. Deterministic and pure so the
 * server and client can compute the identical value from the identical
 * inputs independently.
 */
export function sweepPosition(elapsedMs: number, periodMs: number): number {
  if (!(periodMs > 0)) return -1;
  const half = periodMs / 2;
  // Wrap into [0, periodMs) first - JS `%` can return a negative result for
  // a negative left-hand side, which elapsedMs should never be, but this
  // keeps the function total rather than assuming its caller always clamps.
  const t = ((elapsedMs % periodMs) + periodMs) % periodMs;
  const phase = t / half; // [0, 2)
  return phase <= 1 ? -1 + 2 * phase : 3 - 2 * phase;
}

/** 1 = stopped dead centre, 0 = stopped at either extreme end of the bar. */
export function accuracyFor(position: number): number {
  return 1 - Math.min(1, Math.abs(position));
}

/**
 * The floor of the reward curve, as a fraction of the max - a miss should
 * still feel like something rather than nothing (this is a level-up bonus,
 * not a punishment), just clearly less than a good hit.
 */
const MIN_REWARD_FRACTION = 0.15;
/**
 * How sharply the curve rewards precision. >1 means the top of the range
 * pays disproportionately more than the middle - a near-perfect stop should
 * feel markedly better than a merely-good one, not just a little better.
 */
const CURVE_EXPONENT = 3;

/**
 * The best possible payout for `level`'s minigame (accuracy = 1). Uses the
 * same `100 * level` shape as levels.ts's flat levelRewardGc, so a great
 * timing hit is a genuine bonus on top of the level's own reward (roughly
 * doubling it) rather than dwarfing it.
 */
export function levelMinigameMaxRewardGc(level: number): number {
  const clamped = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return 100 * clamped;
}

/**
 * Gold Coins paid for `level`'s minigame at a given `accuracy` (0-1,
 * clamped). Floor at `MIN_REWARD_FRACTION` of the max (never zero), curved
 * up to the max by `CURVE_EXPONENT` so precision is rewarded disproportionately
 * near the top of the range.
 */
export function levelMinigameRewardGc(level: number, accuracy: number): number {
  const maxReward = levelMinigameMaxRewardGc(level);
  const minReward = Math.max(5, Math.round(maxReward * MIN_REWARD_FRACTION));
  const clamped = Math.max(0, Math.min(1, Number.isFinite(accuracy) ? accuracy : 0));
  const curved = Math.pow(clamped, CURVE_EXPONENT);
  return Math.round(minReward + (maxReward - minReward) * curved);
}
