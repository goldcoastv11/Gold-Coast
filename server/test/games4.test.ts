import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { resetDb, signupUser, authed } from "./helpers";
import { VIDEO_POKER_PAYTABLE } from "../src/games/videopoker";

beforeEach(resetDb);

describe("POST /games/blackjack/* (stateful: start / hit / stand)", () => {
  it("start debits the GC wager, deals 2+2 cards, and hides the dealer's hole card unless it's a natural", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/blackjack/start").set(authed(token)).send({ betAmount: 20 });

    expect(res.status).toBe(200);
    expect(res.body.roundId).toBeTruthy();
    expect(res.body.state.playerHand).toHaveLength(2);
    expect(res.body.state.dealerUpCard).toBeGreaterThanOrEqual(1);
    expect(res.body.state.dealerUpCard).toBeLessThanOrEqual(13);

    if (res.body.state.playerTotal === 21) {
      // Natural blackjack - the round auto-stands, dealer plays out and pays
      // out within this same /start call. The GC wager is spent regardless
      // (-20 flat); any win (win=40, push=20) is credited straight back as
      // GC too - TICKETS is retired and never moves.
      expect(res.body.state.status).toBe("resolved");
      expect(res.body.state.dealerHand).not.toBeNull();
      expect(["win", "push"]).toContain(res.body.state.outcome);
      expect(res.body.payout).toBe(res.body.state.outcome === "win" ? 40 : 20);
      expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 20 + res.body.payout);
      expect(res.body.user.tickets).toBe(before.body.tickets);
    } else {
      expect(res.body.state.status).toBe("playing");
      expect(res.body.state.dealerHand).toBeNull();
      expect(res.body.state.dealerTotal).toBeNull();
      expect(res.body.payout).toBeNull();
      expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 20);
    }
  });

  it("rejects a second start while a round is active", async () => {
    const { token } = await signupUser();

    // A natural blackjack auto-resolves (and closes the round) within the
    // same /start call - so a second start right after one would legitimately
    // get 200, not 409, on that path. Retry until the first start is a real
    // still-open round before asserting the second one is blocked - same
    // "don't assert past the natural-blackjack branch" fix as the earlier
    // start test, and the same retry-until-non-natural pattern this file's
    // own "busting on hit" test already uses.
    let first: request.Response | null = null;
    for (let attempt = 0; attempt < 40 && (!first || first.body.state.status === "resolved"); attempt++) {
      first = await request(app).post("/games/blackjack/start").set(authed(token)).send({ betAmount: 10 });
    }
    expect(first!.body.state.status).toBe("playing");

    const second = await request(app).post("/games/blackjack/start").set(authed(token)).send({ betAmount: 10 });
    expect(second.status).toBe(409);
  });

  it("busting on hit ends the round immediately with no payout", async () => {
    const { token } = await signupUser();

    // A natural blackjack on start leaves nothing to hit against, and a hit
    // only ever resolves the round when it busts (standing on <=21 is a
    // separate action) - so retry with a fresh round on a natural, and keep
    // hitting the SAME round (never poll a closed one) until either a bust
    // resolves it or we give up on this attempt and start over fresh.
    let bust: request.Response | null = null;
    let goldBeforeBust = 0;
    for (let attempt = 0; attempt < 40 && !bust; attempt++) {
      const before = await request(app).get("/me").set(authed(token));
      const start = await request(app).post("/games/blackjack/start").set(authed(token)).send({ betAmount: 10 });
      if (start.body.state.status === "resolved") continue; // natural blackjack, nothing to hit
      const roundId = start.body.roundId;

      let resolvedThisAttempt = false;
      for (let i = 0; i < 15 && !resolvedThisAttempt; i++) {
        const res = await request(app).post("/games/blackjack/hit").set(authed(token)).send({ roundId });
        if (res.body.state.status === "resolved") {
          // applyBlackjackHit only ever resolves the round by busting.
          resolvedThisAttempt = true;
          bust = res;
          goldBeforeBust = before.body.goldCoins;
        }
      }
      // Vanishingly unlikely (15 hits without busting), but if it happens
      // the round is still active - same "don't leave a round open before
      // the next attempt's start()" pitfall as Hi-Lo's wrong-guess test:
      // an unresolved round here would 409 the next attempt's start(), and
      // start.body.state would then be undefined.
      if (!resolvedThisAttempt) {
        await request(app).post("/games/blackjack/stand").set(authed(token)).send({ roundId });
      }
    }

    expect(bust).not.toBeNull();
    expect(bust!.body.state.playerTotal).toBeGreaterThan(21);
    expect(bust!.body.state.outcome).toBe("lose");
    expect(bust!.body.payout).toBe(0);
    expect(bust!.body.user.goldCoins).toBe(goldBeforeBust - 10);

    const after = await request(app).post("/games/blackjack/hit").set(authed(token)).send({ roundId: undefined });
    expect(after.status).toBe(400); // roundId missing entirely - separate from the "already closed" case below
  });

  it("rejects hitting a round that's already resolved", async () => {
    const { token } = await signupUser();
    let roundId: string | null = null;
    for (let attempt = 0; attempt < 40 && !roundId; attempt++) {
      const start = await request(app).post("/games/blackjack/start").set(authed(token)).send({ betAmount: 10 });
      if (start.body.state.status === "resolved") continue; // natural - already resolved via start, nothing to stand
      roundId = start.body.roundId;
      const stand = await request(app).post("/games/blackjack/stand").set(authed(token)).send({ roundId });
      expect(stand.status).toBe(200);
    }
    expect(roundId).not.toBeNull();

    const res = await request(app).post("/games/blackjack/hit").set(authed(token)).send({ roundId });
    expect(res.status).toBe(404);
  });

  it("standing runs the dealer to >=17 and settles win/push/lose, with any payout in GC", async () => {
    const { token } = await signupUser();

    let roundId: string | null = null;
    let before: request.Response | null = null;
    for (let attempt = 0; attempt < 40 && !roundId; attempt++) {
      before = await request(app).get("/me").set(authed(token));
      const start = await request(app).post("/games/blackjack/start").set(authed(token)).send({ betAmount: 10 });
      if (start.body.state.status === "resolved") continue; // skip naturals for this test, they auto-stand already
      roundId = start.body.roundId;
    }
    expect(roundId).not.toBeNull();

    const res = await request(app).post("/games/blackjack/stand").set(authed(token)).send({ roundId });
    expect(res.status).toBe(200);
    expect(res.body.state.status).toBe("resolved");
    expect(res.body.state.dealerHand).not.toBeNull();
    expect(res.body.state.dealerTotal).toBeGreaterThanOrEqual(17);
    expect(["win", "push", "lose"]).toContain(res.body.state.outcome);

    const expectedMult = res.body.state.outcome === "win" ? 2 : res.body.state.outcome === "push" ? 1 : 0;
    expect(res.body.payout).toBe(10 * expectedMult);
    expect(res.body.user.goldCoins).toBe(before!.body.goldCoins - 10 + res.body.payout);
    expect(res.body.user.tickets).toBe(before!.body.tickets); // TICKETS is retired - never moves

    // Round is closed now - a further stand or hit must 404, not double-pay.
    const again = await request(app).post("/games/blackjack/stand").set(authed(token)).send({ roundId });
    expect(again.status).toBe(404);
  });

  it("requires auth", async () => {
    expect((await request(app).post("/games/blackjack/start").send({ betAmount: 10 })).status).toBe(401);
  });
});

