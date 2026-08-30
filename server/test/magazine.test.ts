import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { applyTransaction } from "../src/economy/ledger";
import { resetDb, signupUser, authed } from "./helpers";
import {
  getMagazineRooms,
  isRoomWorthShowing,
  magazineDateKey,
  pickMagazineUserIds,
  MAGAZINE_ROOM_COUNT
} from "../src/economy/magazine";
import { DEFAULT_WALLPAPER_ID, DEFAULT_FLOORING_ID, ROOM_CATALOG } from "../src/roomCatalog";
import { FURNITURE_CATALOG } from "../src/furnitureCatalog";

beforeEach(resetDb);

/** Same real-ledger top-up pattern as room.test.ts/furniture.test.ts's topUpGc. */
async function topUpGc(username: string, amount: number): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.$transaction((tx) =>
    applyTransaction(tx, user.id, "GC", "ADJUST_GC", amount, { reason: "test bankroll top-up" })
  );
}

const wallpaper = ROOM_CATALOG.find((p) => p.id === "room_wallpaper_stripe")!; // non-default
const armchair = FURNITURE_CATALOG.find((p) => p.id === "furniture_armchair")!;

/** Buys+equips a non-default wallpaper, the cheapest way to make a room "worth showing". */
async function decorateRoom(token: string, username: string): Promise<void> {
  await topUpGc(username, wallpaper.price);
  const res = await request(app).post("/room/buy").set(authed(token)).send({ pieceId: wallpaper.id });
  expect(res.status).toBe(200);
}

/** Buys+places a furniture piece - the other way a room can qualify. */
async function placeFurniture(token: string, username: string): Promise<void> {
  await topUpGc(username, armchair.price);
  await request(app).post("/furniture/buy").set(authed(token)).send({ pieceId: armchair.id });
  const res = await request(app)
    .post("/furniture/place")
    .set(authed(token))
    .send({ pieceId: armchair.id, slot: "WALL_LEFT" });
  expect(res.status).toBe(200);
}

describe("magazineDateKey", () => {
  it("is the UTC calendar date, same as progression's daily challenges", () => {
    expect(magazineDateKey(new Date("2026-08-28T23:59:59Z"))).toBe("2026-08-28");
    expect(magazineDateKey(new Date("2026-08-29T00:00:00Z"))).toBe("2026-08-29");
  });
});

describe("isRoomWorthShowing", () => {
  it("rejects an all-default room with nothing placed", () => {
    expect(
      isRoomWorthShowing({ WALLPAPER: DEFAULT_WALLPAPER_ID, FLOORING: DEFAULT_FLOORING_ID }, {})
    ).toBe(false);
  });

  it("accepts a non-default wallpaper alone", () => {
    expect(
      isRoomWorthShowing({ WALLPAPER: "room_wallpaper_stripe", FLOORING: DEFAULT_FLOORING_ID }, {})
    ).toBe(true);
  });

  it("accepts a non-default flooring alone", () => {
    expect(
      isRoomWorthShowing({ WALLPAPER: DEFAULT_WALLPAPER_ID, FLOORING: "room_floor_checker" }, {})
    ).toBe(true);
  });

  it("accepts default wallpaper/flooring with one piece of furniture placed", () => {
    expect(
      isRoomWorthShowing(
        { WALLPAPER: DEFAULT_WALLPAPER_ID, FLOORING: DEFAULT_FLOORING_ID },
        { WALL_LEFT: "furniture_armchair" }
      )
    ).toBe(true);
  });
});

describe("pickMagazineUserIds (pure seeded rotation, no DB)", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];

  it("returns the same order for the same dateKey", () => {
    const first = pickMagazineUserIds(ids, "2026-08-30");
    const second = pickMagazineUserIds(ids, "2026-08-30");
    expect(second).toEqual(first);
  });

  it("returns a different order for a different dateKey", () => {
    const day1 = pickMagazineUserIds(ids, "2026-08-30");
    const day2 = pickMagazineUserIds(ids, "2026-08-31");
    expect(day2).not.toEqual(day1);
  });

  it("slices to `count` without padding", () => {
    const picked = pickMagazineUserIds(ids, "2026-08-30");
    expect(picked.length).toBe(MAGAZINE_ROOM_COUNT);
  });

  it("returns every candidate, un-padded, when there are fewer than `count`", () => {
    const few = ["only-one", "only-two"];
    const picked = pickMagazineUserIds(few, "2026-08-30");
    expect(picked.length).toBe(2);
    expect(picked.sort()).toEqual(few.sort());
  });

  it("returns an empty list for an empty candidate pool", () => {
    expect(pickMagazineUserIds([], "2026-08-30")).toEqual([]);
  });
});

