import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { resetDb, signupUser, authed } from "./helpers";
import { GC_MULTIPLIERS, GC_MULTIPLIER_BASE } from "../src/economy/gcMultiplier";

beforeEach(resetDb);

describe("POST /auth/signup", () => {
  it("creates a user, issues a JWT, and grants the signup bonus (GC via server-resolved multiplier, no starting TICKETS)", async () => {
    const res = await request(app).post("/auth/signup").send({ username: "alice", password: "hunter22" });

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.username).toBe("alice");

    // GC must be exactly BASE * one of the valid multipliers - never a
    // client-supplied value, since the request body had no multiplier at all.
    expect(GC_MULTIPLIERS).toContain(res.body.signupBonus.gcMultiplier);
    expect(res.body.signupBonus.gcAmount).toBe(GC_MULTIPLIER_BASE * res.body.signupBonus.gcMultiplier);
    expect(res.body.user.goldCoins).toBe(res.body.signupBonus.gcAmount);

    // No starting TICKETS - only ever won by playing a game.
    expect(res.body.user.tickets).toBe(0);

    // Default wardrobe state. A brand-new account owns exactly the free
    // default body and is wearing it - with no rows written anywhere, since
    // the default body is owned implicitly (see economy/wardrobe.ts). This
    // is the "a new player is never invisible" guarantee, checked at the
    // one moment it could go wrong.
    expect(res.body.user.wardrobe.owned).toEqual(["body_default"]);
    expect(res.body.user.wardrobe.equipped.BODY).toBe("body_default");
  });

  it("ignores any client-supplied multiplier - the server always resolves its own", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ username: "mallory", password: "hunter22", multiplier: 2, gcMultiplier: 999 });

    expect(res.status).toBe(201);
    expect(GC_MULTIPLIERS).toContain(res.body.signupBonus.gcMultiplier);
    // If the server had trusted a client-supplied "999" multiplier this
    // would either be 999x or crash - it must be a real, valid multiplier.
    expect(res.body.signupBonus.gcAmount).toBeLessThanOrEqual(GC_MULTIPLIER_BASE * 2);
  });

  it("rejects a duplicate username", async () => {
    await signupUser({ username: "bob" });
    const res = await request(app).post("/auth/signup").send({ username: "bob", password: "hunter22" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("USERNAME_TAKEN");
  });

  it("rejects a too-short password", async () => {
    const res = await request(app).post("/auth/signup").send({ username: "carol", password: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("does not require an email", async () => {
    const res = await request(app).post("/auth/signup").send({ username: "no_email_user", password: "hunter22" });
    expect(res.status).toBe(201);
  });
});

describe("POST /auth/login", () => {
  it("logs in with the correct password and returns the persisted balances", async () => {
    const { username } = await signupUser({ username: "dave", password: "correct-horse" });

    const res = await request(app).post("/auth/login").send({ username, password: "correct-horse" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.username).toBe("dave");
  });

  it("rejects a wrong password without leaking whether the username exists", async () => {
    await signupUser({ username: "erin", password: "correct-horse" });

    const wrongPassword = await request(app).post("/auth/login").send({ username: "erin", password: "nope" });
    const unknownUser = await request(app).post("/auth/login").send({ username: "ghost", password: "nope" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error).toBe(unknownUser.body.error);
  });

  it("does NOT grant a second signup bonus on re-login", async () => {
    const { username, token } = await signupUser({ username: "frank" });
    const before = await request(app).get("/me").set(authed(token));

    await request(app).post("/auth/login").send({ username, password: "hunter22" });
    const after = await request(app).get("/me").set(authed(token));

    expect(after.body.goldCoins).toBe(before.body.goldCoins);
    expect(after.body.tickets).toBe(before.body.tickets);
  });
});

describe("GET /me", () => {
  /**
   * Regression guard for the 2026-09-03 production login outage.
   *
   * `eced44f` dropped `adReward` from this payload and, in the same commit,
   * dropped the client code reading it. That is only safe if both halves
   * deploy - and they didn't: Netlify production deploys were being skipped
   * for exceeded credits, so a pre-`eced44f` client ran against a
   * post-`eced44f` server. Its unguarded `me.adReward.lastClaimedAt` threw
   * on every single login, and the login screen swallowed the error into a
   * generic "something went wrong". Every player was locked out.
   *
   * This asserts the compatibility shim is still being sent. Do NOT delete
   * this test (or the field) until the deployed client is confirmed to be
   * at or after `eced44f` - see the field's doc comment in serializers.ts
   * for how to check that properly rather than assuming.
   */
  it("still sends the adReward compatibility shim the stale deployed client needs", async () => {
    const user = await signupUser();
    const res = await request(app).get("/me").set(authed(user.token));

    expect(res.status).toBe(200);
    // The exact shape the old client dereferences. A missing `adReward`
    // here is a total login outage in production, not a cosmetic gap.
    expect(res.body.adReward).toEqual({ lastClaimedAt: null });
  });

  it("requires a valid JWT", async () => {
    const noAuth = await request(app).get("/me");
    expect(noAuth.status).toBe(401);

    const badAuth = await request(app).get("/me").set("Authorization", "Bearer not-a-real-token");
    expect(badAuth.status).toBe(401);
  });

  it("returns balances, wardrobe, and position for the authenticated user", async () => {
    const { token } = await signupUser();
    const res = await request(app).get("/me").set(authed(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      wardrobe: {
        owned: ["body_default"],
        equipped: { BODY: "body_default" }
      },
      lastPosition: null
    });
  });
});
