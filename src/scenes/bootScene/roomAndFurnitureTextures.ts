import Phaser from "phaser";
import { PALETTE, LIT_ALPHA, CONTACT_SHADOW_ALPHA } from "./palette";

/**
 * Player Room decor: wallpaper/flooring tiles (roomCatalog.ts's
 * ROOM_CATALOG) and standalone furniture props (furnitureCatalog.ts's
 * FURNITURE_CATALOG), plus the outdoor decorative plant prop. All
 * procedural, moved out of BootScene.ts unchanged; a piece's catalogue
 * `id` is still its texture key.
 */

/**
 * Player Room wallpaper tiles, 16x16 tileable - one per WALLPAPER piece
 * in roomCatalog.ts's ROOM_CATALOG. A piece's `id` IS its texture key
 * here, same convention wardrobe pieces use, so adding a wallpaper is
 * purely a catalogue + generator pair, never a renderer change.
 *
 * Same warm PALETTE as everything else in this file, but deliberately
 * NOT a reuse of createWallTexture's sandstone plaster: that texture is
 * the outdoor casino plaza's perimeter wall, and the whole point of the
 * Room is that it reads as a distinct, private space rather than another
 * patch of the same building - so its wall gets its own lighter, cozier
 * register (indoor wallpaper, not exterior masonry).
 */
export function createRoomWallpaperTextures(scene: Phaser.Scene) {
  const s = 16;

  // Plain - the free default every player starts with. Deliberately the
  // quietest of the three: per the roadmap's design point, a sparse
  // starting room should read as fillable, not unfinished, and a loud
  // default wallpaper would fight that read.
  {
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.cream, 1);
    g.fillRect(0, 0, s, s);
    g.fillStyle(PALETTE.litEdge, 0.25);
    g.fillRect(0, 0, s, 1);
    g.fillStyle(PALETTE.shadeEdge, 0.08);
    g.fillRect(0, s - 1, s, 1);
    g.generateTexture("room_wallpaper_plain", s, s);
    g.destroy();
  }

  // Sunset Stripe - alternating cream/coral vertical bands.
  {
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.cream, 1);
    g.fillRect(0, 0, s, s);
    g.fillStyle(PALETTE.coral, 0.85);
    g.fillRect(0, 0, 4, s);
    g.fillRect(8, 0, 4, s);
    g.fillStyle(PALETTE.litEdge, 0.2);
    g.fillRect(0, 0, s, 1);
    g.generateTexture("room_wallpaper_stripe", s, s);
    g.destroy();
  }

  // Garden Bloom - cream base with a small scatter of mint bloom dots.
  {
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.cream, 1);
    g.fillRect(0, 0, s, s);
    g.fillStyle(PALETTE.mint, 0.8);
    g.fillCircle(4, 4, 1.4);
    g.fillCircle(12, 12, 1.4);
    g.fillStyle(PALETTE.mintBright, 0.6);
    g.fillCircle(12, 4, 1);
    g.fillCircle(4, 12, 1);
    g.fillStyle(PALETTE.litEdge, 0.2);
    g.fillRect(0, 0, s, 1);
    g.generateTexture("room_wallpaper_floral", s, s);
    g.destroy();
  }
}


/**
 * Player Room flooring tiles, 16x16 tileable - one per FLOORING piece in
 * roomCatalog.ts's ROOM_CATALOG. Same id-is-texture-key convention as
 * createRoomWallpaperTextures above.
 */
export function createRoomFlooringTextures(scene: Phaser.Scene) {
  const s = 16;

  // Bare Wood - the free default. Warm plank tone with a single seam.
  {
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRect(0, 0, s, s);
    g.fillStyle(PALETTE.shadeEdge, 0.15);
    g.fillRect(0, 7, s, 1);
    g.fillStyle(PALETTE.litEdge, 0.2);
    g.fillRect(0, 0, s, 1);
    g.generateTexture("room_floor_plain", s, s);
    g.destroy();
  }

  // Checkerboard - two-tone squares, the pattern baked into one 16px
  // tile (two 8x8 quadrants) rather than depending on placement math to
  // alternate it.
  {
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.cabinet, 1);
    g.fillRect(0, 0, s, s);
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRect(0, 0, 8, 8);
    g.fillRect(8, 8, 8, 8);
    g.generateTexture("room_floor_checker", s, s);
    g.destroy();
  }

  // Woven Rug - same weave technique as createCarpetBlueTexture (the
  // casino floor's own rug tile), under a distinct key so a player who's
  // seen both can still tell "my room" from "the casino floor" at a
  // glance.
  {
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.rug, 1);
    g.fillRect(0, 0, s, s);
    g.fillStyle(PALETTE.rugFleck, 0.55);
    for (let x = 0; x < s; x += 2) g.fillRect(x, 0, 1, s);
    g.fillStyle(PALETTE.litEdge, 0.05);
    for (let y = 1; y < s; y += 2) g.fillRect(0, y, s, 1);
    g.generateTexture("room_floor_rug", s, s);
    g.destroy();
  }
}


