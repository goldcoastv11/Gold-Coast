/**
 * The level-up "stop the marker" timing minigame.
 *
 * Same priority as progression.test.ts: this pays real Gold Coins, so the
 * load-bearing cases are "the reward actually credits through the ledger",
 * "a session can't be completed twice", "a forged/unearned claim is
 * rejected", and "the payout curve behaves at its extremes" - not the
 * happy path alone.
 *
 * `startLevelMinigame`/`completeLevelMinigame` are exercised directly
 * (bypassing HTTP) wherever a test needs to control the elapsed time
 * precisely - both take an injectable `now`, same pattern as
 * progress.ts's claimChallenge - so the sweep's exact extremes (dead
 * centre / either end of the bar) can be hit deterministically instead of
 * racing a real clock. A smaller set of HTTP-level tests separately covers
 * the route wiring itself.
 */

import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, signupUser, authed } from "./helpers";
import { xpForLevel } from "../src/progression/levels";
import { periodKeyFor } from "../src/progression/periods";
import { grantPendingLevelRewards, claimChallenge } from "../src/progression/progress";
import {
  accuracyFor,
  levelMinigameMaxRewardGc,
  levelMinigameRewardGc,
  sweepPosition
} from "../src/progression/levelMinigame";
import { completeLevelMinigame, startLevelMinigame } from "../src/progression/levelMinigameSession";

beforeEach(resetDb);

async function userIdFor(username: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  return user.id;
}

/** Seeds a player straight to `level`'s XP and pays out its level rewards, which also flags a minigame as owed (see PlayerProgress.pendingMinigameLevel). */
async function levelUpTo(userId: string, level: number) {
  await prisma.playerProgress.create({ data: { userId, xp: xpForLevel(level), rewardedLevel: 1 } });
  return prisma.$transaction((tx) => grantPendingLevelRewards(tx, userId));
}

// =====================================================================
// Pure math: sweep position, accuracy, and the reward curve
// =====================================================================

describe("sweepPosition / accuracyFor", () => {
  it("starts and wraps at the bar's left extreme (-1)", () => {
    expect(sweepPosition(0, 1000)).toBeCloseTo(-1, 10);
    expect(sweepPosition(1000, 1000)).toBeCloseTo(-1, 10);
    expect(sweepPosition(2000, 1000)).toBeCloseTo(-1, 10);
  });

  it("reaches the right extreme (+1) at the half period", () => {
    expect(sweepPosition(500, 1000)).toBeCloseTo(1, 10);
  });

  it("passes dead centre (0) a quarter and three-quarters through the period", () => {
    expect(sweepPosition(250, 1000)).toBeCloseTo(0, 10);
    expect(sweepPosition(750, 1000)).toBeCloseTo(0, 10);
  });

  it("accuracy is 1 at centre and 0 at either extreme", () => {
    expect(accuracyFor(0)).toBe(1);
    expect(accuracyFor(1)).toBe(0);
    expect(accuracyFor(-1)).toBe(0);
    expect(accuracyFor(0.5)).toBeCloseTo(0.5, 10);
  });
});

describe("levelMinigameRewardGc curve", () => {
  it("pays the max reward at accuracy 1 and a positive floor at accuracy 0 (a miss still gives something)", () => {
    const max = levelMinigameMaxRewardGc(10); // 100 * 10
    expect(max).toBe(1000);
    expect(levelMinigameRewardGc(10, 1)).toBe(max);

    const floor = levelMinigameRewardGc(10, 0);
    expect(floor).toBeGreaterThan(0);
    expect(floor).toBeLessThan(max);
  });

  it("rewards precision disproportionately near the top of the range", () => {
    const max = levelMinigameMaxRewardGc(10);
    const near = levelMinigameRewardGc(10, 0.9);
    const mid = levelMinigameRewardGc(10, 0.5);
    const perfect = levelMinigameRewardGc(10, 1);

    // A near-perfect hit should sit much closer to the perfect payout than
    // to the midpoint's - the curve is convex, not linear.
    expect(perfect - near).toBeLessThan(near - mid);
    expect(mid).toBeLessThan(near);
    expect(near).toBeLessThan(perfect);
    void max;
  });

  it("clamps out-of-range accuracy instead of paying a nonsense amount", () => {
    expect(levelMinigameRewardGc(5, -3)).toBe(levelMinigameRewardGc(5, 0));
    expect(levelMinigameRewardGc(5, 99)).toBe(levelMinigameRewardGc(5, 1));
  });

  it("scales the max reward with the anchor level", () => {
    expect(levelMinigameMaxRewardGc(1)).toBe(100);
    expect(levelMinigameMaxRewardGc(20)).toBe(2000);
  });
});

