import Phaser from "phaser";
import { WARDROBE_CATALOG, WardrobePieceDef, WardrobeSlot } from "../wardrobeCatalog";
import {
  CharacterRig,
  DIRECTIONS,
  FLAT_RIG,
  KENNEY_RIG,
  LPC_CHARACTER_SHEETS,
  LPC_COLUMNS,
  LPC_RIG,
  LPC_WALK_ROW
} from "../characterRig";
import { fadeToScene } from "../ui/sceneTransition";
import { preloadSounds, preloadMusic } from "../ui/SoundManager";
import { whenDisplayFontReady } from "../ui/Theme";

/**
 * BootScene loads the environment tileset assets plus the player/NPC/dealer
 * character spritesheets and every wardrobe piece.
 *
 * "Warm Daylight" reskin (this pass): every procedurally-drawn ground, wall
 * and cabinet/table texture below moves off the previous "Arcade Nights"
 * dark charcoal-navy body onto a warm, sunlit brown/sand/amber register, per
 * direction - the target reference is Adventure Academy (warm, rounded,
 * soft-lit, inviting) rather than the dark night-time arcade the old palette
 * produced. Supersedes the "Arcade Nights" direction, which itself replaced
 * the "Bright Social-Hub" pastel palette in STYLE_GUIDE.md.
 *
 * Key names are kept stable (cabinet, felt, mint, coral, cream, etc.) even
 * though most no longer literally match their old color - every
 * create*Texture() method below references PALETTE by name, so re-pointing
 * the values here is what makes the new look cascade everywhere without
 * touching each drawing method. As part of this pass the four ground/wall
 * tiles were brought INTO that scheme: createFloorTanTexture/
 * createCarpetBlueTexture/createCarpetRedTexture/createWallTexture used to
 * hardcode their own inline hex literals, which made them the one set of
 * textures a PALETTE re-point could NOT reach - they now reference the
 * ground tokens below like everything else, so PALETTE is finally the single
 * chokepoint this comment always claimed it was. (Those four are drawn
 * procedurally, not loaded: the Kenney "RPG Urban Pack" they came from had
 * no dark equivalent when "Arcade Nights" landed, and they've stayed
 * procedural since.)
 *
 * Theme.ts/uiHelpers.ts (chrome UI palette) is a separate token set, kept in
 * sync by hand (not literally shared) since this file has no import
 * relationship to it. Note the two are deliberately NOT the same lightness:
 * nothing in this file has text drawn on top of it, so these surfaces are
 * free to go genuinely light/sunlit, whereas Theme.ts's surfaces have to stay
 * dark enough to carry near-white text - see Theme.ts's "Contrast contract".
 */
const PALETTE = {
  /** Deep warm brown outline used on every drawn shape - soft-lit line art rather than the previous near-black 0x05070c, which read as hard/inky against the new light surfaces. Still dark enough to hold every shape's silhouette. */
  outline: 0x3d2a1e,
  /** Warm ivory - "cabinet" furniture body (was terracotta, then dark navy, then cold white 0xf2f3f7). The white was chosen so cabinets would pop against a near-black floor; with the floor now light sand, separation instead comes from the cabinet being the LIGHTEST and least saturated thing on the floor, plus its full-strength `outline` stroke. */
  cabinet: 0xfbf1de,
  /** Warm tan - trim/base/plinth accents, a shade darker than `cabinet` for shape definition (was cold light gray). */
  cabinetDark: 0xd8bd94,
  /** Muted slate-teal "screen" panel background - still clearly a lit screen against the ivory cabinet body, but warmer and less inky than the old 0x131a2c so it reads as glass catching daylight rather than a black void. */
  screen: 0x2f4a63,
  /** Slightly deeper alt panel. */
  screenAlt: 0x263c52,
  /** Sunlit emerald felt for card/dice tables - classic table-felt green, which sits far warmer against the ivory cabinet rail than the old royal blue 0x1b3a6b did against a near-black one. */
  felt: 0x37806a,
  /** Green - "positive/safe" grid-cell color (mines' safe cells, keno default cells, plant foliage) - kept as a green functional accent (universal win/safe signal), softened off the previous neon 0x2ecc71 now that it no longer has to shout over a dark background. */
  mint: 0x5cc47f,
  /** Lighter green variant. */
  mintBright: 0x8ade9f,
  /** Soft sky blue - secondary accent, and the flat player character's body color (see createFlatCharacterSheet). Softened from the old electric 0x3d7fd9; still the most saturated cool note on the floor, which is what keeps the player readable against warm sand. */
  sky: 0x5b9fd6,
  /** Warm sunlit orange - primary brand accent, matches Theme.accent. */
  coral: 0xef8b3f,
  /** Warm honey - jackpot/highlight accent, matches Theme.gold. */
  gold: 0xf0b95e,
  /** Warmer, less shrill red - danger/loss accent, matches Theme.danger. */
  danger: 0xd9564a,
  /** Warm ivory - card faces / light elements on furniture (matches Theme.cardFace). */
  cream: 0xfdf6e8,

  // --- Ground & walls (new tokens this pass - previously inline hex
  // literals inside the four create*Texture methods below, see the class
  // comment). These are the largest surfaces in the overworld by area and
  // therefore the single biggest lever on how the world reads; they carry no
  // text, so they're free to be genuinely light. ---
  /** Warm sunlit sand - the main plaza floor (was near-black charcoal 0x1c1e24, the single darkest and largest surface in the game). */
  floor: 0xd9c39b,
  /** Slightly deeper sand fleck for plaza floor texture. NOTE the polarity is inverted from the old palette on purpose: the flecks used to be LIGHTER than their base because the base was near-black and a darker fleck was invisible on it. The rule being preserved is "a fleck has to be visible," which on a light floor means going darker, not lighter. */
  floorFleck: 0xc6a97e,
  /** Warm terracotta - the gaming-floor "rug" tile. Reads as a clay/kilim rug laid over the sand plaza, and stays clearly distinct from it in both hue and value (the old pairing relied on a dark-grey vs dark-blue distinction that was nearly invisible in practice). */
  rug: 0xb9724c,
  /** Deeper terracotta fleck for the rug. */
  rugFleck: 0xa9633f,
  /** Deep warm red - the unused-but-kept `carpet_red` tile (see createCarpetRedTexture). */
  rugRed: 0x9e4a3a,
  /** Deeper fleck for the red rug variant. */
  rugRedFleck: 0x8c3f30,
  /** Warm sandstone plaster - the perimeter wall (was dark navy brick 0x161c30). */
  wall: 0xc9a27a,
  /** Mortar/course line on the wall, a shade deeper than `wall` (was a near-black 0x0a0e1a seam). */
  wallLine: 0xa8825d,

  // --- Shading tokens (detail pass) ---------------------------------------
  // Every surface in this file used to be a FLAT fill inside an outline: no
  // light direction, no volume, no material. That - not the pixel count - is
  // what made the floor read as blocky next to hand-drawn reference art. The
  // world is drawn 1:1 into the 800x600 canvas (TILE is 16 and every tile
  // image is a 16px texture at scale 1; cabinets are 48x64 textures at scale
  // 1), so a bigger texture at the same world size would add no visible
  // pixels at all - it would just be resampled straight back down by
  // `pixelArt: true`'s NEAREST filter, which drops rows rather than blending
  // them. The detail therefore has to come from USING the pixels that are
  // already there: a consistent light direction (top-left), a shadow side,
  // a contact shadow, and real material texture (paving joints, brick
  // courses, weave, screen glass).
  //
  // These two are drawn at low alpha over whatever is beneath them, so one
  // pair works on every surface regardless of its base colour.
  /** Warm white, used at low alpha as the lit (top-left) edge of a form. */
  litEdge: 0xfffaf0,
  /** The outline brown, used at low alpha as the shaded (bottom-right) edge and as contact shadow. */
  shadeEdge: 0x3d2a1e
} as const;

