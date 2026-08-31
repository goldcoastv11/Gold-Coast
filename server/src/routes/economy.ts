/**
 * Economy routes: Coin Kiosk claim, GC package purchase.
 * All authenticated; all wrap their DB work in a single
 * `prisma.$transaction` so the ledger write(s) + related-table updates
 * (cooldown, meta) are all-or-nothing per request.
 *
 * History: this used to also have a `POST /redeem` (SC redemption) route,
 * back when this game used a two-currency GC/SC sweepstakes model with a
 * real-money redemption path. That whole model was replaced with the
 * current "arcade token" one (GC to play, TICKETS won from playing, spent
 * in the Item Shop, no real-money value at all) - see repo-root CLAUDE.md
 * and economy/ledger.ts's doc comment. There's nothing left to redeem for
 * cash, so that route is gone, not just unused.
 */

import { Router } from "express";
import { registerRoute } from "./registry";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { claimAttendantBonus } from "../economy/attendantClaim";
import { pickRandomGcMultiplier } from "../economy/gcMultiplier";
import { listPackages, purchasePackage } from "../economy/packages";
import { serializeMe } from "../serializers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

// ---- Coin Kiosk claim ----
// GC leg's multiplier is resolved server-side here (never trusts the
// client's shuffle-cup animation outcome) - see economy/gcMultiplier.ts.
router.post(
  "/claim-bonus",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const multiplier = pickRandomGcMultiplier();

    const outcome = await prisma.$transaction((tx) => claimAttendantBonus(tx, userId, multiplier));

    if (!outcome.ok) {
      return res.status(429).json({
        error: "Attendant claim is on cooldown",
        code: "COOLDOWN",
        remainingMs: outcome.remainingMs
      });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({
      granted: {
        gcMultiplier: multiplier,
        gcAmount: outcome.gcTransaction.amount
      },
      user: me
    });
  })
);

// ---- GC packages ----
router.get("/packages", (_req, res) => {
  res.json({ packages: listPackages() });
});

const PurchasePackageSchema = z.object({ packageId: z.string().min(1) });

router.post(
  "/packages/purchase",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = PurchasePackageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid purchase payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => purchasePackage(tx, userId, parsed.data.packageId));

    if (!outcome.ok) {
      return res.status(404).json({ error: "Unknown package id", code: outcome.reason });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({
      granted: { gcAmount: outcome.gcTransaction.amount },
      pkg: outcome.pkg,
      user: me
    });
  })
);

registerRoute(router);

export default router;