/**
 * Player Room furniture (roadmap/room-furniture) - one small standalone
 * prop per piece in furnitureCatalog.ts's FURNITURE_CATALOG, drawn at a
 * fixed 32x40 footprint and rendered centered on its slot's world
 * position by RoomScene.ts (see that file's buildFurniture). Same warm
 * PALETTE and "outline + lit/shade edge" technique as every other prop
 * in this file - kept small and simple since these sit on the floor
 * alongside a full-size character and shouldn't compete with it.
 *
 * Purely decorative (see RoomScene.ts's header on why furniture has no
 * collision): the four slot positions were picked to stay clear of the
 * spawn-to-door walking corridor, so there's nothing here that needs to
 * physically block the player.
 */
export function createFurnitureTextures(scene: Phaser.Scene) {
  const w = 32;
  const h = 40;

  // Armchair - a rounded seat back + cushion, warm coral upholstery.
  {
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
    g.fillEllipse(16, 37, 22, 6);
    // back
    g.fillStyle(PALETTE.coral, 1);
    g.fillRoundedRect(4, 10, 24, 22, 6);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(4, 10, 24, 22, 6);
    // seat cushion
    g.fillStyle(PALETTE.cream, 1);
    g.fillRoundedRect(6, 24, 20, 10, 3);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(6, 24, 20, 10, 3);
    // stubby legs
    g.fillStyle(PALETTE.outline, 1);
    g.fillRect(7, 34, 3, 5);
    g.fillRect(22, 34, 3, 5);
    // lit edge
    g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
    g.fillRoundedRect(4, 10, 24, 4, 4);
    g.generateTexture("furniture_armchair", w, h);
    g.destroy();
  }

  // Floor Lamp - a thin pole with a warm glowing shade.
  {
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
    g.fillEllipse(16, 37, 14, 4);
    // base
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(10, 34, 12, 4, 2);
    g.lineStyle(1.5, PALETTE.outline, 1);
    g.strokeRoundedRect(10, 34, 12, 4, 2);
    // pole
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRect(15, 12, 2, 22);
    // shade (trapezoid)
    g.fillStyle(PALETTE.gold, 1);
    g.fillPoints(
      [
        { x: 6, y: 12 },
        { x: 26, y: 12 },
        { x: 22, y: 2 },
        { x: 10, y: 2 }
      ],
      true
    );
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokePoints(
      [
        { x: 6, y: 12 },
        { x: 26, y: 12 },
        { x: 22, y: 2 },
        { x: 10, y: 2 }
      ],
      true
    );
    // glow
    g.fillStyle(PALETTE.litEdge, 0.35);
    g.fillTriangle(16, 4, 11, 11, 21, 11);
    g.generateTexture("furniture_floor_lamp", w, h);
    g.destroy();
  }

  // Bookshelf - a tall cabinet with three shelves of colored book spines.
  {
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
    g.fillEllipse(16, 37, 24, 5);
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(3, 3, 26, 32, 3);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(3, 3, 26, 32, 3);
    const shelfColors = [PALETTE.coral, PALETTE.mint, PALETTE.sky, PALETTE.gold, PALETTE.danger];
    for (let row = 0; row < 3; row++) {
      const shelfY = 7 + row * 9;
      g.fillStyle(PALETTE.cream, 1);
      g.fillRect(5, shelfY, 22, 7);
      let x = 6;
      let i = 0;
      while (x < 25) {
        const bw = 2 + (i % 2);
        g.fillStyle(shelfColors[(row + i) % shelfColors.length], 1);
        g.fillRect(x, shelfY + 1, bw, 5);
        x += bw + 1;
        i++;
      }
      g.lineStyle(1, PALETTE.outline, 0.6);
      g.strokeRect(5, shelfY, 22, 7);
    }
    g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
    g.fillRect(3, 3, 26, 2);
    g.generateTexture("furniture_bookshelf", w, h);
    g.destroy();
  }

  // Potted Plant - a compact version of createPlantTexture's shape,
  // resized to this slot's smaller footprint (that texture is 48x64,
  // sized for the outdoor plaza; a room slot piece needs to match the
  // others here).
  {
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
    g.fillEllipse(16, 37, 16, 5);
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillPoints(
      [
        { x: 9, y: 26 },
        { x: 23, y: 26 },
        { x: 20, y: 36 },
        { x: 12, y: 36 }
      ],
      true
    );
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokePoints(
      [
        { x: 9, y: 26 },
        { x: 23, y: 26 },
        { x: 20, y: 36 },
        { x: 12, y: 36 }
      ],
      true
    );
    g.fillStyle(PALETTE.cabinet, 1);
    g.fillRoundedRect(7, 23, 18, 5, 2);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(7, 23, 18, 5, 2);
    const clumps: Array<[number, number, number, number]> = [
      [16, 15, 9, PALETTE.mint],
      [9, 19, 6, PALETTE.mintBright],
      [23, 19, 6, PALETTE.mint],
      [16, 6, 6, PALETTE.mintBright]
    ];
    for (const [cx, cy, r, color] of clumps) {
      g.fillStyle(color, 1);
      g.fillCircle(cx, cy, r);
      g.lineStyle(1.5, PALETTE.outline, 1);
      g.strokeCircle(cx, cy, r);
    }
    g.generateTexture("furniture_potted_plant", w, h);
    g.destroy();
  }

  // Side Table - a small round-topped table, low enough to read as a
  // side piece rather than competing with the bookshelf/armchair.
  {
    const g = scene.add.graphics();
    g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
    g.fillEllipse(16, 37, 18, 5);
    // legs
    g.fillStyle(PALETTE.outline, 1);
    g.fillRect(9, 24, 2, 11);
    g.fillRect(21, 24, 2, 11);
    // tabletop
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(5, 18, 22, 8, 3);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(5, 18, 22, 8, 3);
    g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
    g.fillRoundedRect(5, 18, 22, 3, 3);
    g.generateTexture("furniture_side_table", w, h);
    g.destroy();
  }
}


