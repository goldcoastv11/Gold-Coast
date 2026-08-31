/**
 * GET /leaderboard - the daily/weekly/all-time GC-earned boards. See
 * economy/leaderboard.ts for what "earned" means and how the windows are
 * derived.
 *
 * `requireAuth` even though every board is otherwise public-ish (usernames
 * are shown - explicit founder call, "they accepted that usernames become
 * publicly visible") because the response includes the CALLER's own
 * rank/row (`me`), which only makes sense for a known player, and every
 * other read route in this app (`/challenges`, `/progression`, `/me`) is
 * already auth-gated the same way for consistency.
 */

import { Router } from "express";
import { registerRoute } from "./registry";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { asyncHandler } from "../asyncHandler";
import { getLeaderboard } from "../economy/leaderboard";

const router = Router();

router.get(
  "/leaderboard",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const board = await prisma.$transaction((tx) => getLeaderboard(tx, userId));
    return res.json(board);
  })
);

registerRoute(router);

export default router;
