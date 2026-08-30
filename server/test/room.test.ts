import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { applyTransaction } from "../src/economy/ledger";
import { resetDb, signupUser, authed } from "./helpers";
import { ROOM_CATALOG, ROOM_SLOTS, DEFAULT_PIECE_ID } from "../src/roomCatalog";

beforeEach(resetDb);

/**
 * Room decor, like wardrobe pieces before it, is bought with GC. Seed a
 * test bankroll through the real ledger (ADJUST_GC) rather than writing a
 * balance directly - same pattern wardrobe.test.ts's topUpGc uses.
 */
async function topUpGc(username: string, amount: number): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.$transaction((tx) =>
    applyTransaction(tx, user.id, "GC", "ADJUST_GC", amount, { reason: "test bankroll top-up" })
  );
}

const wallpaper = ROOM_CATALOG.find((p) => p.id === "room_wallpaper_stripe")!; // 400
const otherWallpaper = ROOM_CATALOG.find((p) => p.id === "room_wallpaper_floral")!; // 650
const flooring = ROOM_CATALOG.find((p) => p.id === "room_floor_checker")!; // 400

describe("GET /room/catalog", () => {
  it("serves slots and pieces without auth - it's static catalogue data", async () => {
    const res = await request(app).get("/room/catalog");
    expect(res.status).toBe(200);
    expect(res.body.pieces.length).toBe(ROOM_CATALOG.length);
    expect(res.body.slots.length).toBe(ROOM_SLOTS.length);
  });

  it("marks both slots as never-empty", async () => {
    const res = await request(app).get("/room/catalog");
    for (const slot of res.body.slots) {
      expect(slot.optional).toBe(false);
    }
  });
});

describe("POST /room/buy", () => {
  it("buys an affordable piece with GC through the ledger", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, wallpaper.price);

    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/room/buy").set(authed(token)).send({ pieceId: wallpaper.id });

    expect(res.status).toBe(200);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - wallpaper.price);
    expect(res.body.user.room.owned).toContain(wallpaper.id);

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const tx = await prisma.transaction.findFirst({
      where: { userId: user.id, type: "SHOP_PURCHASE_GC" }
    });
    expect(tx).not.toBeNull();
    expect(tx!.currency).toBe("GC");
    expect(tx!.amount).toBe(-wallpaper.price);
    expect(tx!.meta).toMatchObject({ roomPieceId: wallpaper.id, roomSlot: "WALLPAPER" });
  });

  it("applies the piece immediately - buying it means it's equipped", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, wallpaper.price);

    const res = await request(app).post("/room/buy").set(authed(token)).send({ pieceId: wallpaper.id });
    expect(res.body.user.room.equipped.WALLPAPER).toBe(wallpaper.id);
    // Buying wallpaper doesn't touch flooring.
    expect(res.body.user.room.equipped.FLOORING).toBe(DEFAULT_PIECE_ID.FLOORING);
  });

  it("rejects an unaffordable purchase", async () => {
    const { token, username } = await signupUser();
    // Signup GC is randomized - drain to exactly 0 first so this is
    // unaffordable regardless of the starting balance.
    const before = await request(app).get("/me").set(authed(token));
    await topUpGc(username, -before.body.goldCoins);

    const res = await request(app).post("/room/buy").set(authed(token)).send({ pieceId: wallpaper.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_GC");

    // Balance and ownership are both untouched by the rejected purchase.
    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.goldCoins).toBe(0);
    expect(me.body.room.owned).not.toContain(wallpaper.id);
  });

  it("rejects buying a piece already owned", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, wallpaper.price * 2);

    await request(app).post("/room/buy").set(authed(token)).send({ pieceId: wallpaper.id });
    const res = await request(app).post("/room/buy").set(authed(token)).send({ pieceId: wallpaper.id });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_OWNED");
  });

  it("rejects buying a free default piece - it's already owned by everyone", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, 500);
    const res = await request(app)
      .post("/room/buy")
      .set(authed(token))
      .send({ pieceId: DEFAULT_PIECE_ID.WALLPAPER });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_OWNED");
  });

  it("rejects an unknown piece id", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/room/buy").set(authed(token)).send({ pieceId: "not_a_piece" });
    expect(res.status).toBe(404);
  });
});

