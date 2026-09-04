/**
 * The live Blackjack table's money paths, against the real HTTP API and the
 * real database.
 *
 * The round loop's own logic is covered without a database in
 * blackjackTable.test.ts. What this file covers is everything that only
 * exists once the route and the ledger are involved:
 *
 * - who is allowed to bet and act (including the turn rule, which is the
 *   one place a player could otherwise play someone else's hand);
 * - that the ledger moves by exactly the right amount for a win, a loss and
 *   a push;
 * - that one seat that cannot pay does not roll back everyone else's.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { BETTING_MS, BlackjackTable, DEALING_MS } from "../src/realtime/blackjackTable";
import { gameServers } from "../src/realtime/gameServers";
import { presenceHub } from "../src/realtime/presence";
import { BlackjackSeat, ROOM_BLACKJACK, roomKey } from "../src/realtime/protocol";
import { settleBlackjackRound } from "../src/realtime/blackjackSettlement";
import { getBalance } from "../src/economy/ledger";
import { BET_MAX, BET_MIN } from "../src/games/shared";
import { resetDb, signupUser, authed } from "./helpers";

const SERVER_ID = "boardwalk";

let table: BlackjackTable;

beforeEach(async () => {
  await resetDb();
  gameServers.reset();
  presenceHub.clear();
  table = gameServers.get(SERVER_ID)!.blackjack;
  // Started on an explicit clock so tests can step the round precisely.
  // Jumping far ahead instead would run through the whole hand and out the
  // other side into a fresh betting round.
  table.start(0);
});

afterEach(() => {
  table.stop();
  presenceHub.clear();
});

/** Signs a player up and sits them at the server's Blackjack table, as the socket would. */
async function seatedPlayer(username?: string) {
  const user = await signupUser(username ? { username } : undefined);
  const row = await prisma.user.findUnique({ where: { username: user.username } });
  const userId = row!.id;
  presenceHub.enter(roomKey(SERVER_ID, ROOM_BLACKJACK), {
    id: userId,
    username: user.username,
    x: 0,
    y: 0,
    dir: "down",
    moving: false,
    wardrobe: {}
  });
  return { ...user, userId };
}

const bet = (token: string, body: object) =>
  request(app).post("/games/blackjack/table/bet").set(authed(token)).send(body);

const action = (token: string, body: object) =>
  request(app).post("/games/blackjack/table/action").set(authed(token)).send(body);

