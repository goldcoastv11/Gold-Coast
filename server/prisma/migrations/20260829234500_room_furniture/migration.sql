-- Player Room furniture (roadmap/room-furniture) - ownership and fixed-slot
-- placement for the room's third decor category, alongside wallpaper and
-- flooring. Purely ADDITIVE, same precedent as the player-room migration
-- this follows (20260829233000_player_room): two new tables plus one new
-- enum, nothing dropped or altered.
--
-- NOT YET APPLIED IN PRODUCTION as of this branch - flag for the founder to
-- run `prisma migrate deploy` (see server/DEPLOYMENT.md's public-proxy
-- DATABASE_URL note) before this ships. Until then, server/src/serializers.ts's
-- getFurnitureState() degrades to "nothing owned, every slot empty" on the
-- shared `tx`, same safety net getRoomState()/getWardrobeState()/
-- getItemShopState() already rely on.

-- CreateEnum
CREATE TYPE "FurnitureSlot" AS ENUM ('WALL_LEFT', 'WALL_RIGHT', 'CORNER', 'BY_DOOR');

-- CreateTable
CREATE TABLE "furniture_owned" (
    "user_id" TEXT NOT NULL,
    "piece_id" TEXT NOT NULL,

    CONSTRAINT "furniture_owned_pkey" PRIMARY KEY ("user_id","piece_id")
);

-- CreateTable
CREATE TABLE "furniture_placed" (
    "user_id" TEXT NOT NULL,
    "slot" "FurnitureSlot" NOT NULL,
    "piece_id" TEXT NOT NULL,

    CONSTRAINT "furniture_placed_pkey" PRIMARY KEY ("user_id","slot")
);

-- AddForeignKey
ALTER TABLE "furniture_owned" ADD CONSTRAINT "furniture_owned_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "furniture_placed" ADD CONSTRAINT "furniture_placed_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
