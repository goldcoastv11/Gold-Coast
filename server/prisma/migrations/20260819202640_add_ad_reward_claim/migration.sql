-- CreateTable
CREATE TABLE "ad_reward_claim" (
    "user_id" TEXT NOT NULL,
    "last_claimed_at" TIMESTAMPTZ(3),

    CONSTRAINT "ad_reward_claim_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "ad_reward_claim" ADD CONSTRAINT "ad_reward_claim_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
