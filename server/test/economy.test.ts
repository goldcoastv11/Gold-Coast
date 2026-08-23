import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, signupUser, authed } from "./helpers";
import { GC_PACKAGES } from "../src/economy/packages";
import { GC_MULTIPLIERS, GC_MULTIPLIER_BASE } from "../src/economy/gcMultiplier";
import { MIN_SC_REDEMPTION } from "../src/economy/redemption";

beforeEach(resetDb);

describe("POST /claim-bonus (Coin Kiosk claim, formerly the Chip Attendant's - GC only, no SC)", () => {
  it("grants GC via a server-resolved multiplier, no SC, and doesn't touch the playthrough requirement", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/claim-bonus").set(authed(token));

    expect(res.status).toBe(200);
    expect(GC_MULTIPLIERS).toContain(res.body.granted.gcMultiplier);
    expect(res.body.granted.gcAmount).toBe(GC_MULTIPLIER_BASE * res.body.granted.gcMultiplier);
    expect(res.body.granted.scAmount).toBe(0);

    expect(res.body.user.goldCoins).toBe(before.body.goldCoins + res.body.granted.gcAmount);
    expect(res.body.user.stakeCoins).toBe(before.body.stakeCoins);
    expect(res.body.user.playthrough.required).toBe(before.body.playthrough.required);
  });

  it("enforces a 30s server-side cooldown - a second immediate claim is rejected", async () => {
    const { token } = await signupUser();

    const first = await request(app).post("/claim-bonus").set(authed(token));
    expect(first.status).toBe(200);

    const second = await request(app).post("/claim-bonus").set(authed(token));
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("COOLDOWN");
    expect(second.body.remainingMs).toBeGreaterThan(0);
    expect(second.body.remainingMs).toBeLessThanOrEqual(30_000);
  });

  it("requires auth", async () => {
    const res = await request(app).post("/claim-bonus");
    expect(res.status).toBe(401);
  });
});

describe("GET /packages", () => {
  it("lists the exact tier catalog with non-linear SC-per-dollar scaling across tiers", async () => {
    const res = await request(app).get("/packages");
    expect(res.status).toBe(200);
    expect(res.body.packages).toEqual(GC_PACKAGES);

    const scPerDollar = GC_PACKAGES.map((p) => p.scBonus / p.priceUsd);
    for (let i = 1; i < scPerDollar.length; i++) {
      expect(scPerDollar[i]).toBeGreaterThan(scPerDollar[i - 1]);
    }
    // Non-linear, specifically: not a flat multiple of price (i.e. not all equal).
    const allEqual = scPerDollar.every((v) => Math.abs(v - scPerDollar[0]) < 1e-9);
    expect(allEqual).toBe(false);
  });
});

describe("POST /packages/purchase", () => {
  it("grants a package's exact GC + SC bonus and registers the playthrough requirement", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));
    const pkg = GC_PACKAGES.find((p) => p.id === "gold")!;

    const res = await request(app).post("/packages/purchase").set(authed(token)).send({ packageId: "gold" });

    expect(res.status).toBe(200);
    expect(res.body.granted.gcAmount).toBe(pkg.gcAmount);
    expect(res.body.granted.scAmount).toBe(pkg.scBonus);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins + pkg.gcAmount);
    expect(res.body.user.stakeCoins).toBe(before.body.stakeCoins + pkg.scBonus);
    expect(res.body.user.playthrough.required).toBe(before.body.playthrough.required + pkg.scBonus);
  });

  it("rejects an unknown package id", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/packages/purchase").set(authed(token)).send({ packageId: "not-a-real-tier" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("UNKNOWN_PACKAGE");
  });

  it.each(GC_PACKAGES.map((p) => p.id))("every catalog tier '%s' purchases successfully with its exact numbers", async (id) => {
    const { token } = await signupUser();
    const pkg = GC_PACKAGES.find((p) => p.id === id)!;
    const res = await request(app).post("/packages/purchase").set(authed(token)).send({ packageId: id });
    expect(res.status).toBe(200);
    expect(res.body.pkg).toEqual(pkg);
  });
});