// =====================================================================
// DB flow: owed only from a real level-up, one shot, server clock only
// =====================================================================

describe("startLevelMinigame", () => {
  it("does nothing if the player hasn't leveled up (no forged entitlement)", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);

    const outcome = await prisma.$transaction((tx) => startLevelMinigame(tx, userId));
    expect(outcome).toEqual({ ok: false, reason: "NONE_PENDING" });
    expect(await prisma.levelMinigameSession.count({ where: { userId } })).toBe(0);
  });

  it("issues a session anchored to the level just reached", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);
    const grants = await levelUpTo(userId, 5);
    expect(grants.map((g) => g.level)).toEqual([2, 3, 4, 5]);

    const outcome = await prisma.$transaction((tx) => startLevelMinigame(tx, userId));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.session.level).toBe(5);
    expect(outcome.session.sweepPeriodMs).toBeGreaterThan(0);

    const rows = await prisma.levelMinigameSession.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");
  });

  it("resumes the same session (same clock) rather than minting a new one on a second start", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);
    await levelUpTo(userId, 2);

    const first = await prisma.$transaction((tx) => startLevelMinigame(tx, userId));
    const second = await prisma.$transaction((tx) => startLevelMinigame(tx, userId));
    if (!first.ok || !second.ok) throw new Error("unreachable");

    expect(second.session.sessionId).toBe(first.session.sessionId);
    expect(await prisma.levelMinigameSession.count({ where: { userId } })).toBe(1);
  });

  it("bumps the anchor level (not the clock) if a further level-up lands while a session sits unplayed", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);
    await levelUpTo(userId, 2);

    const first = await prisma.$transaction((tx) => startLevelMinigame(tx, userId));
    if (!first.ok) throw new Error("unreachable");
    const before = await prisma.levelMinigameSession.findUniqueOrThrow({ where: { id: first.session.sessionId } });

    // A second, later claim pushes the player to level 4 without the first
    // minigame ever having been played.
    await prisma.playerProgress.update({ where: { userId }, data: { xp: xpForLevel(4) } });
    await prisma.$transaction((tx) => grantPendingLevelRewards(tx, userId));

    const second = await prisma.$transaction((tx) => startLevelMinigame(tx, userId));
    if (!second.ok) throw new Error("unreachable");
    expect(second.session.sessionId).toBe(first.session.sessionId);
    expect(second.session.level).toBe(4);

    const after = await prisma.levelMinigameSession.findUniqueOrThrow({ where: { id: first.session.sessionId } });
    expect(after.startedAt.getTime()).toBe(before.startedAt.getTime());
  });
});

