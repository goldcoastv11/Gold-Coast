import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient, MOVE_SEND_MS } from "./realtime";
import { clearToken, setToken } from "./client";
import { ClientMessage, ServerMessage } from "./realtimeProtocol";

/**
 * Tests for the browser end of the realtime channel, driven against a fake
 * WebSocket.
 *
 * A fake rather than a real socket because what needs pinning here is
 * ORDERING and STATE, not transport: that `hello` is always the first frame,
 * that a reconnect re-announces the room the player is standing in, that a
 * dead socket silently drops messages instead of throwing into a game loop
 * running at 60fps. The transport itself is covered end-to-end on the
 * server side (server/test/realtime.test.ts) against a real `ws` upgrade.
 *
 * The properties below are exactly the ones whose failure mode is "the
 * player is invisible to everyone and nothing anywhere reports an error".
 */

/** Stands in for the browser's WebSocket, recording what was sent and letting a test drive the other end. */
class FakeSocket {
  static instances: FakeSocket[] = [];

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  readonly url: string;
  readonly sent: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.serverClose(1000);
  }

  // --- test-side drivers ---

  /** Completes the connection, as a server accepting the upgrade would. */
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  /** Delivers one server frame. */
  deliver(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  serverClose(code: number) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }

  get frames(): ClientMessage[] {
    return this.sent.map((s) => JSON.parse(s) as ClientMessage);
  }
}

const TOKEN = "test.jwt.token";

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  setToken(TOKEN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearToken();
});

/** Opens a client and drives it through a full handshake into the overworld. */
function connected(): { client: RealtimeClient; socket: FakeSocket } {
  const client = new RealtimeClient();
  client.start();
  const socket = FakeSocket.instances[0];
  socket.open();
  socket.deliver({ t: "welcome", selfId: "me", tickMs: 100, heartbeatMs: 20_000 });
  return { client, socket };
}

