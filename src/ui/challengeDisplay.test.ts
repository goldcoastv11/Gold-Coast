import { describe, it, expect } from "vitest";
import {
  claimableCount,
  cosmeticName,
  formatNextLevelReward,
  formatNextUnlock,
  formatResetIn,
  formatReward,
  formatXpProgress,
  isClaimable,
  milestoneLevels,
  nextCosmeticUnlock,
  progressFraction,
  sortForDisplay,
  xpBarFraction
} from "./challengeDisplay";
import type { ChallengeView, ProgressionResponse } from "../api/types";

function challenge(over: Partial<ChallengeView> = {}): ChallengeView {
  return {
    id: "daily_play_10",
    period: "DAILY",
    name: "Warm Up",
    description: "Play 10 rounds of anything.",
    progress: 0,
    target: 10,
    complete: false,
    claimed: false,
    rewardGc: 150,
    rewardXp: 40,
    periodEndsAt: "2026-08-29T00:00:00.000Z",
    ...over
  };
}

function progression(over: Partial<ProgressionResponse> = {}): ProgressionResponse {
  return {
    xp: 640,
    level: 4,
    xpIntoLevel: 40,
    xpForNextLevel: 400,
    atMaxLevel: false,
    rewardedLevel: 4,
    maxLevel: 50,
    nextLevelRewardGc: 500,
    cosmeticUnlocks: { "5": "acc_bow", "10": "acc_headphones", "15": "acc_shades", "50": "pet_shadow" },
    ...over
  };
}

describe("isClaimable / claimableCount", () => {
  it("is only true for complete-but-unclaimed", () => {
    expect(isClaimable(challenge({ complete: false, claimed: false }))).toBe(false);
    expect(isClaimable(challenge({ complete: true, claimed: false }))).toBe(true);
    expect(isClaimable(challenge({ complete: true, claimed: true }))).toBe(false);
  });

  it("counts across every group it is given", () => {
    const daily = [challenge({ complete: true }), challenge({ id: "b" })];
    const weekly = [challenge({ id: "c", complete: true })];
    const achievements = [challenge({ id: "d", complete: true, claimed: true })];
    expect(claimableCount(daily, weekly, achievements)).toBe(2);
    expect(claimableCount([])).toBe(0);
  });
});

describe("progressFraction", () => {
  it("clamps to 0-1", () => {
    expect(progressFraction(challenge({ progress: 5, target: 10 }))).toBe(0.5);
    expect(progressFraction(challenge({ progress: 0, target: 10 }))).toBe(0);
    expect(progressFraction(challenge({ progress: 99, target: 10 }))).toBe(1);
    expect(progressFraction(challenge({ progress: -3, target: 10 }))).toBe(0);
  });

  it("does not produce NaN for a zero target", () => {
    expect(progressFraction(challenge({ progress: 0, target: 0 }))).toBe(1);
  });
});

describe("sortForDisplay", () => {
  it("puts claimable first, claimed last, nearly-done above barely-started", () => {
    const list = [
      challenge({ id: "claimed", complete: true, claimed: true }),
      challenge({ id: "barely", progress: 1, target: 10 }),
      challenge({ id: "nearly", progress: 9, target: 10 }),
      challenge({ id: "ready", complete: true })
    ];
    expect(sortForDisplay(list).map((c) => c.id)).toEqual(["ready", "nearly", "barely", "claimed"]);
  });

  it("does not mutate the caller's array", () => {
    const list = [challenge({ id: "a" }), challenge({ id: "b", complete: true })];
    sortForDisplay(list);
    expect(list.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("formatResetIn", () => {
  const now = Date.parse("2026-08-28T12:00:00.000Z");

  it("returns null for a lifetime achievement", () => {
    expect(formatResetIn(null, now)).toBeNull();
  });

  it("returns null for an unparsable instant rather than 'Invalid Date'", () => {
    expect(formatResetIn("not-a-date", now)).toBeNull();
  });

  it("shows hours and minutes within a day", () => {
    expect(formatResetIn("2026-08-28T16:12:00.000Z", now)).toBe("Resets in 4h 12m");
  });

  it("drops to minutes only under an hour", () => {
    expect(formatResetIn("2026-08-28T12:25:00.000Z", now)).toBe("Resets in 25m");
  });

  it("shows days and hours for a weekly", () => {
    expect(formatResetIn("2026-08-31T00:00:00.000Z", now)).toBe("Resets in 2d 12h");
  });

  it("never renders a 0m or a negative countdown", () => {
    expect(formatResetIn("2026-08-28T12:00:30.000Z", now)).toBe("Resets in <1m");
    expect(formatResetIn("2026-08-28T11:00:00.000Z", now)).toBe("Resetting now");
  });
});

describe("xpBarFraction / formatXpProgress", () => {
  it("fills proportionally within a level", () => {
    expect(xpBarFraction({ xpIntoLevel: 100, xpForNextLevel: 400, atMaxLevel: false })).toBe(0.25);
  });

  it("reads full at max level and never divides by zero", () => {
    expect(xpBarFraction({ xpIntoLevel: 0, xpForNextLevel: 0, atMaxLevel: true })).toBe(1);
    expect(xpBarFraction({ xpIntoLevel: 5, xpForNextLevel: 0, atMaxLevel: false })).toBe(1);
  });

  it("formats within-level progress, and total XP once maxed", () => {
    expect(formatXpProgress({ xp: 1240, xpIntoLevel: 140, xpForNextLevel: 1400, atMaxLevel: false })).toBe(
      "140 / 1,400 XP"
    );
    expect(formatXpProgress({ xp: 122500, xpIntoLevel: 0, xpForNextLevel: 0, atMaxLevel: true })).toBe(
      "122,500 XP"
    );
  });
});

describe("cosmetic milestones", () => {
  it("lists milestone levels ascending", () => {
    expect(milestoneLevels(progression().cosmeticUnlocks)).toEqual([5, 10, 15, 50]);
  });

  it("finds the next milestone strictly above the current level", () => {
    const unlocks = progression().cosmeticUnlocks;
    expect(nextCosmeticUnlock(4, unlocks)).toEqual({ level: 5, itemId: "acc_bow" });
    // Standing exactly on a milestone means it is already granted.
    expect(nextCosmeticUnlock(5, unlocks)).toEqual({ level: 10, itemId: "acc_headphones" });
    expect(nextCosmeticUnlock(50, unlocks)).toBeNull();
  });

  it("names cosmetics from the item catalog, falling back to the raw id", () => {
    expect(cosmeticName("acc_shades")).toBe("Shades");
    expect(cosmeticName("acc_not_in_catalog")).toBe("acc_not_in_catalog");
  });

  it("formats the next-unlock line, and nothing once all are passed", () => {
    expect(formatNextUnlock(progression())).toBe("Next unlock: Bow at Level 5");
    expect(formatNextUnlock(progression({ level: 50 }))).toBeNull();
  });
});

describe("reward copy", () => {
  it("names Gold Coins in full, never Tickets", () => {
    const line = formatReward(challenge({ rewardGc: 5000, rewardXp: 1000 }));
    expect(line).toBe("+5,000 Gold Coins · 1,000 XP");
    expect(line).not.toMatch(/Ticket/i);
  });

  it("names what the next level pays, and nothing at max level", () => {
    expect(formatNextLevelReward(progression({ nextLevelRewardGc: 800 }))).toBe(
      "Next level: +800 Gold Coins"
    );
    expect(formatNextLevelReward(progression({ atMaxLevel: true }))).toBeNull();
  });
});
