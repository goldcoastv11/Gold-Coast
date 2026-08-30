/**
 * Pure layout/navigation math for ui/MagazinePanel.ts. Deliberately
 * Phaser-free and side-effect-free (same reasoning as quickplayGrid.ts) so
 * the panel's two easy-to-get-wrong bits - "does the scaled room actually
 * fit the well without distorting it" and "does Prev/Next wrap around
 * cleanly at either end" - are unit-testable without standing up a scene.
 */

import { ROOM_PIXEL_H, ROOM_PIXEL_W } from "../roomRenderer";

/**
 * The uniform scale (and resulting pixel size) that fits the room's full
 * ROOM_PIXEL_W x ROOM_PIXEL_H world into a box of at most (maxW, maxH),
 * preserving its aspect ratio. Capped at 1 - a thumbnail never upscales
 * past the room's real, already-small pixel-art resolution.
 */
export function fitRoomScale(maxW: number, maxH: number): { scale: number; w: number; h: number } {
  const scale = Math.min(maxW / ROOM_PIXEL_W, maxH / ROOM_PIXEL_H, 1);
  return { scale, w: ROOM_PIXEL_W * scale, h: ROOM_PIXEL_H * scale };
}

/**
 * Wraps `index` into [0, count) so Prev/Next can cycle past either end
 * instead of dead-ending - stepping Next from the last room lands back on
 * the first, and Prev from the first lands on the last. Returns 0 for an
 * empty list (nothing to wrap into).
 */
export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}
