/**
 * The live Roulette table's money paths, against the real HTTP API and the
 * real database.
 *
 * Two halves, deliberately separated from the round loop's own unit tests
 * (rouletteTable.test.ts, which uses a fake clock and no database):
 *
 * - `POST /games/roulette/table/bet` — the only door a bet comes in
 *   through, and therefore the place every "can this player do this?"
 *   question has to be answered.
 * - `settleTableRound` — the only code in the realtime feature that moves a
 *   balance. Driven directly rather than through a WebSocket and a
 *   12-second betting window, which is exactly why it was split out of the
 *   socket adapter.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { rouletteTable } from "../src/realtime/rouletteTable";
import { settleTableRound } from "../src/realtime/tableSettlement";
import { TableResult } from "../src/realtime/protocol";
import { getBalance } from "../src/economy/ledger";
import { BET_MAX, BET_MIN } from "../src/games/shared";
import { resetDb, signupUser, authed } from "./helpers";

beforeEach(async () => {
  await resetDb();
  // The table is a module-level singleton started by the realtime attach,
  // which these tests don't run - so each test opens a fresh round itself.
  rouletteTable.start();
});

afterEach(() => {
  rouletteTable.stop();
});

function bet(token: string, body: object) {
  return request(app).post("/games/roulette/table/bet").set(authed(token)).send(body);
}

describe("POST /games/roulette/table/bet", () => {
  it("accepts a bet and returns the table with it on", async () => {
    const user = await signupUser({ username: "alice_table" });

    const res = await bet(user.token, { betAmount: 25, bet: "red" });

    expect(res.status).toBe(200);
    expect(res.body.bet).toMatchObject({ username: "alice_table", choice: "red", amount: 25 });
    expect(res.body.table.phase).toBe("betting");
    expect(res.body.table.bets).toHaveLength(1);
  });

  it("does NOT debit the balance when the bet is placed", async () => {
    const user = await signupUser();
    const before = await getBalance(prisma, (await currentUserId(user.username)), "GC");

    await bet(user.token, { betAmount: 25, bet: "red" });

    // The whole round settles atomically at spin time - see
    // realtime/rouletteTable.ts's header. A debit here would be a stake
    // that a process restart could strand.
    const after = await getBalance(prisma, await currentUserId(user.username), "GC");
    expect(after).toBe(before);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/games/roulette/table/bet")
      .send({ betAmount: 25, bet: "red" });
    expect(res.status).toBe(401);
  });

  it("rejects a bet the player can't afford", async () => {
    const user = await signupUser();
    const userId = await currentUserId(user.username);
    // Drain the account down below the minimum bet.
    const balance = await getBalance(prisma, userId, "GC");
    await prisma.balance.update({ where: { userId }, data: { goldCoins: 0 } });
    expect(balance).toBeGreaterThan(0);

    const res = await bet(user.token, { betAmount: BET_MIN, bet: "red" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_BALANCE");
    expect(rouletteTable.snapshot().bets).toEqual([]);
  });

  it("rejects a second bet on the same round", async () => {
    const user = await signupUser();
    await bet(user.token, { betAmount: 25, bet: "red" });

    const res = await bet(user.token, { betAmount: 25, bet: "black" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_BET");
    expect(rouletteTable.snapshot().bets).toHaveLength(1);
  });

  it("rejects an out-of-range or non-integer stake", async () => {
    const user = await signupUser();

    expect((await bet(user.token, { betAmount: BET_MIN - 1, bet: "red" })).status).toBe(400);
    expect((await bet(user.token, { betAmount: BET_MAX + 1, bet: "red" })).status).toBe(400);
    expect((await bet(user.token, { betAmount: 12.5, bet: "red" })).status).toBe(400);
    expect(rouletteTable.snapshot().bets).toEqual([]);
  });

  it("rejects a colour that isn't on the wheel", async () => {
    const user = await signupUser();
    const res = await bet(user.token, { betAmount: 25, bet: "purple" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("refuses bets when the table isn't running", async () => {
    const user = await signupUser();
    // Simulates the realtime channel having failed to attach: the wheel
    // will never spin, so taking a stake for it must be impossible.
    rouletteTable.stop();

    const res = await bet(user.token, { betAmount: 25, bet: "red" });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("TABLE_CLOSED");
  });

  it("keeps several players' bets on the same round", async () => {
    const alice = await signupUser({ username: "alice_multi" });
    const bob = await signupUser({ username: "bob_multi" });

    await bet(alice.token, { betAmount: 25, bet: "red" });
    await bet(bob.token, { betAmount: 50, bet: "black" });

    const table = rouletteTable.snapshot();
    expect(table.bets.map((b) => b.username).sort()).toEqual(["alice_multi", "bob_multi"]);
  });
});

describe("GET /games/roulette/table", () => {
  it("returns the current table so a client without a socket can still watch", async () => {
    const user = await signupUser();
    const res = await request(app).get("/games/roulette/table").set(authed(user.token));

    expect(res.status).toBe(200);
    expect(res.body.running).toBe(true);
    expect(res.body.table.phase).toBe("betting");
    expect(res.body.table.msRemaining).toBeGreaterThan(0);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/games/roulette/table")).status).toBe(401);
  });
});

describe("settleTableRound", () => {
  it("debits the stake and credits the win, in the same shape as a solo round", async () => {
    const user = await signupUser();
    const userId = await currentUserId(user.username);
    const before = await getBalance(prisma, userId, "GC");

    await settleTableRound("round-1", 7, [
      result(userId, user.username, "red", 20, true, 40)
    ]);

    // Wagered 20, won 40 back: net +20.
    expect(await getBalance(prisma, userId, "GC")).toBe(before + 20);

    const transactions = await prisma.transaction.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    const types = transactions.map((t) => t.type);
    expect(types).toContain("WAGER_GC");
    expect(types).toContain("GAME_WIN_GC");
  });

  it("debits the stake and pays nothing on a loss", async () => {
    const user = await signupUser();
    const userId = await currentUserId(user.username);
    const before = await getBalance(prisma, userId, "GC");

    await settleTableRound("round-2", 8, [
      result(userId, user.username, "red", 20, false, 0)
    ]);

    expect(await getBalance(prisma, userId, "GC")).toBe(before - 20);
  });

  it("settles every player independently - one bad bet doesn't roll back the others", async () => {
    const alice = await signupUser({ username: "alice_settle" });
    const bob = await signupUser({ username: "bob_settle" });
    const aliceId = await currentUserId(alice.username);
    const bobId = await currentUserId(bob.username);
    const aliceBefore = await getBalance(prisma, aliceId, "GC");

    // Bob spent his Gold Coins elsewhere between betting and the spin.
    await prisma.balance.update({ where: { userId: bobId }, data: { goldCoins: 0 } });

    const outcome = await settleTableRound("round-3", 7, [
      result(aliceId, alice.username, "red", 20, true, 40),
      result(bobId, bob.username, "red", 20, true, 40)
    ]);

    // Alice is paid in full. This is the property a single table-wide
    // transaction would break.
    expect(await getBalance(prisma, aliceId, "GC")).toBe(aliceBefore + 20);
    expect(outcome.voidedUserIds).toEqual([bobId]);

    // Bob's round did not happen: nothing debited, nothing paid.
    expect(await getBalance(prisma, bobId, "GC")).toBe(0);
    expect(await prisma.transaction.count({ where: { userId: bobId, type: "WAGER_GC" } })).toBe(0);
  });

  it("reports a voided bet as a loss in the results it hands back for broadcast", async () => {
    const user = await signupUser();
    const userId = await currentUserId(user.username);
    await prisma.balance.update({ where: { userId }, data: { goldCoins: 0 } });

    const outcome = await settleTableRound("round-4", 7, [
      result(userId, user.username, "red", 20, true, 40)
    ]);

    // A player must never read "you won 40" for a round they were not paid.
    expect(outcome.settled[0]).toMatchObject({ voided: true, won: false, payout: 0 });
  });

  it("records the round as roulette activity, so the live table counts toward challenges", async () => {
    const user = await signupUser();
    const userId = await currentUserId(user.username);

    await settleTableRound("round-5", 7, [result(userId, user.username, "red", 20, true, 40)]);

    const wager = await prisma.transaction.findFirst({
      where: { userId, type: "WAGER_GC" },
      orderBy: { createdAt: "desc" }
    });
    // Same game name as the solo route, plus table metadata - the two modes
    // share a bucket because they are the same wheel.
    expect(wager?.meta).toMatchObject({ game: "roulette", table: true, roundId: "round-5" });
  });

  it("does nothing at all for a round with no bets", async () => {
    const outcome = await settleTableRound("round-6", 7, []);
    expect(outcome).toEqual({ voidedUserIds: [], settled: [] });
  });
});

function result(
  userId: string,
  username: string,
  choice: "red" | "black" | "green",
  amount: number,
  won: boolean,
  payout: number
): TableResult {
  return { userId, username, choice, amount, won, payout };
}

async function currentUserId(username: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error(`no user ${username}`);
  return user.id;
}
