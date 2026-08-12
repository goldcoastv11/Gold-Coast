import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";

const GRID_SIZE = 5; // 5x5 = 25 tiles
const TOTAL_TILES = GRID_SIZE * GRID_SIZE;
const MINE_COUNT = 3;
const SAFE_TILES = TOTAL_TILES - MINE_COUNT;
const HOUSE_EDGE = 0.02; // 2%, folded into the fair multiplier below

const TILE_SIZE = 44;
const TILE_GAP = 6;
const GRID_CENTER_Y = 312;
const GRID_CENTER_X = 400;

interface TileVisual {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

/**
 * Fair cumulative multiplier for having safely revealed `picks` tiles out of
 * TOTAL_TILES with MINE_COUNT mines, then shaved by HOUSE_EDGE. Each term is
 * 1 / P(this pick is safe | previous picks were safe).
 */
function multiplierForPicks(picks: number): number {
  let m = 1;
  for (let k = 0; k < picks; k++) {
    m *= (TOTAL_TILES - k) / (SAFE_TILES - k);
  }
  return m * (1 - HOUSE_EDGE);
}

function generateMinePositions(): Set<number> {
  const indices = Array.from({ length: TOTAL_TILES }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Phaser.Math.Between(0, i);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return new Set(indices.slice(0, MINE_COUNT));
}

export class MinesScene extends Phaser.Scene {
  private minePositions: Set<number> = new Set();
  private revealed: Set<number> = new Set();
  private picksMade = 0;
  private active = false;
  private tiles: TileVisual[] = [];

  private messageText!: Phaser.GameObjects.Text;
  private multiplierText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private startBtn?: UIButton;
  private cashOutBtn?: UIButton;
  private betControl?: BetControl;
  private currentBet = 0;

  constructor() {
    super("MinesScene");
  }

  create() {
    this.active = false;
    this.picksMade = 0;
    this.minePositions = new Set();
    this.revealed = new Set();
    this.tiles = [];
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    makePanel(this, 400, 300, 480, 540);

    this.add
      .text(400, 55, "MINES", {
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
      .text(400, 172, `${MINE_COUNT} mines hidden among ${TOTAL_TILES} tiles - start a game`, {
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
      "START GAME",
      Theme.accent,
      Theme.accentHover,
      () => this.startGame()
    );
    this.cashOutBtn = makeButton(
      this,
      500,
      495,
      170,
      46,
      "CASH OUT",
      Theme.gold,
      Theme.goldHover,
      () => this.cashOut()
    );
    this.cashOutBtn.setEnabled(false);
    this.cashOutBtn.container.setVisible(false);

    makeButton(this, 400, 550, 200, 36, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      this.scene.start("OverworldScene")
    );

    this.buildEmptyGridVisuals();
    this.updateBalance();
  }

  private buildEmptyGridVisuals() {
    this.tiles.forEach((t) => t.container.destroy());
    this.tiles = [];

    const totalWidth = GRID_SIZE * TILE_SIZE + (GRID_SIZE - 1) * TILE_GAP;
    const totalHeight = GRID_SIZE * TILE_SIZE + (GRID_SIZE - 1) * TILE_GAP;
    const startX = GRID_CENTER_X - totalWidth / 2 + TILE_SIZE / 2;
    const startY = GRID_CENTER_Y - totalHeight / 2 + TILE_SIZE / 2;

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const x = startX + col * (TILE_SIZE + TILE_GAP);
        const y = startY + row * (TILE_SIZE + TILE_GAP);
        this.tiles.push(this.makeTile(x, y));
      }
    }
  }

  private makeTile(x: number, y: number): TileVisual {
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    const label = this.add.text(0, 0, "", { fontSize: "18px" }).setOrigin(0.5);
    container.add([bg, label]);
    this.paintTile(bg, label, "hidden");
    return { container, bg, label };
  }

  private paintTile(
    bg: Phaser.GameObjects.Graphics,
    label: Phaser.GameObjects.Text,
    state: "hidden" | "clickable" | "gem" | "mine"
  ) {
    bg.clear();
    const colors = {
      hidden: Theme.inset,
      clickable: 0xd9f5ec, // very pale mint - playable, not yet revealed
      gem: Theme.winZone,
      mine: Theme.loseZone
    };
    const border = {
      hidden: Theme.panelBorder,
      clickable: Theme.accent,
      gem: Theme.accent,
      mine: Theme.danger
    };
    bg.fillStyle(colors[state], 1);
    bg.fillRoundedRect(-TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE, 8);
    bg.lineStyle(2, border[state], 1);
    bg.strokeRoundedRect(-TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE, 8);

    if (state === "gem") label.setText("💎").setColor(Theme.textAccent);
    else if (state === "mine") label.setText("💣").setColor(Theme.textDanger);
    else label.setText("").setColor(Theme.textMuted);
  }

  private startGame() {
    if (this.active) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    this.currentBet = gameState.betAmount;
    gameState.goldCoins -= this.currentBet;
    this.updateBalance();

    this.active = true;
    this.picksMade = 0;
    this.revealed = new Set();
    this.minePositions = generateMinePositions();

    this.messageText.setText("Pick a tile - avoid the mines").setColor(Theme.textMuted);
    this.multiplierText.setText("Multiplier: 1.00x");

    this.startBtn?.container.setVisible(false);
    this.startBtn?.setEnabled(false);
    this.cashOutBtn?.container.setVisible(false);
    this.cashOutBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);

    this.renderGridState();
  }

  private renderGridState() {
    this.tiles.forEach((tile, index) => {
      tile.container.removeAllListeners();
      tile.container.disableInteractive();

      if (this.revealed.has(index)) {
        this.paintTile(tile.bg, tile.label, "gem");
      } else if (this.active) {
        this.paintTile(tile.bg, tile.label, "clickable");
        tile.container.setSize(TILE_SIZE, TILE_SIZE);
        tile.container.setInteractive({ useHandCursor: true });
        tile.container.on("pointerdown", () => this.pickTile(index));
      } else {
        this.paintTile(tile.bg, tile.label, "hidden");
      }
    });
  }

  private pickTile(index: number) {
    if (!this.active || this.revealed.has(index)) return;

    if (this.minePositions.has(index)) {
      // reveal the whole board so the player can see what they hit/avoided
      this.tiles.forEach((tile, i) => {
        tile.container.removeAllListeners();
        tile.container.disableInteractive();
        if (this.minePositions.has(i)) {
          this.paintTile(tile.bg, tile.label, "mine");
        } else if (this.revealed.has(i)) {
          this.paintTile(tile.bg, tile.label, "gem");
        } else {
          this.paintTile(tile.bg, tile.label, "hidden");
        }
      });
      this.active = false;
      this.messageText.setText("💥 Boom! You lose your bet.").setColor(Theme.textDanger);
      this.endRound();
      return;
    }

    this.revealed.add(index);
    this.picksMade++;
    const multiplier = multiplierForPicks(this.picksMade);
    this.multiplierText.setText(`Multiplier: ${multiplier.toFixed(2)}x`);
    popIn(this, this.multiplierText);

    if (this.picksMade >= SAFE_TILES) {
      // cleared the whole board - auto cash out
      this.active = false;
      const payout = Math.round(this.currentBet * multiplier);
      gameState.goldCoins += payout;
      this.messageText.setText(`Board cleared! +${payout} GC`).setColor(Theme.textAccent);
      this.updateBalance();
      this.renderGridState();
      this.endRound();
      return;
    }

    this.messageText.setText("Cash out or keep picking").setColor(Theme.textMuted);
    this.cashOutBtn?.container.setVisible(true);
    this.cashOutBtn?.setEnabled(true);
    this.renderGridState();
  }

  private cashOut() {
    if (!this.active || this.picksMade < 1) return;

    const multiplier = multiplierForPicks(this.picksMade);
    const payout = Math.round(this.currentBet * multiplier);
    gameState.goldCoins += payout;
    this.updateBalance();
    this.messageText.setText(`Cashed out! +${payout} GC`).setColor(Theme.textAccent);
    this.active = false;
    this.renderGridState();
    this.endRound();
  }

  private endRound() {
    this.cashOutBtn?.container.setVisible(false);
    this.cashOutBtn?.setEnabled(false);
    this.startBtn?.container.setVisible(true);
    this.startBtn?.setEnabled(true);
    this.startBtn?.setLabel("NEW GAME");
    this.betControl?.setEnabled(true);

    this.tiles.forEach((t) => {
      t.container.removeAllListeners();
      t.container.disableInteractive();
    });
  }

  private updateBalance() {
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
