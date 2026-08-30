-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'LEVEL_MINIGAME_REWARD_GC';

-- AlterTable
ALTER TABLE "player_progress" ADD COLUMN     "pending_minigame_level" INTEGER;

-- CreateTable
CREATE TABLE "level_minigame_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sweep_period_ms" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "accuracy" DOUBLE PRECISION,
    "reward_gc" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "level_minigame_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "level_minigame_sessions_user_id_status_idx" ON "level_minigame_sessions"("user_id", "status");

-- AddForeignKey
ALTER TABLE "level_minigame_sessions" ADD CONSTRAINT "level_minigame_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