describe("handshake", () => {
  it("sends hello as the very first frame", () => {
    const { socket } = connected();
    // The server closes any socket whose first frame isn't `hello`, so
    // nothing may ever be sent ahead of it.
    expect(socket.frames[0]).toEqual({ t: "hello", token: TOKEN });
  });

  it("does not connect at all when nobody is logged in", () => {
    clearToken();
    const client = new RealtimeClient();
    client.start();

    // Not an error and not worth retrying - start() is called again after a
    // successful login.
    expect(FakeSocket.instances).toHaveLength(0);
    expect(client.currentStatus).toBe("offline");
  });

  it("reports its own id from welcome, so the client can skip drawing itself", () => {
    const { client } = connected();
    expect(client.id).toBe("me");
    expect(client.currentStatus).toBe("online");
  });

  it("is a no-op to start() an already-connected client", () => {
    const { client } = connected();
    client.start();
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe("room membership", () => {
  it("announces the room once connected", () => {
    const { client, socket } = connected();
    client.setRoom("overworld");
    expect(socket.frames).toContainEqual({ t: "room", room: "overworld" });
  });

  it("re-announces the room after a reconnect, with no scene involvement", () => {
    vi.useFakeTimers();
    const { client, socket } = connected();
    client.setRoom("overworld");

    socket.serverClose(1006); // abnormal closure - a dropped connection
    vi.advanceTimersByTime(2000);

    const reconnected = FakeSocket.instances[1];
    expect(reconnected).toBeDefined();
    reconnected.open();
    reconnected.deliver({ t: "welcome", selfId: "me", tickMs: 100, heartbeatMs: 20_000 });

    // The whole point of tracking a "desired" room: OverworldScene said
    // "overworld" once, before the drop, and never hears about the
    // reconnect. Without this the player silently becomes invisible to
    // everyone for the rest of the session.
    expect(reconnected.frames).toContainEqual({ t: "room", room: "overworld" });
  });

  it("remembers a room entered while offline and announces it on connect", () => {
    vi.useFakeTimers();
    const client = new RealtimeClient();
    client.start();
    const socket = FakeSocket.instances[0];

    // The player walked onto the floor while the socket was still opening.
    client.setRoom("overworld");
    socket.open();
    socket.deliver({ t: "welcome", selfId: "me", tickMs: 100, heartbeatMs: 20_000 });

    expect(socket.frames).toContainEqual({ t: "room", room: "overworld" });
  });
});

describe("movement reporting", () => {
  it("throttles to one move per send window", () => {
    const { client, socket } = connected();
    client.setRoom("overworld");

    const start = 1_000_000;
    client.sendMove(10, 10, "down", true, start);
    client.sendMove(20, 10, "down", true, start + 10);
    client.sendMove(30, 10, "down", true, start + 20);

    const moves = socket.frames.filter((f) => f.t === "move");
    expect(moves).toHaveLength(1);

    client.sendMove(40, 10, "down", true, start + MOVE_SEND_MS);
    expect(socket.frames.filter((f) => f.t === "move")).toHaveLength(2);
  });

  it("sends nothing at all while a player stands still", () => {
    const { client, socket } = connected();
    client.setRoom("overworld");

    const start = 1_000_000;
    client.sendMove(10, 10, "down", false, start);
    const after = socket.frames.filter((f) => f.t === "move").length;

    // Same position, same facing, many frames later. A stream of identical
    // positions from every idle player is exactly what the heartbeat exists
    // to make unnecessary.
    for (let i = 1; i <= 10; i++) client.sendMove(10, 10, "down", false, start + i * MOVE_SEND_MS);
    expect(socket.frames.filter((f) => f.t === "move")).toHaveLength(after);
  });

  it("sends a turn on the spot, and a stop", () => {
    const { client, socket } = connected();
    client.setRoom("overworld");
    const start = 1_000_000;

    client.sendMove(10, 10, "down", true, start);
    client.sendMove(10, 10, "left", true, start + MOVE_SEND_MS);
    client.sendMove(10, 10, "left", false, start + MOVE_SEND_MS * 2);

    const moves = socket.frames.filter((f) => f.t === "move");
    expect(moves).toHaveLength(3);
    // The final frame must report `moving: false`, or the player is left
    // walking on the spot forever on every other screen.
    expect(moves[2]).toMatchObject({ dir: "left", moving: false });
  });

  it("re-sends position after re-entering a room even if the player never moved", () => {
    const { client, socket } = connected();
    client.setRoom("overworld");
    const start = 1_000_000;
    client.sendMove(10, 10, "down", false, start);

    client.setRoom(null);
    client.setRoom("overworld");

    // A fresh room means the server has no idea where this player is - the
    // dedupe must not swallow the first report and leave them stuck at the
    // default spawn point.
    client.sendMove(10, 10, "down", false, start + MOVE_SEND_MS);
    expect(socket.frames.filter((f) => f.t === "move")).toHaveLength(2);
  });
});

describe("degrading offline", () => {
  it("silently drops sends while disconnected instead of throwing into the game loop", () => {
    const { client, socket } = connected();
    socket.serverClose(1006);

    // These are called from OverworldScene.update(), 60 times a second. A
    // throw here would take down the whole scene over a dropped socket.
    expect(() => {
      client.sendMove(1, 2, "down", true, 5_000_000);
      client.sendEmote("wave");
      client.announceAppearance();
      client.setRoom("overworld");
    }).not.toThrow();
  });

  it("reconnects after an unexpected close", () => {
    vi.useFakeTimers();
    const { socket } = connected();

    socket.serverClose(1006);
    expect(FakeSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(2000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("stays down when displaced by the same account in another tab", () => {
    vi.useFakeTimers();
    const { socket } = connected();

    socket.serverClose(4001);
    vi.advanceTimersByTime(60_000);

    // Reconnecting would start an endless fight between two tabs, each
    // displacing the other.
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("stops retrying once the server rejects the token", () => {
    vi.useFakeTimers();
    const { socket } = connected();

    socket.deliver({ t: "error", code: "UNAUTHORIZED", message: "Invalid or expired token" });
    socket.serverClose(1008);
    vi.advanceTimersByTime(60_000);

    // The HTTP client's own 401 handler owns sending the player back to the
    // login screen; this just stops arguing with a credential that doesn't
    // work.
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("stop() closes the socket and cancels any pending reconnect", () => {
    vi.useFakeTimers();
    const { client, socket } = connected();

    socket.serverClose(1006);
    client.stop();
    vi.advanceTimersByTime(60_000);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.currentStatus).toBe("offline");
  });
});

describe("event fan-out", () => {
  it("delivers roster, join, leave, state, emote and appearance to listeners", () => {
    const { client, socket } = connected();

    const seen: string[] = [];
    client.on("roster", () => seen.push("roster"));
    client.on("join", () => seen.push("join"));
    client.on("leave", () => seen.push("leave"));
    client.on("state", () => seen.push("state"));
    client.on("emote", () => seen.push("emote"));
    client.on("appearance", () => seen.push("appearance"));

    const somebody = {
      id: "other",
      username: "other",
      x: 1,
      y: 2,
      dir: "down" as const,
      moving: false,
      wardrobe: { BODY: "body_default" }
    };
    socket.deliver({ t: "roster", players: [somebody] });
    socket.deliver({ t: "join", player: somebody });
    socket.deliver({ t: "state", players: [{ id: "other", x: 3, y: 4, dir: "up", moving: true }] });
    socket.deliver({ t: "emote", id: "other", e: "wave" });
    socket.deliver({ t: "appearance", player: somebody });
    socket.deliver({ t: "leave", id: "other" });

    expect(seen).toEqual(["roster", "join", "state", "emote", "appearance", "leave"]);
  });

  it("unsubscribing stops delivery, and one throwing listener doesn't stop the others", () => {
    const { client, socket } = connected();
    const calls: string[] = [];

    const off = client.on("leave", () => calls.push("first"));
    client.on("leave", () => {
      throw new Error("listener bug");
    });
    client.on("leave", () => calls.push("third"));

    socket.deliver({ t: "leave", id: "x" });
    // A bug in one scene's handler must not silently stop every other
    // subscriber from being told a player left.
    expect(calls).toEqual(["first", "third"]);

    off();
    calls.length = 0;
    socket.deliver({ t: "leave", id: "y" });
    expect(calls).toEqual(["third"]);
  });

  it("delivers the live table's messages", () => {
    const { client, socket } = connected();
    client.setRoom("roulette");

    const snapshots: string[] = [];
    const bets: string[] = [];
    const results: number[] = [];
    client.on("table", (snapshot) => snapshots.push(snapshot.phase));
    client.on("tableBet", (_roundId, bet) => bets.push(bet.username));
    client.on("tableResult", (_roundId, number) => results.push(number));

    socket.deliver({
      t: "table",
      snapshot: {
        roundId: "r1",
        phase: "betting",
        msRemaining: 12_000,
        bets: [],
        number: null,
        color: null,
        results: null
      }
    });
    socket.deliver({
      t: "tablebet",
      roundId: "r1",
      bet: { userId: "u2", username: "bob", choice: "red", amount: 25 }
    });
    socket.deliver({
      t: "tableresult",
      roundId: "r1",
      number: 7,
      color: "red",
      results: [{ userId: "u2", username: "bob", choice: "red", amount: 25, won: true, payout: 50 }]
    });

    expect(snapshots).toEqual(["betting"]);
    expect(bets).toEqual(["bob"]);
    expect(results).toEqual([7]);
  });

  it("passes a non-fatal server error on as a notice, and keeps the socket open", () => {
    const { client, socket } = connected();
    const notices: string[] = [];
    client.on("notice", (code) => notices.push(code));

    socket.deliver({
      t: "error",
      code: "BET_VOIDED",
      message: "Your bet was voided"
    });

    // A voided bet is something the player has to be told; swallowing it
    // would leave them staring at a round that silently didn't happen.
    expect(notices).toEqual(["BET_VOIDED"]);
    expect(socket.readyState).toBe(FakeSocket.OPEN);
  });

  it("does not raise a notice for the token being rejected - that is handled internally", () => {
    const { client, socket } = connected();
    const notices: string[] = [];
    client.on("notice", (code) => notices.push(code));

    socket.deliver({ t: "error", code: "UNAUTHORIZED", message: "Invalid or expired token" });

    expect(notices).toEqual([]);
  });

  it("ignores a malformed frame rather than throwing", () => {
    const { socket } = connected();
    expect(() => socket.onmessage?.({ data: "not json" })).not.toThrow();
    expect(() => socket.onmessage?.({ data: 42 })).not.toThrow();
  });
});
