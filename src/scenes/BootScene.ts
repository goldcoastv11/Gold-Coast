import Phaser from "phaser";
import { WARDROBE_CATALOG } from "../wardrobeCatalog";
import { FLAT_RIG, KENNEY_RIG, LPC_CHARACTER_SHEETS, LPC_RIG } from "../characterRig";
import { fadeToScene } from "../ui/sceneTransition";
import { preloadSounds, preloadMusic } from "../ui/SoundManager";
import { whenDisplayFontReady } from "../ui/Theme";
import {
  loadCharacterSheet,
  createWalkAnims,
  createFlatCharacterSheet,
  remapWalkOnlySheets,
  ensureWardrobePlaceholders,
  createWardrobeWalkAnims,
  createAccessoryTextures
} from "./bootScene/characterTextures";
import {
  createFloorTanTexture,
  createCarpetBlueTexture,
  createCarpetRedTexture,
  createWallTexture,
  createExitDoorTexture
} from "./bootScene/floorWallTextures";
import {
  createRoomWallpaperTextures,
  createRoomFlooringTextures,
  createFurnitureTextures,
  createPlantTexture
} from "./bootScene/roomAndFurnitureTextures";
import {
  createMinesTexture,
  createDiceTexture,
  createLimboTexture,
  createPlinkoTexture,
  createKenoTexture,
  createWheelTexture,
  createHiLoTexture,
  createBaccaratTexture,
  createVideoPokerTexture,
  createRouletteTableTexture,
  createSlotMachineTexture,
  createBlackjackTableTexture,
  createCoinFlipMachineTexture,
  createDragonPedestalTexture
} from "./bootScene/gameCabinetTextures";
import {
  createCoinKioskTexture,
  createItemShopTexture,
  createChallengeBoardTexture,
  createLevelUpKioskTexture,
  createComingSoonTexture,
  createTutorialGuideTexture
} from "./bootScene/uiStationTextures";

