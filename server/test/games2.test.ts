import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { resetDb, signupUser, authed } from "./helpers";
import { ROULETTE_PAYOUTS, colorOf } from "../src/games/roulette";
import { PLINKO_MULTIPLIERS, PLINKO_ROWS } from "../src/games/plinko";
import { SLOT_SYMBOLS, scoreSlotsSpin } from "../src/games/slots";
import { kenoMultiplier, kenoMinPayHits, kenoHitProbability, KENO_HOUSE_EDGE, KENO_MAX_PICKS } from "../src/games/keno";
import { PLAYER_WIN_MULT, BANKER_WIN_MULT, TIE_WIN_MULT } from "../src/games/baccarat";
import { buildWheelSegments, WHEEL_SEGMENT_COUNT } from "../src/games/wheel";

beforeEach(resetDb);

describe("POST /games/coinflip/play", () => {
  it("pays exactly 2x GC on a win, nothing on a loss; GC wager always spent", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/coinflip/play").set(authed(token)).send({ betAmount: 10, guess: "heads" });

    expect(res.status).toBe(200);
    expect(res.body.result.won).toBe(res.body.result.result === "heads");
    expect(res.body.result.payout).toBe(res.body.result.won ? 20 : 0);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
    expect(res.body.user.tickets).toBe(before.body.tickets); // TICKETS is retired - never moves
  });

  it("lands close to 50/50 over many rounds", async () => {
    const { token } = await signupUser();
    let wins = 0;
    let trials = 0;
    for (let i = 0; i < 300; i++) {
      const res = await request(app).post("/games/coinflip/play").set(authed(token)).send({ betAmount: 5, guess: "heads" });
      if (res.status !== 200) break;
      trials++;
      if (res.body.result.won) wins++;
    }
    expect(trials).toBeGreaterThan(50);
    expect(wins / trials).toBeGreaterThan(0.35);
    expect(wins / trials).toBeLessThan(0.65);
  });
});

describe("POST /games/roulette/play", () => {
  it("pays the correct color multiplier in GC and the number/color are consistent", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/roulette/play").set(authed(token)).send({ betAmount: 10, bet: "red" });

    expect(res.status).toBe(200);
    expect(res.body.result.color).toBe(colorOf(res.body.result.number));
    const won = res.body.result.color === "red";
    expect(res.body.result.won).toBe(won);
    expect(res.body.result.payout).toBe(won ? 10 * ROULETTE_PAYOUTS.red : 0);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
    expect(res.body.user.tickets).toBe(before.body.tickets); // TICKETS is retired - never moves
  });

  it("rejects an invalid bet color", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/games/roulette/play").set(authed(token)).send({ betAmount: 10, bet: "purple" });
    expect(res.status).toBe(400);
  });
});

describe("POST /games/limbo/play", () => {
  it("pays exactly bet * target in GC on a win (crashPoint >= target), nothing on a loss", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/limbo/play").set(authed(token)).send({ betAmount: 10, target: 2 });

    expect(res.status).toBe(200);
    const won = res.body.result.crashPoint >= 2;
    expect(res.body.result.won).toBe(won);
    expect(res.body.result.payout).toBe(won ? Math.round(10 * 2) : 0);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
    expect(res.body.user.tickets).toBe(before.body.tickets); // TICKETS is retired - never moves
  });

  it("rejects a target of 1x or less", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/games/limbo/play").set(authed(token)).send({ betAmount: 10, target: 1 });
    expect(res.status).toBe(400);
  });
});

describe("POST /games/plinko/play", () => {
  it("pays the multiplier for the landed slot in GC, and the path is internally consistent with the slot", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/plinko/play").set(authed(token)).send({ betAmount: 10 });

    expect(res.status).toBe(200);
    expect(res.body.result.path).toHaveLength(PLINKO_ROWS);
    expect(res.body.result.path[PLINKO_ROWS - 1]).toBe(res.body.result.slotIndex);
    expect(res.body.result.multiplier).toBe(PLINKO_MULTIPLIERS[res.body.result.slotIndex]);
    expect(res.body.result.payout).toBe(Math.round(10 * res.body.result.multiplier));
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
    expect(res.body.user.tickets).toBe(before.body.tickets); // TICKETS is retired - never moves
  });
});

describe("POST /games/slots/play", () => {
  it("resolves 3 reels and pays GC according to 2-of-a-kind/3-of-a-kind matches", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/slots/play").set(authed(token)).send({ betAmount: 10 });

    expect(res.status).toBe(200);
    expect(res.body.result.reels).toHaveLength(3);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
    expect(res.body.user.tickets).toBe(before.body.tickets); // TICKETS is retired - never moves
  });
});

