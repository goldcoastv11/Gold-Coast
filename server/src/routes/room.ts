/**
 * Player Room routes - mirrors routes/wardrobe.ts's shape exactly (see
 * economy/room.ts). GC-only.
 *
 * GET /room/catalog is public (no auth): static catalogue data - slots and
 * every piece's id/name/price - with nothing player-specific in it. What a
 * given player OWNS and has APPLIED comes back on the normal authenticated
 * user payload (serializers.ts's MeResponse.room), same split
 * routes/wardrobe.ts uses for the same reason.
 *
 * No /room/unequip route: unlike the wardrobe's optional slots, WALLPAPER
 * and FLOORING are never "nothing applied" (see economy/room.ts's header),
 * so there's nothing to take off, only something to swap via /room/equip.
 */

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { purchasePiece, equipPiece } from "../economy/room";
import { ROOM_CATALOG, ROOM_SLOTS } from "../roomCatalog";
import { serializeMe } from "../serializers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const PieceIdSchema = z.object({ pieceId: z.string().min(1) });

router.get(
  "/room/catalog",
  asyncHandler(async (_req, res) => {
    return res.json({ slots: ROOM_SLOTS, pieces: ROOM_CATALOG });
  })
);

router.post(
  "/room/buy",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = PieceIdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid room purchase payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => purchasePiece(tx, userId, parsed.data.pieceId));

    if (!outcome.ok) {
      const status = outcome.reason === "NOT_FOUND" ? 404 : outcome.reason === "ALREADY_OWNED" ? 409 : 400;
      return res.status(status).json({ error: "Could not purchase room piece", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ piece: outcome.piece, user: me });
  })
);

router.post(
  "/room/equip",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = PieceIdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid room equip payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => equipPiece(tx, userId, parsed.data.pieceId));

    if (!outcome.ok) {
      const status = outcome.reason === "NOT_FOUND" ? 404 : 403;
      return res.status(status).json({ error: "Could not equip room piece", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ piece: outcome.piece, user: me });
  })
);

export default router;
