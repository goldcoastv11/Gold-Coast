/**
 * Challenges & levels routes (Retention Leg 2), plus the level-up "stop the
 * marker" timing minigame that rides on top of it.
 *
 *   GET  /challenges              - the player's active daily/weekly
 *                                   challenges and permanent achievements,
 *                                   with progress
 *   POST /challenges/claim        - claim one completed challenge (pays Gold
 *                                   Coins + XP, and any level rewards that
 *                                   XP unlocks)
 *   GET  /progression             - level / XP state on its own, including
 *                                   any minigame currently owed
 *   POST /minigame/levelup/start  - starts (or resumes) the minigame owed
 *                                   for a level-up, if any
 *   POST /minigame/levelup/stop   - stops the marker and pays out
 *
 * All five are `requireAuth`: every one reads or writes a specific player's
 * state, and three of them move money. Nothing here ever reads an identity
 * from the request body - `userId` comes only from the verified JWT, same
 * trust boundary as every other authenticated route.
 *
 * There is deliberately NO route for reporting challenge progress, and the
 * minigame's stop route takes no accuracy/result input from the client at
 * all - see progression/progress.ts's TRUST BOUNDARY note and
 * progression/levelMinigameSession.ts's header. A "here's what I scored"
 * endpoint would hand a client the ability to mint Gold Coins.
 */

import { Router } from "express";
import { registerRoute } from "./registry";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { serializeMe } from "../serializers";
import { asyncHandler } from "../asyncHandler";
import { claimChallenge, getChallengeBoard, getPendingLevelMinigame, getProgression } from "../progression/progress";
import { LEVEL_COSMETIC_UNLOCKS, MAX_LEVEL, levelRewardGc } from "../progression/levels";
import { completeLevelMinigame, startLevelMinigame } from "../progression/levelMinigameSession";

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
      pendingLevelMinigame: outcome.pendingLevelMinigame,
      user: me
    });
  })
);

router.get(
  "/progression",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const [progression, pendingLevelMinigame] = await prisma.$transaction((tx) =>
      Promise.all([getProgression(tx, userId), getPendingLevelMinigame(tx, userId)])
    );
    return res.json({
      ...progression,
      maxLevel: MAX_LEVEL,
      /** What the NEXT level pays, so the client can show "next: 600 Gold Coins". */
      nextLevelRewardGc: progression.atMaxLevel ? 0 : levelRewardGc(progression.level + 1),
      cosmeticUnlocks: LEVEL_COSMETIC_UNLOCKS,
      // Non-null when a level-up minigame is owed and not yet played - e.g.
      // the player closed the tab on it earlier. Lets the challenges panel
      // route back into it on next open instead of it being silently lost.
      pendingLevelMinigame
    });
  })
);

// ---------------------------------------------------------------------
// Level-up minigame ("stop the marker" - see progression/levelMinigame.ts)
// ---------------------------------------------------------------------

router.post(
  "/minigame/levelup/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const outcome = await prisma.$transaction((tx) => startLevelMinigame(tx, userId));

    if (!outcome.ok) {
      const status = outcome.reason === "NONE_PENDING" ? 409 : 400;
      return res.status(status).json({ error: "No level-up minigame to start", code: outcome.reason });
    }

    return res.json({ session: outcome.session });
  })
);

const StopSchema = z.object({ sessionId: z.string().min(1).max(64) });

router.post(
  "/minigame/levelup/stop",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = StopSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid minigame stop payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) =>
      completeLevelMinigame(tx, userId, parsed.data.sessionId)
    );

    if (!outcome.ok) {
      const status =
        outcome.reason === "NOT_FOUND" ? 404 : outcome.reason === "ALREADY_CLAIMED" ? 409 : 400;
      return res.status(status).json({ error: "Could not complete level-up minigame", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({
      result: {
        level: outcome.level,
        accuracy: outcome.accuracy,
        rewardGc: outcome.rewardGc,
        position: outcome.position
      },
      user: me
    });
  })
);

registerRoute(router);

export default router;
