import { Router } from "express";
import { registerRoute } from "./registry";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const PositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
});

router.post(
  "/position",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const parsed = PositionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid position payload", code: "INVALID_INPUT" });
    }

    const { x, y } = parsed.data;
    await prisma.lastPosition.upsert({
      where: { userId },
      create: { userId, x, y },
      update: { x, y }
    });

    return res.json({ ok: true, x, y });
  })
);

registerRoute(router);

export default router;
