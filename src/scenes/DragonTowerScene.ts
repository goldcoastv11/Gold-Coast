import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Tokens } from "../ui/DesignTokens";
import {
  makeText,
  makeGameShell,
  formatBalance,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  GAME_SHELL_DISPLAY_CENTER_Y,
  popIn,
  drawCabinetFrame,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";

const ROWS = 6;
const TILES_PER_ROW = 4;
// Cumulative payout multiplier after successfully clearing row i (0-indexed) - must match server/src/games/dragontower.ts's DRAGON_TOWER_MULTIPLIERS (cosmetic copy only; the server is authoritative and always returns the real number).
const MULTIPLIERS = [1.3, 1.8, 2.7, 4, 7, 12];

const TILE_SIZE = 46;
const TILE_GAP = Tokens.space.sm;
const ROW_SPACING = 56;
/** Horizontal breathing room either side of the 4-wide tower, on the token scale. */
const BOARD_SIDE_PAD = Tokens.space.huge * 4;
// Stake-style layout: tower centered in the shell's right-side display
// area (see ui/uiHelpers.ts's makeGameShell) - the sidebar now occupies
// the left third of the screen, so this is no longer the canvas center.
const TOWER_CENTER_X = GAME_SHELL_DISPLAY_CENTER_X;
const BOTTOM_ROW_Y = GAME_SHELL_DISPLAY_CENTER_Y + (ROWS - 1) * (ROW_SPACING / 2);

interface TileVisual {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

type TileState = "locked" | "active" | "safe" | "bad";

/**
 * DRAGON TOWER step states, on the Stake-style direction - the same
 * surface-only treatment MinesScene uses, so the two grid games read as one
 * family. A locked step is a recessed well, the live row is a raised
 * control, and a resolved step takes one of the two muted state tints; the
 * outcome is spoken by the glyph, not by a coloured border.
 */
const TILE_FILL: Record<TileState, number> = {
  locked: Tokens.color.inset,
  active: Tokens.color.surfaceRaised,
  safe: Tokens.color.positiveMuted,
  bad: Tokens.color.negativeMuted
};

export class DragonTowerScene extends Phaser.Scene {
  private currentRow = 0;
  private active = false;
  /** True while a start/pick/cash-out request is in flight - blocks further input without ending the run. */
  private busy = false;
  private roundId: string | null = null;
  /** Column picked at each cleared row so far - remembered client-side purely to redraw a "safe" mark on those tiles once the round ends and badIndexPerRow is revealed (the server never needs this back). */
  private pickedColPerRow: number[] = [];
  private tiles: TileVisual[][] = [];

  private messageText!: Phaser.GameObjects.Text;
  private multiplierText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private startBtn?: UIButton;
  private cashOutBtn?: UIButton;
  private walkAwayBtn?: UIButton;
  private betControl?: BetControl;
  private shell!: GameShellHandle;

  constructor() {
    super("DragonTowerScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "retroBeat");
    this.active = false;
    this.busy = false;
    this.currentRow = 0;
    this.roundId = null;
    this.pickedColPerRow = [];
    this.tiles = [];
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    // Stake-style shell - see MinesScene.create()/ui/uiHelpers.ts's
    // makeGameShell doc comment.
    this.shell = makeGameShell(this, "DRAGON TOWER", "START RUN", {
      onStart: () => this.startRun(),
      onCashOut: () => this.cashOut(),
      onWalkAway: () => this.leaveGame()
    });
    this.balanceText = this.shell.balanceText;
    this.multiplierText = this.shell.multiplierText;
    this.messageText = this.shell.messageText;
    this.startBtn = this.shell.startBtn;
    this.cashOutBtn = this.shell.cashOutBtn;
    this.walkAwayBtn = this.shell.walkAwayBtn;
    this.betControl = this.shell.betControl;
    this.messageText.setText("Start a run to climb the tower");

    // Cabinet frame - generous horizontal padding (there's plenty of spare
    // width either side of the 4-wide tower), minimal vertical padding
    // (the tower's own 6 rows already run close to the mobile-landscape
    // safe zone's top/bottom edges - see uiHelpers.ts's
    // SAFE_ZONE_TOP/BOTTOM).
    const towerW = TILES_PER_ROW * TILE_SIZE + (TILES_PER_ROW - 1) * TILE_GAP;
    const towerH = (ROWS - 1) * ROW_SPACING + TILE_SIZE;
    drawCabinetFrame(
      this,
      TOWER_CENTER_X,
      BOTTOM_ROW_Y - (ROWS - 1) * (ROW_SPACING / 2),
      towerW + BOARD_SIDE_PAD,
      towerH + Tokens.space.sm
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
      const startX = TOWER_CENTER_X - totalWidth / 2 + TILE_SIZE / 2;

      for (let col = 0; col < TILES_PER_ROW; col++) {
        const x = startX + col * (TILE_SIZE + TILE_GAP);
        rowTiles.push(this.makeTile(x, y, "locked"));
      }
      this.tiles.push(rowTiles);
    }
  }

  private makeTile(x: number, y: number, state: TileState): TileVisual {
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    const label = makeText(this, 0, 0, "", {
      size: Tokens.type.glyph.sm,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });
    container.add([bg, label]);
    this.paintTile(bg, label, state);
    return { container, bg, label };
  }

  private paintTile(bg: Phaser.GameObjects.Graphics, label: Phaser.GameObjects.Text, state: TileState) {
    this.fillTile(bg, TILE_FILL[state]);

    if (state === "safe") label.setText("✓").setColor(Tokens.text.accent);
    else if (state === "bad") label.setText("💥").setColor(Tokens.text.negative);
    else if (state === "active") label.setText("?").setColor(Tokens.text.primary);
    else label.setText("").setColor(Tokens.text.muted);
  }

  private fillTile(bg: Phaser.GameObjects.Graphics, fill: number) {
    bg.clear();
    bg.fillStyle(fill, 1);
    bg.fillRoundedRect(-TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE, Tokens.radius.sm);
  }

  /**
   * #36: the bad tile per row and the climb/cash-out math are resolved
   * server-side (POST /games/dragontower/start|pick|cashout) - this scene
   * only ever learns which tile was bad once the server's response says so
   * (a bad pick, or the round ending via cash-out/reaching the top).
   */
  private startRun() {
    if (this.active || this.busy) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    const bet = gameState.betAmount;
    this.busy = true;
    this.startBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Starting...").setColor(Tokens.text.muted);

    this.attemptStart(bet, true);
  }

  /** Task #43: see MinesScene.attemptStart's doc comment - same one-retry ROUND_ALREADY_ACTIVE recovery pattern. */
  private attemptStart(bet: number, allowRecovery: boolean) {
    api
      .startDragonTower(bet, "GC")
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.roundId = res.roundId;
        this.active = true;
        this.busy = false;
        this.currentRow = 0;
        this.pickedColPerRow = [];

        this.messageText.setText("Pick a tile in the glowing row").setColor(Tokens.text.muted);
        this.multiplierText.setText("Multiplier: 1.0x");

        this.startBtn?.container.setVisible(false);
        this.startBtn?.setEnabled(false);
        this.cashOutBtn?.container.setVisible(false);
        this.cashOutBtn?.setEnabled(false);

        this.updateBalance();
        this.renderTowerState();
      })
      .catch((err) => {
        if (allowRecovery && err instanceof ApiError && err.code === "ROUND_ALREADY_ACTIVE") {
          api
            .abandonRound()
            .then((abandonRes) => {
              gameState.hydrateFromServer(abandonRes.user);
              this.attemptStart(bet, false);
            })
            .catch(() => {
              this.busy = false;
              this.startBtn?.setEnabled(true);
              this.betControl?.setEnabled(true);
              this.messageText
                .setText("Couldn't recover an unfinished round - please try again.")
                .setColor(Tokens.text.negative);
            });
          return;
        }
        this.busy = false;
        this.startBtn?.setEnabled(true);
        this.betControl?.setEnabled(true);
        this.showApiError(err, "Not enough Gold Coins!");
      });
  }

  /** Task #43: see MinesScene.leaveGame's doc comment - same forfeit-before-leaving pattern. */
  private leaveGame() {
    if (!this.active) {
      fadeToScene(this, "OverworldScene");
      return;
    }
    this.walkAwayBtn?.setEnabled(false);
    this.startBtn?.setEnabled(false);
    this.cashOutBtn?.setEnabled(false);
    api
      .abandonRound()
      .then((res) => gameState.hydrateFromServer(res.user))
      .catch(() => {
        // Best-effort - see MinesScene.leaveGame's doc comment.
      })
      .finally(() => fadeToScene(this, "OverworldScene"));
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
        } else if (row === this.currentRow && this.active && !this.busy) {
          this.paintTile(tile.bg, tile.label, "active");
          tile.container.setSize(TILE_SIZE, TILE_SIZE);
          tile.container.setInteractive({ useHandCursor: true });
          // Hover lifts one surface step - same affordance as every button.
          tile.container.on("pointerover", () => this.fillTile(tile.bg, Tokens.color.surfaceHover));
          tile.container.on("pointerout", () => this.fillTile(tile.bg, TILE_FILL.active));
          tile.container.on("pointerdown", () => this.pickTile(col));
        } else if (row === this.currentRow && this.active) {
          this.paintTile(tile.bg, tile.label, "active");
        } else {
          this.paintTile(tile.bg, tile.label, "locked");
        }
      }
    }
  }

  /** Reveals the full tower once a run has ended (bust, cash-out, or reached the top) - marks each row's true bad column, and "safe" on whichever column was actually picked for rows successfully cleared. */
  private revealTower(badIndexPerRow: number[], bustedRow: number | null) {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < TILES_PER_ROW; col++) {
        const tile = this.tiles[row][col];
        tile.container.removeAllListeners();
        tile.container.disableInteractive();

        const clearedThisRow = row < this.pickedColPerRow.length;
        const isBustRow = bustedRow !== null && row === bustedRow;

        if (clearedThisRow || isBustRow) {
          this.paintTile(tile.bg, tile.label, col === badIndexPerRow[row] ? "bad" : "safe");
        } else {
          this.paintTile(tile.bg, tile.label, "locked");
        }
      }
    }
  }

  private pickTile(col: number) {
    if (!this.active || this.busy || !this.roundId) return;

    this.busy = true;
    this.renderTowerState(); // repaint with clicks disabled while the request is in flight

    api
      .pickDragonTowerTile(this.roundId, col)
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.busy = false;

        if (res.isBad) {
          this.active = false;
          this.revealTower(res.badIndexPerRow ?? [], this.currentRow);
          this.messageText.setText("Bust! You lose your bet.").setColor(Tokens.text.negative);
          playSfx(this, "bust");
          playSfx(this, "lose");
          this.updateBalance();
          this.endRun();
          return;
        }

        // Pop the tile that was just cleared before currentRow advances -
        // renderTowerState()/revealTower() below repaint every tile every
        // call, so this has to target the one real tile here, using the
        // still-current row/col (the same pattern MinesScene.pickTile uses).
        const clearedTile = this.tiles[this.currentRow]?.[col];
        if (clearedTile) popIn(this, clearedTile.container);

        this.pickedColPerRow.push(col);
        this.currentRow = res.currentRow ?? this.currentRow + 1;
        this.multiplierText.setText(`Multiplier: ${res.multiplier}x`);
        popIn(this, this.multiplierText);
        playSfx(this, "reveal");

        if (res.reachedTop) {
          this.active = false;
          this.revealTower(res.badIndexPerRow ?? [], null);
          this.messageText.setText(`Reached the top! +${res.payout ?? 0} Tickets`).setColor(Tokens.text.accent);
          this.updateBalance();
          showWinCelebration(this, res.payout ?? 0);
          this.endRun();
          return;
        }

        this.messageText.setText("Cash out or keep climbing").setColor(Tokens.text.muted);
        this.cashOutBtn?.container.setVisible(true);
        this.cashOutBtn?.setEnabled(true);
        this.renderTowerState();
      })
      .catch((err) => {
        this.busy = false;
        this.renderTowerState();
        this.showApiError(err, "Something went wrong - please try again.");
      });
  }

  private cashOut() {
    if (!this.active || this.busy || this.currentRow < 1 || !this.roundId) return;

    this.busy = true;
    this.cashOutBtn?.setEnabled(false);
    this.renderTowerState();

    api
      .cashOutDragonTower(this.roundId)
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.busy = false;
        this.active = false;
        this.revealTower(res.badIndexPerRow, null);
        this.messageText.setText(`Cashed out! +${res.payout} Tickets`).setColor(Tokens.text.accent);
        this.updateBalance();
        showWinCelebration(this, res.payout);
        this.endRun();
      })
      .catch((err) => {
        this.busy = false;
        this.cashOutBtn?.setEnabled(true);
        this.renderTowerState();
        this.showApiError(err, "Something went wrong - please try again.");
      });
  }

  private showApiError(err: unknown, insufficientBalanceMessage: string) {
    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText(insufficientBalanceMessage).setColor(Tokens.text.negative);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
    }
  }

  private endRun() {
    this.roundId = null;
    this.cashOutBtn?.container.setVisible(false);
    this.cashOutBtn?.setEnabled(false);
    this.startBtn?.container.setVisible(true);
    this.startBtn?.setEnabled(true);
    this.startBtn?.setLabel("NEW RUN");
    this.betControl?.setEnabled(true);

    this.tiles.forEach((row) =>
      row.forEach((t) => {
        t.container.removeAllListeners();
        t.container.disableInteractive();
      })
    );
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins, gameState.tickets));
  }
}
