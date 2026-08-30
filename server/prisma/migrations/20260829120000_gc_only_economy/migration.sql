-- GC-only economy restructure (2026-08-29, founder direction): TICKETS is
-- retired, every game now pays its win out in GC, and the wardrobe/Item Shop
-- are priced in GC.
--
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
--
-- Schema-only: no data is touched here. The follow-up migration
-- (20260829120100_zero_tickets_balances) uses TICKETS_RETIRED added below -
-- Postgres won't let a brand-new enum value be used in the same transaction
-- that adds it, so that has to be a separate migration, not a data-write
-- statement appended to this one.

ALTER TYPE "TransactionType" ADD VALUE 'GAME_WIN_GC';
ALTER TYPE "TransactionType" ADD VALUE 'SHOP_PURCHASE_GC';
ALTER TYPE "TransactionType" ADD VALUE 'TICKETS_RETIRED';
