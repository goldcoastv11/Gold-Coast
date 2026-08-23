import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { applyTransaction } from "../src/economy/ledger";
import { resetDb, signupUser, authed } from "./helpers";
import { TRIPLE_CHANCE_MIN_AMOUNT, TRIPLE_CHANCE_MAX_AMOUNT } from "../src/games/triplechance";

beforeEach(resetDb);

/**
 * Tops up `username`'s GC balance via the real ledger (ADJUST_GC - the one
 * TransactionType that, unlike ADJUST_SC, is allowed to credit - see
 * economy/ledger.ts's applyTransaction doc comment), so a test can give
 * itself a bankroll far beyond anything a real 1200-trial random walk could
 * plausibly reach, rather than a raw/bypassing-the-ledger balance write.
 */
async function topUpGold(username: string, amount: number): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.$transaction((tx) => applyTransaction(tx, user.id, "GC", "ADJUST_GC", amount, { reason: "test bankroll top-up" }));
}

describe("POST /games/triplechance/play (#46 - bonus round after a shuffle-cup GC win)", () => {
  it("a win pays exactly 3x and a loss pays exactly 0x, settled in one request", async () => {
    const { token, username } = await signupUser();
    // Same class of bug the RTP test below already guards against: a driftless
    // 0%-edge random walk can plausibly exhaust a small starting balance before
    // both outcomes are observed (e.g. several losing streaks in a row on a low
    // starting grant). Top up via the real ledger so up to 60 rounds at 100 GC
    // never hits insufficient-balance regardless of streak luck.
    await topUpGold(username, 10_000);

    // Single-shot, stateless - just play repeatedly against the same
    // account until both outcomes have been observed at least once (1/3 vs
    // 2/3 odds - a handful of attempts is more than enough either way).
    let sawWin = false;
    let sawLoss = false;
    for (let i = 0; i < 60 && !(sawWin && sawLoss); i++) {
      const before = await request(app).get("/me").set(authed(token));
      const res = await request(app).post("/games/triplechance/play").set(authed(token)).send({ betAmount: 100 });

      expect(res.status).toBe(200);
      if (res.body.result.won) {
        sawWin = true;
        expect(res.body.result.multiplier).toBe(3);
        expect(res.body.result.payout).toBe(300);
        expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 100 + 300);
      } else {
        sawLoss = true;
        expect(res.body.result.multiplier).toBe(0);
        expect(res.body.result.payout).toBe(0);
        expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 100);
      }
      // Never touches TICKETS in any way, win or lose - Triple Chance is
      // GC-in/GC-out, chained onto the Coin Kiosk's shuffle-cup GC win, not
      // one of the TICKETS-paying games.
      expect(res.body.user.tickets).toBe(before.body.tickets);
    }

    expect(sawWin).toBe(true);
    expect(sawLoss).toBe(true);
  });

  it("real RTP (probability-weighted, not the formula's own assumption) is exactly 100% within statistical tolerance - deliberately 0% house edge, unlike every wager-driven game", async () => {
    const { token, username } = await signupUser();
    const betAmount = 50;
    const trials = 1200;
    let totalWagered = 0;
    let totalPaidOut = 0;

    // #46 (QA-found regression): Triple Chance is a real 0%-house-edge game
    // - a driftless random walk, not one shaved toward the house like every
    // other game here - so a fixed-size loop racing a FINITE starting
    // balance (500/1000/2000 GC from signup's shuffle-cup) genuinely CAN
    // and did hit insolvency well before `trials` iterations (observed:
    // 0.545 instead of >0.8), invalidating the "stop early is negligible"
    // assumption a house-edged game's equivalent test can safely make (see
    // Dice's "lands close to target win rate" test, which stops early on
    // insufficient balance too - but Dice's negative edge makes an early
    // bust vanishingly rare and, even if it happened, wouldn't skew the win
    // rate). Top up via the real ledger first so this test's bankroll is
    // ~100,000 SDs above the walk's plausible range over `trials` @
    // `betAmount` (SD per trial ~= betAmount*sqrt(2) ~= 70.7, SD of the
    // trials-long sum ~= 70.7*sqrt(1200) ~= 2449) - the loop can still stop
    // early in principle, it just won't in practice.
    await topUpGold(username, 5_000_000);

    for (let i = 0; i < trials; i++) {
      const res = await request(app).post("/games/triplechance/play").set(authed(token)).send({ betAmount });
      // Balance can't go negative - stop early if it ever would rather than asserting on a 400 (matches Dice's equivalent test), though the top-up above should make this unreachable in practice.
      if (res.status !== 200) break;
      totalWagered += betAmount;
      totalPaidOut += res.body.result.payout;
    }

    const realRtp = totalPaidOut / totalWagered;
    // Per-trial multiplier is 3 w.p. 1/3, 0 w.p. 2/3 - mean 1.0, variance 2,
    // so SD of the mean over `trials` iid trials is sqrt(2/trials) ~= 0.041
    // at trials=1200. +-20% is ~5 SD - astronomically unlikely to flake, but
    // tight enough that a regression back to "equal-share-without-capping"-
    // style breakage (which skewed Keno's RTP by 12-27 points, #45) would
    // still fail this immediately.
    expect(realRtp).toBeGreaterThan(0.8);
    expect(realRtp).toBeLessThan(1.2);
  });

  it("chains cleanly: wagering the previous round's payout works exactly like any other bet", async () => {
    const { token } = await signupUser();

    // Simulate the client's "Triple Chance again?" chain: bet 500 (typical
    // shuffle-cup grant), and if it wins, immediately wager the tripled
    // amount again. Nothing server-side needs to know this is a chain - a
    // chained bet is just an ordinary bet whose amount happens to be the
    // previous payout, single-shot and stateless like any other.
    let amount = 500;
    for (let round = 0; round < 5; round++) {
      const res = await request(app).post("/games/triplechance/play").set(authed(token)).send({ betAmount: amount });
      expect(res.status).toBe(200);
      if (!res.body.result.won) break;
      expect(res.body.result.payout).toBe(amount * 3);
      amount = res.body.result.payout;
    }
  });

  it("rejects an amount below the minimum", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/games/triplechance/play")
      .set(authed(token))
      .send({ betAmount: TRIPLE_CHANCE_MIN_AMOUNT - 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("rejects an amount above the maximum", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/games/triplechance/play")
      .set(authed(token))
      .send({ betAmount: TRIPLE_CHANCE_MAX_AMOUNT + 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("rejects wagering more GC than the player actually has", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app)
      .post("/games/triplechance/play")
      .set(authed(token))
      .send({ betAmount: before.body.goldCoins + 1000 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("ignores any client-supplied currency field - always settles in GC", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    // Even if a client tried to sneak a currency field through, the route
    // never reads it - Triple Chance always settles GC-in/GC-out.
    const res = await request(app)
      .post("/games/triplechance/play")
      .set(authed(token))
      .send({ betAmount: 100, currency: "SC" });

    expect(res.status).toBe(200);
    expect(res.body.user.tickets).toBe(before.body.tickets);
    const expectedGold = res.body.result.won ? before.body.goldCoins + 200 : before.body.goldCoins - 100;
    expect(res.body.user.goldCoins).toBe(expectedGold);
  });

  it("requires auth", async () => {
    const res = await request(app).post("/games/triplechance/play").send({ betAmount: 500 });
    expect(res.status).toBe(401);
  });
});
