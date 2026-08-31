import Phaser from "phaser";
import { WARDROBE_CATALOG, WardrobePieceDef, WardrobeSlot } from "../../wardrobeCatalog";
import { CharacterRig, DIRECTIONS, FLAT_RIG, LPC_COLUMNS, LPC_RIG, LPC_WALK_ROW } from "../../characterRig";
import { PALETTE } from "./palette";

/**
 * Character/wardrobe procedural art: spritesheet loading, walk-animation
 * building, the flat/vector player redesign, the wardrobe placeholder-art
 * safety net (real LPC art loads over these when present - see
 * docs/character-art-spec.md), and the 5 wearable accessory icons. Moved
 * out of BootScene.ts unchanged.
 */

/**
 * Loads a character spritesheet at whatever frame size its rig declares.
 *
 * Replaces four near-identical `load.spritesheet(key, path, {frameWidth:
 * 16, frameHeight: 16})` blocks plus the old 21x32 skin loop - the frame size
 * is now read off the rig descriptor rather than repeated as a literal at
 * every call site, which is what makes a fourth rig (LPC's 64x64) a
 * one-argument change instead of a new copy of the loader.
 */
export function loadCharacterSheet(scene: Phaser.Scene, key: string, path: string, rig: CharacterRig) {
  scene.load.spritesheet(key, path, {
    frameWidth: rig.frameWidth,
    frameHeight: rig.frameHeight
  });
}


/**
 * Builds the four `${prefix}_walk_${dir}` animations for a sheet, from its
 * rig descriptor's explicit frame indices (see src/characterRig.ts).
 *
 * This is the merge of the two former builders - createKenneyWalkAnims
 * (16x16, 4 direction-columns x 3 frame-rows, explicit frame arrays) and
 * createLegacySkinWalkAnims (21x32, 3 frame-columns x 4 direction-rows,
 * generateFrameNumbers ranges). Both produced exactly the frame sequences
 * KENNEY_RIG.walkFrames / LEGACY_SKIN_RIG.walkFrames now declare, so this
 * is a like-for-like replacement - but unlike the old pair, it cannot be
 * pointed at the wrong sheet, because the layout travels with the rig
 * instead of with the method name.
 */
export function createWalkAnims(scene: Phaser.Scene, sheetKey: string, prefix: string, rig: CharacterRig) {
  for (const dir of DIRECTIONS) {
    scene.anims.create({
      key: `${prefix}_walk_${dir}`,
      frames: rig.walkFrames[dir].map((frame) => ({ key: sheetKey, frame })),
      frameRate: 8,
      repeat: -1
    });
  }
}


/**
 * Flat/vector player character (user direction: "we are going to have to
 * overhaul the character design" + "like the Wii" + "make the casino not
 * 8 bit anymore" - away from the old chibi Kenney pixel-art look). Phase
 * 1 of a larger planned overhaul - floor/walls/furniture were separate
 * follow-up phases, not
 * touched here.
 *
 * Deliberately kept at the SAME 16x16-frame, 4-col [left,down,up,right] x
 * 3-row layout as the Kenney rig it replaces - which is why FLAT_RIG in
 * src/characterRig.ts is literally KENNEY_RIG with a different id. (At the
 * time this was written a bigger frame size would have meant touching the
 * `height <= 16` rig-detection branch OverworldScene's applyPlayerBody /
 * applyPlayerScale / idleFrameForDir all shared; that guess is gone now -
 * a rig declares its own frame size - so a future redraw of this sheet is
 * no longer pinned to 16x16 by anything but its own generation code
 * below.) Same frame size means this is purely a new
 * texture, zero changes needed anywhere else - the style change (flat
 * rounded shapes, solid fills, no pixel-art dithering/outline-per-pixel
 * detail) happens entirely within that unchanged budget instead. No walk-
 * cycle spritesheet was sourced/drawn frame-by-frame either - the 3
 * "frames" per direction are just a 1px foot-offset wiggle, procedurally
 * varied per row below, reusing the exact same anim-key wiring
 * (createWalkAnims, `${prefix}_walk_${dir}`) the old rig used.
 */
