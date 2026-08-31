/**
 * Player Room furniture routes (roadmap/room-furniture) - mirrors
 * routes/room.ts's shape where it fits, adds a /remove route room.ts has
 * no equivalent of (see economy/furniture.ts's header on why furniture's
 * shape genuinely differs). GC-only.
 *
 * GET /furniture/catalog is public (no auth): static catalogue data - the
 * four slots and every piece's id/name/price - with nothing
 * player-specific in it, same reasoning as GET /room/catalog.
 *
 * What a given player OWNS and has PLACED comes back on the normal
 * authenticated user payload (serializers.ts's MeResponse.furniture).
 */

import { Router } from "express";
import { registerRoute } from "./registry";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { purchaseFurniture, placeFurniture, removeFurniture } from "../economy/furniture";
import { FURNITURE_CATALOG, FURNITURE_SLOTS } from "../furnitureCatalog";
import { serializeMe } from "../serializers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const PieceIdSchema = z.object({ pieceId: z.string().min(1) });
const PlaceSchema = z.object({ pieceId: z.string().min(1), slot: z.string().min(1) });
const SlotSchema = z.object({ slot: z.string().min(1) });

router.get(
  "/furniture/catalog",
  asyncHandler(async (_req, res) => {
    return res.json({ slots: FURNITURE_SLOTS, pieces: FURNITURE_CATALOG });
  })
);

router.post(
  "/furniture/buy",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = PieceIdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid furniture purchase payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => purchaseFurniture(tx, userId, parsed.data.pieceId));

    if (!outcome.ok) {
      const status = outcome.reason === "NOT_FOUND" ? 404 : outcome.reason === "ALREADY_OWNED" ? 409 : 400;
      return res.status(status).json({ error: "Could not purchase furniture", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ piece: outcome.piece, user: me });
  })
);

router.post(
  "/furniture/place",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = PlaceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid furniture placement payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) =>
      placeFurniture(tx, userId, parsed.data.pieceId, parsed.data.slot)
    );

    if (!outcome.ok) {
      const status =
        outcome.reason === "NOT_FOUND" || outcome.reason === "SLOT_NOT_FOUND" ? 404 : 403;
      return res.status(status).json({ error: "Could not place furniture", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ piece: outcome.piece, slot: outcome.slot, user: me });
  })
);

router.post(
  "/furniture/remove",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = SlotSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid furniture removal payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => removeFurniture(tx, userId, parsed.data.slot));

    if (!outcome.ok) {
      return res.status(404).json({ error: "Could not remove furniture", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ user: me });
  })
);

registerRoute(router);

export default router;
