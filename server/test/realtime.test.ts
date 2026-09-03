/**
 * Socket-level tests for the realtime channel: a real HTTP server, a real
 * `ws` upgrade, real JWTs from real signups.
 *
 * These exist because the parts most likely to break in production are the
 * parts a unit test cannot reach - the handshake ordering, "who gets told
 * what", and the trust boundary (an unauthenticated socket must be able to
 * do exactly nothing). The room logic itself is tested without any of this
 * machinery in realtimePresence.test.ts.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import WebSocket from "ws";
import { app } from "../src/app";
import { attachRealtime, REALTIME_PATH, RealtimeHandle } from "../src/realtime/server";
import { ClientMessage, ServerMessage } from "../src/realtime/protocol";
import { resetDb, signupUser, authed } from "./helpers";
import request from "supertest";

let server: Server;
let realtime: RealtimeHandle;
let url: string;

beforeAll(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  realtime = attachRealtime(server);
  const { port } = server.address() as AddressInfo;
  url = `ws://127.0.0.1:${port}${REALTIME_PATH}`;
});

afterAll(async () => {
  await realtime.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(resetDb);

/**
 * A test client that records every frame it receives, so an assertion can
 * wait for a specific message type instead of sleeping and hoping.
 */
class TestClient {
  readonly socket: WebSocket;
  readonly received: ServerMessage[] = [];
  private waiters: { predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  closeInfo: { code: number } | null = null;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      this.received.push(message);
      this.waiters = this.waiters.filter((w) => {
        if (!w.predicate(message)) return true;
        w.resolve(message);
        return false;
      });
    });
    socket.on("close", (code) => {
      this.closeInfo = { code };
    });
  }

  static async open(): Promise<TestClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return new TestClient(socket);
  }

  send(message: ClientMessage) {
    this.socket.send(JSON.stringify(message));
  }

  /** Resolves with the first message (already received or yet to arrive) matching `t`. */
  next<T extends ServerMessage["t"]>(t: T, timeoutMs = 5000): Promise<Extract<ServerMessage, { t: T }>> {
    const already = this.received.find((m) => m.t === t);
    if (already) return Promise.resolve(already as Extract<ServerMessage, { t: T }>);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${t}"`)), timeoutMs);
      this.waiters.push({
        predicate: (m) => m.t === t,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        }
      });
    });
  }

  waitForClose(timeoutMs = 5000): Promise<number> {
    if (this.closeInfo) return Promise.resolve(this.closeInfo.code);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for close")), timeoutMs);
      this.socket.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  close() {
    this.socket.close();
  }
}

/** Opens a socket, authenticates it, and walks onto the casino floor. */
async function connectOnFloor(token: string): Promise<TestClient> {
  const client = await TestClient.open();
  client.send({ t: "hello", token });
  await client.next("welcome");
  client.send({ t: "room", room: "overworld" });
  await client.next("roster");
  return client;
}

describe("realtime handshake", () => {
  it("accepts a valid JWT and answers with welcome", async () => {
    const user = await signupUser();
    const client = await TestClient.open();

    client.send({ t: "hello", token: user.token });
    const welcome = await client.next("welcome");

    expect(typeof welcome.selfId).toBe("string");
    expect(welcome.tickMs).toBeGreaterThan(0);
    client.close();
  });

  it("closes a socket that sends a forged token", async () => {
    const client = await TestClient.open();
    client.send({ t: "hello", token: "not.a.real.jwt" });

    const error = await client.next("error");
    expect(error.code).toBe("UNAUTHORIZED");
    await client.waitForClose();
  });

  it("refuses to do anything for a socket that never said hello", async () => {
    const client = await TestClient.open();

    // The trust boundary: an unauthenticated socket has exactly one
    // capability, and it is `hello`. Entering a room is not it.
    client.send({ t: "room", room: "overworld" });

    const error = await client.next("error");
    expect(error.code).toBe("UNAUTHORIZED");
    await client.waitForClose();
  });

  it("answers a ping with a pong so an idle player is not reaped", async () => {
    const user = await signupUser();
    const client = await TestClient.open();
    client.send({ t: "hello", token: user.token });
    await client.next("welcome");

    client.send({ t: "ping" });
    await client.next("pong");
    client.close();
  });

  it("reports a malformed frame without dropping the connection", async () => {
    const user = await signupUser();
    const client = await TestClient.open();
    client.send({ t: "hello", token: user.token });
    await client.next("welcome");

    client.socket.send("this is not json");
    const error = await client.next("error");

    expect(error.code).toBe("BAD_MESSAGE");
    // Forward compatibility: an unknown message must not be an outage for
    // a client one version ahead of the server.
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    client.close();
  });

  it("displaces the first socket when the same account connects again", async () => {
    const user = await signupUser();
    const first = await connectOnFloor(user.token);

    const second = await TestClient.open();
    second.send({ t: "hello", token: user.token });
    await second.next("welcome");

    const error = await first.next("error");
    expect(error.code).toBe("DISPLACED");
    expect(await first.waitForClose()).toBe(4001);

    second.close();
  });
});

