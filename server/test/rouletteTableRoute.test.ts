/**
 * The live Roulette table's money paths, against the real HTTP API and the
 * real database.
 *
 * Two halves, deliberately separated from the round loop's own unit tests
 * (rouletteTable.test.ts, which uses a fake clock and no database):
 *
 * - `POST /games/roulette/table/bet` — the only door a bet comes in
 *   through, and therefore where every "can this player do this?" question
 *   is answered. Since servers landed, that includes "are they even sitting
 *   at this table?", which is answered from presence rather than from the
 *   request body.
 * - `settleTableRound` — the only Roulette code that moves a balance.
 *   Driven directly rather than through a WebSocket and a 12-second betting
 *   window, which is exactly why it was split out of the socket adapter.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { RouletteTable } from "../src/realtime/rouletteTable";
import { gameServers } from "../src/realtime/gameServers";
import { presenceHub } from "../src/realtime/presence";
import { ROOM_ROULETTE, TableResult, roomKey } from "../src/realtime/protocol";
import { settleTableRound } from "../src/realtime/tableSettlement";
import { getBalance } from "../src/economy/ledger";
import { BET_MAX, BET_MIN } from "../src/games/shared";
import { resetDb, signupUser, authed } from "./helpers";

/** One of the seeded public servers - see realtime/gameServers.ts. */
const SERVER_ID = "boardwalk";

let table: RouletteTable;

beforeEach(async () => {
  await resetDb();
  // Servers and presence are process-global in-memory state, so each test
  // starts from a clean slate rather than inheriting the last one's seats.
  gameServers.reset();
  presenceHub.clear();
  table = gameServers.get(SERVER_ID)!.roulette;
  table.start();
});

afterEach(() => {
  table.stop();
  presenceHub.clear();
});

/**
 * Signs up a player and sits them at the server's Roulette table, which is
 * what the socket would normally do on `{t:"room", room:"roulette"}`. The
 * bet route reads presence to decide which server's wheel a bet belongs to,
 * so without this a bet is correctly refused.
 */
