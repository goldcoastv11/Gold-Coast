import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, signupUser, authed } from "./helpers";
import { MAX_BATCH_SIZE } from "../src/routes/events";

beforeEach(resetDb);

/**
 * Leg 1 player-activity tracking (POST /events - see src/routes/events.ts).
 *
 * The security-relevant tests here are the two about identity: userId is
 * derived from the JWT and ONLY from the JWT. If either of those ever
 * fails, anyone can attribute arbitrary activity to any account.
 */

function batch(events: Array<{ name: string; sessionId?: string; props?: Record<string, unknown> }>) {
  return { events: events.map((e) => ({ sessionId: "sess_test_1", ...e })) };
}

describe("POST /events", () => {
  it("inserts a whole batch in one request, attributed to the authenticated user", async () => {
    const { token, username } = await signupUser();

    const res = await request(app)
      .post("/events")
      .set(authed(token))
      .send(
        batch([
          { name: "session.start" },
          { name: "game.opened", props: { game: "SlotsScene" } },
          { name: "game.round_played", props: { game: "slots", betAmount: 10, outcome: "loss", payout: 0 } }
        ])
      );

    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(3);

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const rows = await prisma.event.findMany({ orderBy: { name: "asc" } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.userId === user.id)).toBe(true);
    expect(rows.every((r) => r.sessionId === "sess_test_1")).toBe(true);
    expect(rows.map((r) => r.name).sort()).toEqual(["game.opened", "game.round_played", "session.start"]);

    const round = rows.find((r) => r.name === "game.round_played")!;
    expect(round.props).toEqual({ game: "slots", betAmount: 10, outcome: "loss", payout: 0 });
  });

  it("accepts an unauthenticated batch and stores a null userId", async () => {
    const res = await request(app).post("/events").send(batch([{ name: "session.start" }]));

    expect(res.status).toBe(202);
    const rows = await prisma.event.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
  });

  it("treats an invalid/expired token as anonymous rather than rejecting the batch", async () => {
    // Tracking must never start erroring just because a session went stale
    // - see optionalAuth's doc comment in src/auth/middleware.ts.
    const res = await request(app)
      .post("/events")
      .set(authed("not-a-real-jwt"))
      .send(batch([{ name: "session.start" }]));

    expect(res.status).toBe(202);
    const rows = await prisma.event.findMany();
    expect(rows[0].userId).toBeNull();
  });

  it("IGNORES a client-supplied userId - identity comes only from the JWT", async () => {
    const { token, username } = await signupUser();
    const victim = await signupUser();
    const victimUser = await prisma.user.findUniqueOrThrow({ where: { username: victim.username } });
    const caller = await prisma.user.findUniqueOrThrow({ where: { username } });

    const res = await request(app)
      .post("/events")
      .set(authed(token))
      .send({ events: [{ name: "session.start", sessionId: "sess_test_1", userId: victimUser.id }] });

    expect(res.status).toBe(202);
    const rows = await prisma.event.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(caller.id);
    expect(rows[0].userId).not.toBe(victimUser.id);
  });

  it("IGNORES a client-supplied userId on an anonymous call too", async () => {
    const { username } = await signupUser();
    const victimUser = await prisma.user.findUniqueOrThrow({ where: { username } });

    const res = await request(app)
      .post("/events")
      .send({ events: [{ name: "session.start", sessionId: "sess_test_1", userId: victimUser.id }] });

    expect(res.status).toBe(202);
    const rows = await prisma.event.findMany();
    expect(rows[0].userId).toBeNull();
  });

  it("rejects an oversized batch", async () => {
    const events = Array.from({ length: MAX_BATCH_SIZE + 1 }, () => ({ name: "session.start" }));

    const res = await request(app).post("/events").send(batch(events));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BATCH_TOO_LARGE");
    expect(await prisma.event.count()).toBe(0);
  });

  it("accepts a batch exactly at the cap", async () => {
    const events = Array.from({ length: MAX_BATCH_SIZE }, () => ({ name: "session.start" }));

    const res = await request(app).post("/events").send(batch(events));

    expect(res.status).toBe(202);
    expect(await prisma.event.count()).toBe(MAX_BATCH_SIZE);
  });

  it("rejects an empty batch, a missing sessionId, and a missing name", async () => {
    const empty = await request(app).post("/events").send({ events: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("INVALID_INPUT");

    const noSession = await request(app).post("/events").send({ events: [{ name: "session.start" }] });
    expect(noSession.status).toBe(400);

    const noName = await request(app).post("/events").send({ events: [{ sessionId: "sess_test_1" }] });
    expect(noName.status).toBe(400);

    expect(await prisma.event.count()).toBe(0);
  });

  it("rejects props that aren't flat scalars - no nested blobs get smuggled in", async () => {
    // The props cap is a privacy control as much as a size one (see
    // routes/events.ts's header): a bounded, flat, scalar map is a poor
    // place to hide a paragraph of personal data.
    const nested = await request(app)
      .post("/events")
      .send(batch([{ name: "game.opened", props: { nested: { game: "slots" } } }]));
    expect(nested.status).toBe(400);

    const tooLong = await request(app)
      .post("/events")
      .send(batch([{ name: "game.opened", props: { game: "x".repeat(500) } }]));
    expect(tooLong.status).toBe(400);

    expect(await prisma.event.count()).toBe(0);
  });

  it("writes nothing at all when any single event in the batch is invalid", async () => {
    const res = await request(app)
      .post("/events")
      .send(batch([{ name: "session.start" }, { name: "" }]));

    expect(res.status).toBe(400);
    expect(await prisma.event.count()).toBe(0);
  });
});

describe("lastLoginAt", () => {
  it("is set on signup", async () => {
    const { username } = await signupUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(user.lastLoginAt).not.toBeNull();
  });

  it("moves forward on a successful login", async () => {
    const { username } = await signupUser({ password: "hunter22" });
    const afterSignup = await prisma.user.findUniqueOrThrow({ where: { username } });

    // The column is timestamptz(3) - millisecond resolution - so a login
    // in the same millisecond as the signup would compare equal and make
    // this assertion meaningless. Force a measurable gap.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const res = await request(app).post("/auth/login").send({ username, password: "hunter22" });
    expect(res.status).toBe(200);

    const afterLogin = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(afterLogin.lastLoginAt!.getTime()).toBeGreaterThan(afterSignup.lastLoginAt!.getTime());
  });

  it("does NOT move on a failed login", async () => {
    const { username } = await signupUser({ password: "hunter22" });
    const before = await prisma.user.findUniqueOrThrow({ where: { username } });

    await new Promise((resolve) => setTimeout(resolve, 25));

    const res = await request(app).post("/auth/login").send({ username, password: "wrong-password" });
    expect(res.status).toBe(401);

    const after = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(after.lastLoginAt!.getTime()).toBe(before.lastLoginAt!.getTime());
  });
});
