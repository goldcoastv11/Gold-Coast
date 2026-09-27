/**
 * The server browser and the registry behind it.
 *
 * A "server" is one instance of the arcade - its own floor, its own wheel,
 * its own Blackjack table (see realtime/gameServers.ts). The properties
 * worth pinning here are the ones whose failure is a privacy or isolation
 * bug rather than a cosmetic one: private servers must not be listed, two
 * servers must not share a table, and a reaped server must not leave a live
 * join code behind.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import {
  GameServerRegistry,
  PRIVATE_SERVER_TTL_MS,
  gameServers
} from "../src/realtime/gameServers";
import { presenceHub } from "../src/realtime/presence";
import { ROOM_OVERWORLD, SERVER_CAPACITY, roomKey } from "../src/realtime/protocol";
import { resetDb, signupUser, authed } from "./helpers";

beforeEach(async () => {
  await resetDb();
  gameServers.reset();
  presenceHub.clear();
});

afterEach(() => {
  presenceHub.clear();
});

/** Puts a player on a server's casino floor, the way the socket would. */
function stand(userId: string, serverId: string) {
  presenceHub.enter(roomKey(serverId, ROOM_OVERWORLD), {
    id: userId,
    username: userId,
    x: 0,
    y: 0,
    dir: "down",
    moving: false,
    wardrobe: {}
  });
}

describe("GET /servers", () => {
  it("lists the public servers with capacity", async () => {
    const user = await signupUser();
    const res = await request(app).get("/servers").set(authed(user.token));

    expect(res.status).toBe(200);
    expect(res.body.servers.length).toBeGreaterThan(0);
    expect(res.body.servers[0]).toMatchObject({ visibility: "public", capacity: SERVER_CAPACITY });
    expect(res.body.servers.every((s: { visibility: string }) => s.visibility === "public")).toBe(true);
  });

  it("reports live player counts", async () => {
    const user = await signupUser();
    stand("p1", "boardwalk");
    stand("p2", "boardwalk");
    stand("p3", "sunset");

    const res = await request(app).get("/servers").set(authed(user.token));
    const byId = Object.fromEntries(
      res.body.servers.map((s: { id: string; players: number }) => [s.id, s.players])
    );

    expect(byId.boardwalk).toBe(2);
    expect(byId.sunset).toBe(1);
    expect(byId.highroller).toBe(0);
  });

  it("never lists a private server", async () => {
    const user = await signupUser();
    gameServers.createPrivate("Secret table");

    const res = await request(app).get("/servers").set(authed(user.token));

    // Listing a private server - even just its name and headcount - would
    // let anyone enumerate which rooms exist and how busy they are, which
    // is exactly what "private" is supposed to prevent.
    expect(res.body.servers.some((s: { visibility: string }) => s.visibility === "private")).toBe(false);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/servers")).status).toBe(401);
  });
});

describe("POST /servers", () => {
  it("creates a private server and returns its join code", async () => {
    const user = await signupUser({ username: "hostplayer" });

    const res = await request(app).post("/servers").set(authed(user.token)).send({});

    expect(res.status).toBe(201);
    expect(res.body.server.visibility).toBe("private");
    expect(typeof res.body.server.joinCode).toBe("string");
    expect(res.body.server.joinCode.length).toBeGreaterThanOrEqual(6);
    expect(res.body.server.name).toContain("hostplayer");
  });

  it("accepts a name", async () => {
    const user = await signupUser();
    const res = await request(app).post("/servers").set(authed(user.token)).send({ name: "Friday game" });
    expect(res.body.server.name).toBe("Friday game");
  });

  it("gives each private server its own tables", async () => {
    const a = gameServers.createPrivate("A");
    const b = gameServers.createPrivate("B");

    // Two servers are two independent games. Sharing a table instance would
    // mean players on one betting into the other's round.
    expect(a.roulette).not.toBe(b.roulette);
    expect(a.blackjack).not.toBe(b.blackjack);
    expect(a.joinCode).not.toBe(b.joinCode);
  });

  it("requires authentication", async () => {
    expect((await request(app).post("/servers").send({})).status).toBe(401);
  });
});

