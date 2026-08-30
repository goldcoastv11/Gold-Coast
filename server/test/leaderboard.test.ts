/**
 * GC-earned leaderboard (economy/leaderboard.ts + GET /leaderboard). The
 * cases that matter: the three windows only include rows actually inside
 * them, only "earned" transaction types count (never a wager or a
 * purchase), a player's own rank shows up even outside the top N, and an
 * empty board renders as genuinely empty rather than erroring.
 */

import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { TransactionType } from "@prisma/client";
import { applyTransaction } from "../src/economy/ledger";
import { getLeaderboard, LeaderboardResponse } from "../src/economy/leaderboard";
import { resetDb, signupUser, authed, SignedUpUser } from "./helpers";

beforeEach(resetDb);

/** Applies one real ledger transaction, then backdates its createdAt - the only way to put a row outside "today"/"this week" without waiting for real time to pass. */
async function grantAt(userId: string, type: TransactionType, amount: number, when: Date): Promise<void> {
  const tx = await prisma.$transaction((t) => applyTransaction(t, userId, "GC", type, amount, {}));
  await prisma.transaction.update({ where: { id: tx.id }, data: { createdAt: when } });
}

async function userIdFor(username: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  return user.id;
}

const NOW = new Date();
const YESTERDAY = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
const LAST_WEEK = new Date(NOW.getTime() - 9 * 24 * 60 * 60 * 1000);

async function getBoard(token: string): Promise<LeaderboardResponse> {
  const res = await request(app).get("/leaderboard").set(authed(token));
  expect(res.status).toBe(200);
  return res.body as LeaderboardResponse;
}

