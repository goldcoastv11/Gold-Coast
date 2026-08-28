/**
 * Challenges & levels routes (Retention Leg 2).
 *
 *   GET  /challenges       - the player's active daily/weekly challenges and
 *                            permanent achievements, with progress
 *   POST /challenges/claim - claim one completed challenge (pays Gold Coins
 *                            + XP, and any level rewards that XP unlocks)
 *   GET  /progression      - level / XP state on its own
 *
 * All three are `requireAuth`: every one reads or writes a specific
 * player's state, and the claim route moves money. Nothing here ever reads
 * an identity from the request body - `userId` comes only from the verified
 * JWT, same trust boundary as every other authenticated route.
 *
 * There is deliberately NO route for reporting progress. Progress is
 * recorded server-side from real game settlement (progression/progress.ts
 * and games/shared.ts); a "I completed this" endpoint would hand a client
 * the ability to mint Gold Coins.
 */

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { serializeMe } from "../serializers";
import { asyncHandler } from "../asyncHandler";
import { claimChallenge, getChallengeBoard, getProgression } from "../progression/progress";
import { LEVEL_COSMETIC_UNLOCKS, MAX_LEVEL, levelRewardGc } from "../progression/levels";

const router = Router();

router.get(
  "/challenges",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const board = await prisma.$transaction((tx) => getChallengeBoard(tx, userId));
    return res.json(board);
  })
);

const ClaimSchema = z.object({ challengeId: z.string().min(1).max(64) });

router.post(
  "/challenges/claim",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = ClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid challenge claim payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => claimChallenge(tx, userId, parsed.data.challengeId));

    if (!outcome.ok) {
      const status =
        outcome.reason === "NOT_FOUND" ? 404 : outcome.reason === "ALREADY_CLAIMED" ? 409 : 400;
      return res.status(status).json({ error: "Could not claim challenge", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({
      claimed: {
        challengeId: outcome.challengeId,
        rewardGc: outcome.rewardGc,
        rewardXp: outcome.rewardXp
      },
      progression: outcome.progression,
      levelsGained: outcome.levelsGained,
      user: me
    });
  })
);

router.get(
  "/progression",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const progression = await prisma.$transaction((tx) => getProgression(tx, userId));
    return res.json({
      ...progression,
      maxLevel: MAX_LEVEL,
      /** What the NEXT level pays, so the client can show "next: 600 Gold Coins". */
      nextLevelRewardGc: progression.atMaxLevel ? 0 : levelRewardGc(progression.level + 1),
      cosmeticUnlocks: LEVEL_COSMETIC_UNLOCKS
    });
  })
);

export default router;