async function seatedPlayer(username?: string) {
  const user = await signupUser(username ? { username } : undefined);
  const row = await prisma.user.findUnique({ where: { username: user.username } });
  const userId = row!.id;
  presenceHub.enter(roomKey(SERVER_ID, ROOM_ROULETTE), {
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

function bet(token: string, body: object) {
  return request(app).post("/games/roulette/table/bet").set(authed(token)).send(body);
}

describe("POST /games/roulette/table/bet", () => {
  it("accepts a bet from a seated player and returns the table with it on", async () => {
    const user = await seatedPlayer("alice_table");

    const res = await bet(user.token, { betAmount: 25, bet: "red" });

    expect(res.status).toBe(200);
    expect(res.body.bet).toMatchObject({ username: "alice_table", choice: "red", amount: 25 });
    expect(res.body.table.phase).toBe("betting");
    expect(res.body.table.bets).toHaveLength(1);
  });

  it("refuses a bet from someone who isn't sitting at the table", async () => {
    // The trust boundary: which server's wheel a bet lands on comes from
    // presence, never from the caller. A player who isn't seated has no
    // table to bet on, and cannot name one.
    const user = await signupUser();

    const res = await bet(user.token, { betAmount: 25, bet: "red" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_AT_TABLE");
    expect(table.snapshot().bets).toEqual([]);
  });

  it("puts the bet on the table of the server the player is actually on", async () => {
    const user = await signupUser();
    const row = await prisma.user.findUnique({ where: { username: user.username } });
    const other = gameServers.get("sunset")!;
    other.roulette.start();
    presenceHub.enter(roomKey("sunset", ROOM_ROULETTE), {
      id: row!.id,
      username: user.username,
      x: 0,
      y: 0,
      dir: "down",
      moving: false,
      wardrobe: {}
    });

    await bet(user.token, { betAmount: 25, bet: "red" });

    // Their bet belongs to Sunset's wheel and must not appear on the
    // Boardwalk one - two servers are two independent games.
    expect(other.roulette.snapshot().bets).toHaveLength(1);
    expect(table.snapshot().bets).toEqual([]);
    other.roulette.stop();
  });

  it("does NOT debit the balance when the bet is placed", async () => {
    const user = await seatedPlayer();
    const before = await getBalance(prisma, user.userId, "GC");

    await bet(user.token, { betAmount: 25, bet: "red" });

    // The whole round settles atomically at spin time - see
    // realtime/rouletteTable.ts's header. A debit here would be a stake
    // that a process restart could strand.
    expect(await getBalance(prisma, user.userId, "GC")).toBe(before);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/games/roulette/table/bet")
      .send({ betAmount: 25, bet: "red" });
    expect(res.status).toBe(401);
  });

  it("rejects a bet the player can't afford", async () => {
    const user = await seatedPlayer();
    await prisma.balance.update({ where: { userId: user.userId }, data: { goldCoins: 0 } });

    const res = await bet(user.token, { betAmount: BET_MIN, bet: "red" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_BALANCE");
    expect(table.snapshot().bets).toEqual([]);
  });

  it("rejects a second bet on the same round", async () => {
    const user = await seatedPlayer();
    await bet(user.token, { betAmount: 25, bet: "red" });

    const res = await bet(user.token, { betAmount: 25, bet: "black" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_BET");
    expect(table.snapshot().bets).toHaveLength(1);
  });

  it("rejects an out-of-range or non-integer stake", async () => {
    const user = await seatedPlayer();

    expect((await bet(user.token, { betAmount: BET_MIN - 1, bet: "red" })).status).toBe(400);
    expect((await bet(user.token, { betAmount: BET_MAX + 1, bet: "red" })).status).toBe(400);
    expect((await bet(user.token, { betAmount: 12.5, bet: "red" })).status).toBe(400);
    expect(table.snapshot().bets).toEqual([]);
  });

  it("rejects a colour that isn't on the wheel", async () => {
    const user = await seatedPlayer();
    const res = await bet(user.token, { betAmount: 25, bet: "purple" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("refuses bets when the table isn't running", async () => {
    const user = await seatedPlayer();
    // Simulates a server whose tables were stopped because it emptied out.
    table.stop();

    const res = await bet(user.token, { betAmount: 25, bet: "red" });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("TABLE_CLOSED");
  });

  it("keeps several players' bets on the same round", async () => {
    const alice = await seatedPlayer("alice_multi");
    const bob = await seatedPlayer("bob_multi");

    await bet(alice.token, { betAmount: 25, bet: "red" });
    await bet(bob.token, { betAmount: 50, bet: "black" });

    expect(table.snapshot().bets.map((b) => b.username).sort()).toEqual([
      "alice_multi",
      "bob_multi"
    ]);
  });
});

describe("GET /games/roulette/table", () => {
  it("returns the table of the server the player is on", async () => {
    const user = await seatedPlayer();
    const res = await request(app).get("/games/roulette/table").set(authed(user.token));

    expect(res.status).toBe(200);
    expect(res.body.running).toBe(true);
    expect(res.body.table.phase).toBe("betting");
    expect(res.body.table.msRemaining).toBeGreaterThan(0);
  });

  it("reports no table for a player who isn't sitting at one", async () => {
    const user = await signupUser();
    const res = await request(app).get("/games/roulette/table").set(authed(user.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ running: false, table: null });
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/games/roulette/table")).status).toBe(401);
  });
});

describe("settleTableRound", () => {
  it("debits the stake and credits the win, in the same shape as a solo round", async () => {
    const user = await seatedPlayer();
    const before = await getBalance(prisma, user.userId, "GC");

    await settleTableRound("round-1", 7, [result(user.userId, user.username, "red", 20, true, 40)]);

    // Wagered 20, won 40 back: net +20.
    expect(await getBalance(prisma, user.userId, "GC")).toBe(before + 20);

    const types = (
      await prisma.transaction.findMany({ where: { userId: user.userId } })
    ).map((t) => t.type);
    expect(types).toContain("WAGER_GC");
    expect(types).toContain("GAME_WIN_GC");
  });

  it("debits the stake and pays nothing on a loss", async () => {
    const user = await seatedPlayer();
    const before = await getBalance(prisma, user.userId, "GC");

    await settleTableRound("round-2", 8, [result(user.userId, user.username, "red", 20, false, 0)]);

    expect(await getBalance(prisma, user.userId, "GC")).toBe(before - 20);
  });

  it("settles every player independently - one bad bet doesn't roll back the others", async () => {
    const alice = await seatedPlayer("alice_settle");
    const bob = await seatedPlayer("bob_settle");
    const aliceBefore = await getBalance(prisma, alice.userId, "GC");

    // Bob spent his Gold Coins elsewhere between betting and the spin.
    await prisma.balance.update({ where: { userId: bob.userId }, data: { goldCoins: 0 } });

    const outcome = await settleTableRound("round-3", 7, [
      result(alice.userId, alice.username, "red", 20, true, 40),
      result(bob.userId, bob.username, "red", 20, true, 40)
    ]);

    // Alice is paid in full. This is the property a single table-wide
    // transaction would break.
    expect(await getBalance(prisma, alice.userId, "GC")).toBe(aliceBefore + 20);
    expect(outcome.voidedUserIds).toEqual([bob.userId]);

    // Bob's round did not happen: nothing debited, nothing paid.
    expect(await getBalance(prisma, bob.userId, "GC")).toBe(0);
    expect(await prisma.transaction.count({ where: { userId: bob.userId, type: "WAGER_GC" } })).toBe(0);
  });

  it("reports a voided bet as a loss in the results it hands back for broadcast", async () => {
    const user = await seatedPlayer();
    await prisma.balance.update({ where: { userId: user.userId }, data: { goldCoins: 0 } });

    const outcome = await settleTableRound("round-4", 7, [
      result(user.userId, user.username, "red", 20, true, 40)
    ]);

    // A player must never read "you won 40" for a round they were not paid.
    expect(outcome.settled[0]).toMatchObject({ voided: true, won: false, payout: 0 });
  });

  it("records the round as roulette activity, so the live table counts toward challenges", async () => {
    const user = await seatedPlayer();

    await settleTableRound("round-5", 7, [result(user.userId, user.username, "red", 20, true, 40)]);

    const wager = await prisma.transaction.findFirst({
      where: { userId: user.userId, type: "WAGER_GC" },
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
