import Phaser from "phaser";
import { SKIN_CATALOG } from "../GameState";
import { fadeToScene } from "../ui/sceneTransition";

/**
 * BootScene loads the environment tileset assets plus the player/NPC/dealer
 * character spritesheets and every purchasable skin.
 *
 * "Arcade Nights" reskin (Gold Coast Arcade rebrand): every procedurally-
 * drawn game cabinet/table texture below moved off the old "Bright
 * Social-Hub" pastel palette onto a dark charcoal-navy body with orange/
 * gold/white accents, per direction ("look more like Dave and Busters").
 * Key names are kept stable (cabinet, felt, mint, coral, cream, etc.) even
 * though most no longer literally match their old color - every
 * create*Texture() method below references PALETTE by name, so re-pointing
 * the values here is what makes the new look cascade everywhere without
 * touching each drawing method. The floor/wall/carpet ground tiles (below,
 * in preload()/create()) used to be pre-cut PNGs from the old Kenney
 * "RPG Urban Pack" - that pack is a bright town/plaza kit with no dark
 * equivalent, so those four are now drawn procedurally too (createFloorTan
 * Texture/createCarpetRedTexture/createCarpetBlueTexture/createWallTexture),
 * same technique as the furniture, instead of hunting for pre-made dark
 * tile art. Theme.ts/uiHelpers.ts (chrome UI palette) is a separate token
 * set with its own new dark values, kept in sync by hand (not literally
 * shared) since this file has no import relationship to it.
 */