describe("realtime presence on the casino floor", () => {
  it("sends a newcomer the roster and tells everyone already there about them", async () => {
    const alice = await signupUser({ username: "alice_rt" });
    const bob = await signupUser({ username: "bob_rt" });

    const aliceClient = await connectOnFloor(alice.token);
    // Alice walked onto an empty floor.
    expect((await aliceClient.next("roster")).players).toEqual([]);

    const bobClient = await TestClient.open();
    bobClient.send({ t: "hello", token: bob.token });
    await bobClient.next("welcome");
    bobClient.send({ t: "room", room: "overworld" });

    // Bob sees Alice already standing there...
    const roster = await bobClient.next("roster");
    expect(roster.players.map((p) => p.username)).toEqual(["alice_rt"]);
    // ...and Alice is told Bob arrived.
    const join = await aliceClient.next("join");
    expect(join.player.username).toBe("bob_rt");

    aliceClient.close();
    bobClient.close();
  });

  it("carries a player's equipped wardrobe from the database, not from the client", async () => {
    const user = await signupUser();
    const client = await connectOnFloor(user.token);
    const other = await signupUser();
    const otherClient = await TestClient.open();
    otherClient.send({ t: "hello", token: other.token });
    await otherClient.next("welcome");
    otherClient.send({ t: "room", room: "overworld" });

    const roster = await otherClient.next("roster");
    // Every account owns and wears the free default body, so a brand-new
    // player is never rendered invisible on someone else's screen.
    expect(roster.players[0].wardrobe.BODY).toBe("body_default");

    client.close();
    otherClient.close();
  });

  it("broadcasts movement to the other players on the floor", async () => {
    const alice = await signupUser();
    const bob = await signupUser();
    const aliceClient = await connectOnFloor(alice.token);
    const bobClient = await connectOnFloor(bob.token);
    const bobId = (await bobClient.next("welcome")).selfId;

    bobClient.send({ t: "move", x: 300, y: 420, dir: "left", moving: true });

    const state = await aliceClient.next("state");
    const bobDelta = state.players.find((p) => p.id === bobId);
    expect(bobDelta).toMatchObject({ x: 300, y: 420, dir: "left", moving: true });

    aliceClient.close();
    bobClient.close();
  });

  it("clamps a move that would put a player off the map", async () => {
    const alice = await signupUser();
    const bob = await signupUser();
    const aliceClient = await connectOnFloor(alice.token);
    const bobClient = await connectOnFloor(bob.token);
    const bobId = (await bobClient.next("welcome")).selfId;

    bobClient.send({ t: "move", x: -100_000, y: 100_000, dir: "up", moving: true });

    const state = await aliceClient.next("state");
    const bobDelta = state.players.find((p) => p.id === bobId);
    // 80x56 tiles at 16px - see protocol.ts.
    expect(bobDelta?.x).toBe(0);
    expect(bobDelta?.y).toBe(56 * 16);

    aliceClient.close();
    bobClient.close();
  });

  it("tells the room when a player leaves for a game screen, and again when they come back", async () => {
    const alice = await signupUser();
    const bob = await signupUser();
    const aliceClient = await connectOnFloor(alice.token);
    const bobClient = await connectOnFloor(bob.token);
    const bobId = (await bobClient.next("welcome")).selfId;
    await aliceClient.next("join");

    // Bob walks into a game cabinet. The socket stays open - only presence
    // ends - so coming back out is instant.
    bobClient.send({ t: "room", room: null });
    const leave = await aliceClient.next("leave");
    expect(leave.id).toBe(bobId);
    expect(bobClient.socket.readyState).toBe(WebSocket.OPEN);

    aliceClient.received.length = 0;
    bobClient.send({ t: "room", room: "overworld" });
    const rejoin = await aliceClient.next("join");
    expect(rejoin.player.id).toBe(bobId);

    aliceClient.close();
    bobClient.close();
  });

  it("tells the room when a player disconnects", async () => {
    const alice = await signupUser();
    const bob = await signupUser();
    const aliceClient = await connectOnFloor(alice.token);
    const bobClient = await connectOnFloor(bob.token);
    const bobId = (await bobClient.next("welcome")).selfId;
    await aliceClient.next("join");

    bobClient.close();

    const leave = await aliceClient.next("leave");
    expect(leave.id).toBe(bobId);
    aliceClient.close();
  });

  it("does not broadcast to a player who has left the floor", async () => {
    const alice = await signupUser();
    const bob = await signupUser();
    const aliceClient = await connectOnFloor(alice.token);
    const bobClient = await connectOnFloor(bob.token);

    aliceClient.send({ t: "room", room: null });
    await bobClient.next("leave");
    bobClient.received.length = 0;

    // Alice is off the floor; her moves are nobody's business.
    aliceClient.send({ t: "move", x: 500, y: 500, dir: "right", moving: true });
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(bobClient.received.filter((m) => m.t === "state")).toEqual([]);
    aliceClient.close();
    bobClient.close();
  });
});

