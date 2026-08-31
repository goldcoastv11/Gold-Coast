/**
 * Layered wardrobe routes - replaces routes/skins.ts, and used to mirror
 * routes/items.ts's shape exactly (see economy/wardrobe.ts) - that file was
 * the accessories/pets Item Shop's buy/equip/unequip backend, removed as
 * dead code once its only UI entry point was pulled (2026-08-30
 * roadmap/deadcode, see repo-root CLAUDE.md). GC-only (2026-08-29 GC-only
 * economy restructure - TICKETS is retired, see repo-root CLAUDE.md).
 *
 * GET /wardrobe/catalog is public (no auth): it's static catalogue data -
 * slots, their explicit draw order, and every piece's id/name/price - with
 * nothing player-specific in it. What a given player OWNS and WEARS comes
 * back on the normal authenticated user payload (serializers.ts's
 * MeResponse), so no route here needs to serve per-player state.
 */

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { purchasePiece, equipPiece, unequipSlot } from "../economy/wardrobe";
import { WARDROBE_CATALOG, WARDROBE_SLOTS } from "../wardrobeCatalog";
import { serializeMe } from "../serializers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const PieceIdSchema = z.object({ pieceId: z.string().min(1) });
// Mirrors the WardrobeSlot enum. Listed literally rather than derived so an
// invalid slot is a 400 from validation, never a Prisma-level enum error.
const SlotSchema = z.object({
  slot: z.enum(["BODY", "LEGS", "FEET", "TORSO", "HAIR", "HAT"])
});

router.get(
  "/wardrobe/catalog",
  asyncHandler(async (_req, res) => {
    return res.json({ slots: WARDROBE_SLOTS, pieces: WARDROBE_CATALOG });
  })
);

router.post(
  "/wardrobe/buy",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = PieceIdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid wardrobe purchase payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => purchasePiece(tx, userId, parsed.data.pieceId));

    if (!outcome.ok) {
      const status = outcome.reason === "NOT_FOUND" ? 404 : outcome.reason === "ALREADY_OWNED" ? 409 : 400;
      return res.status(status).json({ error: "Could not purchase wardrobe piece", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ piece: outcome.piece, user: me });
  })
);

router.post(
  "/wardrobe/equip",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = PieceIdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid wardrobe equip payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => equipPiece(tx, userId, parsed.data.pieceId));

    if (!outcome.ok) {
      const status = outcome.reason === "NOT_FOUND" ? 404 : 403;
      return res.status(status).json({ error: "Could not equip wardrobe piece", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ piece: outcome.piece, user: me });
  })
);

router.post(
  "/wardrobe/unequip",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = SlotSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid wardrobe unequip payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => unequipSlot(tx, userId, parsed.data.slot));

    // Taking off the BODY slot is refused outright - see economy/wardrobe.ts's
    // unequipSlot. 400 rather than 403: it's a malformed request (that slot
    // can't be empty), not a permission problem.
    if (!outcome.ok) {
      return res.status(400).json({ error: "That slot can't be left empty", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ user: me });
  })
);

export default router;