describe("POST /games/videopoker/* (deal / draw)", () => {
  it("deal debits the GC wager and returns a fresh 5-card hand", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/games/videopoker/deal").set(authed(token)).send({ betAmount: 20 });

    expect(res.status).toBe(200);
    expect(res.body.roundId).toBeTruthy();
    expect(res.body.hand).toHaveLength(5);
    for (const card of res.body.hand) {
      expect(card).toBeGreaterThanOrEqual(2);
      expect(card).toBeLessThanOrEqual(14);
    }
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 20);
  });

  it("rejects a second deal while a round is active", async () => {
    const { token } = await signupUser();
    await request(app).post("/games/videopoker/deal").set(authed(token)).send({ betAmount: 10 });
    const second = await request(app).post("/games/videopoker/deal").set(authed(token)).send({ betAmount: 10 });
    expect(second.status).toBe(409);
  });

  it("holding all 5 cards on draw returns the exact same hand, scores it as dealt, and pays GC", async () => {
    const { token } = await signupUser();
    const deal = await request(app).post("/games/videopoker/deal").set(authed(token)).send({ betAmount: 10 });
    const dealtHand = deal.body.hand;
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app)
      .post("/games/videopoker/draw")
      .set(authed(token))
      .send({ roundId: deal.body.roundId, holds: [true, true, true, true, true] });

    expect(res.status).toBe(200);
    expect(res.body.hand).toEqual(dealtHand);
    const validRanks = VIDEO_POKER_PAYTABLE.map((e) => e.rank);
    expect(validRanks).toContain(res.body.rank);
    const expectedEntry = VIDEO_POKER_PAYTABLE.find((e) => e.rank === res.body.rank)!;
    expect(res.body.multiplier).toBe(expectedEntry.mult);
    expect(res.body.payout).toBe(10 * expectedEntry.mult);
    // The GC wager was already spent at deal() - draw's payout is credited
    // on top of that as GC too. TICKETS is retired and never moves.
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins + res.body.payout);
    expect(res.body.user.tickets).toBe(before.body.tickets);
  });

  it("holding nothing draws 5 fresh cards and scores according to the paytable", async () => {
    const { token } = await signupUser();
    const deal = await request(app).post("/games/videopoker/deal").set(authed(token)).send({ betAmount: 10 });

    const res = await request(app)
      .post("/games/videopoker/draw")
      .set(authed(token))
      .send({ roundId: deal.body.roundId, holds: [false, false, false, false, false] });

    expect(res.status).toBe(200);
    expect(res.body.hand).toHaveLength(5);
    const validRanks = VIDEO_POKER_PAYTABLE.map((e) => e.rank);
    expect(validRanks).toContain(res.body.rank);
    const expectedEntry = VIDEO_POKER_PAYTABLE.find((e) => e.rank === res.body.rank)!;
    expect(res.body.payout).toBe(10 * expectedEntry.mult);
  });

  it("rejects a holds array that isn't exactly 5 entries", async () => {
    const { token } = await signupUser();
    const deal = await request(app).post("/games/videopoker/deal").set(authed(token)).send({ betAmount: 10 });

    const res = await request(app)
      .post("/games/videopoker/draw")
      .set(authed(token))
      .send({ roundId: deal.body.roundId, holds: [true, false, false, false] });

    expect(res.status).toBe(400);
  });

  it("rejects drawing on a round that's already resolved", async () => {
    const { token } = await signupUser();
    const deal = await request(app).post("/games/videopoker/deal").set(authed(token)).send({ betAmount: 10 });
    const holds = [true, true, true, true, true];
    await request(app).post("/games/videopoker/draw").set(authed(token)).send({ roundId: deal.body.roundId, holds });

    const again = await request(app).post("/games/videopoker/draw").set(authed(token)).send({ roundId: deal.body.roundId, holds });
    expect(again.status).toBe(404);
  });

  it("requires auth", async () => {
    expect((await request(app).post("/games/videopoker/deal").send({ betAmount: 10 })).status).toBe(401);
  });
});
