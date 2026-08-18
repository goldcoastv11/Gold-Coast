-- CreateTable
CREATE TABLE "game_rounds" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "bet_amount" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "state" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "game_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_rounds_user_id_game_status_idx" ON "game_rounds"("user_id", "game", "status");

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