/**
 * Indoor decorative plant - replaces the old Jephed plant.png (same 48x64
 * footprint so buildDecorations()'s placement/origin needed no changes).
 * A terracotta pot with rounded mint-teal foliage clumps, warm dark-brown
 * outlines throughout - direction notes 1/2/3/5.
 */
export function createPlantTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();

  // pot (trapezoid, narrower at the base)
  g.fillStyle(PALETTE.cabinetDark, 1);
  g.fillPoints(
    [
      { x: 12, y: 46 },
      { x: 36, y: 46 },
      { x: 32, y: 62 },
      { x: 16, y: 62 }
    ],
    true
  );
  g.lineStyle(2, PALETTE.outline, 1);
  g.strokePoints(
    [
      { x: 12, y: 46 },
      { x: 36, y: 46 },
      { x: 32, y: 62 },
      { x: 16, y: 62 }
    ],
    true
  );
  // pot rim
  g.fillStyle(PALETTE.cabinet, 1);
  g.fillRoundedRect(10, 42, 28, 7, 3);
  g.lineStyle(2, PALETTE.outline, 1);
  g.strokeRoundedRect(10, 42, 28, 7, 3);

  // foliage clumps
  const clumps: Array<[number, number, number, number]> = [
    [24, 26, 14, PALETTE.mint],
    [13, 32, 10, PALETTE.mintBright],
    [35, 32, 10, PALETTE.mint],
    [24, 14, 9, PALETTE.mintBright]
  ];
  for (const [cx, cy, r, color] of clumps) {
    g.fillStyle(color, 1);
    g.fillCircle(cx, cy, r);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeCircle(cx, cy, r);
  }

  g.generateTexture("plant", w, h);
  g.destroy();
}
