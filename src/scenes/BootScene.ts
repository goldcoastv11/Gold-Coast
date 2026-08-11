import Phaser from "phaser";
import { SKIN_CATALOG } from "../GameState";

/**
 * BootScene loads the real casino tileset assets (extracted from the
 * uploaded tileset PNG) plus the player/NPC/dealer character spritesheets
 * and every purchasable skin.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload() {
    this.load.image("floor_tan", "assets/tiles/floor_tan.png");
    this.load.image("carpet_red", "assets/tiles/carpet_red.png");
    this.load.image("carpet_blue", "assets/tiles/carpet_blue.png");
    this.load.image("wall", "assets/tiles/wall.png");
    this.load.image("roulette_table", "assets/tiles/roulette_table.png");
    this.load.image("slot_machine", "assets/tiles/slot_machine.png");
    this.load.image("blackjack_table", "assets/tiles/blackjack_table.png");
    this.load.image("coinflip_machine", "assets/tiles/coinflip_machine.png");
    this.load.image("dragon_pedestal", "assets/tiles/dragon_pedestal.png");
    this.load.image("plant", "assets/tiles/plant.png");

    // Character spritesheets: 3 columns (walk frames) x 4 rows
    // (down, left, right, up), each frame 21x32
    this.load.spritesheet("player_sheet", "assets/characters/player_spritesheet.png", {
      frameWidth: 21,
      frameHeight: 32
    });
    this.load.spritesheet("npc_sheet", "assets/characters/npc_spritesheet.png", {
      frameWidth: 21,
      frameHeight: 32
    });
    this.load.spritesheet("dealer_sheet", "assets/characters/dealer_spritesheet.png", {
      frameWidth: 21,
      frameHeight: 32
    });

    // Every purchasable skin - same 21x32, 3x4 layout as the base characters
    for (const skin of SKIN_CATALOG) {
      if (skin.id === "player") continue; // already loaded above as player_sheet
      this.load.spritesheet(skin.textureKey, `assets/characters/skins/${skin.textureKey}.png`, {
        frameWidth: 21,
        frameHeight: 32
      });
    }
  }

  create() {
    this.createWalkAnims("player_sheet", "player");
    this.createWalkAnims("npc_sheet", "npc");
    this.createWalkAnims("dealer_sheet", "dealer");
    for (const skin of SKIN_CATALOG) {
      if (skin.id === "player") continue;
      this.createWalkAnims(skin.textureKey, skin.id);
    }
    this.createExitDoorTexture();
    this.createMinesTexture();
    this.createDiceTexture();
    this.createLimboTexture();
    this.createPlinkoTexture();
    this.createKenoTexture();
    this.createWheelTexture();
    this.createHiLoTexture();
    this.createBaccaratTexture();
    this.createComingSoonTexture();

    this.scene.start("LoginScene");
  }

  /** A simple drawn door - replaces the earlier placeholder "sign" look. */
  private createExitDoorTexture() {
    const w = 40;
    const h = 48;
    const g = this.add.graphics();
    // door frame
    g.fillStyle(0x3a2418, 1);
    g.fillRoundedRect(0, 0, w, h, 4);
    // door panel
    g.fillStyle(0x6b4226, 1);
    g.fillRoundedRect(4, 4, w - 8, h - 8, 3);
    // panel inset lines
    g.lineStyle(2, 0x4a2e18, 1);
    g.strokeRoundedRect(9, 9, w - 18, h / 2 - 10, 2);
    g.strokeRoundedRect(9, h / 2 + 1, w - 18, h / 2 - 10, 2);
    // doorknob
    g.fillStyle(0xffd54f, 1);
    g.fillCircle(w - 11, h / 2, 2.5);
    g.generateTexture("exit_door", w, h);
    g.destroy();
  }

  /**
   * The four new-game furniture pieces below are drawn placeholders (same
   * approach as the exit door) so these games don't need to wait on real
   * tileset art to be walkable-up-to in the overworld. Swap for real sprites
   * whenever art is sourced - see README "Next steps".
   */
  private createMinesTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    g.fillStyle(0x2a2f3a, 1);
    g.fillRoundedRect(4, 10, w - 8, h - 16, 6);
    g.lineStyle(2, 0x0e1015, 1);
    g.strokeRoundedRect(4, 10, w - 8, h - 16, 6);

    g.fillStyle(0x0b0d12, 1);
    g.fillRoundedRect(9, 16, w - 18, 30, 4);

    const cell = 7;
    const gap = 2;
    const gridW = cell * 3 + gap * 2;
    const startX = w / 2 - gridW / 2;
    const startY = 20;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const isMine = r === 1 && c === 1;
        g.fillStyle(isMine ? 0xff5252 : 0x00e676, 1);
        g.fillRoundedRect(startX + c * (cell + gap), startY + r * (cell + gap), cell, cell, 1.5);
      }
    }

    g.fillStyle(0x1a1d24, 1);
    g.fillRoundedRect(10, h - 10, w - 20, 8, 3);
    g.generateTexture("mines_machine", w, h);
    g.destroy();
  }

  private createDiceTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();

    g.fillStyle(0x3a2418, 1);
    g.fillRoundedRect(10, h - 18, w - 20, 14, 3);
    g.fillStyle(0x1b5e3a, 1);
    g.fillRoundedRect(2, h - 42, w - 4, 26, 6);
    g.lineStyle(2, 0x0e1015, 1);
    g.strokeRoundedRect(2, h - 42, w - 4, 26, 6);

    this.drawDie(g, 12, h - 36, 14, 5);
    this.drawDie(g, 28, h - 30, 14, 3);

    g.generateTexture("dice_table", w, h);
    g.destroy();
  }

  /** Draws a single white die with black pips for the given face value (3 or 5 used here). */
  private drawDie(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, value: number) {
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(x, y, size, size, 3);
    g.lineStyle(1, 0x999999, 1);
    g.strokeRoundedRect(x, y, size, size, 3);

    g.fillStyle(0x1a1d24, 1);
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

    g.fillStyle(0x2a2f3a, 1);
    g.fillRoundedRect(4, 10, w - 8, h - 16, 6);
    g.lineStyle(2, 0x0e1015, 1);
    g.strokeRoundedRect(4, 10, w - 8, h - 16, 6);

    g.fillStyle(0x0b0d12, 1);
    g.fillRoundedRect(9, 16, w - 18, 30, 4);

    g.lineStyle(3, 0xffd54f, 1);
    g.beginPath();
    g.moveTo(13, 42);
    g.lineTo(24, 30);
    g.lineTo(33, 20);
    g.strokePath();
    g.fillStyle(0xffd54f, 1);
    g.fillTriangle(33, 18, 27, 22, 33, 26);

    g.fillStyle(0x1a1d24, 1);
    g.fillRoundedRect(10, h - 10, w - 20, 8, 3);
    g.generateTexture("limbo_machine", w, h);
    g.destroy();
  }

  private createPlinkoTexture() {
    const w = 64;
    const h = 64;
    const g = this.add.graphics();

    g.fillStyle(0x171a22, 1);
    g.fillRoundedRect(2, 4, w - 4, h - 18, 6);
    g.lineStyle(2, 0x2a2f3a, 1);
    g.strokeRoundedRect(2, 4, w - 4, h - 18, 6);

    g.fillStyle(0x8a92a3, 1);
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

    const slotColors = [0xff5252, 0xffd54f, 0x00e676, 0xffd54f, 0xff5252];
    const slotW = (w - 8) / slotColors.length;
    slotColors.forEach((color, i) => {
      g.fillStyle(color, 1);
      g.fillRect(4 + i * slotW, h - 24, slotW - 1, 6);
    });

    g.fillStyle(0x1a1d24, 1);
    g.fillRoundedRect(w / 2 - 10, h - 10, 20, 8, 3);
    g.generateTexture("plinko_board", w, h);
    g.destroy();
  }

  /** A small drawn "board" of numbered squares on a cabinet - stands in for a real Keno terminal sprite. */
  private createKenoTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    g.fillStyle(0x2a2f3a, 1);
    g.fillRoundedRect(4, 10, w - 8, h - 16, 6);
    g.lineStyle(2, 0x0e1015, 1);
    g.strokeRoundedRect(4, 10, w - 8, h - 16, 6);

    g.fillStyle(0x0b0d12, 1);
    g.fillRoundedRect(9, 16, w - 18, 30, 4);

    const cell = 5;
    const gap = 1.5;
    const cols = 4;
    const rows = 4;
    const gridW = cols * cell + (cols - 1) * gap;
    const gridH = rows * cell + (rows - 1) * gap;
    const startX = w / 2 - gridW / 2;
    const startY = 20;
    const highlighted = new Set([1, 3, 6, 9, 12, 14]);
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        g.fillStyle(highlighted.has(i) ? 0xffd54f : 0x00e676, 1);
        g.fillRoundedRect(startX + c * (cell + gap), startY + r * (cell + gap), cell, cell, 1);
        i++;
      }
    }

    g.fillStyle(0x1a1d24, 1);
    g.fillRoundedRect(10, h - 10, w - 20, 8, 3);
    g.generateTexture("keno_machine", w, h);
    g.destroy();
  }

  /** A small drawn segmented-wheel cabinet, cabinet-scale like keno_machine/dice_table. */
  private createWheelTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    g.fillStyle(0x2a2f3a, 1);
    g.fillRoundedRect(4, 10, w - 8, h - 16, 6);
    g.lineStyle(2, 0x0e1015, 1);
    g.strokeRoundedRect(4, 10, w - 8, h - 16, 6);

    const cx = w / 2;
    const cy = 30;
    const radius = 14;
    const colors = [0x00e676, 0xffd54f, 0xff5252, 0xffffff, 0x00e676, 0xffd54f, 0xff5252, 0xffffff];
    const slice = (Math.PI * 2) / colors.length;
    colors.forEach((color, i) => {
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, radius, i * slice, (i + 1) * slice, false);
      g.closePath();
      g.fillPath();
    });
    g.lineStyle(1.5, 0x0e1015, 1);
    g.strokeCircle(cx, cy, radius);
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(cx - 3, cy - radius - 6, cx + 3, cy - radius - 6, cx, cy - radius + 1);

    g.fillStyle(0x1a1d24, 1);
    g.fillRoundedRect(10, h - 10, w - 20, 8, 3);
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
    g.fillStyle(0x2a2f3a, 1);
    g.fillRoundedRect(4, 10, w - 8, h - 16, 6);
    g.lineStyle(2, 0x0e1015, 1);
    g.strokeRoundedRect(4, 10, w - 8, h - 16, 6);

    g.fillStyle(0x0b0d12, 1);
    g.fillRoundedRect(9, 16, w - 18, 30, 4);

    // two overlapping mini playing cards
    g.fillStyle(0xf5f2ea, 1);
    g.fillRoundedRect(14, 20, 14, 20, 2);
    g.fillRoundedRect(21, 24, 14, 20, 2);
    g.lineStyle(1, 0x0e1015, 1);
    g.strokeRoundedRect(14, 20, 14, 20, 2);
    g.strokeRoundedRect(21, 24, 14, 20, 2);

    // up/down arrow between them
    g.fillStyle(0x00e676, 1);
    g.fillTriangle(40, 22, 36, 28, 44, 28);
    g.fillStyle(0xff5252, 1);
    g.fillTriangle(40, 44, 36, 38, 44, 38);

    g.fillStyle(0x1a1d24, 1);
    g.fillRoundedRect(10, h - 10, w - 20, 8, 3);
    g.generateTexture("hilo_table", w, h);
    g.destroy();
  }

  /** A small drawn baccarat table cabinet - two mini playing cards over a felt strip, cabinet-scale like the others. */
  private createBaccaratTexture() {
    const w = 48;
    const h = 64;
    const g = this.add.graphics();
    g.fillStyle(0x2a2f3a, 1);
    g.fillRoundedRect(4, 10, w - 8, h - 16, 6);
    g.lineStyle(2, 0x0e1015, 1);
    g.strokeRoundedRect(4, 10, w - 8, h - 16, 6);

    // green felt playing surface
    g.fillStyle(0x0f3d24, 1);
    g.fillRoundedRect(9, 16, w - 18, 30, 4);
    g.lineStyle(1, 0xffd54f, 0.6);
    g.strokeRoundedRect(9, 16, w - 18, 30, 4);

    // two mini cards (player/banker)
    g.fillStyle(0xf5f2ea, 1);
    g.fillRoundedRect(13, 22, 10, 15, 2);
    g.fillRoundedRect(25, 22, 10, 15, 2);
    g.lineStyle(1, 0x0e1015, 1);
    g.strokeRoundedRect(13, 22, 10, 15, 2);
    g.strokeRoundedRect(25, 22, 10, 15, 2);
    g.fillStyle(0xc62828, 1);
    g.fillCircle(18, 29, 1.6);
    g.fillStyle(0x1a1a1a, 1);
    g.fillCircle(30, 29, 1.6);

    g.fillStyle(0x1a1d24, 1);
    g.fillRoundedRect(10, h - 10, w - 20, 8, 3);
    g.generateTexture("baccarat_table", w, h);
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
    g.fillStyle(0x3a2418, 1);
    g.fillRect(w / 2 - 4, 34, 8, 26);

    // sign board
    g.fillStyle(0xffd54f, 1);
    g.fillRoundedRect(4, 6, w - 8, 32, 6);
    g.lineStyle(2, 0x0e1015, 1);
    g.strokeRoundedRect(4, 6, w - 8, 32, 6);

    // exclamation mark
    g.fillStyle(0x1a1d24, 1);
    g.fillRoundedRect(w / 2 - 3, 12, 6, 15, 3);
    g.fillCircle(w / 2, 32, 3.2);

    g.generateTexture("coming_soon_sign", w, h);
    g.destroy();
  }

  private createWalkAnims(sheetKey: string, prefix: string) {
    // Row order in the sheet: 0=down, 1=left, 2=right, 3=up. 3 frames each.
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
