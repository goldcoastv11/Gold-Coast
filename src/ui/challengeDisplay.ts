/**
 * Pure presentation logic for the challenges/levels UI.
 *
 * Deliberately Phaser-free and side-effect-free so the decisions that
 * actually matter to the player - which row surfaces first, whether a
 * countdown reads "4h 12m" or "12m", how far along a bar should be - are
 * unit-testable without standing up a scene. ChallengesPanel.ts does the
 * drawing and nothing else.
 *
 * Nothing here re-derives server truth. The XP curve, the level ladder and
 * the unlock table all live on the server (server/src/progression/levels.ts)
 * and arrive over the wire; these helpers only ever read what was sent.
 */

import type { ChallengeView, ProgressionResponse } from "../api/types";
import { getItem } from "../itemCatalog";

/**
 * A completed-but-unclaimed challenge - the whole point of the feature, and
 * the state every other piece of the UI keys off (row tint, tab badge, the
 * overworld station badge).
 */
export function isClaimable(c: ChallengeView): boolean {
  return c.complete && !c.claimed;
}

/** How many of the given groups have a reward sitting there unclaimed. */
export function claimableCount(...groups: ChallengeView[][]): number {
  let n = 0;
  for (const group of groups) {
    for (const c of group) if (isClaimable(c)) n += 1;
  }
  return n;
}

/**
 * 0-1 fraction of a challenge's target reached. `target` is always positive
 * in the catalog, but a zero would produce NaN and silently render a
 * garbage bar, so it degrades to a full bar instead.
 */
export function progressFraction(c: ChallengeView): number {
  if (!(c.target > 0)) return 1;
  return Math.max(0, Math.min(1, c.progress / c.target));
}

/**
 * Display order within a group: anything claimable first (that is the thing
 * we want a player to see the instant the panel opens), then in-progress
 * with the closest-to-finished at the top, then already-claimed rows sunk to
 * the bottom. Returns a new array - callers keep the server's list intact.
 */
export function sortForDisplay(list: ChallengeView[]): ChallengeView[] {
  const rank = (c: ChallengeView) => (isClaimable(c) ? 0 : c.claimed ? 2 : 1);
  return [...list].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    // Within the in-progress band, nearly-done sorts above barely-started.
    // Claimable/claimed bands keep the catalog's own order (the comparator
    // returns 0), which is stable in every engine this targets.
    if (rank(a) === 1) return progressFraction(b) - progressFraction(a);
    return 0;
  });
}

/**
 * "Resets in 4h 12m" for a daily/weekly, or null for a lifetime achievement
 * (periodEndsAt is null) or an unparsable instant. Minutes are dropped once
 * there is more than a day left, and anything under a minute reads "<1m"
 * rather than "0m", which looks broken.
 */
export function formatResetIn(periodEndsAt: string | null, now: number = Date.now()): string | null {
  if (!periodEndsAt) return null;
  const endsAt = Date.parse(periodEndsAt);
  if (!Number.isFinite(endsAt)) return null;

  const ms = endsAt - now;
  // A period that has already rolled over is about to be replaced by the
  // next fetch anyway; saying so beats a negative countdown.
  if (ms <= 0) return "Resetting now";

  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "Resets in <1m";

  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `Resets in ${days}d ${hours}h`;
  if (hours > 0) return `Resets in ${hours}h ${minutes}m`;
  return `Resets in ${minutes}m`;
}

/** 0-1 fill of the XP bar toward the next level. A maxed-out player reads as full. */
export function xpBarFraction(p: {
  xpIntoLevel: number;
  xpForNextLevel: number;
  atMaxLevel: boolean;
}): number {
  if (p.atMaxLevel || !(p.xpForNextLevel > 0)) return 1;
  return Math.max(0, Math.min(1, p.xpIntoLevel / p.xpForNextLevel));
}

/** "1,240 / 1,400 XP", or "12,900 XP" once there is no next level to climb to. */
export function formatXpProgress(p: {
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  atMaxLevel: boolean;
}): string {
  if (p.atMaxLevel || !(p.xpForNextLevel > 0)) return `${formatNumber(p.xp)} XP`;
  return `${formatNumber(p.xpIntoLevel)} / ${formatNumber(p.xpForNextLevel)} XP`;
}

/** Thousands separators, so a five-figure Gold Coin reward is readable at a glance. */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Every level that grants a cosmetic, ascending. Non-numeric keys are ignored rather than trusted. */
export function milestoneLevels(cosmeticUnlocks: Record<string, string>): number[] {
  return Object.keys(cosmeticUnlocks)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

/**
 * The next cosmetic the player has not reached yet, or null once every
 * milestone is behind them.
 */
export function nextCosmeticUnlock(
  level: number,
  cosmeticUnlocks: Record<string, string>
): { level: number; itemId: string } | null {
  for (const milestone of milestoneLevels(cosmeticUnlocks)) {
    if (milestone > level) return { level: milestone, itemId: cosmeticUnlocks[String(milestone)] };
  }
  return null;
}

/**
 * Player-facing name for a granted cosmetic. Falls back to the raw id rather
 * than blanking the line: the server's unlock table and the client's item
 * catalog are hand-synced copies (see itemCatalog.ts), so a future
 * server-side addition should degrade to something honest, not to nothing.
 */
export function cosmeticName(itemId: string): string {
  return getItem(itemId)?.name ?? itemId;
}

/** "Next unlock: Shades at Level 15", or null at max level / once all milestones are passed. */
export function formatNextUnlock(p: ProgressionResponse): string | null {
  const next = nextCosmeticUnlock(p.level, p.cosmeticUnlocks);
  if (!next) return null;
  return `Next unlock: ${cosmeticName(next.itemId)} at Level ${next.level}`;
}

/** "Next level: +800 Gold Coins", or null at max level. Gold Coins, never Tickets - see api/types.ts. */
export function formatNextLevelReward(p: ProgressionResponse): string | null {
  if (p.atMaxLevel) return null;
  return `Next level: +${formatNumber(p.nextLevelRewardGc)} Gold Coins`;
}

/** "+150 Gold Coins · 40 XP" - the reward line on a challenge row. */
export function formatReward(c: ChallengeView): string {
  return `+${formatNumber(c.rewardGc)} Gold Coins · ${formatNumber(c.rewardXp)} XP`;
}