/**
 * BootScene loads the environment tileset assets plus the player/NPC/dealer
 * character spritesheets and every wardrobe piece, then hands off to
 * LoginScene once the display font is ready.
 *
 * Every procedurally-drawn texture (the ~83 create*Texture generators this
 * scene used to define directly) now lives in src/scenes/bootScene/, split
 * by domain: characterTextures.ts (player/NPC/wardrobe/accessories),
 * gameCabinetTextures.ts (the 14 games' cabinet sprites), uiStationTextures.ts
 * (Coin Kiosk/Item Shop/Challenge Board/Level-Up Kiosk/tutorial guide),
 * roomAndFurnitureTextures.ts (Player Room decor + the outdoor plant),
 * floorWallTextures.ts (plaza/rug/wall/door tiles), cabinetShell.ts (the
 * shared cabinet-body/base/screen pieces every cabinet-style texture draws
 * on top of), and palette.ts (the shared warm "Daylight" color tokens - see
 * that file's doc comment for the palette's own history). This file is now
 * just the loader: it calls each generator in the same order they used to
 * run in, so every texture key and the frames/animations built from it are
 * unchanged.
 *
 * Texture keys are untouched by the split - everything else in the game
 * looks textures up by string, so a renamed key would break silently at
 * runtime rather than at compile time.
 */
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
    loadCharacterSheet(this, "player_sheet", "assets/characters/kenney/char_a_green.png", KENNEY_RIG);
    loadCharacterSheet(this, "npc_sheet", "assets/characters/kenney/char_e_gray.png", KENNEY_RIG);
    loadCharacterSheet(this, "dealer_sheet", "assets/characters/kenney/char_c_lavender.png", KENNEY_RIG);

    // Ambient background bystanders (OverworldScene's addAmbientNpc) - the
    // 3 Kenney variants STYLE_GUIDE.md flagged as sitting completely unused
    // (char_b_brick/char_d_hardhat/char_f_dark), put to work as decorative
    // "social hub" flavor per direction note 4 rather than static dead
    // weight. Same 16x16/4x3 layout as player/npc/dealer above, so they
    // declare the same KENNEY_RIG - no new loader logic needed.
    loadCharacterSheet(this, "npc2_sheet", "assets/characters/kenney/char_b_brick.png", KENNEY_RIG);
    loadCharacterSheet(this, "npc3_sheet", "assets/characters/kenney/char_d_hardhat.png", KENNEY_RIG);
    loadCharacterSheet(this, "npc4_sheet", "assets/characters/kenney/char_f_dark.png", KENNEY_RIG);

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
      loadCharacterSheet(this, piece.id, `assets/characters/lpc/${piece.file}`, LPC_RIG);
    }

    // LPC (Universal LPC Spritesheet Generator) outfit sheets - the fourth
    // rig, 64x64 frames on a 13-column sheet. This list is EMPTY until the
    // founder exports real art (see docs/character-art-spec.md); the loop is
    // here so that dropping a PNG into public/assets/characters/lpc/ and
    // adding one line to LPC_CHARACTER_SHEETS is the entire integration -
    // loading, animation building and rig registration all follow from it.
    for (const sheet of LPC_CHARACTER_SHEETS) {
      loadCharacterSheet(this, sheet.textureKey, `assets/characters/lpc/${sheet.file}`, LPC_RIG);
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
    createFlatCharacterSheet(this);
    createWalkAnims(this, "player_flat_sheet", "player", FLAT_RIG);
    createWalkAnims(this, "npc_sheet", "npc", KENNEY_RIG);
    createWalkAnims(this, "dealer_sheet", "dealer", KENNEY_RIG);
    createWalkAnims(this, "npc2_sheet", "npc2", KENNEY_RIG);
    createWalkAnims(this, "npc3_sheet", "npc3", KENNEY_RIG);
    createWalkAnims(this, "npc4_sheet", "npc4", KENNEY_RIG);
    // Wardrobe: put the imported walk-only sheets' frames at the indices the
    // LPC rig addresses, fill in generated stand-in art for anything with no
    // real PNG, THEN build walk animations. Order matters - an anim can't
    // reference a texture (or a frame) that doesn't exist yet.
    remapWalkOnlySheets(this);
    ensureWardrobePlaceholders(this);
    createWardrobeWalkAnims(this);

    for (const sheet of LPC_CHARACTER_SHEETS) {
      createWalkAnims(this, sheet.textureKey, sheet.textureKey, LPC_RIG);
    }
    createFloorTanTexture(this);
    createCarpetRedTexture(this);
    createCarpetBlueTexture(this);
    createWallTexture(this);
    createExitDoorTexture(this);
    // Player Room decor (roadmap/player-room-v2) - wallpaper/flooring tiles
    // for every piece in roomCatalog.ts's ROOM_CATALOG. Reuses "exit_door"
    // above for the Room's own door back to the casino floor - a door
    // reads as a door regardless of which room it's in, so no new texture
    // is needed there.
    createRoomWallpaperTextures(this);
    createRoomFlooringTextures(this);
    // Player Room furniture (roadmap/room-furniture) - one texture per
    // piece in furnitureCatalog.ts's FURNITURE_CATALOG, same
    // id-is-texture-key convention as the wallpaper/flooring generators
    // above.
    createFurnitureTextures(this);
    createMinesTexture(this);
    createDiceTexture(this);
    createLimboTexture(this);
    createPlinkoTexture(this);
    createKenoTexture(this);
    createWheelTexture(this);
    createHiLoTexture(this);
    createBaccaratTexture(this);
    createVideoPokerTexture(this);
    createCoinKioskTexture(this);
    createItemShopTexture(this);
    createChallengeBoardTexture(this);
    createLevelUpKioskTexture(this);
    createComingSoonTexture(this);
    createPlantTexture(this);
    createRouletteTableTexture(this);
    createSlotMachineTexture(this);
    createBlackjackTableTexture(this);
    createCoinFlipMachineTexture(this);
    createDragonPedestalTexture(this);
    createTutorialGuideTexture(this);
    createAccessoryTextures(this);

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
}
