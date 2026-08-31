/**
 * Item shop routes (accessories/pets) - mirrors routes/wardrobe.ts's shape
 * exactly, generalized to the ItemOwned/EquippedItem tables (see
 * economy/itemShop.ts). GC-only (2026-08-29 GC-only economy restructure -
 * TICKETS is retired, see repo-root CLAUDE.md).
 */

import { Router } from "express";
import { registerRoute } from "./registry";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { purchaseItem, equipItem, unequipItem } from "../economy/itemShop";
import { serializeMe } from "../serializers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const ItemIdSchema = z.object({ itemId: z.string().min(1) });
const CategorySchema = z.object({ category: z.enum(["ACCESSORY", "PET"]) });

router.post(
  "/items/buy",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = ItemIdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid item purchase payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => purchaseItem(tx, userId, parsed.data.itemId));

    if (!outcome.ok) {
      const status = outcome.reason === "NOT_FOUND" ? 404 : outcome.reason === "ALREADY_OWNED" ? 409 : 400;
      return res.status(status).json({ error: "Could not purchase item", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ item: outcome.item, user: me });
  })
);

router.post(
  "/items/equip",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = ItemIdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid item equip payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => equipItem(tx, userId, parsed.data.itemId));

    if (!outcome.ok) {
      const status = outcome.reason === "NOT_FOUND" ? 404 : 403;
      return res.status(status).json({ error: "Could not equip item", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ item: outcome.item, user: me });
  })
);

router.post(
  "/items/unequip",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = CategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid item unequip payload", code: "INVALID_INPUT" });
    }

    await prisma.$transaction((tx) => unequipItem(tx, userId, parsed.data.category));

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ user: me });
  })
);

registerRoute(router);

export default router;
