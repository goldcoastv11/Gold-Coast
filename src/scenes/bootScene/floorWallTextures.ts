import Phaser from "phaser";
import { PALETTE, LIT_ALPHA } from "./palette";

/**
 * Ground/wall tiles - the casino floor's paving, the two "rug" carpet tiles,
 * the perimeter wall, and the exit door. All procedural (Graphics +
 * generateTexture), moved out of BootScene.ts unchanged; texture keys are
 * untouched so buildFloor()/buildWalls()/buildDecorations() in
 * OverworldScene.ts need no changes.
 */

/**
 * Main plaza floor tile, 16x16 - warm sunlit sandstone paving. Drawn
 * procedurally (see class doc comment) instead of a loaded PNG.
 *
 * "Warm Daylight" pass: this is the single largest surface in the game by
 * area, so it's the main reason the world used to read as night-time - it
 * was a near-black charcoal (0x1c1e24). It's now PALETTE.floor, a warm
 * sand. The previous direction's "flecks must be LIGHTER than the base"
 * rule is inverted here (PALETTE.floorFleck is darker than PALETTE.floor);
 * see floorFleck's own comment - the underlying rule being kept is "the
 * fleck has to actually be visible," which flips with the base's lightness.
 *
 * Detail pass: this was a flat fill plus three 1px specks - repeated 4480
 * times across the map, which is precisely why the ground read as a dead
 * field rather than a surface. It is now a real paving slab: a joint along
 * two edges (so consecutive tiles form a visible grid rather than one
 * continuous smear), a lit top-left bevel and shaded bottom-right bevel
 * inside the joint, and grain. All of it stays deliberately low-contrast -
 * the founder's standing direction on this surface is "quieter, so the
 * games pop," so the goal here is texture you feel rather than a pattern
 * you look at.
 *
 * `variant` 1 splits the slab into two courses, giving the plaza a second
 * paver shape to break up the 16px repeat (see buildFloor, which sprinkles
 * it thinly). Both variants share the same edge joints, so they tile
 * against each other seamlessly in any arrangement.
 */
export function drawPavingTile(scene: Phaser.Scene, key: string, variant: 0 | 1) {
  const s = 16;
  const g = scene.add.graphics();

  g.fillStyle(PALETTE.floor, 1);
  g.fillRect(0, 0, s, s);

  // Joints along the top and left edges only - the neighbouring tile
  // supplies the other two, so the grid never doubles up into a 2px seam.
  g.fillStyle(PALETTE.floorFleck, 1);
  g.fillRect(0, 0, s, 1);
  g.fillRect(0, 0, 1, s);

  // Bevel inside the joint: lit on the top-left, shaded on the bottom
  // right. This is the whole reason the slab reads as raised.
  g.fillStyle(PALETTE.litEdge, 0.35);
  g.fillRect(1, 1, s - 1, 1);
  g.fillRect(1, 1, 1, s - 1);
  g.fillStyle(PALETTE.shadeEdge, 0.1);
  g.fillRect(1, s - 1, s - 1, 1);
  g.fillRect(s - 1, 1, 1, s - 1);

  if (variant === 1) {
    // A second course line across the middle, with its own bevel - the
    // same slab broken into two bricks.
    g.fillStyle(PALETTE.floorFleck, 1);
    g.fillRect(1, 8, s - 1, 1);
    g.fillStyle(PALETTE.litEdge, 0.3);
    g.fillRect(1, 9, s - 1, 1);
  }

  // Grain. Kept to a handful of 1px specks at very low contrast.
  g.fillStyle(PALETTE.floorFleck, 0.7);
  g.fillRect(5, 5, 1, 1);
  g.fillRect(11, 10, 1, 1);
  g.fillRect(8, 13, 1, 1);
  g.fillStyle(PALETTE.shadeEdge, 0.07);
  g.fillRect(12, 4, 2, 1);
  g.fillRect(4, 11, 2, 1);

  g.generateTexture(key, s, s);
  g.destroy();
}


export function createFloorTanTexture(scene: Phaser.Scene) {
  drawPavingTile(scene, "floor_tan", 0);
  drawPavingTile(scene, "floor_tan_b", 1);
}


/**
 * Gaming-floor "rug" tile, 16x16 - warm terracotta, reading as a clay/kilim
 * rug laid over the sand plaza. Distinct from the plaza in BOTH hue and
 * value, which is a real improvement on the old pairing: that one asked a
 * dark grey and a dark navy to be told apart, and at those lightnesses they
 * largely weren't. A deeper terracotta fleck gives it texture, plus a small
 * orange speck and a faint ivory one, all kept low-alpha/small so none of
 * it reads as a loud repeating pattern (an earlier full-tile orange border
 * was too loud - see git history).
 */
