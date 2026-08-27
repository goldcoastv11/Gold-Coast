-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('ACCESSORY', 'PET');

-- CreateTable
CREATE TABLE "items_owned" (
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,

    CONSTRAINT "items_owned_pkey" PRIMARY KEY ("user_id","item_id")
);

-- CreateTable
CREATE TABLE "equipped_items" (
    "user_id" TEXT NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "item_id" TEXT NOT NULL,

    CONSTRAINT "equipped_items_pkey" PRIMARY KEY ("user_id","category")
);

-- AddForeignKey
ALTER TABLE "items_owned" ADD CONSTRAINT "items_owned_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipped_items" ADD CONSTRAINT "equipped_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