describe("completeLevelMinigame", () => {
  it("credits Gold Coins through the ledger for a dead-centre stop (accuracy 1, max reward)", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);
    await levelUpTo(userId, 3);

    const started = await prisma.$transaction((tx) => startLevelMinigame(tx, userId));
    if (!started.ok) throw new Error("unreachable");
    const t0 = new Date("2026-08-29T00:00:00.000Z");
    // Pin the period to a value evenly divisible by 4 (overriding whatever
    // was randomly issued) purely so "one quarter period" below is an exact
    // integer millisecond, not a fraction Date silently truncates - real
    // sessions use whatever random period they got, this is a test-only
    // precision nicety.
    const periodMs = 1600;
    await prisma.levelMinigameSession.update({
      where: { id: started.session.sessionId },
      data: { startedAt: t0, sweepPeriodMs: periodMs }
    });

    // levelUpTo already credited levels 2 and 3's own flat LEVEL_REWARD_GC -
    // capture the balance right before the minigame's own payout so the
    // assertion below isolates just that.
    const goldBefore = (await prisma.balance.findUniqueOrThrow({ where: { userId } })).goldCoins;

    // Quarter-period elapsed = dead centre (see sweepPosition tests above).
    const stopAt = new Date(t0.getTime() + periodMs / 4);
    const outcome = await prisma.$transaction((tx) =>
      completeLevelMinigame(tx, userId, started.session.sessionId, stopAt)
    );
    if (!outcome.ok) throw new Error("unreachable");

    expect(outcome.accuracy).toBeCloseTo(1, 6);
    expect(outcome.rewardGc).toBe(levelMinigameMaxRewardGc(3));

    const rows = await prisma.transaction.findMany({ where: { userId, type: "LEVEL_MINIGAME_REWARD_GC" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe("GC");
    expect(rows[0].amount).toBe(outcome.rewardGc);

    const balance = await prisma.balance.findUniqueOrThrow({ where: { userId } });
    expect(balance.goldCoins).toBe(goldBefore + outcome.rewardGc);
  });

  it("still pays the reduced floor amount for a stop at either extreme (accuracy 0) - a miss isn't punished with nothing", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);
    await levelUpTo(userId, 3);

    const started = await prisma.$transaction((tx) => startLevelMinigame(tx, userId));
    if (!started.ok) throw new Error("unreachable");
    const t0 = new Date("2026-08-29T00:00:00.000Z");
    await prisma.levelMinigameSession.update({
      where: { id: started.session.sessionId },
      data: { startedAt: t0 }
    });

    // Zero elapsed = the marker's starting extreme.
    const outcome = await prisma.$transaction((tx) =>
      completeLevelMinigame(tx, userId, started.session.sessionId, t0)
    );
    if (!outcome.ok) throw new Error("unreachable");

    expect(outcome.accuracy).toBeCloseTo(0, 6);
    const max = levelMinigameMaxRewardGc(3);
    expect(outcome.rewardGc).toBeGreaterThan(0);
    expect(outcome.rewardGc).toBeLessThan(max);
  });

  it("clears the pending-minigame flag on completion", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);
    await levelUpTo(userId, 2);

    const started = await prisma.$transaction((tx) => startLevelMinigame(tx, userId));
    if (!started.ok) throw new Error("unreachable");
    await prisma.$transaction((tx) => completeLevelMinigame(tx, userId, started.session.sessionId));

    const progress = await prisma.playerProgress.findUniqueOrThrow({ where: { userId } });
    expect(progress.pendingMinigameLevel).toBeNull();

    // And starting again finds nothing owed.
    const again = await prisma.$transaction((tx) => startLevelMinigame(tx, userId));
    expect(again).toEqual({ ok: false, reason: "NONE_PENDING" });
  });

  it("cannot be replayed for repeat payouts", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);
    await levelUpTo(userId, 2);

    const started = await prisma.$transaction((tx) => startLevelMinigame(tx, userId));
    if (!started.ok) throw new Error("unreachable");

    const first = await prisma.$transaction((tx) =>
      completeLevelMinigame(tx, userId, started.session.sessionId)
    );
    expect(first.ok).toBe(true);

    const second = await prisma.$transaction((tx) =>
      completeLevelMinigame(tx, userId, started.session.sessionId)
    );
    expect(second).toEqual({ ok: false, reason: "ALREADY_CLAIMED" });

    const rows = await prisma.transaction.findMany({ where: { userId, type: "LEVEL_MINIGAME_REWARD_GC" } });
    expect(rows).toHaveLength(1);
  });

  it("rejects a forged sessionId that never existed", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);

    const outcome = await prisma.$transaction((tx) =>
      completeLevelMinigame(tx, userId, "not-a-real-session-id")
    );
    expect(outcome).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("rejects a valid sessionId that belongs to a different player", async () => {
    const a = await signupUser();
    const b = await signupUser();
    const userIdA = await userIdFor(a.username);
    const userIdB = await userIdFor(b.username);
    await levelUpTo(userIdA, 2);

    const started = await prisma.$transaction((tx) => startLevelMinigame(tx, userIdA));
    if (!started.ok) throw new Error("unreachable");

    const outcome = await prisma.$transaction((tx) =>
      completeLevelMinigame(tx, userIdB, started.session.sessionId)
    );
    expect(outcome).toEqual({ ok: false, reason: "NOT_FOUND" });

    // Nothing was credited to either account.
    expect(await prisma.transaction.count({ where: { type: "LEVEL_MINIGAME_REWARD_GC" } })).toBe(0);
  });
});