export function createFlatCharacterSheet(scene: Phaser.Scene) {
  const FRAME = FLAT_RIG.frameHeight;
  const COLS = FLAT_RIG.columns; // left, down, up, right - matches FLAT_RIG.walkFrames' column order
  const ROWS = 3;
  const w = FRAME * COLS;
  const h = FRAME * ROWS;
  const g = scene.add.graphics();

  const BODY = PALETTE.sky; // soft sky blue - matches this game's own accent family, not a sourced character's color
  const BODY_DARK = 0x3a6fa0; // shading/feet - re-darkened to stay a clear step below the softened PALETTE.sky above
  const SKIN = 0xffc999; // character skin tone - same reference value STYLE_GUIDE.md's own palette table already uses
  const EYE = PALETTE.outline;

  const DIRS: Array<{ col: number; dir: "left" | "down" | "up" | "right" }> = [
    { col: 0, dir: "left" },
    { col: 1, dir: "down" },
    { col: 2, dir: "up" },
    { col: 3, dir: "right" }
  ];

  for (const { col, dir } of DIRS) {
    for (let row = 0; row < ROWS; row++) {
      const ox = col * FRAME;
      const oy = row * FRAME;
      const footOffset = row === 0 ? -1 : row === 1 ? 0 : 1;

      // Body - one flat rounded capsule, solid fill (no shading/dither -
      // the actual "not 8-bit" difference from the old rig).
      g.fillStyle(BODY, 1);
      g.fillRoundedRect(ox + 4, oy + 7, 8, 7, 3);
      g.lineStyle(1, BODY_DARK, 1);
      g.strokeRoundedRect(ox + 4, oy + 7, 8, 7, 3);

      // Head - flat circle.
      g.fillStyle(SKIN, 1);
      g.fillCircle(ox + 8, oy + 5, 4);

      // Face - two dots facing down, one side-dot facing left/right
      // (suggesting a profile), nothing facing up (back of the head) -
      // same "no face when facing away" convention the old rig's own
      // idle-pose handling already used.
      if (dir === "down") {
        g.fillStyle(EYE, 1);
        // Radius 1.0, not an initial 0.7 - verified live (sampling the
        // actual rendered texture's pixels) that 0.7 rendered as a soft
        // brownish smudge rather than a crisp dot, small enough that
        // anti-aliasing coverage dominated the whole shape instead of
        // just its edge.
        g.fillCircle(ox + 6.5, oy + 5, 1);
        g.fillCircle(ox + 9.5, oy + 5, 1);
      } else if (dir === "left" || dir === "right") {
        g.fillStyle(EYE, 1);
        g.fillCircle(ox + (dir === "left" ? 5.5 : 10.5), oy + 5, 1);
      }

      // Feet - two small dark ovals, offset per row for the walk wiggle.
      g.fillStyle(BODY_DARK, 1);
      g.fillEllipse(ox + 6 + footOffset, oy + 14.5, 2.4, 1.6);
      g.fillEllipse(ox + 10 - footOffset, oy + 14.5, 2.4, 1.6);
    }
  }

  g.generateTexture("player_flat_sheet", w, h);
  g.destroy();

  // generateTexture() (unlike load.spritesheet()) produces a texture with
  // exactly ONE frame covering the whole packed image - it does NOT auto-
  // slice into a grid the way a loaded spritesheet does. Verified live:
  // without this, the texture had frameTotal 1, so every numeric frame
  // index createWalkAnims()/idleFrameForDir() ask for (0-11) missed
  // and fell back to rendering the ENTIRE 64x48 packed sheet wherever a
  // single 16x16 frame was expected - which is exactly why the reported
  // screenshot showed a dense grid of tiny repeated characters instead of
  // one. This is the first ANIMATED multi-frame texture this project has
  // generated procedurally (every earlier createXTexture() - furniture,
  // accessories - is single-frame, so this gap never came up before).
  // Manually registering each 16x16 region as frame 0..11 (row*4+col,
  // matching FLAT_RIG.walkFrames' own numbering) makes it addressable
  // exactly like a loaded spritesheet's frames.
  const texture = scene.textures.get("player_flat_sheet");
  let frameIndex = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      texture.add(frameIndex, 0, col * FRAME, row * FRAME, FRAME, FRAME);
      frameIndex++;
    }
  }

  // Force nearest-neighbor filtering on this texture specifically -
  // Graphics.fillCircle/fillRoundedRect/fillEllipse draw with true
  // anti-aliased edges baked into the pixels (unlike this game's other,
  // hand-authored pixel-art PNGs, which have zero anti-aliasing to begin
  // with), and the default LINEAR filter smooths that further on top when
  // Phaser scales the 16x16 texture up 2-3x for display - reported live
  // as looking notably blurry. NEAREST stops that second layer of
  // softening; it can't undo the anti-aliasing already baked into the
  // source pixels themselves (that would need redrawing with only
  // axis-aligned rectangles - a much blockier, more "8-bit" look, the
  // opposite of the smooth-vector direction this redesign is going for).
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
}


