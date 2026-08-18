/**
 * Economy routes: attendant claim, GC package purchase, SC redemption.
 * All authenticated; all wrap their DB work in a single
 * `prisma.$transaction` so the ledger write(s) + related-table updates
 * (playthrough, cooldown, meta) are all-or-nothing per request.
 */

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { claimAttendantBonus } from "../economy/attendantClaim";
import { pickRandomGcMultiplier } from "../economy/gcMultiplier";
import { listPackages, purchasePackage } from "../economy/packages";
import { redeemSc, MIN_SC_REDEMPTION } from "../economy/redemption";
import { serializeMe } from "../serializers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

// ---- Attendant claim ----
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
        gcAmount: outcome.gcTransaction.amount,
        scAmount: outcome.scBonusTransaction.amount
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
      granted: { gcAmount: outcome.gcTransaction.amount, scAmount: outcome.scBonusTransaction.amount },
      pkg: outcome.pkg,
      user: me
    });
  })
);

// ---- SC redemption ----
const RedeemSchema = z.object({ amountSc: z.number().positive() });

router.post(
  "/redeem",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = RedeemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid redemption payload", code: "INVALID_INPUT" });
    }

    const outcome = await prisma.$transaction((tx) => redeemSc(tx, userId, parsed.data.amountSc));

    if (!outcome.ok) {
      return res.status(400).json({
        error: "Redemption not eligible",
        code: outcome.eligibility.reason,
        minimumSc: MIN_SC_REDEMPTION,
        eligibility: outcome.eligibility
      });
    }

    const me = await prisma.$transaction((tx) => serializeMe(tx, userId, username));
    return res.json({ redeemedSc: outcome.amountSc, user: me });
  })
);

export default router;
