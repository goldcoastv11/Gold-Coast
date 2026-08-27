import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { applyTransaction } from "../src/economy/ledger";
import { resetDb, signupUser, authed } from "./helpers";
import { ITEM_CATALOG } from "../src/itemCatalog";

beforeEach(resetDb);

/**
 * Items (accessories/pets), like skins, are purchased with TICKETS, and
 * TICKETS can only ever be credited via a real game win (GAME_WIN_TICKETS -
 * see ledger.test.ts's "one sanctioned path" test). Seed a TICKETS bankroll
 * directly through the real ledger function, same as skins.test.ts's
 * topUpTickets.
 */
async function topUpTickets(username: string, amount: number): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.$transaction((tx) =>
    applyTransaction(tx, user.id, "TICKETS", "GAME_WIN_TICKETS", amount, { reason: "test bankroll top-up" })
  );
}

const accessory = ITEM_CATALOG.find((i) => i.id === "acc_bow")!; // price 150
const pet = ITEM_CATALOG.find((i) => i.id === "pet_buddy")!; // price 500

describe("POST /items/buy", () => {
  it("buys an affordable accessory with TICKETS and never touches GC", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, accessory.price);

    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/items/buy").set(authed(token)).send({ itemId: accessory.id });

    expect(res.status).toBe(200);
    expect(res.body.user.tickets).toBe(before.body.tickets - accessory.price);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins); // GC untouched
    expect(res.body.user.ownedItems).toContain(accessory.id);
    expect(res.body.user.equippedAccessory).toBe(accessory.id);

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const tx = await prisma.transaction.findFirst({ where: { userId: user.id, type: "SKIN_PURCHASE_TICKETS" } });
    expect(tx).not.toBeNull();
    expect(tx!.currency).toBe("TICKETS");
    expect(tx!.amount).toBe(-accessory.price);
  });

  it("buying a pet doesn't touch the accessory slot, and vice versa", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, accessory.price + pet.price);

    await request(app).post("/items/buy").set(authed(token)).send({ itemId: accessory.id });
    const res = await request(app).post("/items/buy").set(authed(token)).send({ itemId: pet.id });

    expect(res.status).toBe(200);
    expect(res.body.user.equippedAccessory).toBe(accessory.id);
    expect(res.body.user.equippedPet).toBe(pet.id);
    expect(res.body.user.ownedItems).toEqual(expect.arrayContaining([accessory.id, pet.id]));
  });

  it("buying a second accessory replaces the equipped one but keeps both owned", async () => {
    const { token, username } = await signupUser();
    const other = ITEM_CATALOG.find((i) => i.category === "ACCESSORY" && i.id !== accessory.id)!;
    await topUpTickets(username, accessory.price + other.price);

    await request(app).post("/items/buy").set(authed(token)).send({ itemId: accessory.id });
    const res = await request(app).post("/items/buy").set(authed(token)).send({ itemId: other.id });

    expect(res.status).toBe(200);
    expect(res.body.user.equippedAccessory).toBe(other.id);
    expect(res.body.user.ownedItems).toEqual(expect.arrayContaining([accessory.id, other.id]));
  });

  it("rejects buying an item that can't be afforded", async () => {
    const { token } = await signupUser();
    const expensive = ITEM_CATALOG.find((i) => i.id === "acc_crown")!; // price 800, above a fresh signup's 0 TICKETS
    const res = await request(app).post("/items/buy").set(authed(token)).send({ itemId: expensive.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_TICKETS");
  });

  it("rejects buying an item already owned", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, 1000);
    await request(app).post("/items/buy").set(authed(token)).send({ itemId: accessory.id });

    const res = await request(app).post("/items/buy").set(authed(token)).send({ itemId: accessory.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_OWNED");
  });

  it("rejects an unknown item id", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/items/buy").set(authed(token)).send({ itemId: "not-a-real-item" });
    expect(res.status).toBe(404);
  });
});

describe("POST /items/equip", () => {
  it("equips an owned item", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, 1000);
    await request(app).post("/items/buy").set(authed(token)).send({ itemId: pet.id });
    await request(app).post("/items/unequip").set(authed(token)).send({ category: "PET" });

    const res = await request(app).post("/items/equip").set(authed(token)).send({ itemId: pet.id });
    expect(res.status).toBe(200);

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.equippedPet).toBe(pet.id);
  });

  it("rejects equipping an item not owned", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/items/equip").set(authed(token)).send({ itemId: pet.id });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_OWNED");
  });

  it("rejects an unknown item id", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/items/equip").set(authed(token)).send({ itemId: "not-a-real-item" });
    expect(res.status).toBe(404);
  });
});

describe("POST /items/unequip", () => {
  it("clears the equipped item for a category - unlike skins, 'nothing' is a valid state", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, accessory.price);
    await request(app).post("/items/buy").set(authed(token)).send({ itemId: accessory.id });

    const res = await request(app).post("/items/unequip").set(authed(token)).send({ category: "ACCESSORY" });
    expect(res.status).toBe(200);
    expect(res.body.user.equippedAccessory).toBeNull();

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.equippedAccessory).toBeNull();
    // still owned, just not worn
    expect(me.body.ownedItems).toContain(accessory.id);
  });

  it("is a no-op (200) when nothing is equipped in that category", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/items/unequip").set(authed(token)).send({ category: "PET" });
    expect(res.status).toBe(200);
  });

  it("rejects an invalid category", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/items/unequip").set(authed(token)).send({ category: "NOT_REAL" });
    expect(res.status).toBe(400);
  });
});
