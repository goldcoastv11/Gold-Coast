import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { resetDb, signupUser, authed } from "./helpers";
import { DRAGON_TOWER_MULTIPLIERS, DRAGON_TOWER_ROWS } from "../src/games/dragontower";

beforeEach(resetDb);

describe("POST /games/dragontower/* (stateful: start / pick / cashout)", () => {
  it("start debits the wager and creates a round without revealing badIndexPerRow", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/dragontower/start").set(authed(token)).send({ betAmount: 20, currency: "GC" });

    expect(res.status).toBe(200);
    expect(res.body.roundId).toBeTruthy();
    expect(res.body.state).toEqual({ currentRow: 0, multiplier: 1 });
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 20);
    expect(JSON.stringify(res.body)).not.toContain("badIndexPerRow");
  });

  it("rejects a second start while a round is active", async () => {
    const { token } = await signupUser();
    await request(app).post("/games/dragontower/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });
    const second = await request(app).post("/games/dragontower/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });
    expect(second.status).toBe(409);
  });

  it("clearing a row uses the exact published multiplier table and keeps the round active", async () => {
    const { token } = await signupUser();

    // A bad pick closes the round - so on a bad first pick, start an
    // entirely fresh round and retry, rather than trying a different
    // column on the now-closed round (which would just poll a dead round).
    // 3/4 columns are safe, so this converges in ~1.33 attempts on average.
    let cleared = false;
    for (let attempt = 0; attempt < 20 && !cleared; attempt++) {
      const start = await request(app).post("/games/dragontower/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });
      const res = await request(app).post("/games/dragontower/pick").set(authed(token)).send({ roundId: start.body.roundId, col: 0 });
      if (res.body.isBad) continue;
      cleared = true;
      expect(res.status).toBe(200);
      expect(res.body.reachedTop).toBe(false);
      expect(res.body.currentRow).toBe(1);
      expect(res.body.multiplier).toBe(DRAGON_TOWER_MULTIPLIERS[0]);
    }
    expect(cleared).toBe(true);
  });

  it("hitting the bad tile ends the round with no payout and reveals badIndexPerRow", async () => {
    const { token } = await signupUser();

    // Keep climbing the SAME column within ONE round (each pick either
    // advances a row or busts) until a bust happens - but climbing forever
    // without ever hitting the bad column is possible (reaching the top
    // auto-closes the round with no bust to observe), so retry with a
    // fresh round if that happens.
    let bust: request.Response | null = null;
    let goldBeforeBust = 0;
    for (let attempt = 0; attempt < 20 && !bust; attempt++) {
      const before = await request(app).get("/me").set(authed(token));
      const start = await request(app).post("/games/dragontower/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });
      const roundId = start.body.roundId;

      for (let row = 0; row < DRAGON_TOWER_ROWS; row++) {
        const res = await request(app).post("/games/dragontower/pick").set(authed(token)).send({ roundId, col: 0 });
        if (res.body.isBad) {
          bust = res;
          goldBeforeBust = before.body.goldCoins;
          break;
        }
      }
    }

    expect(bust).not.toBeNull();
    expect(bust!.body.badIndexPerRow).toHaveLength(DRAGON_TOWER_ROWS);
    expect(bust!.body.payout).toBe(0);
    expect(bust!.body.user.goldCoins).toBe(goldBeforeBust - 10);
  });

  it("cash-out after clearing a row credits bet * the exact published multiplier", async () => {
    const { token } = await signupUser();

    let roundId: string | null = null;
    let preCashout: request.Response | null = null;
    for (let attempt = 0; attempt < 20 && !roundId; attempt++) {
      const start = await request(app).post("/games/dragontower/start").set(authed(token)).send({ betAmount: 50, currency: "GC" });
      const res = await request(app).post("/games/dragontower/pick").set(authed(token)).send({ roundId: start.body.roundId, col: 0 });
      if (!res.body.isBad) {
        roundId = start.body.roundId;
        preCashout = await request(app).get("/me").set(authed(token));
      }
    }
    expect(roundId).not.toBeNull();

    const cashout = await request(app).post("/games/dragontower/cashout").set(authed(token)).send({ roundId });
    expect(cashout.status).toBe(200);
    expect(cashout.body.multiplier).toBe(DRAGON_TOWER_MULTIPLIERS[0]);
    expect(cashout.body.payout).toBe(Math.round(50 * DRAGON_TOWER_MULTIPLIERS[0]));
    expect(cashout.body.user.goldCoins).toBe(preCashout!.body.goldCoins + cashout.body.payout);
  });

  it("reaching the top auto-cashes-out, pays the max multiplier, and reveals badIndexPerRow", async () => {
    const { token } = await signupUser();

    // Same "restart on bust" shape as the other tests, just chasing a full
    // clear (all ROWS picks safe) instead of a single safe pick.
    let top: request.Response | null = null;
    let goldBefore = 0;
    for (let attempt = 0; attempt < 200 && !top; attempt++) {
      const before = await request(app).get("/me").set(authed(token));
      const start = await request(app).post("/games/dragontower/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });
      const roundId = start.body.roundId;

      let busted = false;
      let last: request.Response | null = null;
      for (let row = 0; row < DRAGON_TOWER_ROWS && !busted; row++) {
        last = await request(app).post("/games/dragontower/pick").set(authed(token)).send({ roundId, col: 0 });
        if (last.body.isBad) busted = true;
      }
      if (!busted && last!.body.reachedTop) {
        top = last;
        goldBefore = before.body.goldCoins;
      }
    }

    expect(top).not.toBeNull();
    expect(top!.body.currentRow).toBe(DRAGON_TOWER_ROWS);
    expect(top!.body.multiplier).toBe(DRAGON_TOWER_MULTIPLIERS[DRAGON_TOWER_MULTIPLIERS.length - 1]);
    expect(top!.body.payout).toBe(Math.round(10 * DRAGON_TOWER_MULTIPLIERS[DRAGON_TOWER_MULTIPLIERS.length - 1]));
    expect(top!.body.badIndexPerRow).toHaveLength(DRAGON_TOWER_ROWS);
    expect(top!.body.user.goldCoins).toBe(goldBefore - 10 + top!.body.payout);
  });

  it("rejects cashing out before clearing any row", async () => {
    const { token } = await signupUser();
    const start = await request(app).post("/games/dragontower/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });
    const res = await request(app).post("/games/dragontower/cashout").set(authed(token)).send({ roundId: start.body.roundId });
    expect(res.status).toBe(400);
  });

  it("requires auth", async () => {
    expect((await request(app).post("/games/dragontower/start").send({ betAmount: 10, currency: "GC" })).status).toBe(401);
  });
});

describe("POST /games/hilo/* (stateful: start / guess / cashout)", () => {
  it("start debits the wager and returns the first card without revealing the deck", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/hilo/start").set(authed(token)).send({ betAmount: 20, currency: "GC" });

    expect(res.status).toBe(200);
    expect(res.body.roundId).toBeTruthy();
    expect(res.body.state.currentCard).toBeGreaterThanOrEqual(2);
    expect(res.body.state.currentCard).toBeLessThanOrEqual(14);
    expect(res.body.state.deckRemaining).toBe(51);
    expect(res.body.state.correctGuesses).toBe(0);
    // Not 1.00 - the fair-multiplier formula (matching Mines/Dragon Tower's
    // own "product of fair factors so far" pattern) shaves the house edge
    // in from the very first guess's odds, even before any guess has
    // happened; cashing out isn't possible yet either way (needs >=1
    // correct guess), so this is purely an informational preview number,
    // not something a player could actually claim right now.
    expect(res.body.state.multiplier).toBe(Math.round((1 - 0.02) * 100) / 100);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 20);
    expect(JSON.stringify(res.body)).not.toContain("\"deck\":[");
  });

  it("a correct guess increases correctGuesses and the multiplier, and keeps the round active", async () => {
    const { token } = await signupUser();
    const start = await request(app).post("/games/hilo/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });
    const roundId = start.body.roundId;
    const { higherCount, lowerCount } = start.body.state;
    const direction = higherCount >= lowerCount ? "higher" : "lower";

    // Guess the better-odds side once - a loss ends the round (nothing left
    // to retry against), so this is a single real attempt, not a retry loop
    // pretending multiple guesses are available after a loss.
    const res = await request(app).post("/games/hilo/guess").set(authed(token)).send({ roundId, direction });
    expect(res.status).toBe(200);
    if (res.body.won) {
      expect(res.body.state.correctGuesses).toBe(1);
      expect(res.body.state.multiplier).toBeGreaterThan(1);
    } else {
      expect(res.body.payout).toBe(0);
    }
  });

  it("a wrong guess ends the round with no payout", async () => {
    const { token } = await signupUser();

    // Deliberately guess the WORSE-odds side each time to bias toward a
    // quick, real loss - restarting with a fresh round on every correct
    // guess (a win doesn't end the round, so this loop can't just keep
    // guessing against the same round hoping for a loss - it must actually
    // retry the whole start+guess sequence, same "don't poll a closed round,
    // and don't drift onto a WON round expecting a loss" principle as the
    // other stateful games' tests).
    let lost = false;
    for (let attempt = 0; attempt < 30 && !lost; attempt++) {
      const preStart = await request(app).get("/me").set(authed(token));
      const start = await request(app).post("/games/hilo/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });
      const roundId = start.body.roundId;
      const { higherCount, lowerCount } = start.body.state;
      // Bias toward the worse-odds side to make a loss likely quickly -
      // but only among *valid* guesses. The starting card can be a 2 or an
      // Ace (each ~1/13 of the time), where one direction has zero
      // favorable outcomes and is rejected by the server (400) - same
      // validation the client's UI enforces by disabling that guess
      // button. Falling back to the only-valid side in that case doesn't
      // bias toward a loss as well, but the outer retry loop still
      // converges on a real loss within a handful of attempts either way.
      const direction =
        lowerCount === 0 ? "higher" : higherCount === 0 ? "lower" : higherCount <= lowerCount ? "higher" : "lower";

      const res = await request(app).post("/games/hilo/guess").set(authed(token)).send({ roundId, direction });
      expect(res.status).toBe(200);
      if (!res.body.won) {
        lost = true;
        expect(res.body.payout).toBe(0);
        expect(res.body.user.goldCoins).toBe(preStart.body.goldCoins - 10);

        const after = await request(app).post("/games/hilo/guess").set(authed(token)).send({ roundId, direction });
        expect(after.status).toBe(404);
      } else if (!res.body.deckExhausted) {
        // A win keeps the round active (unlike a loss, which closes it) -
        // this is exactly the "don't poll/restart a still-open round"
        // pitfall in reverse: the NEXT attempt's start() would 409
        // (RoundAlreadyActiveError) against this still-active round if we
        // didn't close it out first. deckExhausted already auto-closed the
        // round server-side (nothing left to guess against), so only close
        // it ourselves in the ordinary case.
        await request(app).post("/games/hilo/cashout").set(authed(token)).send({ roundId });
      }
    }
    expect(lost).toBe(true);
  });

  it("cash-out after a correct guess credits bet * the current multiplier", async () => {
    const { token } = await signupUser();

    let roundId: string | null = null;
    let mult = 0;
    let preCashout: request.Response | null = null;
    for (let attempt = 0; attempt < 30 && !roundId; attempt++) {
      const start = await request(app).post("/games/hilo/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });
      const { higherCount, lowerCount } = start.body.state;
      const direction = higherCount >= lowerCount ? "higher" : "lower";
      const res = await request(app).post("/games/hilo/guess").set(authed(token)).send({ roundId: start.body.roundId, direction });
      if (res.body.won) {
        roundId = start.body.roundId;
        mult = res.body.state.multiplier;
        preCashout = await request(app).get("/me").set(authed(token));
      }
    }
    expect(roundId).not.toBeNull();
    expect(mult).toBeGreaterThan(0);

    const cashout = await request(app).post("/games/hilo/cashout").set(authed(token)).send({ roundId });
    expect(cashout.status).toBe(200);
    expect(cashout.body.multiplier).toBe(mult);
    expect(cashout.body.payout).toBe(Math.round(10 * mult));
    expect(cashout.body.user.goldCoins).toBe(preCashout!.body.goldCoins + cashout.body.payout);
  });

  it("rejects cashing out before any correct guess", async () => {
    const { token } = await signupUser();
    const start = await request(app).post("/games/hilo/start").set(authed(token)).send({ betAmount: 10, currency: "GC" });
    const res = await request(app).post("/games/hilo/cashout").set(authed(token)).send({ roundId: start.body.roundId });
    expect(res.status).toBe(400);
  });

  it("requires auth", async () => {
    expect((await request(app).post("/games/hilo/start").send({ betAmount: 10, currency: "GC" })).status).toBe(401);
  });
});