/** Light comes from the top-left, consistently, on every surface in this file. */
const LIT_ALPHA = 0.28;
const SHADE_ALPHA = 0.22;
/** Contact shadow cast on the floor directly under a piece of furniture. */
const CONTACT_SHADOW_ALPHA = 0.16;

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload() {
    // Environment ground/wall tiles - "Arcade Nights" reskin: the old Kenney
    // "RPG Urban Pack" tiles here were a bright cream-plaza/terracotta-brick
    // pack with no dark-arcade equivalent, so floor_tan/carpet_red/
    // carpet_blue/wall are now drawn procedurally instead (see
    // createFloorTanTexture/createCarpetRedTexture/createCarpetBlueTexture/
    // createWallTexture in create()) rather than loaded from PNGs. Same key
    // names as before so nothing in OverworldScene.buildFloor()/buildWalls()
    // needed to change - only where the pixels under each key come from.
    // "plant" is now drawn procedurally (see createPlantTexture) instead of
    // loaded from a PNG - same 48x64 footprint as the old Jephed asset, so
    // buildDecorations()'s placement/origin needed no changes.

    // Social-hub dressing for OverworldScene's buildDecorations() -
    // benches/lamp posts/market stalls/hedges (STYLE_GUIDE direction note 4:
    // "nature woven into a social hub, not wilderness").
    this.load.image("bench_prop", "assets/kenney_rpg_urban_pack/Tiles/tile_0250.png");
    this.load.image("lamp_post", "assets/kenney_rpg_urban_pack/Tiles/tile_0188.png");
    this.load.image("market_stall", "assets/kenney_rpg_urban_pack/Tiles/tile_0276.png");
    this.load.image("hedge", "assets/kenney_rpg_urban_pack/Tiles/tile_0329.png");
    this.load.image("tree_accent", "assets/kenney_rpg_urban_pack/Tiles/tile_0341.png");

    // Game-table furniture (roulette/slots/blackjack/coin flip/dragon
    // tower) - previously raw PNGs from the old dark Jephed pack; the new
    // Kenney town/plaza pack has no direct table/cabinet equivalent to swap
    // onto (per STYLE_GUIDE.md's scope note), so these are now drawn
    // procedurally instead, same Graphics+generateTexture technique as
    // every cabinet texture below. See createRouletteTableTexture /
    // createSlotMachineTexture / createBlackjackTableTexture /
    // createCoinFlipMachineTexture / createDragonPedestalTexture.

    // Base character spritesheets: task #21/STYLE_GUIDE.md "Bright Social-Hub"
    // reskin, Kenney "RPG Urban Pack" (CC0). 16x16 frames, 4 columns
    // (direction) x 3 rows (walk frame) - declared as KENNEY_RIG in
    // src/characterRig.ts.
    // Mapping per STYLE_GUIDE.md's suggestion: player=green, dealer=lavender
    // (reads distinct/formal), NPC=gray (reads as "staff").
    this.loadCharacterSheet("player_sheet", "assets/characters/kenney/char_a_green.png", KENNEY_RIG);
    this.loadCharacterSheet("npc_sheet", "assets/characters/kenney/char_e_gray.png", KENNEY_RIG);
    this.loadCharacterSheet("dealer_sheet", "assets/characters/kenney/char_c_lavender.png", KENNEY_RIG);

    // Ambient background bystanders (OverworldScene's addAmbientNpc) - the
    // 3 Kenney variants STYLE_GUIDE.md flagged as sitting completely unused
    // (char_b_brick/char_d_hardhat/char_f_dark), put to work as decorative
    // "social hub" flavor per direction note 4 rather than static dead
    // weight. Same 16x16/4x3 layout as player/npc/dealer above, so they
    // declare the same KENNEY_RIG - no new loader logic needed.
    this.loadCharacterSheet("npc2_sheet", "assets/characters/kenney/char_b_brick.png", KENNEY_RIG);
    this.loadCharacterSheet("npc3_sheet", "assets/characters/kenney/char_d_hardhat.png", KENNEY_RIG);
    this.loadCharacterSheet("npc4_sheet", "assets/characters/kenney/char_f_dark.png", KENNEY_RIG);

    // Wardrobe pieces (see src/wardrobeCatalog.ts) - the layered character
    // system that replaced the 17 monolithic skins. Every piece is an LPC
    // sheet, so they all declare LPC_RIG.
    //
    // Only pieces that declare a `file` are loaded: the rest get generated
    // placeholder art in create() below. That is what lets the shop sell a
    // full catalogue of hair, shirts and hats before any real art exists -
    // the founder produces PNGs from docs/character-art-spec.md and each
    // one silently upgrades its piece from placeholder to real, with no
    // code change.
    //
    // A declared file that FAILS to load (wrong name, bad export,
    // interrupted download) is caught below and falls back to the same
    // placeholder path, so a typo in a filename costs you one plain-looking
    // hat rather than a black screen.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (WARDROBE_CATALOG.some((p) => p.id === file.key)) {
        console.warn(
          `[wardrobe] art for "${file.key}" failed to load from ${file.url} - ` +
            "falling back to generated placeholder art. See docs/character-art-spec.md."
        );
      }
    });

    for (const piece of WARDROBE_CATALOG) {
      if (!piece.file) continue;
      this.loadCharacterSheet(piece.id, `assets/characters/lpc/${piece.file}`, LPC_RIG);
    }

    // LPC (Universal LPC Spritesheet Generator) outfit sheets - the fourth
    // rig, 64x64 frames on a 13-column sheet. This list is EMPTY until the
    // founder exports real art (see docs/character-art-spec.md); the loop is
    // here so that dropping a PNG into public/assets/characters/lpc/ and
    // adding one line to LPC_CHARACTER_SHEETS is the entire integration -
    // loading, animation building and rig registration all follow from it.
    for (const sheet of LPC_CHARACTER_SHEETS) {
      this.loadCharacterSheet(sheet.textureKey, `assets/characters/lpc/${sheet.file}`, LPC_RIG);
    }

    // Sound effects (see ui/SoundManager.ts) - loaded once here, played from
    // any scene via playSfx(scene, key), same "load once in BootScene" shape
    // as every image/spritesheet above.
    preloadSounds(this);
    // Background music loops (see ui/SoundManager.ts) - same "load once
    // here, played from any scene" shape via playMusic(scene, key).
    preloadMusic(this);
  }

  create() {
    // Flat/vector player redesign (user direction: "overhaul the character
    // design" + "like the Wii" - away from the old chibi-pixel-art Kenney
    // look). Must exist before the anim below references its frames.
    this.createFlatCharacterSheet();
    this.createWalkAnims("player_flat_sheet", "player", FLAT_RIG);
    this.createWalkAnims("npc_sheet", "npc", KENNEY_RIG);
    this.createWalkAnims("dealer_sheet", "dealer", KENNEY_RIG);
    this.createWalkAnims("npc2_sheet", "npc2", KENNEY_RIG);
    this.createWalkAnims("npc3_sheet", "npc3", KENNEY_RIG);
    this.createWalkAnims("npc4_sheet", "npc4", KENNEY_RIG);
    // Wardrobe: fill in generated stand-in art for every piece that has no
    // real PNG yet, THEN build walk animations. Order matters - an anim
    // can't reference a texture that doesn't exist.
    this.ensureWardrobePlaceholders();
    this.createWardrobeWalkAnims();

    for (const sheet of LPC_CHARACTER_SHEETS) {
      this.createWalkAnims(sheet.textureKey, sheet.textureKey, LPC_RIG);
    }
    this.createFloorTanTexture();
    this.createCarpetRedTexture();
    this.createCarpetBlueTexture();
    this.createWallTexture();
    this.createExitDoorTexture();
    this.createMinesTexture();
    this.createDiceTexture();
    this.createLimboTexture();
    this.createPlinkoTexture();
    this.createKenoTexture();
    this.createWheelTexture();
    this.createHiLoTexture();
    this.createBaccaratTexture();
    this.createVideoPokerTexture();
    this.createCoinKioskTexture();
    this.createItemShopTexture();
    this.createChallengeBoardTexture();
    this.createComingSoonTexture();
    this.createPlantTexture();
    this.createRouletteTableTexture();
    this.createSlotMachineTexture();
    this.createBlackjackTableTexture();
    this.createCoinFlipMachineTexture();
    this.createDragonPedestalTexture();
    this.createTutorialGuideTexture();
    this.createAccessoryTextures();

    void this.handOffWhenFontReady();
  }

  /**
   * Waits for the display font before handing off to LoginScene - the first
   * scene in the game that draws any text at all (BootScene itself draws
   * none, which is exactly why this is the right place to wait: the wait
   * costs nothing visually here, and every later scene inherits the benefit).
   *
   * Without this, the whole first screen renders in the fallback stack and
   * stays there - see whenDisplayFontReady's comment in ui/Theme.ts for why
   * a Phaser canvas can't re-flow into a late-arriving webfont the way a DOM
   * page can. In practice the font is usually already in the browser's HTTP
   * cache or has finished downloading during the texture generation above, so
   * this resolves immediately and adds no perceptible delay on a warm load.
   *
   * Fire-and-forget (`void`) rather than making create() itself async:
   * Phaser calls create() and ignores its return value, so an async create()
   * would not actually be awaited by anything - it would just look like it
   * was. Failure/timeout still hands off (whenDisplayFontReady resolves
   * `false` rather than rejecting), so boot can't get stuck here.
   */
  private async handOffWhenFontReady() {
    await whenDisplayFontReady();
    fadeToScene(this, "LoginScene");
  }

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
  private drawPavingTile(key: string, variant: 0 | 1) {
    const s = 16;
    const g = this.add.graphics();

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

  private createFloorTanTexture() {
    this.drawPavingTile("floor_tan", 0);
    this.drawPavingTile("floor_tan_b", 1);
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
  private createCarpetBlueTexture() {
    const s = 16;
    const g = this.add.graphics();
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
  private createCarpetRedTexture() {
    const s = 16;
    const g = this.add.graphics();
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
  private createWallTexture() {
    const s = 16;
    const g = this.add.graphics();

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
  private createExitDoorTexture() {
    const w = 40;
    const h = 48;
    const g = this.add.graphics();
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

  /**
   * Shared cabinet-shell pieces reused by every 48x64 "arcade cabinet"
   * style game texture below (mines/limbo/keno/wheel/hilo/baccarat/video
   * poker/coin flip) - a rounded terracotta body with a warm dark-brown
   * outline and a matching base bar. Callers draw their own screen/content
   * on top between the two calls.
   */
  private drawCabinetBody(g: Phaser.GameObjects.Graphics, w: number, h: number) {
    // Contact shadow on the floor under the cabinet. Without one, every
    // cabinet looked pasted onto the floor rather than standing on it - the
    // single cheapest thing that makes a top-down floor read as having depth.
    g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
    g.fillEllipse(w / 2, h - 3, w - 10, 7);

    g.fillStyle(PALETTE.cabinet, 1);
    g.fillRoundedRect(4, 10, w - 8, h - 16, 6);

    // Shaded right-hand face, then the lit top-left edge: the two together
    // are what turn a flat rounded rectangle into a box with a light on it.
    // Both sit outside the 9..w-9 window every caller draws its screen into,
    // so a caller's own content always lands on top of plain cabinet colour.
    g.fillStyle(PALETTE.shadeEdge, SHADE_ALPHA);
    g.fillRect(w - 10, 12, 4, h - 20);
    g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
    g.fillRect(6, 12, 2, h - 22);

    // Marquee header - the strip above the screen that a real cabinet
    // carries its game's name on, finished with a gold pinstripe. Ends at
    // y 15, one pixel clear of the screen bezel every caller draws at y 16
    // (see drawCabinetScreen, which insets its bezel by 1px for exactly
    // this reason).
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(7, 11.5, w - 14, 3.5, 1.5);
    g.fillStyle(PALETTE.gold, 0.8);
    g.fillRect(7, 14, w - 14, 1);

    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(4, 10, w - 8, h - 16, 6);
  }

  private drawCabinetBase(g: Phaser.GameObjects.Graphics, w: number, h: number) {
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(10, h - 10, w - 20, 8, 3);
    // Lit top face of the plinth plus a shaded underside, so the base reads
    // as a solid block the cabinet stands on rather than a painted stripe.
    g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
    g.fillRect(12, h - 9, w - 24, 1);
    g.fillStyle(PALETTE.shadeEdge, SHADE_ALPHA);
    g.fillRect(12, h - 4, w - 24, 2);
  }

  /**
   * The lit-glass screen panel every cabinet carries, drawn once here rather
   * than as a bare `fillRoundedRect` repeated at eight call sites.
   *
   * Adds what a flat fill can't say: a dark bezel around the glass, a gloss
   * band across the top, and faint scanlines. Callers still draw their own
   * content on top afterwards, exactly as before.
   */
  private drawCabinetScreen(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number = PALETTE.screen
  ) {
    // Bezel - a dark recess the glass sits inside.
    g.fillStyle(PALETTE.outline, 0.9);
    g.fillRoundedRect(x - 1, y - 1, w + 2, h + 2, 5);

    g.fillStyle(color, 1);
    g.fillRoundedRect(x, y, w, h, 4);

    // Scanlines - very low contrast, just enough to read as a lit panel
    // rather than a painted rectangle.
    g.fillStyle(PALETTE.outline, 0.09);
    for (let i = 3; i < h - 1; i += 3) {
      g.fillRect(x + 1, y + i, w - 2, 1);
    }

    // Gloss: a bright band across the top of the glass, fading out.
    g.fillStyle(PALETTE.litEdge, 0.12);
    g.fillRoundedRect(x + 1, y + 1, w - 2, Math.max(3, h * 0.28), 3);
  }

  /**
   * The game furniture pieces below are drawn placeholders (procedural
   * Graphics + generateTexture, same technique throughout this file) so
   * these games don't need to wait on real tileset art to be walkable-up-to
   * in the overworld. Palette per STYLE_GUIDE.md: saturated flat fills,
   * warm dark-brown outlines (never pure black), rounded corners.
   */
  private createMinesTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    this.drawCabinetBody(g, w, h);

    this.drawCabinetScreen(g, 9, 16, w - 18, 30);

    const cell = 7;
    const gap = 2;
    const gridW = cell * 3 + gap * 2;
    const startX = w / 2 - gridW / 2;
    const startY = 20;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const isMine = r === 1 && c === 1;
        g.fillStyle(isMine ? PALETTE.danger : PALETTE.mint, 1);
        g.fillRoundedRect(startX + c * (cell + gap), startY + r * (cell + gap), cell, cell, 1.5);
      }
    }

    this.drawCabinetBase(g, w, h);
    g.generateTexture("mines_machine", w, h);
    g.destroy();
  }

  private createDiceTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();

    g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
    g.fillEllipse(w / 2, h - 3, w - 10, 7);

    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(10, h - 18, w - 20, 14, 3);
    g.fillStyle(PALETTE.felt, 1);
    g.fillRoundedRect(2, h - 42, w - 4, 26, 6);
    // Lit top edge / shaded lower edge on the felt bed, plus a shadow the
    // dice below can sit in.
    g.fillStyle(PALETTE.litEdge, 0.12);
    g.fillRoundedRect(5, h - 40, w - 10, 3, 1.5);
    g.fillStyle(PALETTE.shadeEdge, 0.16);
    g.fillRoundedRect(5, h - 20, w - 10, 3, 1.5);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(2, h - 42, w - 4, 26, 6);

    this.drawDie(g, 12, h - 36, 14, 5);
    this.drawDie(g, 28, h - 30, 14, 3);

    g.generateTexture("dice_table", w, h);
    g.destroy();
  }

  /** Draws a single cream die with warm-brown pips for the given face value (3 or 5 used here). */
  private drawDie(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, value: number) {
    g.fillStyle(PALETTE.cream, 1);
    g.fillRoundedRect(x, y, size, size, 3);
    g.lineStyle(1, PALETTE.outline, 1);
    g.strokeRoundedRect(x, y, size, size, 3);

    g.fillStyle(PALETTE.outline, 1);
    const cx = x + size / 2;
    const cy = y + size / 2;
    const o = size * 0.25;
    const pipLayouts: Record<number, Array<[number, number]>> = {
      3: [
        [-o, -o],
        [0, 0],
        [o, o]
      ],
      5: [
        [-o, -o],
        [o, -o],
        [0, 0],
        [-o, o],
        [o, o]
      ]
    };
    for (const [dx, dy] of pipLayouts[value] ?? []) {
      g.fillCircle(cx + dx, cy + dy, size * 0.09);
    }
  }

  private createLimboTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    this.drawCabinetBody(g, w, h);

    this.drawCabinetScreen(g, 9, 16, w - 18, 30);

    g.lineStyle(3, PALETTE.gold, 1);
    g.beginPath();
    g.moveTo(13, 42);
    g.lineTo(24, 30);
    g.lineTo(33, 20);
    g.strokePath();
    g.fillStyle(PALETTE.gold, 1);
    g.fillTriangle(33, 18, 27, 22, 33, 26);

    this.drawCabinetBase(g, w, h);
    g.generateTexture("limbo_machine", w, h);
    g.destroy();
  }

  private createPlinkoTexture() {
    const w = 64;
    const h = 64;
    const g = this.add.graphics();

    g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
    g.fillEllipse(w / 2, h - 3, w - 12, 7);

    this.drawCabinetScreen(g, 2, 4, w - 4, h - 18, PALETTE.screen);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(2, 4, w - 4, h - 18, 6);

    g.fillStyle(PALETTE.cabinetDark, 1);
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const count = r + 2;
      const rowY = 14 + r * 7;
      const totalW = (count - 1) * 8;
      const startX = w / 2 - totalW / 2;
      for (let c = 0; c < count; c++) {
        g.fillCircle(startX + c * 8, rowY, 1.4);
      }
    }

    const slotColors = [PALETTE.coral, PALETTE.gold, PALETTE.mint, PALETTE.gold, PALETTE.coral];
    const slotW = (w - 8) / slotColors.length;
    slotColors.forEach((color, i) => {
      g.fillStyle(color, 1);
      g.fillRect(4 + i * slotW, h - 24, slotW - 1, 6);
    });

    this.drawCabinetBase(g, w, h);
    g.generateTexture("plinko_board", w, h);
    g.destroy();
  }

  /** A small drawn "board" of numbered squares on a cabinet - stands in for a real Keno terminal sprite. */
  private createKenoTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    this.drawCabinetBody(g, w, h);

    this.drawCabinetScreen(g, 9, 16, w - 18, 30);

    const cell = 5;
    const gap = 1.5;
    const cols = 4;
    const rows = 4;
    const gridW = cols * cell + (cols - 1) * gap;
    const startX = w / 2 - gridW / 2;
    const startY = 20;
    const highlighted = new Set([1, 3, 6, 9, 12, 14]);
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        g.fillStyle(highlighted.has(i) ? PALETTE.gold : PALETTE.mint, 1);
        g.fillRoundedRect(startX + c * (cell + gap), startY + r * (cell + gap), cell, cell, 1);
        i++;
      }
    }

    this.drawCabinetBase(g, w, h);
    g.generateTexture("keno_machine", w, h);
    g.destroy();
  }

  /** A small drawn segmented-wheel cabinet, cabinet-scale like keno_machine/dice_table. */
  private createWheelTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    this.drawCabinetBody(g, w, h);

    const cx = w / 2;
    const cy = 30;
    const radius = 14;
    const colors = [
      PALETTE.mint,
      PALETTE.gold,
      PALETTE.coral,
      PALETTE.cream,
      PALETTE.mint,
      PALETTE.gold,
      PALETTE.coral,
      PALETTE.cream
    ];
    const slice = (Math.PI * 2) / colors.length;
    colors.forEach((color, i) => {
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, radius, i * slice, (i + 1) * slice, false);
      g.closePath();
      g.fillPath();
    });
    g.lineStyle(1.5, PALETTE.outline, 1);
    g.strokeCircle(cx, cy, radius);
    g.fillStyle(PALETTE.cream, 1);
    g.fillTriangle(cx - 3, cy - radius - 6, cx + 3, cy - radius - 6, cx, cy - radius + 1);

    this.drawCabinetBase(g, w, h);
    g.generateTexture("wheel_machine", w, h);
    g.destroy();
  }

  /**
   * A small drawn card-cabinet with an up/down arrow - cabinet-scale
   * (48x64, matching keno_machine/dice_table) per floor's spacing note for
   * the col67 corridor between CoinFlip and Slots.
   */
  private createHiLoTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    this.drawCabinetBody(g, w, h);

    this.drawCabinetScreen(g, 9, 16, w - 18, 30);

    // two overlapping mini playing cards
    g.fillStyle(PALETTE.cream, 1);
    g.fillRoundedRect(14, 20, 14, 20, 2);
    g.fillRoundedRect(21, 24, 14, 20, 2);
    g.lineStyle(1, PALETTE.outline, 1);
    g.strokeRoundedRect(14, 20, 14, 20, 2);
    g.strokeRoundedRect(21, 24, 14, 20, 2);

    // up/down arrow between them
    g.fillStyle(PALETTE.mint, 1);
    g.fillTriangle(40, 22, 36, 28, 44, 28);
    g.fillStyle(PALETTE.danger, 1);
    g.fillTriangle(40, 44, 36, 38, 44, 38);

    this.drawCabinetBase(g, w, h);
    g.generateTexture("hilo_table", w, h);
    g.destroy();
  }

  /** A small drawn baccarat table cabinet - two mini playing cards over a felt strip, cabinet-scale like the others. */
  private createBaccaratTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    this.drawCabinetBody(g, w, h);

    // felt playing surface
    g.fillStyle(PALETTE.felt, 1);
    g.fillRoundedRect(9, 16, w - 18, 30, 4);
    g.lineStyle(1, PALETTE.gold, 0.6);
    g.strokeRoundedRect(9, 16, w - 18, 30, 4);

    // two mini cards (player/banker)
    g.fillStyle(PALETTE.cream, 1);
    g.fillRoundedRect(13, 22, 10, 15, 2);
    g.fillRoundedRect(25, 22, 10, 15, 2);
    g.lineStyle(1, PALETTE.outline, 1);
    g.strokeRoundedRect(13, 22, 10, 15, 2);
    g.strokeRoundedRect(25, 22, 10, 15, 2);
    g.fillStyle(PALETTE.danger, 1);
    g.fillCircle(18, 29, 1.6);
    g.fillStyle(PALETTE.outline, 1);
    g.fillCircle(30, 29, 1.6);

    this.drawCabinetBase(g, w, h);
    g.generateTexture("baccarat_table", w, h);
    g.destroy();
  }

  /** A small drawn video poker cabinet - a mini screen showing a 5-card hand, cabinet-scale like the others. */
  private createVideoPokerTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    this.drawCabinetBody(g, w, h);

    // screen - starts a row lower than it used to (15 -> 16) so it clears
    // the marquee header drawCabinetBody now draws above it.
    this.drawCabinetScreen(g, 9, 16, w - 18, 23, PALETTE.screenAlt);

    // five tiny cards on the screen
    const cardW = 4;
    const cardH = 10;
    const cardGap = 1.5;
    const totalW = 5 * cardW + 4 * cardGap;
    const startX = w / 2 - totalW / 2;
    for (let i = 0; i < 5; i++) {
      g.fillStyle(PALETTE.cream, 1);
      g.fillRoundedRect(startX + i * (cardW + cardGap), 20, cardW, cardH, 1);
    }

    // control buttons row
    const btnColors = [PALETTE.coral, PALETTE.mint, PALETTE.mint, PALETTE.mint, PALETTE.gold];
    const btnW = 4;
    const btnGap = 1.5;
    const btnTotal = 5 * btnW + 4 * btnGap;
    const btnStartX = w / 2 - btnTotal / 2;
    btnColors.forEach((color, i) => {
      g.fillStyle(color, 1);
      g.fillRoundedRect(btnStartX + i * (btnW + btnGap), 42, btnW, 4, 1);
    });

    this.drawCabinetBase(g, w, h);
    g.generateTexture("video_poker_machine", w, h);
    g.destroy();
  }

  /**
   * The overworld Coin Kiosk - per user direction, a TV/screen-on-a-stand
   * rather than a person character (it used to be the "npc_sheet" Kenney
   * character sprite - see OverworldScene.ts's registerStation call for
   * this station). Same 48x64 cabinet scale as the other game furniture,
   * with an antenna on top (the same "reads as a screen/TV, not a game
   * machine" trick the old, since-retired standalone Ad Kiosk cabinet
   * used) and a coral play-triangle on the screen, since watching a
   * simulated ad is still literally step one of what this station does.
   */
  private createCoinKioskTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    this.drawCabinetBody(g, w, h);

    // antenna, reads as "screen/TV" not "slot machine"
    g.lineStyle(2, PALETTE.outline, 1);
    g.beginPath();
    g.moveTo(w / 2, 10);
    g.lineTo(w / 2 - 6, 2);
    g.moveTo(w / 2, 10);
    g.lineTo(w / 2 + 6, 2);
    g.strokePath();
    g.fillStyle(PALETTE.gold, 1);
    g.fillCircle(w / 2 - 6, 2, 1.8);
    g.fillCircle(w / 2 + 6, 2, 1.8);

    this.drawCabinetScreen(g, 9, 16, w - 18, 30);

    // coral play triangle, centered on the screen
    g.fillStyle(PALETTE.coral, 1);
    g.fillTriangle(w / 2 - 6, 22, w / 2 - 6, 40, w / 2 + 8, 31);

    this.drawCabinetBase(g, w, h);
    g.generateTexture("coin_kiosk", w, h);
    g.destroy();
  }

  /**
   * The overworld Item Shop - per user direction, a booth/counter similar
   * to the Coin Kiosk (same cabinet-scale construction) rather than a
   * person character (it used to be a purchasable character skin
   * standing in as the attendant - see OverworldScene.ts's
   * registerStation call for this station). A small orange-and-white
   * awning up top instead of the Coin Kiosk's antenna (reads as "market
   * stall," not "screen"), and a simple shirt icon on the screen panel
   * instead of a play triangle, since this station sells outfits.
   */
  private createItemShopTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    this.drawCabinetBody(g, w, h);

    // awning - a small triangular pennant on top
    g.fillStyle(PALETTE.coral, 1);
    g.fillTriangle(w / 2, 1, w / 2 - 11, 12, w / 2 + 11, 12);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeTriangle(w / 2, 1, w / 2 - 11, 12, w / 2 + 11, 12);

    this.drawCabinetScreen(g, 9, 16, w - 18, 30);

    // shirt icon, centered on the screen panel
    const cx = w / 2;
    const cy = 31;
    g.fillStyle(PALETTE.cream, 1);
    g.fillTriangle(cx - 7, cy - 6, cx - 13, cy, cx - 7, cy + 2); // left sleeve
    g.fillTriangle(cx + 7, cy - 6, cx + 13, cy, cx + 7, cy + 2); // right sleeve
    g.fillRoundedRect(cx - 7, cy - 6, 14, 16, 2); // body
    g.fillStyle(PALETTE.screen, 1);
    g.fillCircle(cx, cy - 6, 3); // neckline notch, cut from the body with the screen's own color

    this.drawCabinetBase(g, w, h);
    g.generateTexture("item_shop_booth", w, h);
    g.destroy();
  }

  /**
   * The overworld Challenge Board - the walk-up station for challenges, XP
   * and levels (see OverworldScene's registerStation call and
   * ui/ChallengesPanel.ts). Same 48x64 cabinet construction as the Coin
   * Kiosk and Item Shop so it belongs to the same floor furniture family,
   * with a pinboard read: a gold-trimmed board on the screen panel carrying
   * three "pinned notice" rows and a star finial on top, since what this
   * station shows is a list of things to do plus a prestige number.
   */
  private createChallengeBoardTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    this.drawCabinetBody(g, w, h);

    // Star finial on top - the "achievement" read, and the one thing that
    // distinguishes this silhouette from the Coin Kiosk's antenna at a
    // glance when walking past.
    g.fillStyle(PALETTE.gold, 1);
    const cx = w / 2;
    g.fillTriangle(cx, 1, cx - 6, 12, cx + 6, 12);
    g.fillTriangle(cx, 13, cx - 6, 3, cx + 6, 3);

    this.drawCabinetScreen(g, 9, 16, w - 18, 30);

    // Gold-trimmed notice board inset into the screen panel.
    g.lineStyle(1.5, PALETTE.gold, 1);
    g.strokeRoundedRect(12, 19, w - 24, 24, 3);

    // Three pinned notice rows, the shortest last so it reads as a list
    // rather than a solid block.
    g.fillStyle(PALETTE.cream, 1);
    g.fillRect(15, 23, w - 30, 3);
    g.fillRect(15, 30, w - 30, 3);
    g.fillRect(15, 37, w - 38, 3);
    // A single filled pin on the top row - the "one of these is ready"
    // note the panel itself makes so much of.
    g.fillStyle(PALETTE.mint, 1);
    g.fillCircle(w - 15, 24, 2.4);

    this.drawCabinetBase(g, w, h);
    g.generateTexture("challenge_board", w, h);
    g.destroy();
  }

  /**
   * A caution-sign placeholder for floor spots reserved for a game whose
   * scene doesn't exist yet (see OverworldScene's RESERVED_STATIONS). Same
   * 48x64 cabinet scale as Mines/Dice/Limbo/Keno so it doesn't disturb the
   * verified spacing those reserved spots were placed with.
   */
  private createComingSoonTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();

    // signpost
    g.fillStyle(PALETTE.outline, 1);
    g.fillRect(w / 2 - 4, 34, 8, 26);

    // sign board
    g.fillStyle(PALETTE.gold, 1);
    g.fillRoundedRect(4, 6, w - 8, 32, 6);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(4, 6, w - 8, 32, 6);

    // exclamation mark
    g.fillStyle(PALETTE.outline, 1);
    g.fillRoundedRect(w / 2 - 3, 12, 6, 15, 3);
    g.fillCircle(w / 2, 32, 3.2);

    g.generateTexture("coming_soon_sign", w, h);
    g.destroy();
  }

  /**
   * Indoor decorative plant - replaces the old Jephed plant.png (same 48x64
   * footprint so buildDecorations()'s placement/origin needed no changes).
   * A terracotta pot with rounded mint-teal foliage clumps, warm dark-brown
   * outlines throughout - direction notes 1/2/3/5.
   */
  private createPlantTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();

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

  /**
   * Roulette table - top-down cabinet-style table, 112x64 (same footprint
   * as the old Jephed roulette_table.png). Terracotta rail, mint felt
   * inset, a small segmented wheel centered like createWheelTexture's.
   */
  private createRouletteTableTexture() {
    const w = 112;
    const h = 64;
    const g = this.add.graphics();

    // Contact shadow, so the table stands on the floor instead of floating.
    g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
    g.fillRoundedRect(5, 6, w - 8, h - 6, 12);

    // Padded wood rail, lit along the top and shaded underneath.
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(2, 2, w - 4, h - 4, 12);
    g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
    g.fillRoundedRect(5, 4, w - 10, 3, 1.5);
    g.fillStyle(PALETTE.shadeEdge, SHADE_ALPHA);
    g.fillRoundedRect(5, h - 7, w - 10, 3, 1.5);
    // Grain along the rail.
    g.fillStyle(PALETTE.shadeEdge, 0.12);
    for (let x = 12; x < w - 12; x += 7) {
      g.fillRect(x, 3, 1, 4);
      g.fillRect(x + 3, h - 7, 1, 4);
    }
    g.lineStyle(3, PALETTE.outline, 1);
    g.strokeRoundedRect(2, 2, w - 4, h - 4, 12);

    g.fillStyle(PALETTE.felt, 1);
    g.fillRoundedRect(8, 8, w - 16, h - 16, 9);
    // Felt sits BELOW the rail, so it catches a shadow from the rail on its
    // top edge and a little bounce light at the bottom - the inset that
    // makes the playing surface read as recessed rather than painted on.
    g.fillStyle(PALETTE.shadeEdge, 0.18);
    g.fillRoundedRect(9, 9, w - 18, 3, 1.5);
    g.fillStyle(PALETTE.litEdge, 0.07);
    g.fillRoundedRect(9, h - 13, w - 18, 2, 1);
    g.lineStyle(1, PALETTE.gold, 0.6);
    g.strokeRoundedRect(8, 8, w - 16, h - 16, 9);

    // betting-grid hint on either side of the wheel
    for (const gx of [16, w - 16 - 18]) {
      for (let i = 0; i < 3; i++) {
        g.fillStyle(PALETTE.cream, 0.85);
        g.fillRoundedRect(gx, 16 + i * 11, 18, 8, 2);
        g.lineStyle(1, PALETTE.outline, 0.8);
        g.strokeRoundedRect(gx, 16 + i * 11, 18, 8, 2);
      }
    }

    // wheel
    const cx = w / 2;
    const cy = h / 2;
    const radius = 15;
    const colors = [
      PALETTE.mint,
      PALETTE.gold,
      PALETTE.coral,
      PALETTE.cream,
      PALETTE.mint,
      PALETTE.gold,
      PALETTE.coral,
      PALETTE.cream,
      PALETTE.mint,
      PALETTE.gold
    ];
    const slice = (Math.PI * 2) / colors.length;
    colors.forEach((color, i) => {
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, radius, i * slice, (i + 1) * slice, false);
      g.closePath();
      g.fillPath();
    });
    // Fret lines between the pockets, then the outer rim, hub and a lit
    // sliver on the wheel's top-left - a spinning metal wheel, not a pie
    // chart.
    g.lineStyle(1, PALETTE.outline, 0.55);
    for (let i = 0; i < colors.length; i++) {
      const a = i * slice;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      g.strokePath();
    }
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeCircle(cx, cy, radius);
    g.lineStyle(1, PALETTE.litEdge, 0.4);
    g.strokeCircle(cx, cy, radius - 2);
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillCircle(cx, cy, 4);
    g.fillStyle(PALETTE.litEdge, 0.4);
    g.fillCircle(cx - 1, cy - 1, 1.6);
    g.lineStyle(1, PALETTE.outline, 1);
    g.strokeCircle(cx, cy, 4);

    g.generateTexture("roulette_table", w, h);
    g.destroy();
  }

  /**
   * Slot machine cabinet - 48x64 (same footprint as the old Jephed
   * slot_machine.png). Terracotta cabinet, cream screen with three
   * fruit-style reel symbols, a gold lever on the side.
   */
  private createSlotMachineTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();

    // Contact shadow, matching every other piece of floor furniture.
    g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
    g.fillEllipse(w / 2 - 3, h - 3, w - 12, 7);

    g.fillStyle(PALETTE.cabinet, 1);
    g.fillRoundedRect(4, 6, w - 12, h - 10, 8);
    // Same top-left light / bottom-right shade as drawCabinetBody, so this
    // cabinet belongs to the same lit floor as the eight that use it.
    g.fillStyle(PALETTE.shadeEdge, SHADE_ALPHA);
    g.fillRect(w - 12, 10, 3, h - 20);
    g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
    g.fillRect(6, 10, 2, h - 20);
    g.fillRect(6, 8, w - 18, 2);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(4, 6, w - 12, h - 10, 8);

    // Reel window - recessed glass with a gloss band, drawn the same way
    // the arcade cabinets' screens are.
    this.drawCabinetScreen(g, 8, 12, w - 20, 26, PALETTE.screenAlt);
    g.lineStyle(1.5, PALETTE.outline, 1);
    g.strokeRoundedRect(8, 12, w - 20, 26, 5);

    // Reel separators, so it reads as three spinning reels behind one pane.
    g.fillStyle(PALETTE.outline, 0.35);
    g.fillRect(16.5, 13, 1, 24);
    g.fillRect(24.5, 13, 1, 24);

    // three reel symbols, each with a small specular dot
    const reelColors = [PALETTE.coral, PALETTE.gold, PALETTE.mint];
    reelColors.forEach((color, i) => {
      g.fillStyle(color, 1);
      g.fillCircle(13 + i * 8, 25, 4.5);
      g.fillStyle(PALETTE.litEdge, 0.45);
      g.fillCircle(11.5 + i * 8, 23.5, 1.4);
      g.lineStyle(1, PALETTE.outline, 1);
      g.strokeCircle(13 + i * 8, 25, 4.5);
    });

    // lever
    g.lineStyle(3, PALETTE.cabinetDark, 1);
    g.beginPath();
    g.moveTo(w - 6, 16);
    g.lineTo(w - 6, 6);
    g.strokePath();
    g.fillStyle(PALETTE.gold, 1);
    g.fillCircle(w - 6, 5, 4);
    g.lineStyle(1.5, PALETTE.outline, 1);
    g.strokeCircle(w - 6, 5, 4);

    // control buttons row
    const btnColors = [PALETTE.coral, PALETTE.mint, PALETTE.gold];
    btnColors.forEach((color, i) => {
      g.fillStyle(color, 1);
      g.fillCircle(13 + i * 8, 46, 3);
    });

    this.drawCabinetBase(g, w, h);
    g.generateTexture("slot_machine", w, h);
    g.destroy();
  }

  /**
   * Blackjack table - 96x112 (same footprint as the old Jephed
   * blackjack_table.png). A tall semi-circular felt table with a terracotta
   * rail, a couple of mini playing cards and a small chip stack.
   */
  private createBlackjackTableTexture() {
    const w = 96;
    const h = 112;
    const g = this.add.graphics();

    // Contact shadow under the table.
    g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
    g.fillRoundedRect(9, 10, w - 14, h - 12, 22);

    // wood rail, lit on top and shaded underneath, with grain
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(6, 6, w - 12, h - 12, 22);
    g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
    g.fillRoundedRect(24, 8, w - 48, 3, 1.5);
    g.fillStyle(PALETTE.shadeEdge, SHADE_ALPHA);
    g.fillRoundedRect(24, h - 12, w - 48, 3, 1.5);
    g.fillStyle(PALETTE.shadeEdge, 0.12);
    for (let y = 26; y < h - 26; y += 8) {
      g.fillRect(7, y, 4, 1);
      g.fillRect(w - 11, y + 4, 4, 1);
    }
    g.lineStyle(3, PALETTE.outline, 1);
    g.strokeRoundedRect(6, 6, w - 12, h - 12, 22);

    // felt, recessed below the rail (shadow along its top edge)
    g.fillStyle(PALETTE.felt, 1);
    g.fillRoundedRect(16, 16, w - 32, h - 32, 16);
    g.fillStyle(PALETTE.shadeEdge, 0.18);
    g.fillRoundedRect(22, 17, w - 44, 4, 2);
    g.fillStyle(PALETTE.litEdge, 0.07);
    g.fillRoundedRect(22, h - 21, w - 44, 3, 1.5);
    g.lineStyle(1.5, PALETTE.gold, 0.6);
    g.strokeRoundedRect(16, 16, w - 32, h - 32, 16);

    // dealt cards, fanned near the top
    const cardPositions: Array<[number, number, number]> = [
      [w / 2 - 20, 34, -10],
      [w / 2 - 6, 30, 0],
      [w / 2 + 8, 34, 10]
    ];
    for (const [x, y, angle] of cardPositions) {
      g.save();
      g.translateCanvas(x, y);
      g.rotateCanvas(Phaser.Math.DegToRad(angle));
      g.fillStyle(PALETTE.cream, 1);
      g.fillRoundedRect(-8, -11, 16, 22, 2.5);
      g.lineStyle(1.5, PALETTE.outline, 1);
      g.strokeRoundedRect(-8, -11, 16, 22, 2.5);
      g.fillStyle(PALETTE.danger, 1);
      g.fillCircle(0, 0, 2.2);
      g.restore();
    }

    // chip stack, lower-center
    const chipColors = [PALETTE.coral, PALETTE.gold, PALETTE.mint];
    chipColors.forEach((color, i) => {
      g.fillStyle(color, 1);
      g.fillEllipse(w / 2, h - 26 - i * 5, 22, 9);
      g.lineStyle(1.5, PALETTE.outline, 1);
      g.strokeEllipse(w / 2, h - 26 - i * 5, 22, 9);
    });

    g.generateTexture("blackjack_table", w, h);
    g.destroy();
  }

  /**
   * Coin Flip machine - 49x64 (same footprint as the old Jephed
   * coinflip_machine.png). Same cabinet shell as the arcade-scale games,
   * with a big gold coin on the screen.
   */
  private createCoinFlipMachineTexture() {
    const w = 49;
    const h = 64;
    const g = this.add.graphics();
    this.drawCabinetBody(g, w, h);

    this.drawCabinetScreen(g, 9, 16, w - 18, 30);

    const cx = w / 2;
    const cy = 31;
    g.fillStyle(PALETTE.gold, 1);
    g.fillCircle(cx, cy, 10);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeCircle(cx, cy, 10);
    g.lineStyle(1.5, PALETTE.cabinetDark, 1);
    g.strokeCircle(cx, cy, 6.5);
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(cx - 1.5, cy - 5, 3, 10, 1.5);

    this.drawCabinetBase(g, w, h);
    g.generateTexture("coinflip_machine", w, h);
    g.destroy();
  }

  /**
   * Dragon Tower pedestal - 48x64 (same footprint as the old Jephed
   * dragon_pedestal.png). A terracotta column on a plinth, topped with a
   * small ascending stack of tower "levels" and a gold finial gem.
   */
  private createDragonPedestalTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();

    g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
    g.fillEllipse(w / 2, h - 3, w - 16, 7);

    // base plinth
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(10, h - 14, w - 20, 10, 3);
    g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
    g.fillRect(12, h - 13, w - 24, 1);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(10, h - 14, w - 20, 10, 3);

    // column - shorter than the plinth-to-canopy span used to give the
    // ascending tower-level blocks below enough headroom (an earlier
    // version stacked full-height blocks on a 32px column and pushed the
    // top two levels above the canvas entirely - verified via a live
    // texture-manager snapshot; these fixed coordinates keep every level
    // and the finial gem on-canvas with room to spare).
    g.fillStyle(PALETTE.cabinet, 1);
    g.fillRoundedRect(16, 34, 16, 20, 4);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(16, 34, 16, 20, 4);

    // ascending tower-level blocks, each seated a couple px into the one below
    g.fillStyle(PALETTE.mint, 1);
    g.fillRoundedRect(11, 27, 26, 9, 3);
    g.lineStyle(1.5, PALETTE.outline, 1);
    g.strokeRoundedRect(11, 27, 26, 9, 3);

    g.fillStyle(PALETTE.gold, 1);
    g.fillRoundedRect(14, 20, 20, 8, 3);
    g.lineStyle(1.5, PALETTE.outline, 1);
    g.strokeRoundedRect(14, 20, 20, 8, 3);

    g.fillStyle(PALETTE.coral, 1);
    g.fillRoundedRect(17, 13, 14, 7, 3);
    g.lineStyle(1.5, PALETTE.outline, 1);
    g.strokeRoundedRect(17, 13, 14, 7, 3);

    // finial gem
    g.fillStyle(PALETTE.gold, 1);
    g.fillCircle(w / 2, 8, 4.5);
    g.lineStyle(1.5, PALETTE.outline, 1);
    g.strokeCircle(w / 2, 8, 4.5);

    g.generateTexture("dragon_pedestal", w, h);
    g.destroy();
  }

  /**
   * A friendly gold-chip mascot for the onboarding tutorial's dialogue box
   * (src/ui/TutorialGuide.ts) - a drawn placeholder in the same style as
   * every other texture in this file, not a spritesheet, since it never
   * walks/animates - it's a static portrait icon inside a screen-fixed
   * panel. Uses the same shared PALETTE as every other texture in this file
   * (flagged during the chrome-polish pass: this function previously used
   * ad-hoc hex values, including a near-black `0x1a1d24` face - the one
   * spot in the whole file that still violated STYLE_GUIDE.md direction
   * note 2's "never pure black" rule. Fixed here to PALETTE.outline, same
   * warm dark-brown as every other drawn texture's line art.
   */
  private createTutorialGuideTexture() {
    const w = 44;
    const h = 44;
    const g = this.add.graphics();

    g.fillStyle(PALETTE.gold, 1);
    g.fillCircle(w / 2, h / 2, w / 2 - 2);
    g.lineStyle(3, PALETTE.outline, 1);
    g.strokeCircle(w / 2, h / 2, w / 2 - 2);

    // poker-chip-style inner ring, purely decorative
    g.lineStyle(2, 0xffffff, 0.5);
    g.strokeCircle(w / 2, h / 2, w / 2 - 9);

    // face
    g.fillStyle(PALETTE.outline, 1);
    g.fillCircle(w / 2 - 7, h / 2 - 3, 2.6);
    g.fillCircle(w / 2 + 7, h / 2 - 3, 2.6);
    g.lineStyle(2.5, PALETTE.outline, 1);
    g.beginPath();
    g.arc(w / 2, h / 2 + 1, 8, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160));
    g.strokePath();

    g.generateTexture("tutorial_guide", w, h);
    g.destroy();
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
  private createAccessoryTextures() {
    this.createTopHatTexture();
    this.createShadesTexture();
    this.createCrownTexture();
    this.createHeadphonesTexture();
    this.createBowTexture();
  }

  private createTopHatTexture() {
    const w = 14;
    const h = 12;
    const g = this.add.graphics();

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

  private createShadesTexture() {
    const w = 14;
    const h = 6;
    const g = this.add.graphics();

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

  private createCrownTexture() {
    const w = 14;
    const h = 10;
    const g = this.add.graphics();

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

  private createHeadphonesTexture() {
    const w = 16;
    const h = 13;
    const g = this.add.graphics();

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

  private createBowTexture() {
    const w = 12;
    const h = 8;
    const g = this.add.graphics();

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
  private createFlatCharacterSheet() {
    const FRAME = FLAT_RIG.frameHeight;
    const COLS = FLAT_RIG.columns; // left, down, up, right - matches FLAT_RIG.walkFrames' column order
    const ROWS = 3;
    const w = FRAME * COLS;
    const h = FRAME * ROWS;
    const g = this.add.graphics();

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
    const texture = this.textures.get("player_flat_sheet");
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
  // The layered wardrobe ships before its art does. Rather than have the
  // shop sell invisible clothes (or block the whole feature on a weekend of
  // spritesheet exports), every catalogue piece without a real PNG gets a
  // generated stand-in drawn here, in the LPC frame layout, so the system
  // is fully playable and testable today and each real export simply
  // replaces one placeholder.
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
  private static readonly PLACEHOLDER_COLUMNS = 9;
  /** LPC direction order for walk rows 8, 9, 10, 11. */
  private static readonly PLACEHOLDER_DIR_ORDER = ["up", "left", "down", "right"] as const;

  /**
   * Generates stand-in art for every wardrobe piece that has no usable
   * texture - i.e. one with no `file` declared, or whose declared file
   * failed to load. Pieces with real art are left completely alone.
   */
  private ensureWardrobePlaceholders() {
    for (const piece of WARDROBE_CATALOG) {
      if (this.textures.exists(piece.id) && this.textures.get(piece.id).key !== "__MISSING") {
        continue; // real art loaded - nothing to do
      }
      this.createWardrobePlaceholderSheet(piece);
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
  private createWardrobeWalkAnims() {
    for (const piece of WARDROBE_CATALOG) {
      if (piece.slot !== "BODY") continue;
      this.createWalkAnims(piece.id, piece.id, LPC_RIG);
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
  private createWardrobePlaceholderSheet(piece: WardrobePieceDef) {
    const FRAME = LPC_RIG.frameHeight; // 64
    const COLS = BootScene.PLACEHOLDER_COLUMNS;
    const ROWS = BootScene.PLACEHOLDER_DIR_ORDER.length;
    const g = this.add.graphics();

    for (let row = 0; row < ROWS; row++) {
      const dir = BootScene.PLACEHOLDER_DIR_ORDER[row];
      for (let col = 0; col < COLS; col++) {
        // Column 0 is the standing pose; 1-8 are the walk cycle. Swing the
        // limbs on a sine so the cycle loops seamlessly back to column 1.
        const phase = col === 0 ? 0 : Math.sin(((col - 1) / 8) * Math.PI * 2);
        this.drawWardrobePlaceholderFrame(g, piece, dir, phase, col * FRAME, row * FRAME);
      }
    }

    g.generateTexture(piece.id, FRAME * COLS, FRAME * ROWS);
    g.destroy();

    // Register each compact cell under its REAL LPC frame index - see the
    // "compact-sheet trick" comment above. Without this the texture would
    // have a single frame covering the whole packed image, and every
    // numeric frame index the rig asks for would miss and render the entire
    // sheet in place of one 64x64 frame.
    const texture = this.textures.get(piece.id);
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
  private drawWardrobePlaceholderFrame(
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
   * Loads a character spritesheet at whatever frame size its rig declares.
   *
   * Replaces four near-identical `load.spritesheet(key, path, {frameWidth:
   * 16, frameHeight: 16})` blocks plus the old 21x32 skin loop - the frame size
   * is now read off the rig descriptor rather than repeated as a literal at
   * every call site, which is what makes a fourth rig (LPC's 64x64) a
   * one-argument change instead of a new copy of the loader.
   */
  private loadCharacterSheet(key: string, path: string, rig: CharacterRig) {
    this.load.spritesheet(key, path, {
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
  private createWalkAnims(sheetKey: string, prefix: string, rig: CharacterRig) {
    for (const dir of DIRECTIONS) {
      this.anims.create({
        key: `${prefix}_walk_${dir}`,
        frames: rig.walkFrames[dir].map((frame) => ({ key: sheetKey, frame })),
        frameRate: 8,
        repeat: -1
      });
    }
  }
}
