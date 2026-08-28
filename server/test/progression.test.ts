/**
 * Challenges & levels (Retention Leg 2).
 *
 * The tests that matter most here are the money ones: a challenge pays real
 * Gold Coins, so "progress only comes from a real server-side game outcome",
 * "a challenge can't be claimed twice", "an unearned claim is rejected" and
 * "a level's reward is paid exactly once" are the load-bearing cases, not
 * the happy path.
 *
 * Dice is used as the real game throughout because it's a genuine
 * end-to-end round (HTTP -> route -> games/shared.ts -> ledger) whose win
 * probability is a parameter: at target 95 it wins 95% of the time, so a
 * bounded loop reaches any needed number of wins with a failure probability
 * far below "the CI machine has a cosmic-ray bit flip".
 */

import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { applyTransaction } from "../src/economy/ledger";
import { resetDb, signupUser, authed } from "./helpers";
import { dailyPeriodKey, periodKeyFor, weeklyPeriodKey } from "../src/progression/periods";
import { MAX_LEVEL, levelForXp, levelRewardGc, xpForLevel } from "../src/progression/levels";
import {
  ChallengeView,
  claimChallenge,
  getChallengeBoard,
  grantPendingLevelRewards,
  recordWager
} from "../src/progression/progress";

beforeEach(resetDb);

/** GC bankroll top-up through the real ledger, same shape as items.test.ts's topUpTickets. */
async function topUpGc(username: string, amount: number): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.$transaction((tx) =>
    applyTransaction(tx, user.id, "GC", "AD_REWARD_GC", amount, { reason: "test bankroll top-up" })
  );
  return user.id;
}

async function userIdFor(username: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  return user.id;
}

interface Board {
  available: boolean;
  daily: ChallengeView[];
  weekly: ChallengeView[];
  achievements: ChallengeView[];
}

async function getBoard(token: string): Promise<Board> {
  const res = await request(app).get("/challenges").set(authed(token));
  expect(res.status).toBe(200);
  return res.body as Board;
}

function view(board: Board, id: string): ChallengeView {
  const found = [...board.daily, ...board.weekly, ...board.achievements].find((c) => c.id === id);
  if (!found) throw new Error(`challenge ${id} not on the board`);
  return found;
}

/** One real dice round at 95% win odds. */
async function playDice(token: string, betAmount = 5) {
  const res = await request(app)
    .post("/games/dice/play")
    .set(authed(token))
    .send({ betAmount, target: 95 });
  expect(res.status).toBe(200);
  return res.body as { result: { payout: number; won: boolean } };
}

/** Plays real dice rounds until `challengeId` reads complete. Bounded so a failure is a failure, not a hang. */
async function playUntilComplete(token: string, challengeId: string, maxRounds = 200): Promise<void> {
  for (let i = 0; i < maxRounds; i += 1) {
    if (view(await getBoard(token), challengeId).complete) return;
    await playDice(token);
  }
  throw new Error(`${challengeId} did not complete within ${maxRounds} rounds`);
}

// =====================================================================
// Period keys - the no-cron daily/weekly reset
// =====================================================================

describe("period keys", () => {
  it("keys a daily by UTC calendar date", () => {
    expect(dailyPeriodKey(new Date("2026-08-28T12:00:00Z"))).toBe("2026-08-28");
    expect(dailyPeriodKey(new Date("2026-08-28T23:59:59Z"))).toBe("2026-08-28");
    // One second later is a different day, and therefore a different row.
    expect(dailyPeriodKey(new Date("2026-08-29T00:00:00Z"))).toBe("2026-08-29");
  });

  it("keys a weekly by ISO week, stable within the week and rolling over on Monday", () => {
    // 2026-08-28 is a Friday; the following Monday is 2026-08-31.
    const friday = weeklyPeriodKey(new Date("2026-08-28T12:00:00Z"));
    const sunday = weeklyPeriodKey(new Date("2026-08-30T23:59:59Z"));
    const monday = weeklyPeriodKey(new Date("2026-08-31T00:00:00Z"));

    expect(friday).toMatch(/^\d{4}-W\d{2}$/);
    expect(sunday).toBe(friday);
    expect(monday).not.toBe(friday);
  });

  it("gives lifetime achievements one permanent key", () => {
    expect(periodKeyFor("LIFETIME", new Date("2026-08-28T00:00:00Z"))).toBe("all");
    expect(periodKeyFor("LIFETIME", new Date("2030-01-01T00:00:00Z"))).toBe("all");
  });
});

// =====================================================================
// XP curve
// =====================================================================

