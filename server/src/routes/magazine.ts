/**
 * GET /magazine - today's five (or fewer) player rooms, read-only (see
 * economy/magazine.ts for the daily-rotation/selection logic).
 *
 * `requireAuth`, unlike GET /room/catalog and GET /furniture/catalog:
 * those two are static catalogue data with nothing player-specific in
 * them, but this response carries other players' usernames and decor, so
 * it's gated behind login the same as every other in-game player-data
 * endpoint (GET /me, etc.) rather than left open like a static catalogue.
 */

import { Router } from "express";
import { registerRoute } from "./registry";
import { prisma } from "../db";
import { requireAuth } from "../auth/middleware";
import { getMagazineRooms } from "../economy/magazine";
import { asyncHandler } from "../asyncHandler";

const router = Router();

router.get(
  "/magazine",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const result = await getMagazineRooms(prisma);
    return res.json(result);
  })
);

registerRoute(router);

export default router;
