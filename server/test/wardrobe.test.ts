import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { applyTransaction } from "../src/economy/ledger";
import { resetDb, signupUser, authed } from "./helpers";
import { WARDROBE_CATALOG, WARDROBE_SLOTS, DEFAULT_BODY_PIECE_ID } from "../src/wardrobeCatalog";

beforeEach(resetDb);

/**
 * Wardrobe pieces, like the accessories/pets before them, are bought with
 * TICKETS - and TICKETS can only ever be credited by a real game win
 * (GAME_WIN_TICKETS, enforced in the ledger itself - see ledger.test.ts's
 * "one sanctioned path" test). So a test bankroll has to be seeded through
 * that same real path, not by writing a balance directly. Same helper the
 * deleted skins.test.ts and the surviving items.test.ts both use.
 */
async function topUpTickets(username: string, amount: number): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.$transaction((tx) =>
    applyTransaction(tx, user.id, "TICKETS", "GAME_WIN_TICKETS", amount, { reason: "test bankroll top-up" })
  );
}

const shirt = WARDROBE_CATALOG.find((p) => p.id === "torso_tee")!; // 200
const otherShirt = WARDROBE_CATALOG.find((p) => p.id === "torso_hoodie")!; // 380
const trousers = WARDROBE_CATALOG.find((p) => p.id === "legs_jeans")!; // 200
const hat = WARDROBE_CATALOG.find((p) => p.id === "hat_cap")!; // 250
const body = WARDROBE_CATALOG.find((p) => p.id === "body_tan")!; // 150

describe("GET /wardrobe/catalog", () => {
  it("serves slots and pieces without auth - it's static catalogue data", async () => {
    const res = await request(app).get("/wardrobe/catalog");
    expect(res.status).toBe(200);
    expect(res.body.pieces.length).toBe(WARDROBE_CATALOG.length);
    expect(res.body.slots.length).toBe(WARDROBE_SLOTS.length);
  });

  it("declares an explicit draw order, with BODY lowest and HAT highest", async () => {
    const res = await request(app).get("/wardrobe/catalog");
    const byZ = [...res.body.slots].sort((a: { z: number }, b: { z: number }) => a.z - b.z);
    expect(byZ[0].slot).toBe("BODY");
    expect(byZ[byZ.length - 1].slot).toBe("HAT");
    // Every slot's z must be distinct, or "what draws on top" is a coin flip.
    const zs = res.body.slots.map((s: { z: number }) => s.z);
    expect(new Set(zs).size).toBe(zs.length);
  });

  it("marks BODY as the one slot that can't be left empty", async () => {
    const res = await request(app).get("/wardrobe/catalog");
    const optionalFlags = Object.fromEntries(
      res.body.slots.map((s: { slot: string; optional: boolean }) => [s.slot, s.optional])
    );
    expect(optionalFlags.BODY).toBe(false);
    for (const [slot, optional] of Object.entries(optionalFlags)) {
      if (slot !== "BODY") expect(optional).toBe(true);
    }
  });
});

describe("POST /wardrobe/buy", () => {
  it("buys an affordable piece with TICKETS and never touches GC", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, shirt.price);

    const before = await request(app).get("/me").set(authed(token));

    const res = await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: shirt.id });

    expect(res.status).toBe(200);
    expect(res.body.user.tickets).toBe(before.body.tickets - shirt.price);
    expect(res.body.user.goldCoins).toBe(before.body.goldCoins); // GC untouched
    expect(res.body.user.wardrobe.owned).toContain(shirt.id);

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const tx = await prisma.transaction.findFirst({
      where: { userId: user.id, type: "SKIN_PURCHASE_TICKETS" }
    });
    expect(tx).not.toBeNull();
    expect(tx!.currency).toBe("TICKETS");
    expect(tx!.amount).toBe(-shirt.price);
    // The slot/piece is recorded in meta for audit rather than in a new
    // transaction type - see economy/wardrobe.ts's header.
    expect(tx!.meta).toMatchObject({ wardrobePieceId: shirt.id, wardrobeSlot: "TORSO" });
  });

  it("wears the piece immediately - buying it means wearing it", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, shirt.price);

    const res = await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: shirt.id });
    expect(res.body.user.wardrobe.equipped.TORSO).toBe(shirt.id);
  });

  it("buying a piece for one slot leaves the other slots alone", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, shirt.price + trousers.price + hat.price);

    await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: shirt.id });
    await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: trousers.id });
    const res = await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: hat.id });

    // The whole point of the layered model: three purchases produce one
    // character wearing all three, not three separate characters.
    expect(res.body.user.wardrobe.equipped).toMatchObject({
      BODY: DEFAULT_BODY_PIECE_ID,
      TORSO: shirt.id,
      LEGS: trousers.id,
      HAT: hat.id
    });
    expect(res.body.user.wardrobe.owned).toEqual(
      expect.arrayContaining([shirt.id, trousers.id, hat.id])
    );
  });

  it("buying a second piece for the same slot swaps what's worn but keeps both owned", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, shirt.price + otherShirt.price);

    await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: shirt.id });
    const res = await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: otherShirt.id });

    expect(res.body.user.wardrobe.equipped.TORSO).toBe(otherShirt.id);
    expect(res.body.user.wardrobe.owned).toEqual(expect.arrayContaining([shirt.id, otherShirt.id]));
  });

  it("rejects a piece that can't be afforded", async () => {
    const { token } = await signupUser(); // 0 TICKETS - they're only won by playing
    const res = await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: shirt.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_TICKETS");
  });

  it("rejects buying a piece already owned", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, shirt.price * 2);

    await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: shirt.id });
    const res = await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: shirt.id });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_OWNED");
  });

  it("rejects buying the free default body - it's already owned by everyone", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, 500);
    const res = await request(app)
      .post("/wardrobe/buy")
      .set(authed(token))
      .send({ pieceId: DEFAULT_BODY_PIECE_ID });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_OWNED");
  });

  it("rejects an unknown piece id", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: "not_a_piece" });
    expect(res.status).toBe(404);
  });
});