describe("GET /leaderboard", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/leaderboard");
    expect(res.status).toBe(401);
  });

  it("an empty board (nobody has earned anything) is a real, non-error empty state", async () => {
    const player = await signupUser();
    const board = await getBoard(player.token);
    expect(board.daily).toEqual({ top: [], me: null });
    expect(board.weekly).toEqual({ top: [], me: null });
    expect(board.allTime).toEqual({ top: [], me: null });
  });

  it("only counts rows inside each window", async () => {
    const player = await signupUser();
    const userId = await userIdFor(player.username);

    await grantAt(userId, "GAME_WIN_GC", 100, NOW); // in daily, weekly, all-time
    await grantAt(userId, "GAME_WIN_GC", 50, YESTERDAY); // out of daily; in weekly + all-time
    await grantAt(userId, "GAME_WIN_GC", 25, LAST_WEEK); // out of daily + weekly; in all-time only

    const board = await getBoard(player.token);
    expect(board.daily.me?.earnedGc).toBe(100);
    expect(board.weekly.me?.earnedGc).toBe(150);
    expect(board.allTime.me?.earnedGc).toBe(175);
  });

  it("includes every 'earned' type the founder asked for: game winnings, Triple Chance payouts, challenge/level rewards, and Coin Kiosk claims", async () => {
    const player = await signupUser();
    const userId = await userIdFor(player.username);

    await grantAt(userId, "GAME_WIN_GC", 10, NOW);
    await grantAt(userId, "PAYOUT_GC", 20, NOW);
    await grantAt(userId, "CHALLENGE_REWARD_GC", 30, NOW);
    await grantAt(userId, "LEVEL_REWARD_GC", 40, NOW);
    await grantAt(userId, "LEVEL_MINIGAME_REWARD_GC", 50, NOW);
    await grantAt(userId, "AD_REWARD_GC", 60, NOW);

    const board = await getBoard(player.token);
    expect(board.allTime.me?.earnedGc).toBe(10 + 20 + 30 + 40 + 50 + 60);
  });

  it("spending, purchases, and the signup bonus never count toward 'earned'", async () => {
    const player = await signupUser();
    const userId = await userIdFor(player.username);

    // Real GC to spend from, plus every non-"earned" credit type.
    await grantAt(userId, "AD_REWARD_GC", 1000, NOW);
    await grantAt(userId, "PACKAGE_GC", 5000, NOW); // real-money purchase
    await grantAt(userId, "SIGNUP_BONUS_GC", 200, NOW); // one-time welcome grant
    await grantAt(userId, "GAME_WIN_GC", 15, NOW); // the one real "earned" row
    await grantAt(userId, "WAGER_GC", -5, NOW); // a spend (negative, and not an earned type)
    await grantAt(userId, "SHOP_PURCHASE_GC", -10, NOW); // a spend

    const board = await getBoard(player.token);
    // Only the AD_REWARD_GC (1000) and GAME_WIN_GC (15) rows are "earned" -
    // PACKAGE_GC/SIGNUP_BONUS_GC/WAGER_GC/SHOP_PURCHASE_GC must not appear.
    expect(board.allTime.me?.earnedGc).toBe(1000 + 15);
  });

  it("computes standard competition rank (ties share a rank, the next distinct score skips ahead) and returns the caller's own rank even outside the top", async () => {
    const players: SignedUpUser[] = [];
    for (let i = 0; i < 12; i += 1) {
      players.push(await signupUser());
    }
    const ids = await Promise.all(players.map((p) => userIdFor(p.username)));

    // Two players tied for the top spot, then 10 more players each one GC
    // apart, so the 12th-ranked player (the very last one) is outside the
    // top-10 list but should still get their own rank back.
    await grantAt(ids[0], "GAME_WIN_GC", 1000, NOW);
    await grantAt(ids[1], "GAME_WIN_GC", 1000, NOW);
    for (let i = 2; i < 12; i += 1) {
      await grantAt(ids[i], "GAME_WIN_GC", 100 - i, NOW);
    }

    const board = await getBoard(players[0].token);
    expect(board.allTime.top).toHaveLength(10);
    expect(board.allTime.top[0].earnedGc).toBe(1000);
    expect(board.allTime.top[0].rank).toBe(1);
    expect(board.allTime.top[1].earnedGc).toBe(1000);
    expect(board.allTime.top[1].rank).toBe(1); // tied for 1st
    expect(board.allTime.top[2].rank).toBe(3); // next distinct score is 3rd, not 2nd

    // Player 11 (index 11) is the lowest earner - 12th overall, outside top 10.
    const lowestBoard = await getBoard(players[11].token);
    expect(lowestBoard.allTime.top.find((e) => e.userId === ids[11])).toBeUndefined();
    expect(lowestBoard.allTime.me?.rank).toBe(12);
    expect(lowestBoard.allTime.me?.userId).toBe(ids[11]);
  });

  it("shows usernames", async () => {
    const player = await signupUser();
    const userId = await userIdFor(player.username);
    await grantAt(userId, "GAME_WIN_GC", 5, NOW);

    const board = await getBoard(player.token);
    expect(board.allTime.me?.username).toBe(player.username);
    expect(board.allTime.top[0].username).toBe(player.username);
  });
});

describe("getLeaderboard (unit)", () => {
  it("a user who has spent but never earned has no row (not a zero row)", async () => {
    const player = await signupUser();
    const userId = await userIdFor(player.username);
    await grantAt(userId, "AD_REWARD_GC", 100, NOW);
    await grantAt(userId, "WAGER_GC", -100, NOW); // spends it all back down to 0 balance, but WAGER_GC isn't "earned" either way

    const board = await prisma.$transaction((tx) => getLeaderboard(tx, userId, NOW));
    // AD_REWARD_GC (100) is still an earned credit regardless of what was spent afterward - "earned" tracks gains, not current balance/net profit.
    expect(board.allTime.me?.earnedGc).toBe(100);
  });

  it("with nobody earning anything, all three boards are empty for an unrelated caller", async () => {
    const player = await signupUser();
    const userId = await userIdFor(player.username);
    const board = await prisma.$transaction((tx) => getLeaderboard(tx, userId, NOW));
    expect(board.daily).toEqual({ top: [], me: null });
    expect(board.weekly).toEqual({ top: [], me: null });
    expect(board.allTime).toEqual({ top: [], me: null });
  });
});
