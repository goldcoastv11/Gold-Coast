import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { resetDb, signupUser, authed } from "./helpers";
import { GC_MULTIPLIERS, GC_MULTIPLIER_BASE } from "../src/economy/gcMultiplier";
import { SIGNUP_BONUS_SC } from "../src/economy/signupBonus";

beforeEach(resetDb);

describe("POST /auth/signup", () => {
  it("creates a user, issues a JWT, and grants the signup bonus (GC via server-resolved multiplier + flat 25 SC)", async () => {
    const res = await request(app).post("/auth/signup").send({ username: "alice", password: "hunter22" });

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.username).toBe("alice");

    // GC must be exactly BASE * one of the valid multipliers - never a
    // client-supplied value, since the request body had no multiplier at all.
    expect(GC_MULTIPLIERS).toContain(res.body.signupBonus.gcMultiplier);
    expect(res.body.signupBonus.gcAmount).toBe(GC_MULTIPLIER_BASE * res.body.signupBonus.gcMultiplier);
    expect(res.body.user.goldCoins).toBe(res.body.signupBonus.gcAmount);

    // SC leg is flat regardless of the GC multiplier.
    expect(res.body.signupBonus.scAmount).toBe(SIGNUP_BONUS_SC);
    expect(res.body.user.stakeCoins).toBe(SIGNUP_BONUS_SC);

    // Playthrough requirement registered for the SC bonus.
    expect(res.body.user.playthrough).toEqual({ required: SIGNUP_BONUS_SC, wagered: 0 });

    // Default skin/equip state.
    expect(res.body.user.skinsOwned).toEqual(["player"]);
    expect(res.body.user.equippedSkin).toBe("player");
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
    expect(after.body.stakeCoins).toBe(before.body.stakeCoins);
  });
});

describe("GET /me", () => {
  it("requires a valid JWT", async () => {
    const noAuth = await request(app).get("/me");
    expect(noAuth.status).toBe(401);

    const badAuth = await request(app).get("/me").set("Authorization", "Bearer not-a-real-token");
    expect(badAuth.status).toBe(401);
  });

  it("returns balances, skins, equipped skin, and position for the authenticated user", async () => {
    const { token } = await signupUser();
    const res = await request(app).get("/me").set(authed(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      skinsOwned: ["player"],
      equippedSkin: "player",
      lastPosition: null
    });
  });
});
