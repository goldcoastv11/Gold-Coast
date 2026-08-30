import Phaser from "phaser";
import { FurnitureSlotId } from "./furnitureCatalog";

/**
 * Shared Player Room tile-grid rendering (roadmap/magazine), factored out
 * of src/scenes/RoomScene.ts so a read-only viewer of ANOTHER player's
 * room (ui/MagazinePanel.ts) can draw a room from decor DATA instead of
 * gameState, using the exact same tile size, tile loop and furniture slot
 * positions RoomScene itself uses - not a second art pipeline that could
 * quietly drift from the one every player actually walks around in.
 * RoomScene.ts's buildFloor/buildFurniture now call straight into this
 * file; its own behaviour (what gets drawn, at what coordinates) is
 * unchanged, only where the drawing code lives.
 *
 * DELIBERATELY NOT SHARED: wall PHYSICS. RoomScene's own buildWalls() still
 * builds its wall row/column itself (`physics.add.staticGroup`, for player
 * collision) rather than calling into this file - a read-only viewer has no
 * player to collide with, so buildWallImages() below only ever draws plain
 * Images. Both trace the identical border loop over the identical wallKey
 * texture, so there is no second visual definition of what a wall looks
 * like, only two different Phaser object types wrapping it depending on
 * whether the caller needs a collider.
 */

export const ROOM_TILE = 16;
export const ROOM_COLS = 50;
export const ROOM_ROWS = 38;
export const ROOM_PIXEL_W = ROOM_COLS * ROOM_TILE;
export const ROOM_PIXEL_H = ROOM_ROWS * ROOM_TILE;

/**
 * World pixel position for each furniture slot - moved here from
 * RoomScene.ts unchanged (see that file's former comment, reproduced
 * below), so RoomScene and any read-only viewer place the same piece in
 * the same spot.
 *
 * Four sensible spots, picked to stay clear of the spawn(25,28)-to-
 * door(25,33) walking corridor (a straight vertical line around x=400):
 * two against the side walls at mid-height, one in the top-left corner,
 * one off to the side of the door rather than in front of it.
 */
export const FURNITURE_SLOT_POSITIONS: Record<FurnitureSlotId, { x: number; y: number }> = {
  WALL_LEFT: { x: 6 * ROOM_TILE, y: 19 * ROOM_TILE },
  WALL_RIGHT: { x: 44 * ROOM_TILE, y: 19 * ROOM_TILE },
  CORNER: { x: 6 * ROOM_TILE, y: 6 * ROOM_TILE },
  BY_DOOR: { x: 39 * ROOM_TILE, y: 30 * ROOM_TILE }
};

/**
 * Draws the full floor tile grid as plain (non-physics) images at world
 * offset (originX, originY) - the same loop RoomScene.buildFloor used
 * before this file existed.
 */
export function buildFloorTiles(
  scene: Phaser.Scene,
  floorKey: string,
  originX = 0,
  originY = 0
): Phaser.GameObjects.Image[] {
  const tiles: Phaser.GameObjects.Image[] = [];
  for (let x = 0; x < ROOM_COLS; x++) {
    for (let y = 0; y < ROOM_ROWS; y++) {
      tiles.push(
        scene.add.image(originX + x * ROOM_TILE + ROOM_TILE / 2, originY + y * ROOM_TILE + ROOM_TILE / 2, floorKey)
      );
    }
  }
  return tiles;
}

/**
 * Draws the wall border as plain (non-physics) images at world offset
 * (originX, originY) - a read-only viewer's version of RoomScene's own
 * buildWalls, minus the Arcade physics bodies (see this file's header).
 */
export function buildWallImages(
  scene: Phaser.Scene,
  wallKey: string,
  originX = 0,
  originY = 0
): Phaser.GameObjects.Image[] {
  const images: Phaser.GameObjects.Image[] = [];
  for (let x = 0; x < ROOM_COLS; x++) {
    images.push(scene.add.image(originX + x * ROOM_TILE + ROOM_TILE / 2, originY + ROOM_TILE / 2, wallKey));
    images.push(
      scene.add.image(
        originX + x * ROOM_TILE + ROOM_TILE / 2,
        originY + (ROOM_ROWS - 1) * ROOM_TILE + ROOM_TILE / 2,
        wallKey
      )
    );
  }
  for (let y = 0; y < ROOM_ROWS; y++) {
    images.push(scene.add.image(originX + ROOM_TILE / 2, originY + y * ROOM_TILE + ROOM_TILE / 2, wallKey));
    images.push(
      scene.add.image(
        originX + (ROOM_COLS - 1) * ROOM_TILE + ROOM_TILE / 2,
        originY + y * ROOM_TILE + ROOM_TILE / 2,
        wallKey
      )
    );
  }
  return images;
}

/**
 * Draws every furniture slot's image (visible only where `placed[slot]` is
 * set) at world offset (originX, originY) - the same "one image per slot,
 * hidden if empty" pattern RoomScene.buildFurniture used before this file
 * existed.
 */
export function buildFurnitureImages(
  scene: Phaser.Scene,
  placed: Partial<Record<FurnitureSlotId, string>>,
  originX = 0,
  originY = 0
): Partial<Record<FurnitureSlotId, Phaser.GameObjects.Image>> {
  const sprites: Partial<Record<FurnitureSlotId, Phaser.GameObjects.Image>> = {};
  for (const slotDef of Object.keys(FURNITURE_SLOT_POSITIONS) as FurnitureSlotId[]) {
    const { x, y } = FURNITURE_SLOT_POSITIONS[slotDef];
    const pieceId = placed[slotDef] ?? null;
    const image = scene.add
      .image(originX + x, originY + y, pieceId ?? "furniture_armchair")
      .setOrigin(0.5, 0.9);
    image.setVisible(pieceId !== null);
    sprites[slotDef] = image;
  }
  return sprites;
}
