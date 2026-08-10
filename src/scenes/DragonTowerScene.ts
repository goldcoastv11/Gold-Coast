import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";

const ROWS = 6;
const TILES_PER_ROW = 4;
// Cumulative payout multiplier after successfully clearing row i (0-indexed)
const MULTIPLIERS = [1.3, 1.8, 2.7, 4, 7, 12];

const TILE_SIZE = 38;
const TILE_GAP = 8;
const ROW_SPACING = 46;
const BOTTOM_ROW_Y = 444;

interface TileVisual {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

export class DragonTowerScene extends Phaser.Scene {
  private badIndexPerRow: number[] = [];
  private currentRow = 0;
  private active = false;
  private tiles: TileVisual[][] = [];

  private messageText!: Phaser.GameObjects.Text;
  private multiplierText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private startBtn?: UIButton;
  private cashOutBtn?: UIButton;
  private betControl?: BetControl;
  private currentBet = 0;

  constructor() {
    super("DragonTowerScene");
  }

  create() {
    this.active = false;
    this.currentRow = 0;
    this.badIndexPerRow = [];
    this.tiles = [];
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    makePanel(this, 400, 300, 480, 540);

    this.add
      .text(400, 55, "DRAGON TOWER", {
        fontSize: "26px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    makeInset(this, 400, 88, 380, 30, 15);
    this.balanceText = this.add
      .text(400, 88, "", { fontSize: "13px", color: Theme.textPrimary })
      .setOrigin(0.5);

    this.betControl = makeBetControl(this, 400, 120, () => {});

    this.multiplierText = this.add
      .text(400, 150, "", { fontSize: "16px", color: Theme.textGold, fontStyle: "bold" })
      .setOrigin(0.5);

    this.messageText = this.add
      .text(400, 172, "Start a run to climb the tower", {
        fontSize: "13px",
        color: Theme.textMuted
      })
      .setOrigin(0.5);

    this.startBtn = makeButton(
      this,
      300,
      495,
      170,
      46,
      "START RUN",
      Theme.accent,
      Theme.accentHover,
      () => this.startRun()
    );
    this.cashOutBtn = makeButton(
      this,
      500,
      495,
      170,
      46,
      "CASH OUT",
      Theme.gold,
      0xffe082,
      () => this.cashOut()
    );
    this.cashOutBtn.setEnabled(false);
    this.cashOutBtn.container.setVisible(false);

    makeButton(this, 400, 550, 200, 36, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      this.scene.start("OverworldScene")
    );

    this.buildEmptyTowerVisuals();
    this.updateBalance();
  }

  /** Draws the tower grid in its "no active run" locked state. */
  private buildEmptyTowerVisuals() {
    this.tiles.forEach((row) => row.forEach((t) => t.container.destroy()));
    this.tiles = [];

    for (let row = 0; row < ROWS; row++) {
      const rowTiles: TileVisual[] = [];
      const y = BOTTOM_ROW_Y - row * ROW_SPACING;
      const totalWidth = TILES_PER_ROW * TILE_SIZE + (TILES_PER_ROW - 1) * TILE_GAP;
      const startX = 400 - totalWidth / 2 + TILE_SIZE / 2;

      for (let col = 0; col < TILES_PER_ROW; col++) {
        const x = startX + col * (TILE_SIZE + TILE_GAP);
        rowTiles.push(this.makeTile(x, y, "locked"));
      }
      this.tiles.push(rowTiles);
    }
  }

  private makeTile(
    x: number,
    y: number,
    state: "locked" | "active" | "safe" | "bad"
  ): TileVisual {
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    const label = this.add.text(0, 0, "", { fontSize: "18px" }).setOrigin(0.5);
    container.add([bg, label]);
    this.paintTile(bg, label, state);
    return { container, bg, label };
  }

  private paintTile(
    bg: Phaser.GameObjects.Graphics,
    label: Phaser.GameObjects.Text,
    state: "locked" | "active" | "safe" | "bad"
  ) {
    bg.clear();
    const colors = {
      locked: Theme.inset,
      active: 0x1e2530,
      safe: 0x1b5e3a,
      bad: 0x7a1f1f
    };
    const border = {
      locked: Theme.panelBorder,
      active: Theme.accent,
      safe: Theme.accent,
      bad: Theme.danger
    };
    bg.fillStyle(colors[state], 1);
    bg.fillRoundedRect(-TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE, 8);
    bg.lineStyle(2, border[state], 1);
    bg.strokeRoundedRect(-TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE, 8);

    if (state === "safe") label.setText("✓").setColor(Theme.textAccent);
    else if (state === "bad") label.setText("💥").setColor(Theme.textDanger);
    else if (state === "active") label.setText("?").setColor(Theme.textPrimary);
    else label.setText("").setColor(Theme.textMuted);
  }

  private startRun() {
    if (this.active) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    this.currentBet = gameState.betAmount;
    gameState.goldCoins -= this.currentBet;
    this.updateBalance();

    this.active = true;
    this.currentRow = 0;
    this.badIndexPerRow = Array.from({ length: ROWS }, () =>
      Phaser.Math.Between(0, TILES_PER_ROW - 1)
    );

    this.messageText.setText("Pick a tile in the glowing row").setColor(Theme.textMuted);
    this.multiplierText.setText("Multiplier: 1.0x");

    this.startBtn?.container.setVisible(false);
    this.startBtn?.setEnabled(false);
    this.cashOutBtn?.container.setVisible(false);
    this.cashOutBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);

    this.renderTowerState();
  }

  /** Repaints every tile according to current run state, and wires up clicks for the active row. */
  private renderTowerState() {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < TILES_PER_ROW; col++) {
        const tile = this.tiles[row][col];
        tile.container.removeAllListeners();
        tile.container.disableInteractive();

        if (row < this.currentRow) {
          this.paintTile(tile.bg, tile.label, "safe");
        } else if (row === this.currentRow && this.active) {
          this.paintTile(tile.bg, tile.label, "active");
          tile.container.setSize(TILE_SIZE, TILE_SIZE);
          tile.container.setInteractive({ useHandCursor: true });
          tile.container.on("pointerdown", () => this.pickTile(col));
        } else {
          this.paintTile(tile.bg, tile.label, "locked");
        }
      }
    }
  }