describe("POST /wardrobe/equip", () => {
  it("equips a piece the player owns", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, shirt.price + otherShirt.price);

    await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: shirt.id });
    await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: otherShirt.id });

    // Swap back to the first shirt - both are owned, only one is worn.
    const res = await request(app).post("/wardrobe/equip").set(authed(token)).send({ pieceId: shirt.id });
    expect(res.status).toBe(200);
    expect(res.body.user.wardrobe.equipped.TORSO).toBe(shirt.id);

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.wardrobe.equipped.TORSO).toBe(shirt.id);
  });

  it("swapping the body keeps everything else worn", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, shirt.price + body.price);

    await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: shirt.id });
    const res = await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: body.id });

    expect(res.body.user.wardrobe.equipped.BODY).toBe(body.id);
    expect(res.body.user.wardrobe.equipped.TORSO).toBe(shirt.id);
  });

  it("rejects equipping a piece not owned", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/wardrobe/equip").set(authed(token)).send({ pieceId: shirt.id });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_OWNED");
  });

  it("always allows equipping the free default body", async () => {
    const { token } = await signupUser();
    const res = await request(app)
      .post("/wardrobe/equip")
      .set(authed(token))
      .send({ pieceId: DEFAULT_BODY_PIECE_ID });

    expect(res.status).toBe(200);
    expect(res.body.user.wardrobe.equipped.BODY).toBe(DEFAULT_BODY_PIECE_ID);
  });

  it("rejects an unknown piece id", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/wardrobe/equip").set(authed(token)).send({ pieceId: "nope" });
    expect(res.status).toBe(404);
  });
});

describe("POST /wardrobe/unequip", () => {
  it("takes off an optional slot, leaving the piece owned but not worn", async () => {
    const { token, username } = await signupUser();
    await topUpTickets(username, hat.price);
    await request(app).post("/wardrobe/buy").set(authed(token)).send({ pieceId: hat.id });

    const res = await request(app).post("/wardrobe/unequip").set(authed(token)).send({ slot: "HAT" });
    expect(res.status).toBe(200);
    expect(res.body.user.wardrobe.equipped.HAT).toBeUndefined();
    expect(res.body.user.wardrobe.owned).toContain(hat.id);
  });

  it("is a no-op (200) when nothing is worn in that slot", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/wardrobe/unequip").set(authed(token)).send({ slot: "HAIR" });
    expect(res.status).toBe(200);
  });

  it("REFUSES to take off the body - the one slot that can never be empty", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/wardrobe/unequip").set(authed(token)).send({ slot: "BODY" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SLOT_NOT_OPTIONAL");

    // And the body is still there afterwards - this is the single API call
    // that could otherwise produce an invisible player.
    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.wardrobe.equipped.BODY).toBe(DEFAULT_BODY_PIECE_ID);
  });

  it("rejects an unknown slot", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/wardrobe/unequip").set(authed(token)).send({ slot: "ELBOWS" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });
});

describe("the never-invisible-player invariant", () => {
  it("reports a wearable body for a brand-new account with no wardrobe rows at all", async () => {
    const { token, username } = await signupUser();

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(await prisma.wardrobeOwned.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.equippedWardrobe.count({ where: { userId: user.id } })).toBe(0);

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.wardrobe.equipped.BODY).toBe(DEFAULT_BODY_PIECE_ID);
    expect(me.body.wardrobe.owned).toContain(DEFAULT_BODY_PIECE_ID);
  });

  it("falls back to the default body when the stored body piece no longer exists in the catalogue", async () => {
    const { token, username } = await signupUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });

    // Simulate a retired piece: a row pointing at an id the catalogue no
    // longer defines, which is exactly what happens when a piece is pulled
    // from sale after someone equipped it.
    await prisma.equippedWardrobe.create({
      data: { userId: user.id, slot: "BODY", pieceId: "body_retired_long_ago" }
    });

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.wardrobe.equipped.BODY).toBe(DEFAULT_BODY_PIECE_ID);
  });
});
