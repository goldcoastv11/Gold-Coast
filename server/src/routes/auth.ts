/**
 * POST /auth/signup, POST /auth/login.
 *
 * Trust-boundary note (see economy/gcMultiplier.ts): the signup GC leg's
 * shuffle-cup multiplier is resolved HERE, server-side, via
 * `pickRandomGcMultiplier()` - never accepted from the request body. The
 * client's shuffle-cup animation is purely presentational; it should play
 * the animation then reconcile it to `signupBonus.gcMultiplier` in this
 * response.
 */

import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { signToken } from "../auth/jwt";
import { serializeMe } from "../serializers";
import { grantSignupBonus } from "../economy/signupBonus";
import { pickRandomGcMultiplier } from "../economy/gcMultiplier";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const SignupSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "username must be at least 3 characters")
    .max(32, "username must be at most 32 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "username may only contain letters, numbers, and underscores"),
  password: z.string().min(6, "password must be at least 6 characters").max(200),
  email: z.string().trim().email().optional().nullable()
});

router.post("/signup", asyncHandler(async (req, res) => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid signup payload", code: "INVALID_INPUT", details: parsed.error.flatten() });
  }
  const { username, password, email } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return res.status(409).json({ error: "Username already taken", code: "USERNAME_TAKEN" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const multiplier = pickRandomGcMultiplier();

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      // Retention Leg 1: a signup IS a login - the response hands back a
      // JWT and the player walks straight into the game - so seed
      // lastLoginAt here rather than leaving day 0 looking like "never
      // signed in" until their second visit.
      data: { username, email: email ?? null, passwordHash, lastLoginAt: new Date() }
    });
    await tx.balance.create({ data: { userId: user.id, goldCoins: 0, tickets: 0 } });
    await tx.equippedSkin.create({ data: { userId: user.id, skinId: "player" } });

    const bonus = await grantSignupBonus(tx, user.id, multiplier);
    const me = await serializeMe(tx, user.id, user.username);

    return { user, bonus, me };
  });

  const token = signToken({ sub: result.user.id, username: result.user.username });

  return res.status(201).json({
    token,
    user: result.me,
    signupBonus: {
      gcMultiplier: multiplier,
      gcAmount: result.bonus.gcAmount
    }
  });
}));

const LoginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

router.post("/login", asyncHandler(async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid login payload", code: "INVALID_INPUT", details: parsed.error.flatten() });
  }
  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return res.status(401).json({ error: "Wrong username or password", code: "INVALID_CREDENTIALS" });
  }

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    return res.status(401).json({ error: "Wrong username or password", code: "INVALID_CREDENTIALS" });
  }

  const token = signToken({ sub: user.id, username: user.username });

  // Retention Leg 1: stamped only AFTER the password check passes, so a
  // failed login attempt never moves it - "last time this account was
  // actually used" is the whole point of the column. Not awaited into the
  // response path's critical work beyond this line, but still awaited (not
  // fire-and-forget) so the value is durable before the client is told it
  // is signed in; the write is a single indexed-by-PK update.
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const me = await prisma.$transaction((tx) => serializeMe(tx, user.id, user.username));

  return res.json({ token, user: me });
}));

export default router;
