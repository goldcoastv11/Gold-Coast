/**
 * Skin shop routes. GC-only, fully isolated from SC/redemption/playthrough
 * (see economy/skinShop.ts) - this file never touches SC.
 */

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { purchaseSkin, equipSkin } from "../economy/skinShop";
import { serializeMe } from "../serializers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const SkinIdSchema = z.object({ skinId: z.string().min(1) });

router.post(
  "/skins/buy",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = SkinIdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid skin purchase payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => purchaseSkin(tx, userId, parsed.data.skinId));

    if (!outcome.ok) {
      const status = outcome.reason === "NOT_FOUND" ? 404 : outcome.reason === "ALREADY_OWNED" ? 409 : 400;
      return res.status(status).json({ error: "Could not purchase skin", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ skin: outcome.skin, user: me });
  })
);

router.post(
  "/skins/equip",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = SkinIdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid skin equip payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => equipSkin(tx, userId, parsed.data.skinId));

    if (!outcome.ok) {
      const status = outcome.reason === "NOT_FOUND" ? 404 : 403;
      return res.status(status).json({ error: "Could not equip skin", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ equippedSkin: outcome.skinId, user: me });
  })
);

export default router;
