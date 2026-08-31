import { Router } from "express";
import { registerRoute } from "./registry";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { prisma } from "../db";
import { serializeMe } from "../serializers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    res.json(me);
  })
);

registerRoute(router);

export default router;