  private pickTile(col: number) {
    if (!this.active) return;

    const row = this.currentRow;
    const isBad = col === this.badIndexPerRow[row];

    // Reveal the whole row so the player can see what they avoided/hit
    for (let c = 0; c < TILES_PER_ROW; c++) {
      const tile = this.tiles[row][c];
      tile.container.disableInteractive();
      this.paintTile(tile.bg, tile.label, c === this.badIndexPerRow[row] ? "bad" : "safe");
    }

    if (isBad) {
      this.active = false;
      this.messageText.setText("Bust! You lose your bet.").setColor(Theme.textDanger);
      this.endRun();
      return;
    }

    this.currentRow++;
    const multiplier = MULTIPLIERS[this.currentRow - 1];
    this.multiplierText.setText(`Multiplier: ${multiplier}x`);
    popIn(this, this.multiplierText);

    if (this.currentRow >= ROWS) {
      // reached the top - auto cash out
      this.active = false;
      const payout = Math.round(this.currentBet * multiplier);
      gameState.goldCoins += payout;
      this.messageText.setText(`Reached the top! +${payout} GC`).setColor(Theme.textAccent);
      this.updateBalance();
      this.endRun();
      return;
    }

    this.messageText.setText("Cash out or keep climbing").setColor(Theme.textMuted);
    this.cashOutBtn?.container.setVisible(true);
    this.cashOutBtn?.setEnabled(true);
    this.renderTowerState();
  }

  private cashOut() {
    if (!this.active || this.currentRow < 1) return;

    const multiplier = MULTIPLIERS[this.currentRow - 1];
    const payout = Math.round(this.currentBet * multiplier);
    gameState.goldCoins += payout;
    this.updateBalance();
    this.messageText.setText(`Cashed out! +${payout} GC`).setColor(Theme.textAccent);
    this.active = false;
    this.endRun();
  }

  private endRun() {
    this.cashOutBtn?.container.setVisible(false);
    this.cashOutBtn?.setEnabled(false);
    this.startBtn?.container.setVisible(true);
    this.startBtn?.setEnabled(true);
    this.startBtn?.setLabel("NEW RUN");
    this.betControl?.setEnabled(true);

    // lock out any remaining interactive tiles
    this.tiles.forEach((row) =>
      row.forEach((t) => {
        t.container.removeAllListeners();
        t.container.disableInteractive();
      })
    );
  }

  private updateBalance() {
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
