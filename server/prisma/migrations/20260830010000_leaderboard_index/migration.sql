-- GC-earned leaderboard (roadmap/leaderboard): supports economy/leaderboard.ts's
-- SUM(amount) GROUP BY user_id WHERE type IN (...) AND created_at >= <window
-- start> query for the daily/weekly boards, and the "type IN (...)" narrowing
-- for the all-time board. See schema.prisma's Transaction model comment for
-- why the existing [user_id, created_at] index doesn't already cover this.
--
-- Additive-only, no data touched - safe to deploy independently of anything
-- else. NOT yet applied to production as of this writing; flag for the
-- founder to run alongside the other pending migrations.

-- CreateIndex
CREATE INDEX "transactions_type_created_at_idx" ON "transactions"("type", "created_at");
