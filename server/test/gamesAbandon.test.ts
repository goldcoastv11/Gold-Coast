/**
 * #42: POST /games/abandon - fixes the soft-lock where a WALK AWAY click,
 * or a crash/refresh mid-round, left a user permanently stuck getting
 * ROUND_ALREADY_ACTIVE from every stateful game's `start` endpoint with no
 * way to close the stuck round out.
 */

import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, signupUser, authed } from "./helpers";

beforeEach(resetDb);

describe("POST /games/abandon", () => {
  it("forfeits the active round (no refund) and closes it out so a new round can start", async () => {
    const { token } = await signupUser();

    const start = await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 20, currency: "GC" });
    expect(start.status).toBe(200);
    const afterStart = await request(app).get("/me").set(authed(token));
    expect(afterStart.body.goldCoins).toBe(start.body.user.goldCoins); // sanity: bet already debited

    const abandon = await request(app).post("/games/abandon").set(authed(token)).send({});

    expect(abandon.status).toBe(200);
    expect(abandon.body.forfeited).toBe(true);
    expect(abandon.body.game).toBe("mines");
    expect(abandon.body.roundId).toBe(start.body.roundId);
    expect(abandon.body.betAmount).toBe(20);
    expect(abandon.body.currency).toBe("GC");

    // No refund - balance unchanged from right after the bet was debited at start.
    expect(abandon.body.user.goldCoins).toBe(afterStart.body.goldCoins);

    // The soft-lock is actually gone: a brand new round can start immediately.
    const restart = await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });
    expect(restart.status).toBe(200);
  });

  it("reproduces and fixes the original soft-lock across DIFFERENT games (one active round is global per user, not per-game)", async () => {
    const { token } = await signupUser();

    const start = await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });
    expect(start.status).toBe(200);

    // Without abandon, starting ANY other stateful game 409s - this is the bug.
    const blocked = await request(app)
      .post("/games/dragontower/start")
      .set(authed(token))
      .send({ betAmount: 10, currency: "GC" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("ROUND_ALREADY_ACTIVE");

    // Abandon doesn't need to be told which game/round - it just works.
    const abandon = await request(app).post("/games/abandon").set(authed(token)).send({});
    expect(abandon.status).toBe(200);
    expect(abandon.body.game).toBe("mines");

    const unblocked = await request(app)
      .post("/games/dragontower/start")
      .set(authed(token))
      .send({ betAmount: 10, currency: "GC" });
    expect(unblocked.status).toBe(200);
  });

  it("returns 404 NO_ACTIVE_ROUND when there is nothing to abandon", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/games/abandon").set(authed(token)).send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NO_ACTIVE_ROUND");
  });

  it("is idempotent - a second abandon call after the first has nothing left to do", async () => {
    const { token } = await signupUser();
    await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });

    const first = await request(app).post("/games/abandon").set(authed(token)).send({});
    expect(first.status).toBe(200);

    const second = await request(app).post("/games/abandon").set(authed(token)).send({});
    expect(second.status).toBe(404);
    expect(second.body.code).toBe("NO_ACTIVE_ROUND");
  });

  it("does not touch another user's active round", async () => {
    const alice = await signupUser();
    const bob = await signupUser();

    await request(app).post("/games/mines/start").set(authed(alice.token)).send({ betAmount: 10, currency: "GC" });

    const bobAbandon = await request(app).post("/games/abandon").set(authed(bob.token)).send({});
    expect(bobAbandon.status).toBe(404);

    // Alice's round is still there and still active.
    const aliceMe = await request(app).get("/me").set(authed(alice.token));
    expect(aliceMe.body.activeRound).not.toBeNull();
    expect(aliceMe.body.activeRound.game).toBe("mines");
  });

  it("actually closes the round row (status is no longer 'active') rather than just returning a nice response", async () => {
    const { token, username } = await signupUser();
    const start = await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });

    await request(app).post("/games/abandon").set(authed(token)).send({});

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const round = await prisma.gameRound.findUniqueOrThrow({ where: { id: start.body.roundId } });
    expect(round.userId).toBe(user.id);
    expect(round.status).not.toBe("active");
  });

  it("does not create any extra ledger transaction - the original wager debit is the only record of the loss", async () => {
    const { token, username } = await signupUser();
    await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 15, currency: "GC" });
    await request(app).post("/games/abandon").set(authed(token)).send({});

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const txs = await prisma.transaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    const gameTxs = txs.filter((t) => t.type === "WAGER_GC" || t.type === "PAYOUT_GC");
    expect(gameTxs).toHaveLength(1);
    expect(gameTxs[0].type).toBe("WAGER_GC");
    expect(gameTxs[0].amount).toBe(-15);
  });

  it("requires auth", async () => {
    const res = await request(app).post("/games/abandon").send({});
    expect(res.status).toBe(401);
  });
});

describe("GET /me activeRound field", () => {
  it("is null with no active round", async () => {
    const { token } = await signupUser();
    const res = await request(app).get("/me").set(authed(token));
    expect(res.body.activeRound).toBeNull();
  });

  it("surfaces {game, roundId} while a round is active, and goes back to null after resolution", async () => {
    const { token } = await signupUser();
    const start = await request(app).post("/games/hilo/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });

    const during = await request(app).get("/me").set(authed(token));
    expect(during.body.activeRound).toEqual({ game: "hilo", roundId: start.body.roundId });

    await request(app).post("/games/abandon").set(authed(token)).send({});

    const after = await request(app).get("/me").set(authed(token));
    expect(after.body.activeRound).toBeNull();
  });

  it("is exactly what a client needs to recover from a lost roundId (reload/crash/401-relogin) without any other state", async () => {
    const { token } = await signupUser();
    await request(app).post("/games/dragontower/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });

    // Simulate "client lost everything except its JWT" - re-fetch /me cold and
    // recover purely from that.
    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.activeRound.game).toBe("dragontower");

    const abandon = await request(app).post("/games/abandon").set(authed(token)).send({});
    expect(abandon.status).toBe(200);
    expect(abandon.body.roundId).toBe(me.body.activeRound.roundId);
  });
});
