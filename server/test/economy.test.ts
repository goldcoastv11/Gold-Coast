import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, signupUser, authed } from "./helpers";
import { GC_PACKAGES } from "../src/economy/packages";
import { GC_MULTIPLIERS, GC_MULTIPLIER_BASE } from "../src/economy/gcMultiplier";

beforeEach(resetDb);

describe("POST /claim-bonus (Coin Kiosk claim, formerly the Chip Attendant's - GC only, no TICKETS)", () => {
  it("grants GC via a server-resolved multiplier and never touches TICKETS", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/claim-bonus").set(authed(token));

    expect(res.status).toBe(200);
    expect(GC_MULTIPLIERS).toContain(res.body.granted.gcMultiplier);
    expect(res.body.granted.gcAmount).toBe(GC_MULTIPLIER_BASE * res.body.granted.gcMultiplier);

    expect(res.body.user.goldCoins).toBe(before.body.goldCoins + res.body.granted.gcAmount);
    expect(res.body.user.tickets).toBe(before.body.tickets);
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
  it("lists the exact tier catalog (GC-only, no SC bonus)", async () => {
    const res = await request(app).get("/packages");
    expect(res.status).toBe(200);
    expect(res.body.packages).toEqual(GC_PACKAGES);
    for (const pkg of res.body.packages) {
      expect(pkg.scBonus).toBeUndefined();
    }
  });
});

describe("POST /packages/purchase", () => {
  it("grants a package's exact GC amount, no SC/playthrough", async () => {
    const { token } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));
    const pkg = GC_PACKAGES.find((p) => p.id === "gold")!;

    const res = await request(app).post("/packages/purchase").set(authed(token)).send({ packageId: "gold" });

    expect(res.status).toBe(200);
    expect(res.body.granted.gcAmount).toBe(pkg.gcAmount);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins + pkg.gcAmount);
    expect(res.body.user.tickets).toBe(before.body.tickets);
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

describe("Every balance change inserts a transactions row (ledger audit trail)", () => {
  it("signup, attendant claim, and package purchase all produce matching GC-only rows", async () => {
    const { token, username } = await signupUser();
    await request(app).post("/claim-bonus").set(authed(token));
    await request(app).post("/packages/purchase").set(authed(token)).send({ packageId: "starter" });

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const txs = await prisma.transaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });

    const types = txs.map((t) => t.type);
    expect(types).toContain("SIGNUP_BONUS_GC");
    expect(types).toContain("AD_REWARD_GC"); // Coin Kiosk claim - GC only
    expect(types).toContain("PACKAGE_GC"); // from the package purchase below
    expect(types).not.toContain("SIGNUP_BONUS_SC");
    expect(types).not.toContain("PACKAGE_BONUS_SC");

    // balanceAfter values must be an internally consistent running total (GC only here).
    let runningGc = 0;
    for (const t of txs) {
      expect(t.currency).toBe("GC");
      runningGc += t.amount;
      expect(t.balanceAfter).toBe(runningGc);
    }

    const balance = await prisma.balance.findUniqueOrThrow({ where: { userId: user.id } });
    expect(balance.goldCoins).toBe(runningGc);
    expect(balance.tickets).toBe(0);
  });
});