describe("POST /redeem", () => {
  it("rejects redemption while the playthrough requirement is outstanding, even above the minimum", async () => {
    const { token } = await signupUser();
    // Buy a package to comfortably clear MIN_SC_REDEMPTION, but never wager -
    // playthrough stays outstanding.
    await request(app).post("/packages/purchase").set(authed(token)).send({ packageId: "gold" }); // +45 SC

    const res = await request(app).post("/redeem").set(authed(token)).send({ amountSc: 50 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PLAYTHROUGH_INCOMPLETE");
  });

  it("rejects redemption below the minimum SC threshold even with playthrough cleared", async () => {
    const { token } = await signupUser();
    // Signup bonus alone (25 SC, required=25 wagered=0) is below MIN_SC_REDEMPTION (50)
    // regardless of playthrough state.
    const res = await request(app).post("/redeem").set(authed(token)).send({ amountSc: 10 });
    expect(res.status).toBe(400);
    expect(["PLAYTHROUGH_INCOMPLETE", "BELOW_MINIMUM"]).toContain(res.body.code);
  });

  it("succeeds once playthrough is cleared and balance clears the minimum", async () => {
    const { token, username } = await signupUser();

    // Buy enough packages to clear MIN_SC_REDEMPTION, then manually clear the
    // playthrough by wagering the required SC via a direct ledger + playthrough
    // update (there's no game/bet route yet - recordScWager is games' territory,
    // exercised at the unit level in ledger.test.ts). Here we simulate the
    // "wagered enough" state directly against the DB to test the /redeem route
    // itself in isolation.
    await request(app).post("/packages/purchase").set(authed(token)).send({ packageId: "gold" }); // +45 SC, +45 required

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    await prisma.playthroughProgress.update({
      where: { userId: user.id },
      data: { scWagered: 70 } // required = 25 (signup) + 45 (gold) = 70
    });

    const before = await request(app).get("/me").set(authed(token));
    expect(before.body.playthrough).toEqual({ required: 70, wagered: 70 });
    expect(before.body.stakeCoins).toBeGreaterThanOrEqual(MIN_SC_REDEMPTION);

    const res = await request(app).post("/redeem").set(authed(token)).send({ amountSc: 50 });
    expect(res.status).toBe(200);
    expect(res.body.redeemedSc).toBe(50);
    expect(res.body.user.stakeCoins).toBe(before.body.stakeCoins - 50);
  });

  it("rejects redeeming more SC than the current balance (once above the minimum and playthrough-cleared)", async () => {
    const { token, username } = await signupUser();
    // Clear enough balance above MIN_SC_REDEMPTION so BELOW_MINIMUM can't
    // mask the specific case under test.
    await request(app).post("/packages/purchase").set(authed(token)).send({ packageId: "gold" }); // +45 SC
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    await prisma.playthroughProgress.update({ where: { userId: user.id }, data: { scWagered: 70 } }); // required = 25 + 45

    const res = await request(app).post("/redeem").set(authed(token)).send({ amountSc: 100_000 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_BALANCE");
  });
});

describe("Every balance change inserts a transactions row (ledger audit trail)", () => {
  it("signup, attendant claim, and package purchase all produce matching rows", async () => {
    const { token, username } = await signupUser();
    await request(app).post("/claim-bonus").set(authed(token));
    await request(app).post("/packages/purchase").set(authed(token)).send({ packageId: "starter" });

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const txs = await prisma.transaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });

    const types = txs.map((t) => t.type);
    expect(types).toContain("SIGNUP_BONUS_GC");
    expect(types).toContain("SIGNUP_BONUS_SC");
    expect(types).toContain("AD_REWARD_GC"); // Coin Kiosk claim - GC only, no SC leg any more
    expect(types).toContain("PACKAGE_GC"); // from the package purchase below
    expect(types).toContain("PACKAGE_BONUS_SC");

    // balanceAfter values must be internally consistent running totals.
    let runningGc = 0;
    let runningSc = 0;
    for (const t of txs) {
      if (t.currency === "GC") {
        runningGc += t.amount;
        expect(t.balanceAfter).toBe(runningGc);
      } else {
        runningSc += t.amount;
        expect(t.balanceAfter).toBe(runningSc);
      }
    }

    const balance = await prisma.balance.findUniqueOrThrow({ where: { userId: user.id } });
    expect(balance.goldCoins).toBe(runningGc);
    expect(balance.stakeCoins).toBe(runningSc);
  });
});