// --- Wardrobe placeholder art ----------------------------------------
//
// Every catalogue piece HAS real art now (scripts/import-lpc.mjs), so in
// normal operation nothing below draws anything - it is the safety net,
// not the wardrobe. It still exists, and still runs, because the failure
// it covers is real and silent: a PNG that 404s, a half-written deploy, a
// piece added to the catalogue before its art is imported. In any of those
// the character wears a plain block in roughly the right shape instead of
// vanishing, showing a magenta missing-texture box, or crashing the boot.
//
// These are deliberately crude for the same reason they always were: they
// should never be mistaken for the shipped look.
//
// ## The compact-sheet trick
//
// A real LPC sheet is 832 x 3456 (13 columns x 54 rows) and we address
// only the four walk rows out of it - rows 8-11. Generating a full-size
// sheet per piece would cost ~11MB of texture memory each, ~230MB across
// the catalogue, for art that is 97% empty space.
//
// Instead each placeholder is generated as a COMPACT 9x4 grid (576 x 256:
// the 9 walk columns by the 4 directions) and its frames are then
// registered under their real LPC frame INDICES pointing into that
// compact layout. Phaser's texture.add(index, source, x, y, w, h) doesn't
// care whether a frame's index matches its physical position, so frame
// 143 ("right, standing") can live at compact position (0, 192). Every
// consumer - LPC_RIG's walkFrames, the idle frames, LayeredCharacter's
// frame mirroring - addresses these exactly like a real sheet and cannot
// tell the difference, at ~1/20th the memory.

/** Placeholder walk columns: LPC's column 0 (standing) plus its 1-8 cycle. */
export const PLACEHOLDER_COLUMNS = 9;

/** LPC direction order for walk rows 8, 9, 10, 11. */
export const PLACEHOLDER_DIR_ORDER = ["up", "left", "down", "right"] as const;


/**
 * Points the imported walk-only sheets' frames at the indices the LPC rig
 * actually asks for.
 *
 * scripts/import-lpc.mjs downloads each piece's `walk.png` - a 9x4 grid of
 * 64px frames - rather than the generator's full 13x54 export, because the
 * game only ever animates the walk rows and the full sheet is 13x the
 * pixels for the same four rows. Phaser numbers a loaded sheet's frames
 * from its own geometry, so those frames arrive as 0-35 on a 9-column
 * grid, while LPC_RIG addresses walk row 8 of a 13-column one (104-151).
 * Left alone, every frame lookup would miss.
 *
 * The fix is the same one the generated placeholders use, and for the same
 * reason: `texture.add` doesn't care whether a frame's index matches its
 * physical position, so frame 143 ("right, standing") can live at compact
 * position (0, 192). The new indices don't collide with the loader's own
 * 0-35, so both sets coexist and nothing else in the game can tell these
 * from a full sheet.
 */
export function remapWalkOnlySheets(scene: Phaser.Scene) {
  const FRAME = LPC_RIG.frameHeight; // 64
  const COLS = PLACEHOLDER_COLUMNS;
  const ROWS = PLACEHOLDER_DIR_ORDER.length;

  for (const piece of WARDROBE_CATALOG) {
    if (piece.sheetLayout !== "walk") continue;
    if (!scene.textures.exists(piece.id)) continue;
    const texture = scene.textures.get(piece.id);
    if (texture.key === "__MISSING") continue; // load failed - placeholder takes over below

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const lpcFrameIndex = (LPC_WALK_ROW + row) * LPC_COLUMNS + col;
        if (texture.has(String(lpcFrameIndex))) continue;
        texture.add(lpcFrameIndex, 0, col * FRAME, row * FRAME, FRAME, FRAME);
      }
    }
  }
}


/**
 * Generates stand-in art for every wardrobe piece that has no usable
 * texture - i.e. one with no `file` declared, or whose declared file
 * failed to load. Pieces with real art are left completely alone.
 */
