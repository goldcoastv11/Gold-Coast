import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { applyTransaction } from "../src/economy/ledger";
import { resetDb, signupUser, authed } from "./helpers";
import { SKIN_CATALOG } from "../src/skinCatalog";

beforeEach(resetDb);

/**
 * Skins are purchased with TICKETS, and TICKETS can only ever be credited
 * via a real game win (GAME_WIN_TICKETS - see ledger.test.ts's "one
 * sanctioned path" test). There's no purchase/grant route for TICKETS to
 * hit over HTTP, so tests that need a TICKETS bankroll seed it directly
 * through the real ledger function, exactly like games5.test.ts's
 * `topUpGold` seeds a GC bankroll via ADJUST_GC.
 */
async function topUpTickets(username: string, amount: number): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.$transaction((tx) =>
    applyTransaction(tx, user.id, "TICKETS", "GAME_WIN_TICKETS", amount, { reason: "test bankroll top-up" })
  );
}

describe("POST /skins/buy", () => {
  it("buys an affordable skin with TICKETS and never touches GC", async () => {
    const { token, username } = await signupUser();
    const skin = SKIN_CATALOG.find((s) => s.id === "skin_001")!; // price 250
    await topUpTickets(username, skin.price);

    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/skins/buy").set(authed(token)).send({ skinId: skin.id });

    expect(res.status).toBe(200);
    expect(res.body.user.tickets).toBe(before.body.tickets - skin.price);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins); // GC untouched
    expect(res.body.user.skinsOwned).toContain(skin.id);

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const tx = await prisma.transaction.findFirst({ where: { userId: user.id, type: "SKIN_PURCHASE_TICKETS" } });
    expect(tx).not.toBeNull();
    expect(tx!.currency).toBe("TICKETS");
    expect(tx!.amount).toBe(-skin.price);
  });

  it("equips the skin immediately on purchase - buying it means wearing it", async () => {
    const { token, username } = await signupUser();
    const skin = SKIN_CATALOG.find((s) => s.id === "skin_001")!;
    await topUpTickets(username, skin.price);

    const res = await request(app).post("/skins/buy").set(authed(token)).send({ skinId: skin.id });
    expect(res.status).toBe(200);
    expect(res.body.user.equippedSkin).toBe(skin.id);

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.equippedSkin).toBe(skin.id);
  });

  it("rejects buying a skin that can't be afforded", async () => {
    const { token } = await signupUser();
    const expensive = SKIN_CATALOG.find((s) => s.id === "skin_014")!; // price 4000, way above a fresh signup's 0 TICKETS
    const res = await request(app).post("/skins/buy").set(authed(token)).send({ skinId: expensive.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_TICKETS");
  });

  it("rejects buying a skin already owned", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, 1000);
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
    const { token, username } = await signupUser();
    await topUpTickets(username, 1000);
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