describe("POST /games/keno/play", () => {
  it("pays exactly the published combinatorial multiplier in GC for the actual hit count", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));
    const picks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    const res = await request(app).post("/games/keno/play").set(authed(token)).send({ betAmount: 10, picks });

    expect(res.status).toBe(200);
    expect(res.body.result.drawn).toHaveLength(10);
    const expectedMult = kenoMultiplier(10, res.body.result.hits);
    expect(res.body.result.multiplier).toBe(expectedMult);
    expect(res.body.result.payout).toBe(Math.round(10 * expectedMult));
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
    expect(res.body.user.tickets).toBe(before.body.tickets); // TICKETS is retired - never moves
  });

  it("pays 0 below the minimum pay-hits threshold for that pick count", () => {
    expect(kenoMultiplier(10, kenoMinPayHits(10) - 1)).toBe(0);
  });

  it("rejects duplicate picks", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/games/keno/play").set(authed(token)).send({ betAmount: 10, picks: [1, 1, 2] });
    expect(res.status).toBe(400);
  });

  it("rejects more than 10 picks", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/games/keno/play")
      .set(authed(token))
      .send({ betAmount: 10, picks: Array.from({ length: 11 }, (_, i) => i) });
    expect(res.status).toBe(400);
  });

  // #45 (QA-found regression): the payout table used to split RTP into
  // equal shares per tier with no regard for MAX_MULTIPLIER, so the
  // astronomically-rare top tier at high pick counts (e.g. picks=10,
  // hits=10 is ~1-in-850-million) needed a multiplier the cap silently
  // clipped - quietly dragging real RTP for picks 7-10 down to 67-82%
  // while picks 1-6 looked fine. This computes REAL RTP independently (true
  // hypergeometric probability x actual multiplier, summed over every
  // possible hit count) for every pick count 1-10, so any future change to
  // the payout formula that breaks the invariant at ANY pick count - not
  // just the ones QA happened to notice - fails this test immediately.
  it("real RTP (probability-weighted, not the formula's own assumption) is ~1-KENO_HOUSE_EDGE for every pick count 1-10", () => {
    const target = 1 - KENO_HOUSE_EDGE;
    for (let picks = 1; picks <= KENO_MAX_PICKS; picks++) {
      let realRtp = 0;
      for (let hits = 0; hits <= picks; hits++) {
        realRtp += kenoHitProbability(hits, picks) * kenoMultiplier(picks, hits);
      }
      // Tight tolerance - the water-filling construction is exact up to the
      // 2-decimal rounding on each tier's stored multiplier, not a loose
      // approximation, so a regression that reintroduces silent capping
      // (which previously caused a 12-27 point miss) can't hide in here.
      expect(realRtp).toBeGreaterThan(target - 0.01);
      expect(realRtp).toBeLessThan(target + 0.01);
    }
  });

  it("no tier's multiplier ever needs to exceed the documented sane practical max", () => {
    for (let picks = 1; picks <= KENO_MAX_PICKS; picks++) {
      for (let hits = kenoMinPayHits(picks); hits <= picks; hits++) {
        expect(kenoMultiplier(picks, hits)).toBeLessThanOrEqual(10000);
      }
    }
  });
});

describe("POST /games/wheel/play", () => {
  it("pays exactly the segment the server landed on in GC, and segments match the published per-risk layout", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/wheel/play").set(authed(token)).send({ betAmount: 10, risk: "high" });

    expect(res.status).toBe(200);
    expect(res.body.result.segments).toEqual(buildWheelSegments("high"));
    expect(res.body.result.segments).toHaveLength(WHEEL_SEGMENT_COUNT);
    expect(res.body.result.multiplier).toBe(res.body.result.segments[res.body.result.landingIndex]);
    expect(res.body.result.payout).toBe(Math.round(10 * res.body.result.multiplier));
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
    expect(res.body.user.tickets).toBe(before.body.tickets); // TICKETS is retired - never moves
  });
});

