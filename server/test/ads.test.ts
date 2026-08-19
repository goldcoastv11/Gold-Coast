import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { resetDb, signupUser, authed } from "./helpers";
import { AD_REWARD_GC_AMOUNT, AD_REWARD_COOLDOWN_MS } from "../src/economy/adRewards";

beforeEach(resetDb);

describe("POST /ads/claim (simulated ad-reward GC refill)", () => {
  it("grants a fixed GC amount and never touches SC", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/ads/claim").set(authed(token));

    expect(res.status).toBe(200);
    expect(res.body.granted.gcAmount).toBe(AD_REWARD_GC_AMOUNT);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins + AD_REWARD_GC_AMOUNT);
    expect(res.body.user.stakeCoins).toBe(before.body.stakeCoins); // SC untouched
    // No playthrough interaction either - GC has no playthrough requirement of its own.
    expect(res.body.user.playthrough.required).toBe(before.body.playthrough.required);
  });

  it("enforces the server-side cooldown - a second immediate claim is rejected", async () => {
    const { token } = await signupUser();

    const first = await request(app).post("/ads/claim").set(authed(token));
    expect(first.status).toBe(200);

    const second = await request(app).post("/ads/claim").set(authed(token));
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("COOLDOWN");
    expect(second.body.remainingMs).toBeGreaterThan(0);
    expect(second.body.remainingMs).toBeLessThanOrEqual(AD_REWARD_COOLDOWN_MS);
  });

  it("reflects the cooldown on GET /me via adReward.lastClaimedAt", async () => {
    const { token } = await signupUser();

    const before = await request(app).get("/me").set(authed(token));
    expect(before.body.adReward.lastClaimedAt).toBeNull();

    await request(app).post("/ads/claim").set(authed(token));

    const after = await request(app).get("/me").set(authed(token));
    expect(after.body.adReward.lastClaimedAt).not.toBeNull();
  });

  it("is independent of the attendant claim's own cooldown - claiming one doesn't block the other", async () => {
    const { token } = await signupUser();

    const adClaim = await request(app).post("/ads/claim").set(authed(token));
    expect(adClaim.status).toBe(200);

    const attendantClaim = await request(app).post("/claim-bonus").set(authed(token));
    expect(attendantClaim.status).toBe(200);
  });

  it("requires auth", async () => {
    const res = await request(app).post("/ads/claim");
    expect(res.status).toBe(401);
  });
});