export function ensureWardrobePlaceholders(scene: Phaser.Scene) {
  for (const piece of WARDROBE_CATALOG) {
    if (scene.textures.exists(piece.id) && scene.textures.get(piece.id).key !== "__MISSING") {
      continue; // real art loaded - nothing to do
    }
    createWardrobePlaceholderSheet(scene, piece);
  }
}


/**
 * Walk animations for the wardrobe.
 *
 * Only BODY pieces get animations, and that is not an oversight: the body
 * is the base sprite, the only layer that plays an animation at all.
 * Every other layer mirrors the base's current frame index each tick
 * rather than running its own timeline (see ui/LayeredCharacter.ts for
 * why that is both simpler and exactly in sync). So a shirt needs a
 * texture and nothing else.
 */
export function createWardrobeWalkAnims(scene: Phaser.Scene) {
  for (const piece of WARDROBE_CATALOG) {
    if (piece.slot !== "BODY") continue;
    createWalkAnims(scene, piece.id, piece.id, LPC_RIG);
  }
}


/**
 * Draws one piece's placeholder sheet: the same simple shape in the
 * piece's own colour, posed for each of the four directions across nine
 * walk columns.
 *
 * These are deliberately crude - flat blocks in the piece's colour, no
 * shading or detail. They exist to prove the layering works and to let
 * the shop be used, not to be shipped as the game's look. Anything more
 * polished would risk being mistaken for finished art.
 */
export function createWardrobePlaceholderSheet(scene: Phaser.Scene, piece: WardrobePieceDef) {
  const FRAME = LPC_RIG.frameHeight; // 64
  const COLS = PLACEHOLDER_COLUMNS;
  const ROWS = PLACEHOLDER_DIR_ORDER.length;
  const g = scene.add.graphics();

  for (let row = 0; row < ROWS; row++) {
    const dir = PLACEHOLDER_DIR_ORDER[row];
    for (let col = 0; col < COLS; col++) {
      // Column 0 is the standing pose; 1-8 are the walk cycle. Swing the
      // limbs on a sine so the cycle loops seamlessly back to column 1.
      const phase = col === 0 ? 0 : Math.sin(((col - 1) / 8) * Math.PI * 2);
      drawWardrobePlaceholderFrame(g, piece, dir, phase, col * FRAME, row * FRAME);
    }
  }

  g.generateTexture(piece.id, FRAME * COLS, FRAME * ROWS);
  g.destroy();

  // Register each compact cell under its REAL LPC frame index - see the
  // "compact-sheet trick" comment above. Without this the texture would
  // have a single frame covering the whole packed image, and every
  // numeric frame index the rig asks for would miss and render the entire
  // sheet in place of one 64x64 frame.
  const texture = scene.textures.get(piece.id);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const lpcFrameIndex = (LPC_WALK_ROW + row) * LPC_COLUMNS + col;
      texture.add(lpcFrameIndex, 0, col * FRAME, row * FRAME, FRAME, FRAME);
    }
  }

  // Same reasoning as createFlatCharacterSheet's: Graphics draws
  // anti-aliased edges, and the default LINEAR filter softens them
  // further when Phaser scales the frame for display.
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
}


/**
 * One 64x64 placeholder frame, drawn at (ox, oy).
 *
 * Coordinates follow LPC's own proportions so the layers line up with
 * each other and, later, with real LPC art: head around y 14-28, torso
 * y 28-44, legs y 44-58, feet y 56-62, character centred on x 32 and
 * about 20px wide. `phase` is -1..1 and swings the legs/arms.
 */