describe("POST /servers/join", () => {
  it("resolves a join code to its server", async () => {
    const user = await signupUser();
    const created = await request(app).post("/servers").set(authed(user.token)).send({ name: "Ours" });
    const code = created.body.server.joinCode;

    const res = await request(app).post("/servers/join").set(authed(user.token)).send({ code });

    expect(res.status).toBe(200);
    expect(res.body.server.id).toBe(created.body.server.id);
    expect(res.body.server.name).toBe("Ours");
  });

  it("accepts a code in any case, and with stray spaces", async () => {
    const user = await signupUser();
    const created = await request(app).post("/servers").set(authed(user.token)).send({});
    const code: string = created.body.server.joinCode;

    // Codes get typed off a phone screen or read out loud. Being strict
    // about case here would just look broken.
    const res = await request(app)
      .post("/servers/join")
      .set(authed(user.token))
      .send({ code: `  ${code.toLowerCase()}  ` });

    expect(res.status).toBe(200);
  });

  it("404s an unknown code", async () => {
    const user = await signupUser();
    const res = await request(app).post("/servers/join").set(authed(user.token)).send({ code: "ZZZZZZ" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SERVER_NOT_FOUND");
  });

  it("does not leak the join code back through the resolve route", async () => {
    const user = await signupUser();
    const created = await request(app).post("/servers").set(authed(user.token)).send({});
    const code = created.body.server.joinCode;

    const res = await request(app).post("/servers/join").set(authed(user.token)).send({ code });

    // The code comes back exactly once, to whoever created the server. This
    // route confirms a code works; it is not a way to read one out.
    expect(res.body.server.joinCode).toBeUndefined();
  });

  it("requires authentication", async () => {
    expect((await request(app).post("/servers/join").send({ code: "ABCDEF" })).status).toBe(401);
  });
});

describe("the registry's housekeeping", () => {
  it("stops the tables of a server nobody is on", () => {
    const registry = new GameServerRegistry();
    const server = registry.get("boardwalk")!;
    registry.ensureTablesRunning(server, 0);
    expect(server.roulette.running).toBe(true);

    registry.sweep(() => 0, 1_000);

    // An empty table dealing to nobody is pure waste, and a returning
    // player should get a fresh round rather than the middle of one.
    expect(server.roulette.running).toBe(false);
    expect(server.blackjack.running).toBe(false);
  });

  it("leaves an occupied server's tables alone", () => {
    const registry = new GameServerRegistry();
    const server = registry.get("boardwalk")!;
    registry.ensureTablesRunning(server, 0);

    registry.sweep((id) => (id === "boardwalk" ? 1 : 0), 1_000);

    expect(server.roulette.running).toBe(true);
  });

  it("reaps a private server that has been empty past the TTL, and its code with it", () => {
    const registry = new GameServerRegistry();
    const server = registry.createPrivate("Temp", 0);
    const code = server.joinCode!;

    registry.sweep(() => 0, PRIVATE_SERVER_TTL_MS + 1);

    expect(registry.get(server.id)).toBeUndefined();
    // A live code pointing at a dead server would drop players into
    // nothing.
    expect(registry.resolveCode(code)).toBeUndefined();
  });

  it("never reaps a public server, however long it stays empty", () => {
    const registry = new GameServerRegistry();

    registry.sweep(() => 0, PRIVATE_SERVER_TTL_MS * 10);

    // The browser must never be able to present a player with nowhere to
    // go.
    expect(registry.get("boardwalk")).toBeDefined();
    expect(registry.listPublic(() => 0).length).toBeGreaterThan(0);
  });

  it("keeps a private server alive while someone is still in it", () => {
    const registry = new GameServerRegistry();
    const server = registry.createPrivate("Busy", 0);

    registry.sweep((id) => (id === server.id ? 1 : 0), PRIVATE_SERVER_TTL_MS * 5);

    expect(registry.get(server.id)).toBeDefined();
  });

  it("restarts the empty-timer when a server empties again", () => {
    const registry = new GameServerRegistry();
    const server = registry.createPrivate("OnOff", 0);

    // Occupied well past the TTL...
    registry.sweep((id) => (id === server.id ? 1 : 0), PRIVATE_SERVER_TTL_MS * 2);
    // ...then empties. It must get a full TTL from THAT moment, not be
    // reaped instantly because it was created long ago.
    registry.sweep(() => 0, PRIVATE_SERVER_TTL_MS * 2 + 1);
    expect(registry.get(server.id)).toBeDefined();

    registry.sweep(() => 0, PRIVATE_SERVER_TTL_MS * 3 + 2);
    expect(registry.get(server.id)).toBeUndefined();
  });
});

describe("the table broadcaster wiring", () => {
  it("reaches servers created AFTER the broadcaster was registered", () => {
    const registry = new GameServerRegistry();
    const seen: string[] = [];
    registry.setBroadcaster({
      bet: (serverId) => seen.push(serverId),
      seat: (serverId) => seen.push(serverId)
    });

    // The trap this exists to avoid: subscribing to each table once at
    // startup silently misses every private server, so bets there would
    // never reach the other players sitting at that table.
    const later = registry.createPrivate("Later");
    registry.ensureTablesRunning(later, 0);
    later.roulette.placeBet("u1", "alice", "red", 20, 0);
    later.blackjack.placeBet("u1", "alice", 20, 0);

    expect(seen).toEqual([later.id, later.id]);
  });

  it("stops delivering once detached", () => {
    const registry = new GameServerRegistry();
    const seen: string[] = [];
    registry.setBroadcaster({ bet: (id) => seen.push(id), seat: (id) => seen.push(id) });
    registry.setBroadcaster(null);

    const server = registry.get("boardwalk")!;
    registry.ensureTablesRunning(server, 0);
    server.roulette.placeBet("u1", "alice", "red", 20, 0);

    expect(seen).toEqual([]);
  });
});