describe("XP curve", () => {
  it("costs a little more for each level", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(300);
    expect(xpForLevel(4)).toBe(600);
    // Each step is strictly larger than the one before it.
    for (let l = 2; l < 10; l += 1) {
      const step = xpForLevel(l + 1) - xpForLevel(l);
      const prevStep = xpForLevel(l) - xpForLevel(l - 1);
      expect(step).toBeGreaterThan(prevStep);
    }
  });

  it("derives level from total XP and clamps at both ends", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(299)).toBe(2);
    expect(levelForXp(300)).toBe(3);
    expect(levelForXp(-50)).toBe(1);
    expect(levelForXp(999_999_999)).toBe(MAX_LEVEL);
  });

  it("pays nothing for the starting level and scales after that", () => {
    expect(levelRewardGc(1)).toBe(0);
    expect(levelRewardGc(2)).toBe(200);
    expect(levelRewardGc(3)).toBe(300);
  });
});

// =====================================================================
// Progress comes from real, server-side game settlement
// =====================================================================

describe("progress from real game outcomes", () => {
  it("advances play/wager progress on a real dice round", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 10_000);

    const before = await getBoard(token);
    expect(before.available).toBe(true);
    expect(view(before, "daily_play_10").progress).toBe(0);

    await playDice(token, 50);

    const after = await getBoard(token);
    expect(view(after, "daily_play_10").progress).toBe(1);
    expect(view(after, "daily_wager_500").progress).toBe(50);
    expect(view(after, "weekly_play_100").progress).toBe(1);
    // A lifetime achievement with target 1 is complete after one round.
    expect(view(after, "ach_first_round").complete).toBe(true);
  });

  it("counts distinct games as a set, so replaying one game can't inflate it", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 10_000);

    await playDice(token);
    await playDice(token);
    await playDice(token);
    expect(view(await getBoard(token), "daily_variety_3").progress).toBe(1);

    await request(app).post("/games/coinflip/play").set(authed(token)).send({ betAmount: 5, guess: "heads" });
    await request(app).post("/games/slots/play").set(authed(token)).send({ betAmount: 5 });

    const board = await getBoard(token);
    expect(view(board, "daily_variety_3").progress).toBe(3);
    expect(view(board, "daily_variety_3").complete).toBe(true);
  });

  it("counts a win only when the round actually paid out", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 10_000);

    await playUntilComplete(token, "ach_first_win");

    const board = await getBoard(token);
    expect(view(board, "ach_first_win").complete).toBe(true);
    // Wins can never exceed rounds played - a losing round records no win.
    expect(view(board, "weekly_win_30").progress).toBeLessThanOrEqual(
      view(board, "weekly_play_100").progress
    );
  });

  it("does not count Triple Chance, which settles outside games/shared.ts", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 10_000);

    await request(app).post("/games/triplechance/play").set(authed(token)).send({ betAmount: 500 });

    const board = await getBoard(token);
    expect(view(board, "daily_play_10").progress).toBe(0);
    expect(view(board, "ach_first_round").complete).toBe(false);
  });

  it("does not advance from client-reported tracking events", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 10_000);

    // A forged batch claiming a hundred rounds and a huge win. POST /events
    // accepts it as telemetry (202) - and it must move nothing, because
    // challenges pay real Gold Coins.
    const events = Array.from({ length: 50 }, () => ({
      name: "game.round_played",
      sessionId: "forged-session",
      props: { game: "dice", betAmount: 500, outcome: "win", payout: 99999 }
    }));
    const res = await request(app).post("/events").set(authed(token)).send({ events });
    expect(res.status).toBe(202);

    const board = await getBoard(token);
    expect(view(board, "daily_play_10").progress).toBe(0);
    expect(view(board, "daily_wager_500").progress).toBe(0);
    expect(view(board, "ach_first_win").complete).toBe(false);
  });
});

// =====================================================================
// Daily reset across a date boundary
// =====================================================================