describe("POST /games/blackjack/table/bet", () => {
  it("seats a player who is at the table", async () => {
    const user = await seatedPlayer("bj_alice");

    const res = await bet(user.token, { betAmount: 25 });

    expect(res.status).toBe(200);
    expect(res.body.table.seats).toMatchObject([{ username: "bj_alice", bet: 25 }]);
  });

  it("refuses a bet from someone not sitting at the table", async () => {
    const user = await signupUser();

    const res = await bet(user.token, { betAmount: 25 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_AT_TABLE");
    expect(table.snapshot().seats).toEqual([]);
  });

  it("does NOT debit the balance when the bet is placed", async () => {
    const user = await seatedPlayer();
    const before = await getBalance(prisma, user.userId, "GC");

    await bet(user.token, { betAmount: 25 });

    // The whole hand settles in one transaction when it ends, so a restart
    // mid-hand cannot strand a stake.
    expect(await getBalance(prisma, user.userId, "GC")).toBe(before);
  });

  it("rejects a bet the player can't afford", async () => {
    const user = await seatedPlayer();
    await prisma.balance.update({ where: { userId: user.userId }, data: { goldCoins: 0 } });

    const res = await bet(user.token, { betAmount: BET_MIN });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("rejects taking a second seat in the same hand", async () => {
    const user = await seatedPlayer();
    await bet(user.token, { betAmount: 25 });

    const res = await bet(user.token, { betAmount: 25 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_SEATED");
  });

  it("rejects an out-of-range stake", async () => {
    const user = await seatedPlayer();
    expect((await bet(user.token, { betAmount: BET_MIN - 1 })).status).toBe(400);
    expect((await bet(user.token, { betAmount: BET_MAX + 1 })).status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await request(app).post("/games/blackjack/table/bet").send({ betAmount: 25 })).status).toBe(401);
  });
});

describe("POST /games/blackjack/table/action", () => {
  it("refuses an action from someone not at the table", async () => {
    const user = await signupUser();
    const res = await action(user.token, { action: "hit" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_AT_TABLE");
  });

  it("refuses an action while betting is still open", async () => {
    const user = await seatedPlayer();
    await bet(user.token, { betAmount: 25 });

    const res = await action(user.token, { action: "hit" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_ACTING");
  });

  it("refuses an action from a player whose turn it is not", async () => {
    const alice = await seatedPlayer("bj_turn_a");
    const bob = await seatedPlayer("bj_turn_b");
    await bet(alice.token, { betAmount: 25 });
    await bet(bob.token, { betAmount: 25 });

    // Deal, then hand the turn to whoever is first.
    table.advance(BETTING_MS + DEALING_MS);
    const activeUserId = table.snapshot().activeUserId;
    const waiting = activeUserId === alice.userId ? bob : alice;

    const res = await action(waiting.token, { action: "hit" });

    // The one place a player could otherwise play someone else's hand -
    // which would cost THEM real Gold Coins.
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_YOUR_TURN");
  });

  it("lets the active player stand, and passes the turn on", async () => {
    const alice = await seatedPlayer("bj_act_a");
    const bob = await seatedPlayer("bj_act_b");
    await bet(alice.token, { betAmount: 25 });
    await bet(bob.token, { betAmount: 25 });
    table.advance(BETTING_MS + DEALING_MS);

    const activeUserId = table.snapshot().activeUserId!;
    const acting = activeUserId === alice.userId ? alice : bob;

    const res = await action(acting.token, { action: "stand" });

    expect(res.status).toBe(200);
    expect(res.body.table.seats.find((s: BlackjackSeat) => s.userId === activeUserId).status).toBe("stood");
  });

  it("rejects an action that isn't hit or stand", async () => {
    const user = await seatedPlayer();
    const res = await action(user.token, { action: "split" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });
});

describe("GET /games/blackjack/table", () => {
  it("returns the table of the server the player is at", async () => {
    const user = await seatedPlayer();
    const res = await request(app).get("/games/blackjack/table").set(authed(user.token));

    expect(res.status).toBe(200);
    expect(res.body.running).toBe(true);
    expect(res.body.table.phase).toBe("betting");
  });

  it("reports no table for a player who isn't at one", async () => {
    const user = await signupUser();
    const res = await request(app).get("/games/blackjack/table").set(authed(user.token));
    expect(res.body).toEqual({ running: false, table: null });
  });
});

describe("settleBlackjackRound", () => {
  it("debits the stake and credits a win", async () => {
    const user = await seatedPlayer();
    const before = await getBalance(prisma, user.userId, "GC");

    await settleBlackjackRound("bj-1", [seat(user.userId, user.username, 20, "win", 40)]);

    // Wagered 20, won 40 back: net +20.
    expect(await getBalance(prisma, user.userId, "GC")).toBe(before + 20);
  });

  it("debits the stake and pays nothing on a loss", async () => {
    const user = await seatedPlayer();
    const before = await getBalance(prisma, user.userId, "GC");

    await settleBlackjackRound("bj-2", [seat(user.userId, user.username, 20, "lose", 0)]);

    expect(await getBalance(prisma, user.userId, "GC")).toBe(before - 20);
  });

  it("nets to zero on a push, but still writes both ledger legs", async () => {
    const user = await seatedPlayer();
    const before = await getBalance(prisma, user.userId, "GC");

    await settleBlackjackRound("bj-3", [seat(user.userId, user.username, 20, "push", 20)]);

    expect(await getBalance(prisma, user.userId, "GC")).toBe(before);
    // A hand that was played and returned is not the same as a hand that
    // never happened, and the audit trail should be able to tell them apart.
    const types = (await prisma.transaction.findMany({ where: { userId: user.userId } })).map((t) => t.type);
    expect(types).toContain("WAGER_GC");
    expect(types).toContain("GAME_WIN_GC");
  });

  it("settles each seat independently - one that can't pay doesn't roll back the rest", async () => {
    const alice = await seatedPlayer("bj_settle_a");
    const bob = await seatedPlayer("bj_settle_b");
    const aliceBefore = await getBalance(prisma, alice.userId, "GC");
    await prisma.balance.update({ where: { userId: bob.userId }, data: { goldCoins: 0 } });

    const outcome = await settleBlackjackRound("bj-4", [
      seat(alice.userId, alice.username, 20, "win", 40),
      seat(bob.userId, bob.username, 20, "win", 40)
    ]);

    expect(await getBalance(prisma, alice.userId, "GC")).toBe(aliceBefore + 20);
    expect(outcome.voidedUserIds).toEqual([bob.userId]);
    expect(await getBalance(prisma, bob.userId, "GC")).toBe(0);
    expect(await prisma.transaction.count({ where: { userId: bob.userId, type: "WAGER_GC" } })).toBe(0);
  });

  it("reports a voided seat as a loss for broadcast", async () => {
    const user = await seatedPlayer();
    await prisma.balance.update({ where: { userId: user.userId }, data: { goldCoins: 0 } });

    const outcome = await settleBlackjackRound("bj-5", [seat(user.userId, user.username, 20, "win", 40)]);

    // Never report a win that was not paid.
    expect(outcome.settled[0]).toMatchObject({ voided: true, outcome: "lose", payout: 0 });
  });

  it("records the hand as blackjack activity, so the live table counts toward challenges", async () => {
    const user = await seatedPlayer();

    await settleBlackjackRound("bj-6", [seat(user.userId, user.username, 20, "win", 40)]);

    const wager = await prisma.transaction.findFirst({
      where: { userId: user.userId, type: "WAGER_GC" },
      orderBy: { createdAt: "desc" }
    });
    expect(wager?.meta).toMatchObject({ game: "blackjack", table: true, roundId: "bj-6" });
  });
});

function seat(
  userId: string,
  username: string,
  betAmount: number,
  outcome: "win" | "push" | "lose",
  payout: number
): BlackjackSeat {
  return {
    userId,
    username,
    bet: betAmount,
    hand: [10, 10],
    total: 20,
    status: "stood",
    outcome,
    payout
  };
}
