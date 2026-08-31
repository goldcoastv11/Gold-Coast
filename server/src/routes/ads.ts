/**
 * Ad-reward routes. GC-only, fully isolated from SC/redemption/playthrough
 * (see economy/adRewards.ts) - this file never touches SC.
 */

import { Router } from "express";
import { registerRoute } from "./registry";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { claimAdReward } from "../economy/adRewards";
import { serializeMe } from "../serializers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

router.post(
  "/ads/claim",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;

    const outcome = await prisma.$transaction((tx) => claimAdReward(tx, userId));

    if (!outcome.ok) {
      return res.status(429).json({
        error: "Ad reward is on cooldown",
        code: "COOLDOWN",
        remainingMs: outcome.remainingMs
      });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({
      granted: { gcAmount: outcome.transaction.amount },
      user: me
    });
  })
);

registerRoute(router);

export default router;