describe("daily/weekly reset", () => {
  it("starts a daily from zero on the next UTC day while lifetime progress persists", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);

    const day1 = new Date("2026-08-28T12:00:00Z");
    const day2 = new Date("2026-08-29T00:30:00Z");

    await prisma.$transaction(async (tx) => {
      await recordWager(tx, userId, "dice", 200, day1);
      await recordWager(tx, userId, "dice", 200, day1);
    });

    const boardDay1 = await prisma.$transaction((tx) => getChallengeBoard(tx, userId, day1));
    expect(view(boardDay1, "daily_play_10").progress).toBe(2);
    expect(view(boardDay1, "daily_wager_500").progress).toBe(400);
    expect(view(boardDay1, "ach_first_round").complete).toBe(true);

    const boardDay2 = await prisma.$transaction((tx) => getChallengeBoard(tx, userId, day2));
    // Dailies read as zero on the new day - no cron ran, the new day simply
    // addresses a row that doesn't exist yet.
    expect(view(boardDay2, "daily_play_10").progress).toBe(0);
    expect(view(boardDay2, "daily_wager_500").progress).toBe(0);
    // The weekly is unaffected - 28th and 29th Aug 2026 are the same ISO week.
    expect(view(boardDay2, "weekly_play_100").progress).toBe(2);
    // Lifetime achievements never reset.
    expect(view(boardDay2, "ach_first_round").complete).toBe(true);

    // Yesterday's row is still there as inert history, not deleted.
    const rows = await prisma.challengeProgress.findMany({
      where: { userId, challengeId: "daily_play_10" }
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].periodKey).toBe("2026-08-28");
  });

  it("refuses to claim yesterday's completed daily once the day has rolled over", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);

    const day1 = new Date("2026-08-28T12:00:00Z");
    const day2 = new Date("2026-08-29T00:30:00Z");

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < 10; i += 1) await recordWager(tx, userId, "dice", 10, day1);
    });
    expect(view(await prisma.$transaction((tx) => getChallengeBoard(tx, userId, day1)), "daily_play_10").complete).toBe(
      true
    );

    const outcome = await prisma.$transaction((tx) => claimChallenge(tx, userId, "daily_play_10", day2));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("NOT_COMPLETE");
  });
});

// =====================================================================
// Claiming - the money path
// =====================================================================