const PALETTE = {
  /** Near-black outline used on every drawn shape. */
  outline: 0x05070c,
  /** Dark navy-blue - "cabinet" furniture body (was terracotta). */
  cabinet: 0x1a2138,
  /** Darker navy - trim/base/plinth accents. */
  cabinetDark: 0x101725,
  /** Dark slate "screen" panel background, reads as a lit arcade-cabinet screen against the navy body (was cream). */
  screen: 0x131a2c,
  /** Even darker alt panel (was pale sky blue). */
  screenAlt: 0x0d1220,
  /** Rich royal-blue felt for card/dice tables - saturated enough to read as "felt" against the near-black cabinet rail. */
  felt: 0x1b3a6b,
  /** Bright green - "positive/safe" grid-cell color (mines' safe cells, keno default cells, plant foliage) - kept as a green functional accent (universal win/safe signal), just repointed brighter for a dark bg (was mint-teal). */
  mint: 0x2ecc71,
  /** Lighter green variant. */
  mintBright: 0x5eeba0,
  /** Electric mid-blue - secondary accent (was sky blue). */
  sky: 0x3d7fd9,
  /** Vivid orange - primary brand accent, matches Theme.accent (was coral-orange). */
  coral: 0xff7a29,
  /** Amber-gold - jackpot/highlight accent, matches Theme.gold. */
  gold: 0xffb347,
  /** Red - danger/loss accent, matches Theme.danger. */
  danger: 0xe0473f,
  /** Near-white - card faces / light UI elements on dark furniture (was warm cream). */
  cream: 0xf5f6fa
} as const;

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
    // (direction) x 3 rows (walk frame) - see createKenneyWalkAnims below.
    // Mapping per STYLE_GUIDE.md's suggestion: player=green, dealer=lavender
    // (reads distinct/formal), NPC=gray (reads as "staff").
    this.load.spritesheet("player_sheet", "assets/characters/kenney/char_a_green.png", {
      frameWidth: 16,
      frameHeight: 16
    });
    this.load.spritesheet("npc_sheet", "assets/characters/kenney/char_e_gray.png", {
      frameWidth: 16,
      frameHeight: 16
    });
    this.load.spritesheet("dealer_sheet", "assets/characters/kenney/char_c_lavender.png", {
      frameWidth: 16,
      frameHeight: 16
    });

    // Ambient background bystanders (OverworldScene's addAmbientNpc) - the
    // 3 Kenney variants STYLE_GUIDE.md flagged as sitting completely unused
    // (char_b_brick/char_d_hardhat/char_f_dark), put to work as decorative
    // "social hub" flavor per direction note 4 rather than static dead
    // weight. Same 16x16/4x3 layout as player/npc/dealer above, so they
    // reuse createKenneyWalkAnims below - no new loader logic needed.
    this.load.spritesheet("npc2_sheet", "assets/characters/kenney/char_b_brick.png", {
      frameWidth: 16,
      frameHeight: 16
    });
    this.load.spritesheet("npc3_sheet", "assets/characters/kenney/char_d_hardhat.png", {
      frameWidth: 16,
      frameHeight: 16
    });
    this.load.spritesheet("npc4_sheet", "assets/characters/kenney/char_f_dark.png", {
      frameWidth: 16,
      frameHeight: 16
    });

    // Every purchasable skin (SKIN_CATALOG) - STILL the old Jephed-pack rig,
    // 21x32, 3 cols (walk frame) x 4 rows (direction). STYLE_GUIDE.md's scope
    // note is explicit: the new Kenney pack has no equivalent for these 17
    // skins, so per art-director they're deliberately left on the old rig
    // for now rather than being silently dropped or faked - see task #24
    // report to main for the tradeoff/options. This means these files use
    // createLegacySkinWalkAnims (old row-major layout), not
    // createKenneyWalkAnims (new layout, used only for player/npc/dealer
    // above).
    for (const skin of SKIN_CATALOG) {
      if (skin.id === "player") continue; // already loaded above as player_sheet
      this.load.spritesheet(skin.textureKey, `assets/characters/skins/${skin.textureKey}.png`, {
        frameWidth: 21,
        frameHeight: 32
      });
    }
  }

  create() {
    this.createKenneyWalkAnims("player_sheet", "player");
    this.createKenneyWalkAnims("npc_sheet", "npc");
    this.createKenneyWalkAnims("dealer_sheet", "dealer");
    this.createKenneyWalkAnims("npc2_sheet", "npc2");
    this.createKenneyWalkAnims("npc3_sheet", "npc3");
    this.createKenneyWalkAnims("npc4_sheet", "npc4");
    for (const skin of SKIN_CATALOG) {
      if (skin.id === "player") continue;
      this.createLegacySkinWalkAnims(skin.textureKey, skin.id);
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
    this.createComingSoonTexture();
    this.createPlantTexture();
    this.createRouletteTableTexture();
    this.createSlotMachineTexture();
    this.createBlackjackTableTexture();
    this.createCoinFlipMachineTexture();
    this.createDragonPedestalTexture();
    this.createTutorialGuideTexture();

    fadeToScene(this, "LoginScene");
  }

  /**
   * Main plaza floor tile, 16x16 - flat near-black charcoal with a faint
   * darker fleck pattern so it doesn't read as a dead flat void. Drawn
   * procedurally (see class doc comment) instead of a loaded PNG.
   */
  private createFloorTanTexture() {
    const s = 16;
    const g = this.add.graphics();
    g.fillStyle(0x14161c, 1);
    g.fillRect(0, 0, s, s);
    g.fillStyle(0x0e0f14, 1);
    g.fillCircle(4, 4, 1);
    g.fillCircle(11, 9, 1);
    g.fillCircle(7, 13, 0.8);
    g.generateTexture("floor_tan", s, s);
    g.destroy();
  }

  /**
   * Gaming-floor "rug" tile, 16x16 - a dark maroon-black patterned carpet,
   * the classic arcade/bowling-alley carpet look. `carpet_blue` (below) is
   * the existing 1-in-5-tile accent inside this same rug area.
   */
  private createCarpetRedTexture() {
    const s = 16;
    const g = this.add.graphics();
    g.fillStyle(0x2a0f10, 1);
    g.fillRect(0, 0, s, s);
    g.fillStyle(0x3d1416, 1);
    g.fillRect(0, 0, s, 1);
    g.fillRect(0, 8, s, 1);
    g.fillStyle(PALETTE.coral, 0.25);
    g.fillCircle(4, 4, 1.1);
    g.fillCircle(12, 12, 1.1);
    g.generateTexture("carpet_red", s, s);
    g.destroy();
  }

  /** Rug accent tile (1-in-5, see buildFloor()) - a dark navy-black variant of carpet_red. */
  private createCarpetBlueTexture() {
    const s = 16;
    const g = this.add.graphics();
    g.fillStyle(0x0f1526, 1);
    g.fillRect(0, 0, s, s);
    g.fillStyle(0x18213a, 1);
    g.fillRect(0, 0, s, 1);
    g.fillRect(0, 8, s, 1);
    g.fillStyle(PALETTE.sky, 0.25);
    g.fillCircle(4, 4, 1.1);
    g.fillCircle(12, 12, 1.1);
    g.generateTexture("carpet_blue", s, s);
    g.destroy();
  }

  /**
   * Perimeter wall tile, 16x16 - dark navy brick with a thin glowing-orange
   * baseboard trim line, the "neon strip along the wall" touch real arcades
   * use (was a terracotta-brick Kenney tile).
   */
  private createWallTexture() {
    const s = 16;
    const g = this.add.graphics();
    g.fillStyle(0x161c30, 1);
    g.fillRect(0, 0, s, s);
    g.lineStyle(1, 0x0a0e1a, 1);
    g.strokeRect(0, 0, s, 8);
    g.strokeRect(0, 8, s, 8);
    g.fillStyle(PALETTE.coral, 1);
    g.fillRect(0, s - 2, s, 2);
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
    g.fillStyle(PALETTE.cabinet, 1);
    g.fillRoundedRect(4, 10, w - 8, h - 16, 6);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(4, 10, w - 8, h - 16, 6);
  }

  private drawCabinetBase(g: Phaser.GameObjects.Graphics, w: number, h: number) {
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(10, h - 10, w - 20, 8, 3);
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

    g.fillStyle(PALETTE.screen, 1);
    g.fillRoundedRect(9, 16, w - 18, 30, 4);

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

    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(10, h - 18, w - 20, 14, 3);
    g.fillStyle(PALETTE.felt, 1);
    g.fillRoundedRect(2, h - 42, w - 4, 26, 6);
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

    g.fillStyle(PALETTE.screen, 1);
    g.fillRoundedRect(9, 16, w - 18, 30, 4);

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

    g.fillStyle(PALETTE.screen, 1);
    g.fillRoundedRect(2, 4, w - 4, h - 18, 6);
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

    g.fillStyle(PALETTE.screen, 1);
    g.fillRoundedRect(9, 16, w - 18, 30, 4);

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

    g.fillStyle(PALETTE.screen, 1);
    g.fillRoundedRect(9, 16, w - 18, 30, 4);

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

    // screen
    g.fillStyle(PALETTE.screenAlt, 1);
    g.fillRoundedRect(9, 15, w - 18, 24, 4);

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

    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(2, 2, w - 4, h - 4, 12);
    g.lineStyle(3, PALETTE.outline, 1);
    g.strokeRoundedRect(2, 2, w - 4, h - 4, 12);

    g.fillStyle(PALETTE.felt, 1);
    g.fillRoundedRect(8, 8, w - 16, h - 16, 9);
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
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeCircle(cx, cy, radius);
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillCircle(cx, cy, 4);

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

    g.fillStyle(PALETTE.cabinet, 1);
    g.fillRoundedRect(4, 6, w - 12, h - 10, 8);
    g.lineStyle(2, PALETTE.outline, 1);
    g.strokeRoundedRect(4, 6, w - 12, h - 10, 8);

    g.fillStyle(PALETTE.screenAlt, 1);
    g.fillRoundedRect(8, 12, w - 20, 26, 5);
    g.lineStyle(1.5, PALETTE.outline, 1);
    g.strokeRoundedRect(8, 12, w - 20, 26, 5);

    // three reel symbols
    const reelColors = [PALETTE.coral, PALETTE.gold, PALETTE.mint];
    reelColors.forEach((color, i) => {
      g.fillStyle(color, 1);
      g.fillCircle(13 + i * 8, 25, 4.5);
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

    // wood rail
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(6, 6, w - 12, h - 12, 22);
    g.lineStyle(3, PALETTE.outline, 1);
    g.strokeRoundedRect(6, 6, w - 12, h - 12, 22);

    // felt
    g.fillStyle(PALETTE.felt, 1);
    g.fillRoundedRect(16, 16, w - 32, h - 32, 16);
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

    g.fillStyle(PALETTE.screen, 1);
    g.fillRoundedRect(9, 16, w - 18, 30, 4);

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

    // base plinth
    g.fillStyle(PALETTE.cabinetDark, 1);
    g.fillRoundedRect(10, h - 14, w - 20, 10, 3);
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
   * Base character rig (player/npc/dealer) - Kenney "RPG Urban Pack" layout
   * per STYLE_GUIDE.md "Character sheet layout": 16x16 frames, 4 columns
   * (direction) x 3 rows (walk frame), columns = [left, down, up, right].
   * Frame = row * 4 + col (Phaser generateFrameNumbers/spritesheet indexing
   * is row-major over columnsPerRow=4 here), so each direction's 3 frames
   * are 4 apart, NOT contiguous - explicit frame arrays instead of the old
   * start/end range logic, straight from STYLE_GUIDE.md's sample code.
   */
  private createKenneyWalkAnims(sheetKey: string, prefix: string) {
    const DIRECTION_FRAMES: Record<string, number[]> = {
      left: [0, 4, 8],
      down: [1, 5, 9],
      up: [2, 6, 10],
      right: [3, 7, 11]
    };

    for (const [dir, frames] of Object.entries(DIRECTION_FRAMES)) {
      this.anims.create({
        key: `${prefix}_walk_${dir}`,
        frames: frames.map((frame) => ({ key: sheetKey, frame })),
        frameRate: 8,
        repeat: -1
      });
    }
  }

  /**
   * Old Jephed-pack rig, still used by every purchasable skin in
   * SKIN_CATALOG (see the preload() comment above - STYLE_GUIDE.md's scope
   * note explicitly leaves these on the old rig for now). 21x32 frames, 3
   * columns (walk frame) x 4 rows (direction), row order down/left/right/up
   * - this is the *original* createWalkAnims logic, kept as-is and renamed
   * only to distinguish it from createKenneyWalkAnims above. Do not point
   * this at a Kenney sheet (wrong frame size/layout) or vice versa.
   */
  private createLegacySkinWalkAnims(sheetKey: string, prefix: string) {
    const rows: Array<{ dir: string; row: number }> = [
      { dir: "down", row: 0 },
      { dir: "left", row: 1 },
      { dir: "right", row: 2 },
      { dir: "up", row: 3 }
    ];

    for (const { dir, row } of rows) {
      const start = row * 3;
      this.anims.create({
        key: `${prefix}_walk_${dir}`,
        frames: this.anims.generateFrameNumbers(sheetKey, {
          start,
          end: start + 2
        }),
        frameRate: 8,
        repeat: -1
      });
    }
  }
}
