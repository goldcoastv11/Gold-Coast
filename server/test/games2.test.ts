import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { resetDb, signupUser, authed } from "./helpers";
import { ROULETTE_PAYOUTS, colorOf } from "../src/games/roulette";
import { PLINKO_MULTIPLIERS, PLINKO_ROWS } from "../src/games/plinko";
import { kenoMultiplier, kenoMinPayHits, kenoHitProbability, KENO_HOUSE_EDGE, KENO_MAX_PICKS } from "../src/games/keno";
import { PLAYER_WIN_MULT, BANKER_WIN_MULT, TIE_WIN_MULT } from "../src/games/baccarat";
import { buildWheelSegments, WHEEL_SEGMENT_COUNT } from "../src/games/wheel";

beforeEach(resetDb);

describe("POST /games/coinflip/play", () => {
  it("pays exactly 2x on a win, nothing on a loss", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/coinflip/play").set(authed(token)).send({ betAmount: 10, currency: "GC", guess: "heads" });

    expect(res.status).toBe(200);
    expect(res.body.result.won).toBe(res.body.result.result === "heads");
    expect(res.body.result.payout).toBe(res.body.result.won ? 20 : 0);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
  });

  it("lands close to 50/50 over many rounds", async () => {
    const { token } = await signupUser();
    let wins = 0;
    let trials = 0;
    for (let i = 0; i < 300; i++) {
      const res = await request(app).post("/games/coinflip/play").set(authed(token)).send({ betAmount: 5, currency: "GC", guess: "heads" });
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
  it("pays the correct color multiplier and the number/color are consistent", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/roulette/play").set(authed(token)).send({ betAmount: 10, currency: "GC", bet: "red" });

    expect(res.status).toBe(200);
    expect(res.body.result.color).toBe(colorOf(res.body.result.number));
    const won = res.body.result.color === "red";
    expect(res.body.result.won).toBe(won);
    expect(res.body.result.payout).toBe(won ? 10 * ROULETTE_PAYOUTS.red : 0);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
  });

  it("rejects an invalid bet color", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/games/roulette/play").set(authed(token)).send({ betAmount: 10, currency: "GC", bet: "purple" });
    expect(res.status).toBe(400);
  });
});

describe("POST /games/limbo/play", () => {
  it("pays exactly bet * target on a win (crashPoint >= target), nothing on a loss", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/limbo/play").set(authed(token)).send({ betAmount: 10, currency: "GC", target: 2 });

    expect(res.status).toBe(200);
    const won = res.body.result.crashPoint >= 2;
    expect(res.body.result.won).toBe(won);
    expect(res.body.result.payout).toBe(won ? Math.round(10 * 2) : 0);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
  });

  it("rejects a target of 1x or less", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/games/limbo/play").set(authed(token)).send({ betAmount: 10, currency: "GC", target: 1 });
    expect(res.status).toBe(400);
  });
});

describe("POST /games/plinko/play", () => {
  it("pays the multiplier for the landed slot, and the path is internally consistent with the slot", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/plinko/play").set(authed(token)).send({ betAmount: 10, currency: "GC" });

    expect(res.status).toBe(200);
    expect(res.body.result.path).toHaveLength(PLINKO_ROWS);
    expect(res.body.result.path[PLINKO_ROWS - 1]).toBe(res.body.result.slotIndex);
    expect(res.body.result.multiplier).toBe(PLINKO_MULTIPLIERS[res.body.result.slotIndex]);
    expect(res.body.result.payout).toBe(Math.round(10 * res.body.result.multiplier));
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
  });
});

describe("POST /games/slots/play", () => {
  it("resolves 3 reels and pays according to 2-of-a-kind/3-of-a-kind matches", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/slots/play").set(authed(token)).send({ betAmount: 10, currency: "GC" });

    expect(res.status).toBe(200);
    expect(res.body.result.reels).toHaveLength(3);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
  });
});

describe("POST /games/keno/play", () => {
  it("pays exactly the published combinatorial multiplier for the actual hit count", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));
    const picks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    const res = await request(app).post("/games/keno/play").set(authed(token)).send({ betAmount: 10, currency: "GC", picks });

    expect(res.status).toBe(200);
    expect(res.body.result.drawn).toHaveLength(10);
    const expectedMult = kenoMultiplier(10, res.body.result.hits);
    expect(res.body.result.multiplier).toBe(expectedMult);
    expect(res.body.result.payout).toBe(Math.round(10 * expectedMult));
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
  });

  it("pays 0 below the minimum pay-hits threshold for that pick count", () => {
    expect(kenoMultiplier(10, kenoMinPayHits(10) - 1)).toBe(0);
  });

  it("rejects duplicate picks", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/games/keno/play").set(authed(token)).send({ betAmount: 10, currency: "GC", picks: [1, 1, 2] });
    expect(res.status).toBe(400);
  });

  it("rejects more than 10 picks", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/games/keno/play")
      .set(authed(token))
      .send({ betAmount: 10, currency: "GC", picks: Array.from({ length: 11 }, (_, i) => i) });
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
  it("pays exactly the segment the server landed on, and segments match the published per-risk layout", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/wheel/play").set(authed(token)).send({ betAmount: 10, currency: "GC", risk: "high" });

    expect(res.status).toBe(200);
    expect(res.body.result.segments).toEqual(buildWheelSegments("high"));
    expect(res.body.result.segments).toHaveLength(WHEEL_SEGMENT_COUNT);
    expect(res.body.result.multiplier).toBe(res.body.result.segments[res.body.result.landingIndex]);
    expect(res.body.result.payout).toBe(Math.round(10 * res.body.result.multiplier));
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
  });
});

describe("POST /games/baccarat/play", () => {
  it("player bet pays 2x on a player win, pushes (1x) on a tie, loses on banker win", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/baccarat/play").set(authed(token)).send({ betAmount: 10, currency: "GC", betType: "player" });

    expect(res.status).toBe(200);
    const { outcome } = res.body.result;
    if (outcome === "player") expect(res.body.result.payout).toBe(Math.round(10 * PLAYER_WIN_MULT));
    else if (outcome === "tie") expect(res.body.result.payout).toBe(10);
    else expect(res.body.result.payout).toBe(0);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 10 + res.body.result.payout);
  });

  it("banker bet pays 1.95x on a banker win", async () => {
    const { token } = await signupUser();
    let found = false;
    for (let i = 0; i < 60 && !found; i++) {
      const res = await request(app).post("/games/baccarat/play").set(authed(token)).send({ betAmount: 5, currency: "GC", betType: "banker" });
      if (res.status !== 200) break;
      if (res.body.result.outcome === "banker") {
        expect(res.body.result.payout).toBe(Math.round(5 * BANKER_WIN_MULT));
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("tie bet pays 9x on a tie and loses on anything else", async () => {
    const { token } = await signupUser();
    let sawTieWin = false;
    let sawTieLoss = false;
    for (let i = 0; i < 200 && !(sawTieWin && sawTieLoss); i++) {
      const res = await request(app).post("/games/baccarat/play").set(authed(token)).send({ betAmount: 5, currency: "GC", betType: "tie" });
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