describe("getMagazineRooms (DB-backed)", () => {
  it("excludes a brand-new, undecorated account", async () => {
    const { username } = await signupUser();
    void username;

    const result = await prisma.$transaction((tx) => getMagazineRooms(tx, new Date("2026-08-30T12:00:00Z")));
    expect(result.rooms).toEqual([]);
  });

  it("includes a decorated room, with only username + decor fields on it", async () => {
    const { token, username } = await signupUser();
    await decorateRoom(token, username);

    const result = await prisma.$transaction((tx) => getMagazineRooms(tx, new Date("2026-08-30T12:00:00Z")));
    expect(result.rooms.length).toBe(1);
    const entry = result.rooms[0];
    expect(entry.username).toBe(username);
    expect(entry.wallpaperId).toBe(wallpaper.id);
    expect(entry.flooringId).toBe(DEFAULT_FLOORING_ID);
    expect(entry.furniture).toEqual({});
    // Nothing beyond username/wallpaperId/flooringId/furniture - no balances, no email, no id.
    expect(Object.keys(entry).sort()).toEqual(["flooringId", "furniture", "username", "wallpaperId"]);
  });

  it("includes a room that only placed furniture, defaults and all", async () => {
    const { token, username } = await signupUser();
    await placeFurniture(token, username);

    const result = await prisma.$transaction((tx) => getMagazineRooms(tx, new Date("2026-08-30T12:00:00Z")));
    expect(result.rooms.length).toBe(1);
    expect(result.rooms[0].furniture).toEqual({ WALL_LEFT: armchair.id });
  });

  it("handles fewer than 5 decorated rooms without padding or inventing players", async () => {
    for (let i = 0; i < 3; i++) {
      const { token, username } = await signupUser();
      await decorateRoom(token, username);
    }

    const result = await prisma.$transaction((tx) => getMagazineRooms(tx, new Date("2026-08-30T12:00:00Z")));
    expect(result.rooms.length).toBe(3);
  });

  it("caps at MAGAZINE_ROOM_COUNT when more rooms qualify", async () => {
    for (let i = 0; i < MAGAZINE_ROOM_COUNT + 2; i++) {
      const { token, username } = await signupUser();
      await decorateRoom(token, username);
    }

    const result = await prisma.$transaction((tx) => getMagazineRooms(tx, new Date("2026-08-30T12:00:00Z")));
    expect(result.rooms.length).toBe(MAGAZINE_ROOM_COUNT);
  });

  it("picks the same five on the same UTC day and a different set the next day", async () => {
    for (let i = 0; i < MAGAZINE_ROOM_COUNT + 3; i++) {
      const { token, username } = await signupUser();
      await decorateRoom(token, username);
    }

    const sameDayFirst = await prisma.$transaction((tx) =>
      getMagazineRooms(tx, new Date("2026-08-30T01:00:00Z"))
    );
    const sameDaySecond = await prisma.$transaction((tx) =>
      getMagazineRooms(tx, new Date("2026-08-30T23:00:00Z"))
    );
    expect(sameDaySecond.rooms.map((r) => r.username)).toEqual(sameDayFirst.rooms.map((r) => r.username));
    expect(sameDaySecond.dateKey).toBe(sameDayFirst.dateKey);

    const nextDay = await prisma.$transaction((tx) => getMagazineRooms(tx, new Date("2026-08-31T01:00:00Z")));
    expect(nextDay.dateKey).not.toBe(sameDayFirst.dateKey);
    expect(nextDay.rooms.map((r) => r.username)).not.toEqual(sameDayFirst.rooms.map((r) => r.username));
  });
});

describe("GET /magazine", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/magazine");
    expect(res.status).toBe(401);
  });

  it("serves today's dateKey and decorated rooms over HTTP", async () => {
    const { token, username } = await signupUser();
    await decorateRoom(token, username);

    const res = await request(app).get("/magazine").set(authed(token));
    expect(res.status).toBe(200);
    expect(typeof res.body.dateKey).toBe("string");
    expect(res.body.rooms.length).toBe(1);
    expect(res.body.rooms[0].username).toBe(username);
  });
});
