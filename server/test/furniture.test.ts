import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { applyTransaction } from "../src/economy/ledger";
import { resetDb, signupUser, authed } from "./helpers";
import { FURNITURE_CATALOG, FURNITURE_SLOTS } from "../src/furnitureCatalog";

beforeEach(resetDb);

/** Same real-ledger top-up pattern as room.test.ts's topUpGc. */
async function topUpGc(username: string, amount: number): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.$transaction((tx) =>
    applyTransaction(tx, user.id, "GC", "ADJUST_GC", amount, { reason: "test bankroll top-up" })
  );
}

const armchair = FURNITURE_CATALOG.find((p) => p.id === "furniture_armchair")!; // 350
const lamp = FURNITURE_CATALOG.find((p) => p.id === "furniture_floor_lamp")!; // 220
const plant = FURNITURE_CATALOG.find((p) => p.id === "furniture_potted_plant")!; // 200

describe("GET /furniture/catalog", () => {
  it("serves slots and pieces without auth - it's static catalogue data", async () => {
    const res = await request(app).get("/furniture/catalog");
    expect(res.status).toBe(200);
    expect(res.body.pieces.length).toBe(FURNITURE_CATALOG.length);
    expect(res.body.slots.length).toBe(FURNITURE_SLOTS.length);
  });
});

describe("POST /furniture/buy", () => {
  it("buys an affordable piece with GC through the ledger", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, armchair.price);

    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: armchair.id });

    expect(res.status).toBe(200);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - armchair.price);
    expect(res.body.user.furniture.owned).toContain(armchair.id);

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const tx = await prisma.transaction.findFirst({
      where: { userId: user.id, type: "SHOP_PURCHASE_GC" }
    });
    expect(tx).not.toBeNull();
    expect(tx!.currency).toBe("GC");
    expect(tx!.amount).toBe(-armchair.price);
    expect(tx!.meta).toMatchObject({ furniturePieceId: armchair.id });
  });

  it("does NOT place the piece - buying and placing are separate actions", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, armchair.price);

    const res = await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: armchair.id });

    expect(res.body.user.furniture.owned).toContain(armchair.id);
    expect(res.body.user.furniture.placed).toEqual({});
  });

  it("rejects an unaffordable purchase", async () => {
    const { token, username } = await signupUser();
    const before = await request(app).get("/me").set(authed(token));
    await topUpGc(username, -before.body.goldCoins);

    const res = await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: armchair.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_GC");

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.goldCoins).toBe(0);
    expect(me.body.furniture.owned).not.toContain(armchair.id);
  });

  it("rejects buying the same piece twice", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, armchair.price * 2);

    await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: armchair.id });
    const res = await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: armchair.id });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_OWNED");
  });

  it("rejects an unknown piece id", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: "not_a_piece" });
    expect(res.status).toBe(404);
  });
});