describe("POST /room/equip", () => {
  it("rejects equipping a piece not owned - cannot place something you don't own", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/room/equip").set(authed(token)).send({ pieceId: wallpaper.id });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_OWNED");
  });

  it("swaps between two owned pieces in the same slot", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, wallpaper.price + otherWallpaper.price);

    await request(app).post("/room/buy").set(authed(token)).send({ pieceId: wallpaper.id });
    await request(app).post("/room/buy").set(authed(token)).send({ pieceId: otherWallpaper.id });

    // Swap back to the first - both owned, only one applied.
    const res = await request(app).post("/room/equip").set(authed(token)).send({ pieceId: wallpaper.id });
    expect(res.status).toBe(200);
    expect(res.body.user.room.equipped.WALLPAPER).toBe(wallpaper.id);
  });

  it("always allows equipping a free default piece", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/room/equip")
      .set(authed(token))
      .send({ pieceId: DEFAULT_PIECE_ID.FLOORING });

    expect(res.status).toBe(200);
    expect(res.body.user.room.equipped.FLOORING).toBe(DEFAULT_PIECE_ID.FLOORING);
  });

  it("rejects an unknown piece id", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/room/equip").set(authed(token)).send({ pieceId: "nope" });
    expect(res.status).toBe(404);
  });
});

describe("placement survives a reload", () => {
  it("a bought-and-applied wallpaper/flooring combo is still there on a fresh GET /me", async () => {
    const { token, username } = await signupUser();
    await topUpGc(username, wallpaper.price + flooring.price);

    await request(app).post("/room/buy").set(authed(token)).send({ pieceId: wallpaper.id });
    await request(app).post("/room/buy").set(authed(token)).send({ pieceId: flooring.id });

    // A brand-new request, standing in for "the player reloaded the page" -
    // nothing here reuses in-memory state from the buy calls above.
    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.room.equipped.WALLPAPER).toBe(wallpaper.id);
    expect(me.body.room.equipped.FLOORING).toBe(flooring.id);
    expect(me.body.room.owned).toEqual(expect.arrayContaining([wallpaper.id, flooring.id]));

    // And it's real database state, not just serializer memoization.
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const rows = await prisma.roomEquipped.findMany({ where: { userId: user.id } });
    expect(rows.map((r) => r.pieceId).sort()).toEqual([flooring.id, wallpaper.id].sort());
  });
});

describe("the always-decorated-room invariant", () => {
  it("reports a fully-decorated room for a brand-new account with no room rows at all", async () => {
    const { token, username } = await signupUser();

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(await prisma.roomOwned.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.roomEquipped.count({ where: { userId: user.id } })).toBe(0);

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.room.equipped.WALLPAPER).toBe(DEFAULT_PIECE_ID.WALLPAPER);
    expect(me.body.room.equipped.FLOORING).toBe(DEFAULT_PIECE_ID.FLOORING);
    expect(me.body.room.owned).toEqual(
      expect.arrayContaining([DEFAULT_PIECE_ID.WALLPAPER, DEFAULT_PIECE_ID.FLOORING])
    );
  });

  it("falls back to the default when the stored piece no longer exists in the catalogue", async () => {
    const { token, username } = await signupUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });

    await prisma.roomEquipped.create({
      data: { userId: user.id, slot: "WALLPAPER", pieceId: "room_wallpaper_retired_long_ago" }
    });

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.room.equipped.WALLPAPER).toBe(DEFAULT_PIECE_ID.WALLPAPER);
  });
});
