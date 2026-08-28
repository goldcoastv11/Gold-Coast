/**
 * XP curve, level derivation, and what reaching a level gives you.
 *
 * Pure functions only - no DB, no I/O - so the curve can be unit-tested and
 * retuned freely. Nothing stores a level: `player_progress` stores raw XP
 * and the level is computed from it here (see schema.prisma's
 * PlayerProgress doc comment for why).
 *
 * The founder's three things a level gives:
 *   1. a reward at each level      -> LEVEL_REWARD_GC (Gold Coins - see below)
 *   2. unlocked cosmetics          -> LEVEL_COSMETIC_UNLOCKS
 *   3. a visible prestige number   -> the level itself, surfaced on /me
 *
 * WHY GOLD COINS, NOT TICKETS (hard economy rule, repo-root CLAUDE.md):
 * TICKETS may only ever be credited by GAME_WIN_TICKETS - an actual game
 * win - and economy/ledger.ts enforces that at runtime, so a level reward
 * physically cannot pay TICKETS. GC already has legitimate non-game sources
 * (the Coin Kiosk's ad-gated claim, a GC package purchase), so a GC reward
 * fits the existing model without inventing anything.
 */

/**
 * Levels stop here. A cap keeps `levelForXp`'s loop trivially bounded and
 * makes "max level" a real, reachable prestige statement rather than an
 * endless number. Raise it freely - no data migration is involved, since
 * levels aren't stored.
 */
export const MAX_LEVEL = 50;

/**
 * XP to go from level n to n+1 is `XP_PER_LEVEL_STEP * n`, so each level
 * costs a bit more than the last: 100 XP for level 2, 200 more for level 3,
 * 300 more for level 4, and so on. Gentle at the start (a new player sees
 * a level-up in their first session or two) and a genuine long-haul grind
 * at the top end, which is what a prestige number is for.
 */
export const XP_PER_LEVEL_STEP = 100;

/** Total cumulative XP required to BE at `level`. Level 1 is 0 XP. */
export function xpForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  // Sum of XP_PER_LEVEL_STEP * n for n = 1..(level-1).
  return (XP_PER_LEVEL_STEP * clamped * (clamped - 1)) / 2;
}

/** The level a player with `xp` total XP is at. Clamped to [1, MAX_LEVEL]. */
export function levelForXp(xp: number): number {
  const total = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  let level = 1;
  while (level < MAX_LEVEL && total >= xpForLevel(level + 1)) {
    level += 1;
  }
  return level;
}

/**
 * Gold Coins granted for REACHING `level`. Level 1 is the starting level,
 * so it pays nothing - there's no achievement in existing.
 *
 * Scales with the level so the reward keeps pace with the widening XP gap,
 * but stays modest against the Coin Kiosk's 1000 GC free claim: levelling
 * is meant to be a reason to come back, not a replacement for the kiosk.
 */
export function levelRewardGc(level: number): number {
  if (level <= 1) return 0;
  return 100 * level;
}

/**
 * Cosmetics unlocked at a level. Ids come from itemCatalog.ts, and the
 * matching item is GRANTED outright (an `items_owned` row) when the level is
 * reached - deliberately a grant rather than a "you may now buy this" gate.
 *
 * A gate would mean changing what the Item Shop lets you purchase, which
 * would be a behaviour change to a shipped, TICKETS-only flow; a grant is
 * purely additive, can't make anything previously purchasable stop being
 * so, and reads to the player as the better reward anyway. Granting an
 * item is not a balance change, so no ledger transaction is involved and
 * the TICKETS-only purchase rule is untouched.
 */
export const LEVEL_COSMETIC_UNLOCKS: Readonly<Record<number, string>> = {
  5: "acc_bow",
  10: "acc_headphones",
  15: "acc_shades",
  20: "pet_buddy",
  25: "acc_top_hat",
  30: "pet_scout",
  40: "acc_crown",
  50: "pet_shadow"
};

export function cosmeticUnlockForLevel(level: number): string | null {
  return LEVEL_COSMETIC_UNLOCKS[level] ?? null;
}

export interface LevelState {
  xp: number;
  level: number;
  /** XP earned since reaching the current level. */
  xpIntoLevel: number;
  /** XP the current level costs in total, or 0 at MAX_LEVEL. */
  xpForNextLevel: number;
  atMaxLevel: boolean;
}

export function levelState(xp: number): LevelState {
  const total = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  const level = levelForXp(total);
  const atMaxLevel = level >= MAX_LEVEL;
  const base = xpForLevel(level);
  return {
    xp: total,
    level,
    xpIntoLevel: total - base,
    xpForNextLevel: atMaxLevel ? 0 : xpForLevel(level + 1) - base,
    atMaxLevel
  };
}
