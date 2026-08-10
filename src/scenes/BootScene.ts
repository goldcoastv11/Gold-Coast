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
