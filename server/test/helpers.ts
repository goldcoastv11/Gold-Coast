import { prisma } from "../src/db";
import { app } from "../src/app";
import request from "supertest";

/** Wipes every table between tests - `users` cascades to everything else. */
export async function resetDb() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
}

export interface SignedUpUser {
  token: string;
  username: string;
  body: request.Response["body"];
}

let counter = 0;

/** Signs up a fresh, uniquely-named user via the real HTTP route and returns its JWT. */
export async function signupUser(overrides?: { username?: string; password?: string }): Promise<SignedUpUser> {
  counter += 1;
  const username = overrides?.username ?? `player_${Date.now()}_${counter}`;
  const password = overrides?.password ?? "hunter22";

  const res = await request(app).post("/auth/signup").send({ username, password });
  if (res.status !== 201) {
    throw new Error(`signupUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.token, username, body: res.body };
}

export function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}