describe("the live Roulette table over the socket", () => {
  /** Sits a client at the table (the socket half; bets go over HTTP). */
  async function sitAtTable(token: string): Promise<TestClient> {
    const client = await TestClient.open();
    client.send({ t: "hello", token });
    await client.next("welcome");
    client.send({ t: "room", room: "roulette" });
    await client.next("table");
    return client;
  }

  it("sends the table's current state on sitting down", async () => {
    const user = await signupUser();
    const client = await sitAtTable(user.token);

    const table = await client.next("table");
    expect(["betting", "spinning", "payout"]).toContain(table.snapshot.phase);
    expect(table.snapshot.msRemaining).toBeGreaterThan(0);
    client.close();
  });

  it("relays a bet placed over HTTP to everyone at the table", async () => {
    const alice = await signupUser({ username: "alice_live" });
    const bob = await signupUser({ username: "bob_live" });
    const aliceClient = await sitAtTable(alice.token);
    await sitAtTable(bob.token);

    // The bet itself goes through the authenticated HTTP API - the socket
    // is how the table is watched, never how it is played.
    const res = await request(app)
      .post("/games/roulette/table/bet")
      .set(authed(bob.token))
      .send({ betAmount: 25, bet: "red" });
    expect(res.status).toBe(200);

    const relayed = await aliceClient.next("tablebet");
    expect(relayed.bet).toMatchObject({ username: "bob_live", choice: "red", amount: 25 });

    aliceClient.close();
  });

  it("does not send table traffic to someone standing on the casino floor", async () => {
    const onFloor = await signupUser();
    const better = await signupUser();
    const floorClient = await connectOnFloor(onFloor.token);
    await sitAtTable(better.token);

    await request(app)
      .post("/games/roulette/table/bet")
      .set(authed(better.token))
      .send({ betAmount: 25, bet: "black" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(floorClient.received.filter((m) => m.t === "tablebet")).toEqual([]);
    floorClient.close();
  });

  it("refuses a bet from a socket - the channel carries no money", async () => {
    const user = await signupUser();
    const client = await sitAtTable(user.token);

    // There is no bet message in the protocol at all, and that is the
    // point: adding one would move a wager off the authenticated HTTP path
    // every other bet in this product takes.
    client.socket.send(JSON.stringify({ t: "bet", betAmount: 25, choice: "red" }));

    const error = await client.next("error");
    expect(error.code).toBe("BAD_MESSAGE");
    client.close();
  });
});

describe("emotes", () => {
  it("relays an emote to the room, including back to the sender", async () => {
    const alice = await signupUser();
    const bob = await signupUser();
    const aliceClient = await connectOnFloor(alice.token);
    const bobClient = await connectOnFloor(bob.token);
    const bobId = (await bobClient.next("welcome")).selfId;

    bobClient.send({ t: "emote", e: "wave" });

    const seenByAlice = await aliceClient.next("emote");
    expect(seenByAlice).toMatchObject({ id: bobId, e: "wave" });
    // Echoed to the sender so their own emote is drawn by the same code
    // path as everyone else's.
    const seenByBob = await bobClient.next("emote");
    expect(seenByBob).toMatchObject({ id: bobId, e: "wave" });

    aliceClient.close();
    bobClient.close();
  });

  it("rejects an emote outside the closed vocabulary", async () => {
    const user = await signupUser();
    const client = await connectOnFloor(user.token);

    // The founder's call was emotes, not free text. An arbitrary string
    // must not reach another player's screen through this door.
    client.socket.send(JSON.stringify({ t: "emote", e: "buy my coins at example.com" }));

    const error = await client.next("error");
    expect(error.code).toBe("BAD_MESSAGE");
    client.close();
  });

  it("rate-limits an emote spammer without disconnecting them", async () => {
    const user = await signupUser();
    const client = await connectOnFloor(user.token);

    for (let i = 0; i < 30; i++) client.send({ t: "emote", e: "cheer" });

    const error = await client.next("error");
    expect(error.code).toBe("EMOTE_RATE_LIMITED");
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    client.close();
  });
});
