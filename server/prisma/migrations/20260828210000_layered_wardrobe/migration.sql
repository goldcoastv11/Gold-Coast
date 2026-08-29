-- Layered wardrobe (replaces the 17 monolithic character skins).
--
-- Purely ADDITIVE, deliberately: the skins_owned / equipped_skin tables are
-- left in place and untouched even though nothing reads or writes them any
-- more. Same additive-only precedent as the retired SC-era enum values and
-- playthrough_progress table (see schema.prisma's header) - a DROP TABLE
-- against production buys nothing functional here and cannot be undone.
-- The skin FEATURE is gone: its catalog, shop module, routes and client
-- panel were all deleted in this change.

-- CreateEnum
CREATE TYPE "WardrobeSlot" AS ENUM ('BODY', 'LEGS', 'FEET', 'TORSO', 'HAIR', 'HAT');

-- CreateTable
CREATE TABLE "wardrobe_owned" (
    "user_id" TEXT NOT NULL,
    "piece_id" TEXT NOT NULL,

    CONSTRAINT "wardrobe_owned_pkey" PRIMARY KEY ("user_id","piece_id")
);

-- CreateTable
CREATE TABLE "equipped_wardrobe" (
    "user_id" TEXT NOT NULL,
    "slot" "WardrobeSlot" NOT NULL,
    "piece_id" TEXT NOT NULL,

    CONSTRAINT "equipped_wardrobe_pkey" PRIMARY KEY ("user_id","slot")
);

-- AddForeignKey
ALTER TABLE "wardrobe_owned" ADD CONSTRAINT "wardrobe_owned_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipped_wardrobe" ADD CONSTRAINT "equipped_wardrobe_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
