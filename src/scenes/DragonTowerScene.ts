import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";

const ROWS = 6;
const TILES_PER_ROW = 4;
// Cumulative payout multiplier after successfully clearing row i (0-indexed) - must match server/src/games/dragontower.ts's DRAGON_TOWER_MULTIPLIERS (cosmetic copy only; the server is authoritative and always returns the real number).
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

  constructor() {
    super("DragonTowerScene");
  }

  create() {
    fadeInOnCreate(this);
    this.active = false;
    this.busy = false;
    this.currentRow = 0;
    this.roundId = null;
    this.pickedColPerRow = [];
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
      Theme.goldHover,
      () => this.cashOut(),
      Theme.cardTextBlack
    );
    this.cashOutBtn.setEnabled(false);
    this.cashOutBtn.container.setVisible(false);

    this.walkAwayBtn = makeButton(this, 400, 550, 200, 36, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      this.leaveGame()
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
      // Contrast sweep: was a hardcoded 0xd9f5ec "very pale mint" left over
      // from the old light theme - the "?" label painted on top uses
      // Theme.textPrimary (near-white), which read as low-contrast
      // white-on-pale-mint. Theme.secondary (electric dark blue) keeps the
      // "distinct from locked" highlight while giving that white "?" real
      // contrast, and still pairs cleanly with the Theme.accent border below.
      active: Theme.secondary,
      safe: Theme.winZone,
      bad: Theme.loseZone
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

  /**
   * #36: the bad tile per row and the climb/cash-out math are resolved
   * server-side (POST /games/dragontower/start|pick|cashout) - this scene
   * only ever learns which tile was bad once the server's response says so
   * (a bad pick, or the round ending via cash-out/reaching the top).
   */
  private startRun() {
    if (this.active || this.busy) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Tickets!").setColor(Theme.textDanger);
      return;
    }

    const bet = gameState.betAmount;
    this.busy = true;
    this.startBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Starting...").setColor(Theme.textMuted);

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

        this.messageText.setText("Pick a tile in the glowing row").setColor(Theme.textMuted);
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
                .setColor(Theme.textDanger);
            });
          return;
        }
        this.busy = false;
        this.startBtn?.setEnabled(true);
        this.betControl?.setEnabled(true);
        this.showApiError(err, "Not enough Tickets!");
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
          this.messageText.setText("Bust! You lose your bet.").setColor(Theme.textDanger);
          this.updateBalance();
          this.endRun();
          return;
        }

        this.pickedColPerRow.push(col);
        this.currentRow = res.currentRow ?? this.currentRow + 1;
        this.multiplierText.setText(`Multiplier: ${res.multiplier}x`);
        popIn(this, this.multiplierText);

        if (res.reachedTop) {
          this.active = false;
          this.revealTower(res.badIndexPerRow ?? [], null);
          this.messageText.setText(`Reached the top! +${res.payout ?? 0} Tickets`).setColor(Theme.textAccent);
          this.updateBalance();
          this.endRun();
          return;
        }

        this.messageText.setText("Cash out or keep climbing").setColor(Theme.textMuted);
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
        this.messageText.setText(`Cashed out! +${res.payout} Tickets`).setColor(Theme.textAccent);
        this.updateBalance();
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
      this.messageText.setText(insufficientBalanceMessage).setColor(Theme.textDanger);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Theme.textDanger);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Theme.textDanger);
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
    this.balanceText.setText(`🎟️ ${gameState.goldCoins}   💰 ${gameState.stakeCoins}`);
  }
}