export function drawWardrobePlaceholderFrame(
  g: Phaser.GameObjects.Graphics,
  piece: WardrobePieceDef,
  dir: "up" | "left" | "down" | "right",
  phase: number,
  ox: number,
  oy: number
) {
  const color = piece.placeholderColor;
  const cx = ox + 32;
  const swing = phase * 3;
  // Facing left/right shows a narrower silhouette than facing the camera.
  const profile = dir === "left" || dir === "right";
  const halfW = profile ? 7 : 10;

  const slot: WardrobeSlot = piece.slot;

  if (slot === "BODY") {
    // Head.
    g.fillStyle(color, 1);
    g.fillCircle(cx, oy + 21, 7);
    // Torso.
    g.fillRect(cx - halfW, oy + 28, halfW * 2, 16);
    // Legs, swinging in opposition.
    g.fillRect(cx - 6, oy + 44, 5, 14 + swing);
    g.fillRect(cx + 1, oy + 44, 5, 14 - swing);
    // Face - two eyes facing the camera, one in profile, none from behind
    // (same "no face when facing away" convention the flat rig uses).
    if (dir === "down") {
      g.fillStyle(0x2a1c12, 1);
      g.fillCircle(cx - 2.5, oy + 20, 1.2);
      g.fillCircle(cx + 2.5, oy + 20, 1.2);
    } else if (profile) {
      g.fillStyle(0x2a1c12, 1);
      g.fillCircle(cx + (dir === "left" ? -3 : 3), oy + 20, 1.2);
    }
    return;
  }

  g.fillStyle(color, 1);

  switch (slot) {
    case "HAIR":
      // A cap of hair over the top and back of the head.
      g.fillCircle(cx, oy + 19, 7.5);
      g.fillRect(cx - 7.5, oy + 15, 15, 5);
      break;

    case "HAT":
      // Crown plus a brim, sitting just clear of the hair below it.
      g.fillRect(cx - 6, oy + 11, 12, 6);
      g.fillRect(cx - 10, oy + 16, 20, 2.5);
      break;

    case "TORSO":
      // Shirt over the chest, with short sleeves that swing with the arms.
      g.fillRect(cx - halfW, oy + 28, halfW * 2, 15);
      g.fillRect(cx - halfW - 3, oy + 29 + swing, 3, 9);
      g.fillRect(cx + halfW, oy + 29 - swing, 3, 9);
      break;

    case "LEGS":
      // Trousers over the upper legs, following the same swing as the
      // body's legs so they never separate mid-stride.
      g.fillRect(cx - 6, oy + 43, 5, 11 + swing);
      g.fillRect(cx + 1, oy + 43, 5, 11 - swing);
      break;

    case "FEET":
      // Shoes at the bottom of each leg, tracking the same swing.
      g.fillRect(cx - 7, oy + 56 + swing, 6, 4);
      g.fillRect(cx + 1, oy + 56 - swing, 6, 4);
      break;
  }
}


/**
 * Item Shop accessory badges (see itemCatalog.ts, worn above the head in
 * OverworldScene.ts's applyEquippedAccessory) - drawn procedurally, same
 * Graphics+generateTexture technique as every other placeholder in this
 * file, rather than sourced from an external pack: no CC0 pixel-art pack
 * was found that actually matched this project's specific 16x16 Kenney
 * character scale/palette closely enough to not look like a mismatched
 * sticker (a real risk raised and confirmed live - a first version of
 * this rendered accessories as plain emoji, which read as "not on the
 * person" rather than worn). Drawing from PALETTE guarantees the same
 * palette/line-weight as the character rig and every other drawn texture
 * in the game.
 *
 * One flat "worn from the front" icon per accessory, not 4 direction-
 * specific variants - a deliberate simplification given the character's
 * native 16x16 resolution (STYLE_GUIDE.md's own character sheet is only
 * that large), where facing-specific detail on a hat/glasses would be
 * imperceptible anyway. Sized small (14-16px wide) to sit convincingly on
 * a head that's only ~10-12px wide at native scale.
 */
export function createAccessoryTextures(scene: Phaser.Scene) {
  createTopHatTexture(scene);
  createShadesTexture(scene);
  createCrownTexture(scene);
  createHeadphonesTexture(scene);
  createBowTexture(scene);
}


export function createTopHatTexture(scene: Phaser.Scene) {
  const w = 14;
  const h = 12;
  const g = scene.add.graphics();

  // Brim
  g.fillStyle(PALETTE.outline, 1);
  g.fillRoundedRect(0, 8, w, 3, 1.5);
  // Crown (cylinder body)
  g.fillStyle(0x2e211a, 1); // warm near-black, matches Theme.cardTextBlack rather than pure PALETTE.outline so the band below actually reads against it
  g.fillRoundedRect(3, 0, w - 6, 9, 1.5);
  // Gold band
  g.fillStyle(PALETTE.gold, 1);
  g.fillRect(3, 6, w - 6, 2);
  g.lineStyle(1, PALETTE.outline, 1);
  g.strokeRoundedRect(3, 0, w - 6, 9, 1.5);

  g.generateTexture("acc_top_hat", w, h);
  g.destroy();
}


