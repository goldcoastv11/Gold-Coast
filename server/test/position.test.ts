import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { resetDb, signupUser, authed } from "./helpers";

beforeEach(resetDb);

describe("POST /position", () => {
  it("persists and round-trips the last position through /me", async () => {
    const { token } = await signupUser();

    const post = await request(app).post("/position").set(authed(token)).send({ x: 123.5, y: -40 });
    expect(post.status).toBe(200);

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.lastPosition).toEqual({ x: 123.5, y: -40 });
  });

  it("overwrites the previous position", async () => {
    const { token } = await signupUser();
    await request(app).post("/position").set(authed(token)).send({ x: 1, y: 1 });
    await request(app).post("/position").set(authed(token)).send({ x: 2, y: 2 });

    const me = await request(app).get("/me").set(authed(token));
    expect(me.body.lastPosition).toEqual({ x: 2, y: 2 });
  });

  it("rejects a non-finite coordinate", async () => {
    const { token } = await signupUser();
    const res = await request(app).post("/position").set(authed(token)).send({ x: "nan", y: 1 });
    expect(res.status).toBe(400);
  });

  it("requires auth", async () => {
    const res = await request(app).post("/position").send({ x: 1, y: 1 });
    expect(res.status).toBe(401);
  });
});
