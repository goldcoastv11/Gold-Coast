import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { applyTransaction } from "../src/economy/ledger";
import { resetDb, signupUser, authed } from "./helpers";
import { diceMultiplier } from "../src/games/dice";
import { minesMultiplier, MINES_COUNT, MINES_TOTAL_TILES } from "../src/games/mines";

beforeEach(resetDb);

/**
 * GC is spent on every play regardless of win/lose, and (as of the
 * 2026-08-29 GC-only economy restructure) a win pays GC straight back too -
 * but a loss still nets out negative, so a fixed-size trial loop genuinely
 * can and does exhaust a fresh signup's finite GC balance well before
 * finishing, the same class of bug games5.test.ts's `topUpGold` already
 * guards against for Triple Chance. Seed a bankroll via the real ledger
 * (ADJUST_GC) so a long probabilistic trial loop can actually run to
 * completion.
 */
async function topUpGold(username: string, amount: number): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.$transaction((tx) => applyTransaction(tx, user.id, "GC", "ADJUST_GC", amount, { reason: "test bankroll top-up" }));
}

describe("POST /games/dice/play (single-shot reference)", () => {
  it("resolves a round in one request: always debits the GC wager, credits GC back only on a win, matches the published multiplier formula", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app)
      .post("/games/dice/play")
      .set(authed(token))
      .send({ betAmount: 10, target: 50 });

    expect(res.status).toBe(200);
    expect(res.body.result.target).toBe(50);
    expect(res.body.result.multiplier).toBe(diceMultiplier(50));
    expect(res.body.result.roll).toBeGreaterThanOrEqual(0);
    expect(res.body.result.roll).toBeLessThanOrEqual(99);

    // TICKETS is retired - never moves, regardless of outcome.
    expect(res.body.user.tickets).toBe(before.body.tickets);

    const won = res.body.result.roll < 50;
    expect(res.body.result.won).toBe(won);
    if (won) {
      expect(res.body.result.payout).toBe(Math.round(10 * diceMultiplier(50)));
      // The GC wager is always spent first, then a win pays GC straight
      // back - net effect is `-bet +payout`, not just `-bet`.
      expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
    } else {
      expect(res.body.result.payout).toBe(0);
      // A loss nets out to just the wager - it's a play token, not a stake.
      expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10);
    }
  });

  it("lands close to the target win rate over many rounds (probabilistic, not a single deterministic check)", async () => {
    const { token, username } = await signupUser();
    await topUpGold(username, 10_000); // GC is spent every play now, win or lose - needs a real bankroll for 300 trials.
    const target = 50;
    const trials = 300;
    let wins = 0;
    for (let i = 0; i < trials; i++) {
      const res = await request(app)
        .post("/games/dice/play")
        .set(authed(token))
        .send({ betAmount: 5, target });
      // Balance may run out partway through (that's fine/expected) - stop early rather than asserting on a 400.
      if (res.status !== 200) break;
      if (res.body.result.won) wins++;
    }
    // 300 trials at p=0.5 has a standard deviation of ~8.7; allow a generous band.
    expect(wins).toBeGreaterThan(100);
    expect(wins).toBeLessThan(200);
  });

  it("rejects a bet the player can't afford in GC", async () => {
    const { token, username } = await signupUser();

    // Drain to exactly 0 through the real ledger rather than by betting it
    // down. Under the single-currency model a game pays GC back on a win, so
    // betting no longer monotonically reduces the balance - the old
    // drain-by-betting loop could run indefinitely (and did, timing out at
    // 30s) because wins kept topping it back up. ADJUST_GC is the sanctioned
    // test-only balance path, same as games5.test.ts's topUpGold.
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const before = await request(app).get("/me").set(authed(token));
    await prisma.$transaction((tx) =>
      applyTransaction(tx, user.id, "GC", "ADJUST_GC", -before.body.goldCoins, { reason: "test: drain to zero" })
    );

    const res = await request(app).post("/games/dice/play").set(authed(token)).send({ betAmount: 5, target: 50 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("rejects an out-of-range target", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/games/dice/play")
      .set(authed(token))
      .send({ betAmount: 10, target: 3 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("requires auth", async () => {
    const res = await request(app).post("/games/dice/play").send({ betAmount: 10, target: 50 });
    expect(res.status).toBe(401);
  });
});

describe("POST /games/mines/* (stateful reference: start / pick / cashout)", () => {
  it("start debits GC, creates a round, and never reveals mine positions", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 20 });

    expect(res.status).toBe(200);
    expect(res.body.roundId).toBeTruthy();
    expect(res.body.state).toEqual({ revealed: [], picksMade: 0, multiplier: minesMultiplier(0) });
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 20);
    expect(JSON.stringify(res.body)).not.toContain("minePositions");
  });

  it("rejects starting a second round while one is already active", async () => {
    const { token } = await signupUser();
    const first = await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 10 });
    expect(first.status).toBe(200);

    const second = await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 10 });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("ROUND_ALREADY_ACTIVE");
  });

  it("picking a safe tile increases the multiplier and keeps the round active; the multiplier matches the published combinatorial formula", async () => {
    const { token } = await signupUser();

    // A pick that hits a mine closes the round - so "try tile 0, and if it's
    // a mine, start an entirely fresh round and try again" (not "try a
    // different tile in the same now-closed round", which would just poll a
    // dead round and either flake or - worse - be silently miscounted, since
    // a 404 body's `hitMine` is `undefined`, not `false`). 22/25 tiles are
    // safe, so this converges in ~1.14 attempts on average.
    let picked = false;
    for (let attempt = 0; attempt < 20 && !picked; attempt++) {
      const start = await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 10 });
      const roundId = start.body.roundId;
      const res = await request(app).post("/games/mines/pick").set(authed(token)).send({ roundId, tileIndex: 0 });
      if (res.body.hitMine) continue;
      picked = true;
      expect(res.status).toBe(200);
      expect(res.body.boardCleared).toBe(false);
      expect(res.body.revealed).toEqual([0]);
      expect(res.body.multiplier).toBe(minesMultiplier(1));
      expect(JSON.stringify(res.body)).not.toContain("minePositions");
    }
    expect(picked).toBe(true);
  });

  it("hitting a mine ends the round with no payout and reveals the mine positions", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));
    const start = await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 10 });
    const roundId = start.body.roundId;

    // Keep picking until we hit a mine (guaranteed within MINES_TOTAL_TILES picks).
    let hit: request.Response | null = null;
    for (let tile = 0; tile < MINES_TOTAL_TILES; tile++) {
      const res = await request(app).post("/games/mines/pick").set(authed(token)).send({ roundId, tileIndex: tile });
      if (res.body.hitMine) {
        hit = res;
        break;
      }
    }

    expect(hit).not.toBeNull();
    expect(hit!.status).toBe(200);
    expect(hit!.body.minePositions).toHaveLength(MINES_COUNT);
    expect(hit!.body.payout).toBe(0);
    // Bet was already debited (GC) at start and never refunded - net loss of the full bet, no payout.
    expect(hit!.body.user.goldCoins).toBe(before.body.goldCoins - 10);
    expect(hit!.body.user.tickets).toBe(before.body.tickets); // TICKETS is retired - never moves

    // Round is over - a further pick against the same roundId is rejected.
    const after = await request(app).post("/games/mines/pick").set(authed(token)).send({ roundId, tileIndex: 0 });
    expect(after.status).toBe(404);
    expect(after.body.code).toBe("NO_ACTIVE_ROUND");
  });

  it("cash-out after at least one safe pick credits GC = bet * the exact published multiplier, and closes the round", async () => {
    const { token } = await signupUser();

    // Same "restart on a mine, don't keep polling the now-closed round"
    // pattern as the test above.
    let roundId: string | null = null;
    for (let attempt = 0; attempt < 20 && !roundId; attempt++) {
      const start = await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 40 });
      const res = await request(app).post("/games/mines/pick").set(authed(token)).send({ roundId: start.body.roundId, tileIndex: 0 });
      if (!res.body.hitMine) roundId = start.body.roundId;
    }
    expect(roundId).not.toBeNull();

    // `before` was captured pre-loop, so account for whatever the (possibly
    // multiple) start() calls above already debited, net of any that never
    // got this far (each start() that led to an immediate mine hit debited
    // 40 and paid nothing back) - simplest to just re-fetch balance right
    // before cashing out instead of trying to reconstruct it.
    const preCashout = await request(app).get("/me").set(authed(token));

    const cashout = await request(app).post("/games/mines/cashout").set(authed(token)).send({ roundId });
    expect(cashout.status).toBe(200);
    expect(cashout.body.multiplier).toBe(minesMultiplier(1));
    expect(cashout.body.payout).toBe(Math.round(40 * minesMultiplier(1)));
    expect(cashout.body.minePositions).toHaveLength(MINES_COUNT);
    // Cash-out payout is GC, credited on top of whatever GC was already
    // spent at start() - TICKETS is retired and never moves.
    expect(cashout.body.user.goldCoins).toBe(preCashout.body.goldCoins + cashout.body.payout);
    expect(cashout.body.user.tickets).toBe(preCashout.body.tickets);

    // Round is closed - a second cash-out attempt is rejected, not double-paid.
    const again = await request(app).post("/games/mines/cashout").set(authed(token)).send({ roundId });
    expect(again.status).toBe(404);
  });

  it("rejects cashing out before any tile has been revealed", async () => {
    const { token } = await signupUser();
    const start = await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 10 });

    const res = await request(app).post("/games/mines/cashout").set(authed(token)).send({ roundId: start.body.roundId });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PICK");
  });

  it("rejects picking a round that belongs to someone else", async () => {
    const alice = await signupUser();
    const bob = await signupUser();
    const start = await request(app).post("/games/mines/start").set(authed(alice.token)).send({ betAmount: 10 });

    const res = await request(app)
      .post("/games/mines/pick")
      .set(authed(bob.token))
      .send({ roundId: start.body.roundId, tileIndex: 0 });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NO_ACTIVE_ROUND");
  });

  it("rejects re-picking an already-revealed tile", async () => {
    const { token } = await signupUser();

    let roundId: string | null = null;
    for (let attempt = 0; attempt < 20 && !roundId; attempt++) {
      const start = await request(app).post("/games/mines/start").set(authed(token)).send({ betAmount: 10 });
      const res = await request(app).post("/games/mines/pick").set(authed(token)).send({ roundId: start.body.roundId, tileIndex: 0 });
      if (!res.body.hitMine) roundId = start.body.roundId;
    }
    expect(roundId).not.toBeNull();

    const again = await request(app).post("/games/mines/pick").set(authed(token)).send({ roundId, tileIndex: 0 });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("INVALID_PICK");
  });

  it("requires auth on every mines endpoint", async () => {
    expect((await request(app).post("/games/mines/start").send({ betAmount: 10 })).status).toBe(401);
    expect((await request(app).post("/games/mines/pick").send({ roundId: "x", tileIndex: 0 })).status).toBe(401);
    expect((await request(app).post("/games/mines/cashout").send({ roundId: "x" })).status).toBe(401);
  });
});