// =====================================================================
// HTTP wiring
// =====================================================================

describe("POST /minigame/levelup/start and /stop", () => {
  it("requires auth", async () => {
    expect((await request(app).post("/minigame/levelup/start")).status).toBe(401);
    expect((await request(app).post("/minigame/levelup/stop").send({ sessionId: "x" })).status).toBe(401);
  });

  it("returns 409 with nothing owed", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/minigame/levelup/start").set(authed(token));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NONE_PENDING");
  });

  it("starts, stops, and credits Gold Coins visible on /me - end to end over HTTP", async () => {
    const { token, username } = await signupUser();
    const userId = await userIdFor(username);
    await levelUpTo(userId, 2);

    const start = await request(app).post("/minigame/levelup/start").set(authed(token));
    expect(start.status).toBe(200);
    expect(start.body.session.level).toBe(2);
    const sessionId = start.body.session.sessionId as string;

    const before = await request(app).get("/me").set(authed(token));
    const goldBefore = before.body.goldCoins as number;

    const stop = await request(app).post("/minigame/levelup/stop").set(authed(token)).send({ sessionId });
    expect(stop.status).toBe(200);
    expect(stop.body.result.rewardGc).toBeGreaterThan(0);
    expect(stop.body.user.goldCoins).toBe(goldBefore + stop.body.result.rewardGc);

    const again = await request(app).post("/minigame/levelup/stop").set(authed(token)).send({ sessionId });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_CLAIMED");
  });

  it("rejects a malformed stop payload", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/minigame/levelup/stop").set(authed(token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("404s on a sessionId that was never issued", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/minigame/levelup/stop")
      .set(authed(token))
      .send({ sessionId: "nonexistent" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

// =====================================================================
// A multi-level claim offers exactly ONE minigame, not one per level
// =====================================================================

describe("multi-level jumps", () => {
  it("a claim that crosses several levels still owes exactly one minigame, anchored to the highest level", async () => {
    const { username } = await signupUser();
    const userId = await userIdFor(username);

    // Enough banked XP that one more claim's reward crosses several levels.
    await prisma.playerProgress.create({ data: { userId, xp: xpForLevel(4) - 10, rewardedLevel: 1 } });
    // Marks "ach_first_round" (25 XP, LIFETIME) complete-but-unclaimed without
    // needing to actually play a round through HTTP - same shortcut
    // grantPendingLevelRewards's own tests use for XP.
    await prisma.challengeProgress.create({
      data: { userId, challengeId: "ach_first_round", periodKey: periodKeyFor("LIFETIME"), counter: 1 }
    });

    const outcome = await prisma.$transaction((tx) => claimChallenge(tx, userId, "ach_first_round"));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.levelsGained.length).toBeGreaterThan(1);
    expect(outcome.pendingLevelMinigame).toEqual({ level: outcome.progression.level });

    // Only one session gets created no matter how many levels were crossed.
    await prisma.$transaction((tx) => startLevelMinigame(tx, userId));
    expect(await prisma.levelMinigameSession.count({ where: { userId } })).toBe(1);
  });

  it("surfaces a still-unplayed minigame on GET /progression, so re-opening the panel doesn't lose it", async () => {
    const { token, username } = await signupUser();
    const userId = await userIdFor(username);
    await levelUpTo(userId, 3);

    const res = await request(app).get("/progression").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.pendingLevelMinigame).toEqual({ level: 3 });
  });

  it("clears from GET /progression once played", async () => {
    const { token, username } = await signupUser();
    const userId = await userIdFor(username);
    await levelUpTo(userId, 2);

    const start = await request(app).post("/minigame/levelup/start").set(authed(token));
    await request(app)
      .post("/minigame/levelup/stop")
      .set(authed(token))
      .send({ sessionId: start.body.session.sessionId });

    const res = await request(app).get("/progression").set(authed(token));
    expect(res.body.pendingLevelMinigame).toBeNull();
  });
});