describe("POST /furniture/place", () => {
  it("rejects placing a piece not owned", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/furniture/place")
      .set(authed(token))
      .send({ pieceId: armchair.id, slot: "WALL_LEFT" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_OWNED");
  });

  it("rejects placing into a slot that doesn't exist", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, armchair.price);
    await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: armchair.id });

    const res = await request(app)
      .post("/furniture/place")
      .set(authed(token))
      .send({ pieceId: armchair.id, slot: "NOT_A_REAL_SLOT" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SLOT_NOT_FOUND");
  });

  it("places an owned piece into an empty slot", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, armchair.price);
    await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: armchair.id });

    const res = await request(app)
      .post("/furniture/place")
      .set(authed(token))
      .send({ pieceId: armchair.id, slot: "WALL_LEFT" });

    expect(res.status).toBe(200);
    expect(res.body.user.furniture.placed.WALL_LEFT).toBe(armchair.id);
  });

  it("placing into an occupied slot replaces the previous occupant, which stays owned but unplaced", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, armchair.price + lamp.price);
    await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: armchair.id });
    await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: lamp.id });

    await request(app)
      .post("/furniture/place")
      .set(authed(token))
      .send({ pieceId: armchair.id, slot: "WALL_LEFT" });

    const res = await request(app)
      .post("/furniture/place")
      .set(authed(token))
      .send({ pieceId: lamp.id, slot: "WALL_LEFT" });

    expect(res.status).toBe(200);
    expect(res.body.user.furniture.placed.WALL_LEFT).toBe(lamp.id);
    // The armchair is nowhere now - still owned, just not placed anywhere.
    expect(res.body.user.furniture.owned).toContain(armchair.id);
    expect(Object.values(res.body.user.furniture.placed)).not.toContain(armchair.id);
  });

  it("placing an already-placed piece into a different slot moves it, rather than duplicating it", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, armchair.price);
    await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: armchair.id });

    await request(app)
      .post("/furniture/place")
      .set(authed(token))
      .send({ pieceId: armchair.id, slot: "WALL_LEFT" });

    const res = await request(app)
      .post("/furniture/place")
      .set(authed(token))
      .send({ pieceId: armchair.id, slot: "CORNER" });

    expect(res.status).toBe(200);
    expect(res.body.user.furniture.placed.CORNER).toBe(armchair.id);
    expect(res.body.user.furniture.placed.WALL_LEFT).toBeUndefined();
  });

  it("rejects an unknown piece id", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/furniture/place")
      .set(authed(token))
      .send({ pieceId: "nope", slot: "WALL_LEFT" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

describe("POST /furniture/remove", () => {
  it("removes a placed piece, leaving the slot empty", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, armchair.price);
    await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: armchair.id });
    await request(app)
      .post("/furniture/place")
      .set(authed(token))
      .send({ pieceId: armchair.id, slot: "WALL_LEFT" });

    const res = await request(app).post("/furniture/remove").set(authed(token)).send({ slot: "WALL_LEFT" });

    expect(res.status).toBe(200);
    expect(res.body.user.furniture.placed.WALL_LEFT).toBeUndefined();
    // Still owned - removing from a slot doesn't un-buy it.
    expect(res.body.user.furniture.owned).toContain(armchair.id);
  });

  it("removing an already-empty slot is a harmless no-op", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/furniture/remove").set(authed(token)).send({ slot: "CORNER" });
    expect(res.status).toBe(200);
    expect(res.body.user.furniture.placed.CORNER).toBeUndefined();
  });

  it("rejects a slot that doesn't exist", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/furniture/remove")
      .set(authed(token))
      .send({ slot: "NOT_A_REAL_SLOT" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SLOT_NOT_FOUND");
  });
});

describe("placement survives a reload", () => {
  it("a bought-and-placed piece is still there on a fresh GET /me", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, armchair.price + plant.price);

    await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: armchair.id });
    await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: plant.id });
    await request(app)
      .post("/furniture/place")
      .set(authed(token))
      .send({ pieceId: armchair.id, slot: "WALL_LEFT" });
    await request(app)
      .post("/furniture/place")
      .set(authed(token))
      .send({ pieceId: plant.id, slot: "BY_DOOR" });

    // A brand-new request, standing in for "the player reloaded the page".
    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.furniture.placed.WALL_LEFT).toBe(armchair.id);
    expect(me.body.furniture.placed.BY_DOOR).toBe(plant.id);
    expect(me.body.furniture.owned).toEqual(expect.arrayContaining([armchair.id, plant.id]));

    // And it's real database state, not just serializer memoization.
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const rows = await prisma.furniturePlaced.findMany({ where: { userId: user.id } });
    expect(rows.map((r) => r.pieceId).sort()).toEqual([armchair.id, plant.id].sort());
  });
});

describe("a brand-new account", () => {
  it("owns nothing and every slot is empty", async () => {
    const { token, username } = await signupUser();

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(await prisma.furnitureOwned.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.furniturePlaced.count({ where: { userId: user.id } })).toBe(0);

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.furniture.owned).toEqual([]);
    expect(me.body.furniture.placed).toEqual({});
  });

  it("falls back to empty when the stored piece no longer exists in the catalogue", async () => {
    const { token, username } = await signupUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });

    await prisma.furniturePlaced.create({
      data: { userId: user.id, slot: "WALL_LEFT", pieceId: "furniture_retired_long_ago" }
    });

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.furniture.placed.WALL_LEFT).toBeUndefined();
  });
});
