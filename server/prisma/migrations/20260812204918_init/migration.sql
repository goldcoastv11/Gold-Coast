-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('GC', 'SC');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SIGNUP_BONUS_SC', 'PACKAGE_BONUS_SC', 'SIGNUP_BONUS_GC', 'PACKAGE_GC', 'SKIN_PURCHASE_GC', 'AD_REWARD_GC', 'REDEMPTION_SC', 'WAGER_GC', 'WAGER_SC', 'PAYOUT_GC', 'PAYOUT_SC', 'ADJUST_GC', 'ADJUST_SC');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balances" (
    "user_id" TEXT NOT NULL,
    "gold_coins" INTEGER NOT NULL DEFAULT 0,
    "stake_coins" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "balances_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skins_owned" (
    "user_id" TEXT NOT NULL,
    "skin_id" TEXT NOT NULL,

    CONSTRAINT "skins_owned_pkey" PRIMARY KEY ("user_id","skin_id")
);

-- CreateTable
CREATE TABLE "equipped_skin" (
    "user_id" TEXT NOT NULL,
    "skin_id" TEXT NOT NULL,

    CONSTRAINT "equipped_skin_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "last_position" (
    "user_id" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "last_position_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "playthrough_progress" (
    "user_id" TEXT NOT NULL,
    "sc_required" INTEGER NOT NULL DEFAULT 0,
    "sc_wagered" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "playthrough_progress_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "attendant_claim" (
    "user_id" TEXT NOT NULL,
    "last_claimed_at" TIMESTAMP(3),

    CONSTRAINT "attendant_claim_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "transactions_user_id_created_at_idx" ON "transactions"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "balances" ADD CONSTRAINT "balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skins_owned" ADD CONSTRAINT "skins_owned_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipped_skin" ADD CONSTRAINT "equipped_skin_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "last_position" ADD CONSTRAINT "last_position_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playthrough_progress" ADD CONSTRAINT "playthrough_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendant_claim" ADD CONSTRAINT "attendant_claim_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