export function createShadesTexture(scene: Phaser.Scene) {
  const w = 14;
  const h = 6;
  const g = scene.add.graphics();

  g.fillStyle(PALETTE.outline, 1);
  // Bridge
  g.fillRect(w / 2 - 2, 1.5, 4, 1.5);
  // Lenses
  g.fillRoundedRect(0, 0, 5.5, 5, 1.5);
  g.fillRoundedRect(w - 5.5, 0, 5.5, 5, 1.5);
  // Lens shine (small highlight so they don't read as two flat blobs)
  g.fillStyle(0x5a8cc9, 0.7); // Theme.secondaryHover-ish blue glint
  g.fillCircle(1.8, 1.6, 0.9);
  g.fillCircle(w - 3.7, 1.6, 0.9);

  g.generateTexture("acc_shades", w, h);
  g.destroy();
}


export function createCrownTexture(scene: Phaser.Scene) {
  const w = 14;
  const h = 10;
  const g = scene.add.graphics();

  // Whole crown silhouette (band + zigzag top) as ONE filled polygon, not
  // 3 separate abutting fillTriangle calls - the first version of this
  // did that and left a visible vertical seam exactly where two
  // triangles shared an edge (caught by sampling the actual rendered
  // texture's pixel data, not just eyeballing the drawing code - the
  // seam wasn't visible at a glance in the drawing math, only in the
  // rasterized output). One continuous path also means the outline
  // traces the real zigzag silhouette instead of just the band rect.
  g.fillStyle(PALETTE.gold, 1);
  g.beginPath();
  g.moveTo(1, 9);
  g.lineTo(1, 6);
  g.lineTo(4, 0);
  // Valley at y=5.5, NOT y=6 - the first version put it at exactly y=6,
  // making (1,6)/(7,6)/(13,6) three exactly-collinear points. Verified
  // live (sampling the actual rendered texture's pixels, not just the
  // drawing code) that this produced a broken vertical hole straight
  // through the band underneath it, surviving even a full rewrite from
  // 3 separate triangles to this one polygon - a classic degenerate
  // input for ear-clipping triangulation (Phaser's Graphics fillPath
  // uses earcut under the hood), not a triangle-adjacency issue at all.
  g.lineTo(7, 5.5);
  g.lineTo(10, 0);
  g.lineTo(13, 6);
  g.lineTo(13, 9);
  g.closePath();
  g.fillPath();
  g.lineStyle(1, PALETTE.outline, 1);
  g.strokePath();
  // Gems
  g.fillStyle(PALETTE.danger, 1);
  g.fillCircle(4, 3.5, 1.1);
  g.fillStyle(PALETTE.sky, 1);
  g.fillCircle(10, 3.5, 1.1);
  g.fillStyle(PALETTE.mint, 1);
  g.fillCircle(7, 1.8, 1.1);

  g.generateTexture("acc_crown", w, h);
  g.destroy();
}


export function createHeadphonesTexture(scene: Phaser.Scene) {
  const w = 16;
  const h = 13;
  const g = scene.add.graphics();

  g.lineStyle(2, PALETTE.outline, 1);
  g.beginPath();
  g.arc(w / 2, 6, 6, Phaser.Math.DegToRad(190), Phaser.Math.DegToRad(350));
  g.strokePath();

  // Ear cups
  g.fillStyle(PALETTE.outline, 1);
  g.fillRoundedRect(0, 5, 4, 7, 1.5);
  g.fillRoundedRect(w - 4, 5, 4, 7, 1.5);
  g.fillStyle(PALETTE.coral, 1);
  g.fillRoundedRect(0.8, 6, 2.4, 5, 1);
  g.fillRoundedRect(w - 3.2, 6, 2.4, 5, 1);

  g.generateTexture("acc_headphones", w, h);
  g.destroy();
}


export function createBowTexture(scene: Phaser.Scene) {
  const w = 12;
  const h = 8;
  const g = scene.add.graphics();

  g.fillStyle(PALETTE.danger, 1);
  g.fillTriangle(w / 2, h / 2, 0, 0, 0, h);
  g.fillTriangle(w / 2, h / 2, w, 0, w, h);
  g.fillStyle(0xef7a6d, 1); // Theme.dangerHover - lighter center knot, distinct from the two wings
  g.fillCircle(w / 2, h / 2, 2);
  g.lineStyle(1, PALETTE.outline, 1);
  g.strokeTriangle(w / 2, h / 2, 0, 0, 0, h);
  g.strokeTriangle(w / 2, h / 2, w, 0, w, h);

  g.generateTexture("acc_bow", w, h);
  g.destroy();
}