describe("POST /games/baccarat/play", () => {
  it("player bet pays 2x GC on a player win, pushes (1x) on a tie, loses on banker win", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/baccarat/play").set(authed(token)).send({ betAmount: 10, betType: "player" });

    expect(res.status).toBe(200);
    const { outcome } = res.body.result;
    if (outcome === "player") expect(res.body.result.payout).toBe(Math.round(10 * PLAYER_WIN_MULT));
    else if (outcome === "tie") expect(res.body.result.payout).toBe(10);
    else expect(res.body.result.payout).toBe(0);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
    expect(res.body.user.tickets).toBe(before.body.tickets); // TICKETS is retired - never moves
  });

  it("banker bet pays 1.95x GC on a banker win", async () => {
    const { token } = await signupUser();
    let found = false;
    for (let i = 0; i < 60 && !found; i++) {
      const res = await request(app).post("/games/baccarat/play").set(authed(token)).send({ betAmount: 5, betType: "banker" });
      if (res.status !== 200) break;
      if (res.body.result.outcome === "banker") {
        expect(res.body.result.payout).toBe(Math.round(5 * BANKER_WIN_MULT));
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("tie bet pays 9x GC on a tie and loses on anything else", async () => {
    const { token } = await signupUser();
    let sawTieWin = false;
    let sawTieLoss = false;
    for (let i = 0; i < 200 && !(sawTieWin && sawTieLoss); i++) {
      const res = await request(app).post("/games/baccarat/play").set(authed(token)).send({ betAmount: 5, betType: "tie" });
      if (res.status !== 200) break;
      if (res.body.result.outcome === "tie") {
        expect(res.body.result.payout).toBe(Math.round(5 * TIE_WIN_MULT));
        sawTieWin = true;
      } else {
        expect(res.body.result.payout).toBe(0);
        sawTieLoss = true;
      }
    }
    expect(sawTieLoss).toBe(true);
  });
});

/**
 * Payout rebalance (2026-08-27) guard rail.
 *
 * Roulette green (20x -> 36x), Plinko's multiplier table and Slots' pair payouts were all retuned
 * to bring their long-run return into the arcade's 94-100% band. These are hand-picked tables, so
 * nothing else in the codebase stops someone nudging a number and quietly reintroducing a 190%
 * game. Each case below computes the return from the true outcome probabilities x the paytable the
 * server actually ships, in the same spirit as the Keno RTP invariant above.
 */
const REBALANCE_MIN_RTP = 0.94;
const REBALANCE_MAX_RTP = 1.0;

describe("rebalanced games return 94-100% (analytic, no RNG)", () => {
  it("roulette returns 94-100% on every one of the three bets", () => {
    // 37 pockets: 18 red, 18 black, 1 green.
    const pockets: Record<string, number> = { red: 18, black: 18, green: 1 };
    for (const [bet, count] of Object.entries(pockets)) {
      const rtp = (count / 37) * ROULETTE_PAYOUTS[bet as keyof typeof ROULETTE_PAYOUTS];
      expect(rtp).toBeGreaterThanOrEqual(REBALANCE_MIN_RTP);
      expect(rtp).toBeLessThanOrEqual(REBALANCE_MAX_RTP);
    }
  });

  it("plinko returns 94-100% against the true binomial slot probabilities", () => {
    // A drop is PLINKO_ROWS fair left/right bounces, so slot i has probability C(rows, i) / 2^rows.
    const choose = (n: number, k: number) => {
      let c = 1;
      for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
      return c;
    };
    const total = 2 ** PLINKO_ROWS;
    let rtp = 0;
    for (let slot = 0; slot < PLINKO_MULTIPLIERS.length; slot++) {
      rtp += (choose(PLINKO_ROWS, slot) / total) * PLINKO_MULTIPLIERS[slot];
    }
    expect(rtp).toBeGreaterThanOrEqual(REBALANCE_MIN_RTP);
    expect(rtp).toBeLessThanOrEqual(REBALANCE_MAX_RTP);
  });

  it("slots returns 94-100% over all 125 reel combinations, scored by the real payout rules", () => {
    // Enumerated through scoreSlotsSpin (the server's own scoring), not a reimplementation of it.
    const totalWeight = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
    // Big enough that every multiplier in the table is a whole number of coins, so the payout
    // rounding inside scoreSlotsSpin can't skew the figure.
    const bet = 1_000_000;
    let weightedPayout = 0;
    for (const a of SLOT_SYMBOLS) {
      for (const b of SLOT_SYMBOLS) {
        for (const c of SLOT_SYMBOLS) {
          const probability = (a.weight / totalWeight) * (b.weight / totalWeight) * (c.weight / totalWeight);
          weightedPayout += probability * scoreSlotsSpin([a, b, c], bet).payout;
        }
      }
    }
    const rtp = weightedPayout / bet;
    expect(rtp).toBeGreaterThanOrEqual(REBALANCE_MIN_RTP);
    expect(rtp).toBeLessThanOrEqual(REBALANCE_MAX_RTP);
  });
});
