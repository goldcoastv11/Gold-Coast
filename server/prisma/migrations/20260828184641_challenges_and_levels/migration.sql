-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'CHALLENGE_REWARD_GC';
ALTER TYPE "TransactionType" ADD VALUE 'LEVEL_REWARD_GC';

-- CreateTable
CREATE TABLE "player_progress" (
    "user_id" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "rewarded_level" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "player_progress_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "challenge_progress" (
    "user_id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "seen" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "claimed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "challenge_progress_pkey" PRIMARY KEY ("user_id","challenge_id","period_key")
);

-- CreateIndex
CREATE INDEX "challenge_progress_user_id_period_key_idx" ON "challenge_progress"("user_id", "period_key");

-- AddForeignKey
ALTER TABLE "player_progress" ADD CONSTRAINT "player_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_progress" ADD CONSTRAINT "challenge_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