export function createCarpetBlueTexture(scene: Phaser.Scene) {
  const s = 16;
  const g = scene.add.graphics();
  g.fillStyle(PALETTE.rug, 1);
  g.fillRect(0, 0, s, s);

  // Detail pass: this used to be a flat terracotta fill with four 1px
  // dots on it. It is now a woven WEAVE - alternating warp and weft
  // threads, one pixel each - which is what makes a rug read as fabric
  // instead of paint. Deliberately kept to a 2px period and very low
  // contrast: at this scale the eye reads it as material, not as stripes,
  // and the founder's direction on this surface is "quieter."
  g.fillStyle(PALETTE.rugFleck, 0.55);
  for (let x = 0; x < s; x += 2) g.fillRect(x, 0, 1, s);
  g.fillStyle(PALETTE.litEdge, 0.05);
  for (let y = 1; y < s; y += 2) g.fillRect(0, y, s, 1);

  // A few slubs in the weave so it isn't perfectly mechanical, plus the
  // original faint coral/ivory specks.
  g.fillStyle(PALETTE.rugFleck, 1);
  g.fillRect(4, 4, 1, 1);
  g.fillRect(12, 12, 1, 1);
  g.fillStyle(PALETTE.coral, 0.2);
  g.fillRect(9, 5, 1, 1);
  g.fillStyle(PALETTE.cream, 0.14);
  g.fillRect(13, 8, 1, 1);

  g.generateTexture("carpet_blue", s, s);
  g.destroy();
}


/** Same treatment as createCarpetBlueTexture, unused key kept for parity/future use - see that method's doc comment. */
export function createCarpetRedTexture(scene: Phaser.Scene) {
  const s = 16;
  const g = scene.add.graphics();
  g.fillStyle(PALETTE.rugRed, 1);
  g.fillRect(0, 0, s, s);
  g.fillStyle(PALETTE.rugRedFleck, 1);
  g.fillCircle(4, 4, 0.9);
  g.fillCircle(12, 12, 0.9);
  g.generateTexture("carpet_red", s, s);
  g.destroy();
}


/**
 * Perimeter wall tile, 16x16 - warm sandstone plaster with a deeper mortar
 * course line and a warm-orange baseboard trim. The trim used to be an
 * explicitly "glowing neon strip" against a dark navy brick; at these
 * lightnesses it stops reading as neon and instead reads as a painted
 * skirting board, which is the intent under the daylight direction.
 */
export function createWallTexture(scene: Phaser.Scene) {
  const s = 16;
  const g = scene.add.graphics();

  // Mortar bed, then the blocks laid on top of it - the opposite of the
  // previous version, which filled the tile and stroked two rectangles
  // over it (giving two outlined boxes, not masonry).
  g.fillStyle(PALETTE.wallLine, 1);
  g.fillRect(0, 0, s, s);

  // Running bond: a full block on the upper course, two half blocks on
  // the lower one, so the vertical joints stagger tile-to-tile instead of
  // stacking into one continuous seam down the wall.
  const block = (x: number, y: number, bw: number, bh: number) => {
    g.fillStyle(PALETTE.wall, 1);
    g.fillRect(x, y, bw, bh);
    g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
    g.fillRect(x, y, bw, 1);
    g.fillStyle(PALETTE.shadeEdge, 0.13);
    g.fillRect(x, y + bh - 1, bw, 1);
    g.fillRect(x + bw - 1, y, 1, bh);
  };
  block(0, 1, s, 6);
  block(0, 9, 7, 6);
  block(8, 9, 8, 6);

  // Painted skirting along the base, as before.
  g.fillStyle(PALETTE.coral, 1);
  g.fillRect(0, s - 2, s, 2);
  g.fillStyle(PALETTE.litEdge, 0.3);
  g.fillRect(0, s - 2, s, 1);

  g.generateTexture("wall", s, s);
  g.destroy();
}


/**
 * A simple drawn door - "Arcade Nights" palette: near-black outline, dark
 * navy panel, gold-orange knob, rounded corners throughout.
 */
export function createExitDoorTexture(scene: Phaser.Scene) {
  const w = 40;
  const h = 48;
  const g = scene.add.graphics();
  // door frame
  g.fillStyle(PALETTE.outline, 1);
  g.fillRoundedRect(0, 0, w, h, 4);
  // door panel
  g.fillStyle(PALETTE.cabinet, 1);
  g.fillRoundedRect(4, 4, w - 8, h - 8, 3);
  // panel inset lines
  g.lineStyle(2, PALETTE.cabinetDark, 1);
  g.strokeRoundedRect(9, 9, w - 18, h / 2 - 10, 2);
  g.strokeRoundedRect(9, h / 2 + 1, w - 18, h / 2 - 10, 2);
  // doorknob
  g.fillStyle(PALETTE.gold, 1);
  g.fillCircle(w - 11, h / 2, 2.5);
  g.generateTexture("exit_door", w, h);
  g.destroy();
}
