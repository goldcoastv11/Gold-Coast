-- The Player Room (roadmap/player-room-v2) - wallpaper/flooring ownership
-- and equip state. Purely ADDITIVE, same precedent as the layered-wardrobe
-- migration this mirrors (20260828210000_layered_wardrobe): two new tables,
-- nothing dropped or altered.
--
-- NOT YET APPLIED IN PRODUCTION as of this branch - flag for the founder to
-- run `prisma migrate deploy` (see server/DEPLOYMENT.md's public-proxy
-- DATABASE_URL note) before this ships. Until then, server/src/serializers.ts's
-- getRoomState() degrades to the free defaults on the shared `tx`, same
-- safety net getWardrobeState()/getItemShopState() already rely on.

-- CreateEnum
CREATE TYPE "RoomSlot" AS ENUM ('WALLPAPER', 'FLOORING');

-- CreateTable
CREATE TABLE "room_owned" (
    "user_id" TEXT NOT NULL,
    "piece_id" TEXT NOT NULL,

    CONSTRAINT "room_owned_pkey" PRIMARY KEY ("user_id","piece_id")
);

-- CreateTable
CREATE TABLE "room_equipped" (
    "user_id" TEXT NOT NULL,
    "slot" "RoomSlot" NOT NULL,
    "piece_id" TEXT NOT NULL,

    CONSTRAINT "room_equipped_pkey" PRIMARY KEY ("user_id","slot")
);

-- AddForeignKey
ALTER TABLE "room_owned" ADD CONSTRAINT "room_owned_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_equipped" ADD CONSTRAINT "room_equipped_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
