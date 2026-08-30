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
  recordWager,
  recordWin,
  XP_ITEM_PURCHASE,
  XP_ROUND_PLAYED,
  XP_ROUND_WIN
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
// XP from real gameplay - the founder's "every play/win rewards XP" ask,
// on top of the challenge-claim XP already covered above. Exercised at
// the recordWager/recordWin level (same functions games/shared.ts calls
// from real settlement) so the founder's flat-XP rule can be asserted
// exactly, without depending on a particular game's random outcome.
// =====================================================================

describe("XP from real gameplay (playing and winning)", () => {
  it("grants flat XP for playing a round, whether it wins or loses", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);

    await prisma.$transaction((tx) => recordWager(tx, userId, "dice", 5));
    let progress = await prisma.playerProgress.findUniqueOrThrow({ where: { userId } });
    expect(progress.xp).toBe(XP_ROUND_PLAYED);

    // A payout of 0 (a loss) is not a win - no extra XP on top of the play.
    await prisma.$transaction((tx) => recordWin(tx, userId, "dice", 0));
    progress = await prisma.playerProgress.findUniqueOrThrow({ where: { userId } });
    expect(progress.xp).toBe(XP_ROUND_PLAYED);

    // A real win adds XP_ROUND_WIN on top of the round's own XP_ROUND_PLAYED.
    await prisma.$transaction((tx) => recordWin(tx, userId, "dice", 500));
    progress = await prisma.playerProgress.findUniqueOrThrow({ where: { userId } });
    expect(progress.xp).toBe(XP_ROUND_PLAYED + XP_ROUND_WIN);
  });

  it("pays the SAME win XP no matter the bet size or payout - founder's rule: levels track play, not stake", async () => {
    const small = await signupUser();
    const big = await signupUser();
    const smallId = await userIdFor(small.username);
    const bigId = await userIdFor(big.username);

    // A 10 GC bet that wins 20 GC vs. a 1,000 GC bet that wins 5,000 GC -
    // wildly different stakes and payouts, same real win.
    await prisma.$transaction(async (tx) => {
      await recordWager(tx, smallId, "dice", 10);
      await recordWin(tx, smallId, "dice", 20);
    });
    await prisma.$transaction(async (tx) => {
      await recordWager(tx, bigId, "dice", 1000);
      await recordWin(tx, bigId, "dice", 5000);
    });

    const smallProgress = await prisma.playerProgress.findUniqueOrThrow({ where: { userId: smallId } });
    const bigProgress = await prisma.playerProgress.findUniqueOrThrow({ where: { userId: bigId } });
    expect(smallProgress.xp).toBe(bigProgress.xp);
    expect(smallProgress.xp).toBe(XP_ROUND_PLAYED + XP_ROUND_WIN);
  });

  it("grants gameplay XP end to end over a real HTTP round, matching XP_ROUND_PLAYED/XP_ROUND_WIN exactly", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 1_000);

    const before = await request(app).get("/me").set(authed(token));
    const res = await request(app)
      .post("/games/dice/play")
      .set(authed(token))
      .send({ betAmount: 5, target: 95 });
    expect(res.status).toBe(200);

    const expectedXp =
      before.body.progression.xp + XP_ROUND_PLAYED + (res.body.result.won ? XP_ROUND_WIN : 0);
    const after = await request(app).get("/me").set(authed(token));
    expect(after.body.progression.xp).toBe(expectedXp);
  });

  it("crossing a level from real gameplay ALONE (no challenge claim) still sets the pending Level-Up minigame flag", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 5_000);

    // Even with zero wins, XP_ROUND_PLAYED alone crosses level 2's 100 XP
    // threshold by round 20 (5 XP * 20) - bounded loop, never touches
    // /challenges/claim, so any level-up here is purely from gameplay.
    let level = 1;
    for (let i = 0; i < 25 && level < 2; i += 1) {
      await request(app).post("/games/dice/play").set(authed(token)).send({ betAmount: 5, target: 95 });
      const progression = await request(app).get("/progression").set(authed(token));
      level = progression.body.level;
    }
    expect(level).toBeGreaterThanOrEqual(2);

    const res = await request(app).get("/progression").set(authed(token));
    // Same pending-minigame state a challenge-claim-triggered level-up
    // produces - the flag doesn't know or care what pushed the XP over.
    expect(res.body.pendingLevelMinigame).toEqual({ level: res.body.level });
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

    const played = await playDice(token, 5); // completes ach_first_round (target 1)
    // The round itself grants XP_ROUND_PLAYED (win or lose), plus
    // XP_ROUND_WIN if it happened to win - see progress.ts's recordWager/
    // recordWin. Read the actual outcome rather than assuming it, since
    // playDice's win odds are 95% but not guaranteed.
    const gameplayXp = XP_ROUND_PLAYED + (played.result.won ? XP_ROUND_WIN : 0);

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
    expect(res.body.progression.xp).toBe(25 + gameplayXp);
    expect(res.body.progression.level).toBe(1);

    const ledgerRow = await prisma.transaction.findFirst({
      where: { userId, type: "CHALLENGE_REWARD_GC" }
    });
    expect(ledgerRow).not.toBeNull();
    expect(ledgerRow!.currency).toBe("GC");
    expect(ledgerRow!.amount).toBe(100);

    // Nothing in this feature may ever touch Tickets: it's retired, and
    // nothing on this account - including the dice win above - should have
    // written a single TICKETS row.
    const ticketRows = await prisma.transaction.findMany({ where: { userId, currency: "TICKETS" } });
    expect(ticketRows).toHaveLength(0);
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

    // Real gameplay now also grants flat XP (XP_ROUND_PLAYED per round,
    // + XP_ROUND_WIN per win) alongside the three challenge claims below -
    // read the exact rounds/wins so far off the board rather than assuming
    // a fixed round count, since daily_win_3 may or may not need extra
    // rounds beyond the 10 played for daily_play_10 (dice's win odds are
    // 95%, not guaranteed).
    const boardAfterPlay = await getBoard(token);
    const roundsPlayed = view(boardAfterPlay, "weekly_play_100").progress;
    const winsSoFar = view(boardAfterPlay, "weekly_win_30").progress;
    const gameplayXp = roundsPlayed * XP_ROUND_PLAYED + winsSoFar * XP_ROUND_WIN;

    // 25 + 50 + 40 = 115 XP from claims, plus gameplayXp from the rounds
    // themselves - together past level 2's 100 XP threshold.
    for (const id of ["ach_first_round", "ach_first_win", "daily_play_10"]) {
      const res = await request(app).post("/challenges/claim").set(authed(token)).send({ challengeId: id });
      expect(res.status).toBe(200);
    }

    const totalXp = 115 + gameplayXp;
    const expectedLevel = levelForXp(totalXp);

    const progressionRes = await request(app).get("/progression").set(authed(token));
    expect(progressionRes.status).toBe(200);
    expect(progressionRes.body.xp).toBe(totalXp);
    expect(progressionRes.body.level).toBe(expectedLevel);
    expect(progressionRes.body.rewardedLevel).toBe(expectedLevel);
    expect(progressionRes.body.xpIntoLevel).toBe(totalXp - xpForLevel(expectedLevel));
    expect(progressionRes.body.xpForNextLevel).toBe(
      expectedLevel >= MAX_LEVEL ? 0 : xpForLevel(expectedLevel + 1) - xpForLevel(expectedLevel)
    );

    let levelRows = await prisma.transaction.findMany({ where: { userId, type: "LEVEL_REWARD_GC" } });
    // Every level from 2 up to expectedLevel was paid, exactly once each.
    expect(levelRows).toHaveLength(Math.max(0, expectedLevel - 1));
    expect(levelRows.every((r) => r.currency === "GC")).toBe(true);
    let expectedTotalGc = 0;
    for (let l = 2; l <= expectedLevel; l += 1) expectedTotalGc += levelRewardGc(l);
    expect(levelRows.reduce((sum, r) => sum + r.amount, 0)).toBe(expectedTotalGc);

    // Another claim adds XP but must not re-pay any level already paid -
    // whether it crosses a further level depends on exactly how much
    // gameplay XP landed above (winsSoFar varies run to run), so work out
    // what SHOULD happen from the same curve the implementation uses
    // rather than assuming either way.
    const more = await request(app)
      .post("/challenges/claim")
      .set(authed(token))
      .send({ challengeId: "daily_win_3" });
    expect(more.status).toBe(200);

    const expectedLevelAfterMore = levelForXp(totalXp + 50); // daily_win_3's rewardXp
    expect(more.body.levelsGained).toHaveLength(Math.max(0, expectedLevelAfterMore - expectedLevel));

    levelRows = await prisma.transaction.findMany({ where: { userId, type: "LEVEL_REWARD_GC" } });
    expect(levelRows).toHaveLength(Math.max(0, expectedLevelAfterMore - 1));
  });

  it("reports the level as a prestige number on /me", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 10_000);

    const fresh = await request(app).get("/me").set(authed(token));
    expect(fresh.body.progression).toEqual({ level: 1, xp: 0 });

    const played = await playDice(token, 5);
    const gameplayXp = XP_ROUND_PLAYED + (played.result.won ? XP_ROUND_WIN : 0);
    await request(app).post("/challenges/claim").set(authed(token)).send({ challengeId: "ach_first_round" });

    const after = await request(app).get("/me").set(authed(token));
    expect(after.body.progression.xp).toBe(25 + gameplayXp);
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
  it("makes it impossible for a challenge or level reward to mint Tickets (retired - nothing may credit it any more)", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);

    await expect(
      prisma.$transaction((tx) => applyTransaction(tx, userId, "TICKETS", "CHALLENGE_REWARD_GC", 100))
    ).rejects.toThrow(/TICKETS is retired/);

    await expect(
      prisma.$transaction((tx) => applyTransaction(tx, userId, "TICKETS", "LEVEL_REWARD_GC", 100))
    ).rejects.toThrow(/TICKETS is retired/);
  });
});