describe("POST /challenges/claim", () => {
  it("credits Gold Coins through the ledger and never touches Tickets", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 10_000);
    const userId = await userIdFor(username);

    await playDice(token, 5); // completes ach_first_round (target 1)

    const before = await request(app).get("/me").set(authed(token));
    const res = await request(app)
      .post("/challenges/claim")
      .set(authed(token))
      .send({ challengeId: "ach_first_round" });

    expect(res.status).toBe(200);
    expect(res.body.claimed.rewardGc).toBe(100);
    expect(res.body.claimed.rewardXp).toBe(25);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins + 100);
    expect(res.body.user.tickets).toBe(before.body.tickets); // Tickets untouched
    expect(res.body.progression.xp).toBe(25);
    expect(res.body.progression.level).toBe(1);

    const ledgerRow = await prisma.transaction.findFirst({
      where: { userId, type: "CHALLENGE_REWARD_GC" }
    });
    expect(ledgerRow).not.toBeNull();
    expect(ledgerRow!.currency).toBe("GC");
    expect(ledgerRow!.amount).toBe(100);

    // Nothing in this feature may ever mint Tickets: the only TICKETS
    // credits on this account are real game wins.
    const ticketRows = await prisma.transaction.findMany({ where: { userId, currency: "TICKETS" } });
    expect(ticketRows.every((t) => t.type === "GAME_WIN_TICKETS")).toBe(true);
  });

  it("cannot be claimed twice", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 10_000);
    const userId = await userIdFor(username);

    await playDice(token, 5);

    const first = await request(app)
      .post("/challenges/claim")
      .set(authed(token))
      .send({ challengeId: "ach_first_round" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/challenges/claim")
      .set(authed(token))
      .send({ challengeId: "ach_first_round" });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("ALREADY_CLAIMED");

    // Exactly one payout hit the ledger, not two.
    const rows = await prisma.transaction.findMany({ where: { userId, type: "CHALLENGE_REWARD_GC" } });
    expect(rows).toHaveLength(1);
  });

  it("rejects an unearned claim and pays nothing", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 10_000);
    const userId = await userIdFor(username);

    await playDice(token, 5); // one round - nowhere near weekly_play_100's 100

    const res = await request(app)
      .post("/challenges/claim")
      .set(authed(token))
      .send({ challengeId: "weekly_play_100" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NOT_COMPLETE");

    const rows = await prisma.transaction.findMany({ where: { userId, type: "CHALLENGE_REWARD_GC" } });
    expect(rows).toHaveLength(0);
  });

  it("rejects a challenge with no progress row at all", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/challenges/claim")
      .set(authed(token))
      .send({ challengeId: "daily_play_10" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NOT_COMPLETE");
  });

  it("rejects an unknown challenge id", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/challenges/claim")
      .set(authed(token))
      .send({ challengeId: "not-a-real-challenge" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("rejects a malformed payload", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/challenges/claim").set(authed(token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("requires auth", async () => {
    const res = await request(app).post("/challenges/claim").send({ challengeId: "ach_first_round" });
    expect(res.status).toBe(401);
  });
});

// =====================================================================
// Levels
// =====================================================================

describe("levels", () => {
  it("pays a level's Gold Coins exactly once, no matter how many claims follow", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 20_000);
    const userId = await userIdFor(username);

    await playUntilComplete(token, "daily_play_10"); // 10 rounds
    await playUntilComplete(token, "daily_win_3");

    // 25 + 50 + 40 = 115 XP, past level 2's 100 XP threshold.
    for (const id of ["ach_first_round", "ach_first_win", "daily_play_10"]) {
      const res = await request(app).post("/challenges/claim").set(authed(token)).send({ challengeId: id });
      expect(res.status).toBe(200);
    }

    const progressionRes = await request(app).get("/progression").set(authed(token));
    expect(progressionRes.status).toBe(200);
    expect(progressionRes.body.xp).toBe(115);
    expect(progressionRes.body.level).toBe(2);
    expect(progressionRes.body.rewardedLevel).toBe(2);
    expect(progressionRes.body.xpIntoLevel).toBe(15);
    expect(progressionRes.body.xpForNextLevel).toBe(200);

    let levelRows = await prisma.transaction.findMany({ where: { userId, type: "LEVEL_REWARD_GC" } });
    expect(levelRows).toHaveLength(1);
    expect(levelRows[0].currency).toBe("GC");
    expect(levelRows[0].amount).toBe(200);

    // Another claim adds XP but must not re-pay level 2.
    const more = await request(app)
      .post("/challenges/claim")
      .set(authed(token))
      .send({ challengeId: "daily_win_3" });
    expect(more.status).toBe(200);
    expect(more.body.levelsGained).toHaveLength(0);

    levelRows = await prisma.transaction.findMany({ where: { userId, type: "LEVEL_REWARD_GC" } });
    expect(levelRows).toHaveLength(1);
  });

  it("reports the level as a prestige number on /me", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 10_000);

    const fresh = await request(app).get("/me").set(authed(token));
    expect(fresh.body.progression).toEqual({ level: 1, xp: 0 });

    await playDice(token, 5);
    await request(app).post("/challenges/claim").set(authed(token)).send({ challengeId: "ach_first_round" });

    const after = await request(app).get("/me").set(authed(token));
    expect(after.body.progression.xp).toBe(25);
    expect(after.body.progression.level).toBe(1);
  });

  it("grants the cosmetic unlocked at a level, without gating the Item Shop", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);

    // Jump straight to level 5's XP (xpForLevel(5) = 1000) so the unlock
    // path is exercised without playing a thousand rounds.
    await prisma.playerProgress.create({ data: { userId, xp: xpForLevel(5), rewardedLevel: 1 } });
    const grants = await prisma.$transaction((tx) => grantPendingLevelRewards(tx, userId));

    expect(grants.map((g) => g.level)).toEqual([2, 3, 4, 5]);
    expect(grants.find((g) => g.level === 5)!.cosmeticItemId).toBe("acc_bow");

    const owned = await prisma.itemOwned.findMany({ where: { userId } });
    expect(owned.map((o) => o.itemId)).toContain("acc_bow");

    // Every level's GC paid once, and only as GC.
    const rows = await prisma.transaction.findMany({ where: { userId, type: "LEVEL_REWARD_GC" } });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.currency === "GC")).toBe(true);
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(200 + 300 + 400 + 500);

    // Re-running is a no-op - the guard is rewardedLevel, not a re-derivation.
    const again = await prisma.$transaction((tx) => grantPendingLevelRewards(tx, userId));
    expect(again).toHaveLength(0);
    expect(await prisma.transaction.count({ where: { userId, type: "LEVEL_REWARD_GC" } })).toBe(4);
  });
});

// =====================================================================
// The economy rule itself
// =====================================================================

describe("economy rule", () => {
  it("makes it impossible for a challenge or level reward to mint Tickets", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);

    await expect(
      prisma.$transaction((tx) => applyTransaction(tx, userId, "TICKETS", "CHALLENGE_REWARD_GC", 100))
    ).rejects.toThrow(/GAME_WIN_TICKETS/);

    await expect(
      prisma.$transaction((tx) => applyTransaction(tx, userId, "TICKETS", "LEVEL_REWARD_GC", 100))
    ).rejects.toThrow(/GAME_WIN_TICKETS/);
  });
});
