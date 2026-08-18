import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, signupUser, authed } from "./helpers";
import { SKIN_CATALOG } from "../src/skinCatalog";

beforeEach(resetDb);

describe("POST /skins/buy", () => {
  it("buys an affordable skin with GC and never touches SC", async () => {
    const { token, username } = await signupUser();
    // Give enough GC via a package purchase (signup bonus alone may not cover pricier skins).
    await request(app).post("/packages/purchase").set(authed(token)).send({ packageId: "gold" });

    const before = await request(app).get("/me").set(authed(token));
    const skin = SKIN_CATALOG.find((s) => s.id === "skin_001")!; // price 250

    const res = await request(app).post("/skins/buy").set(authed(token)).send({ skinId: skin.id });

    expect(res.status).toBe(200);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins - skin.price);
    expect(res.body.user.stakeCoins).toBe(before.body.stakeCoins); // SC untouched
    expect(res.body.user.skinsOwned).toContain(skin.id);

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const tx = await prisma.transaction.findFirst({ where: { userId: user.id, type: "SKIN_PURCHASE_GC" } });
    expect(tx).not.toBeNull();
    expect(tx!.currency).toBe("GC");
    expect(tx!.amount).toBe(-skin.price);
  });

  it("rejects buying a skin that can't be afforded", async () => {
    const { token } = await signupUser();
    const expensive = SKIN_CATALOG.find((s) => s.id === "skin_014")!; // price 4000, way above signup GC
    const res = await request(app).post("/skins/buy").set(authed(token)).send({ skinId: expensive.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_GC");
  });

  it("rejects buying a skin already owned", async () => {
    const { token } = await signupUser();
    await request(app).post("/packages/purchase").set(authed(token)).send({ packageId: "gold" });
    await request(app).post("/skins/buy").set(authed(token)).send({ skinId: "skin_001" });

    const res = await request(app).post("/skins/buy").set(authed(token)).send({ skinId: "skin_001" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_OWNED");
  });

  it("rejects an unknown skin id", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/skins/buy").set(authed(token)).send({ skinId: "not-a-real-skin" });
    expect(res.status).toBe(404);
  });
});

describe("POST /skins/equip", () => {
  it("equips a skin the player owns", async () => {
    const { token } = await signupUser();
    await request(app).post("/packages/purchase").set(authed(token)).send({ packageId: "gold" });
    await request(app).post("/skins/buy").set(authed(token)).send({ skinId: "skin_001" });

    const res = await request(app).post("/skins/equip").set(authed(token)).send({ skinId: "skin_001" });
    expect(res.status).toBe(200);
    expect(res.body.equippedSkin).toBe("skin_001");

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.equippedSkin).toBe("skin_001");
  });

  it("rejects equipping a skin not owned", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/skins/equip").set(authed(token)).send({ skinId: "skin_002" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_OWNED");
  });

  it("always allows equipping the free default 'player' skin", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/skins/equip").set(authed(token)).send({ skinId: "player" });
    expect(res.status).toBe(200);
  });
});
