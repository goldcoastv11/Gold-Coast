import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import {
  makeGameShell,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  GAME_SHELL_DISPLAY_CENTER_Y,
  popIn,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";

const GRID_SIZE = 5; // 5x5 = 25 tiles
const TOTAL_TILES = GRID_SIZE * GRID_SIZE;
const MINE_COUNT = 3;
const SAFE_TILES = TOTAL_TILES - MINE_COUNT;

const TILE_SIZE = 62;
const TILE_GAP = 8;
// Stake-style layout: grid centered in the shell's right-side display area
// (see ui/uiHelpers.ts's makeGameShell), not the old canvas center - the
// sidebar now occupies the left third of the screen.
const GRID_CENTER_Y = GAME_SHELL_DISPLAY_CENTER_Y;
const GRID_CENTER_X = GAME_SHELL_DISPLAY_CENTER_X;

interface TileVisual {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

export class MinesScene extends Phaser.Scene {
  private revealed: Set<number> = new Set();
  private picksMade = 0;
  private active = false;
  /** True while a start/pick/cash-out request is in flight - blocks further input without ending the round. */
  private busy = false;
  private roundId: string | null = null;
  private tiles: TileVisual[] = [];

  private messageText!: Phaser.GameObjects.Text;
  private multiplierText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private startBtn?: UIButton;
  private cashOutBtn?: UIButton;
  private walkAwayBtn?: UIButton;
  private betControl?: BetControl;
  private shell!: GameShellHandle;

  constructor() {
    super("MinesScene");
  }

  create() {
    fadeInOnCreate(this);
    this.active = false;
    this.busy = false;
    this.picksMade = 0;
    this.roundId = null;
    this.revealed = new Set();
    this.tiles = [];
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    // Stake-style shell: left sidebar (title/balance/bet/multiplier/
    // message/Bet-Cashout/Walk Away) + open right-side display area for
    // the grid - see ui/uiHelpers.ts's makeGameShell doc comment.
    this.shell = makeGameShell(this, "MINES", "START GAME", {
      onStart: () => this.startGame(),
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
    this.messageText.setText(`${MINE_COUNT} mines hidden among ${TOTAL_TILES} tiles - start a game`);

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
      // Contrast sweep: was the same hardcoded 0xd9f5ec "very pale mint"
      // leftover as DragonTowerScene's "active" tile (see its comment) -
      // swapped to the same Theme.secondary for a consistent, dark-theme-
      // appropriate "playable" highlight instead of another light literal.
      clickable: Theme.secondary,
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

  /**
   * #36: mine positions and the reveal/cash-out math are resolved
   * server-side (POST /games/mines/start|pick|cashout) - this scene only
   * ever knows about a tile's true contents once the server's response
   * says so (a hit-mine or a board-clear/cash-out reveal). `busy` blocks
   * further clicks while a request is in flight without ending the round,
   * distinct from `active` (round over vs round paused-on-network).
   */
  private startGame() {
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

  /**
   * Task #43: `allowRecovery` gates a single auto-retry. If the player has
   * an orphaned round from elsewhere (crash/refresh/a stale WALK AWAY that
   * didn't get to run - see leaveGame()), the server rejects this start
   * with 409 ROUND_ALREADY_ACTIVE; rather than dead-ending on that, forfeit
   * whatever's active (POST /games/abandon - see api/client.ts) and retry
   * exactly once. `allowRecovery: false` on the retry prevents a loop if
   * something is still wrong after that.
   */
  private attemptStart(bet: number, allowRecovery: boolean) {
    api
      .startMines(bet, "GC")
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.roundId = res.roundId;
        this.active = true;
        this.busy = false;
        this.picksMade = 0;
        this.revealed = new Set();

        this.messageText.setText("Pick a tile - avoid the mines").setColor(Theme.textMuted);
        this.multiplierText.setText("Multiplier: 1.00x");

        this.startBtn?.container.setVisible(false);
        this.startBtn?.setEnabled(false);
        this.cashOutBtn?.container.setVisible(false);
        this.cashOutBtn?.setEnabled(false);

        this.updateBalance();
        this.renderGridState();
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

  /**
   * Task #43: forfeits the active round (if any) before leaving, so it
   * doesn't orphan a round that would block starting any stateful game
   * later (see server/src/routes/games.ts's /games/abandon and
   * roundStore.ts's one-active-round-per-user-across-every-game rule).
   * Transitions to the overworld regardless of whether the abandon call
   * succeeds - the ROUND_ALREADY_ACTIVE auto-recovery in attemptStart() and
   * LoginScene's reconcileAndEnter() are the fallback safety nets if it
   * doesn't.
   */
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
        // Best-effort - see doc comment above.
      })
      .finally(() => fadeToScene(this, "OverworldScene"));
  }

  private renderGridState() {
    this.tiles.forEach((tile, index) => {
      tile.container.removeAllListeners();
      tile.container.disableInteractive();

      if (this.revealed.has(index)) {
        this.paintTile(tile.bg, tile.label, "gem");
      } else if (this.active && !this.busy) {
        this.paintTile(tile.bg, tile.label, "clickable");
        tile.container.setSize(TILE_SIZE, TILE_SIZE);
        tile.container.setInteractive({ useHandCursor: true });
        tile.container.on("pointerdown", () => this.pickTile(index));
      } else {
        this.paintTile(tile.bg, tile.label, this.active ? "clickable" : "hidden");
      }
    });
  }

  /** Paints every tile not already revealed-as-a-gem as a mine - used once a round ends and the server has told us where they were. */
  private revealMines(minePositions: number[]) {
    const mineSet = new Set(minePositions);
    this.tiles.forEach((tile, i) => {
      tile.container.removeAllListeners();
      tile.container.disableInteractive();
      if (mineSet.has(i)) {
        this.paintTile(tile.bg, tile.label, "mine");
      } else if (this.revealed.has(i)) {
        this.paintTile(tile.bg, tile.label, "gem");
      } else {
        this.paintTile(tile.bg, tile.label, "hidden");
      }
    });
  }

  private pickTile(index: number) {
    if (!this.active || this.busy || this.revealed.has(index) || !this.roundId) return;

    this.busy = true;
    this.renderGridState(); // repaint with clicks disabled while the request is in flight

    api
      .pickMinesTile(this.roundId, index)
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.busy = false;

        if (res.hitMine) {
          this.active = false;
          this.revealMines(res.minePositions ?? []);
          this.messageText.setText("💥 Boom! You lose your bet.").setColor(Theme.textDanger);
          this.updateBalance();
          this.endRound();
          return;
        }

        this.revealed = new Set(res.revealed ?? []);
        this.picksMade = this.revealed.size;
        this.multiplierText.setText(`Multiplier: ${res.multiplier.toFixed(2)}x`);
        popIn(this, this.multiplierText);

        if (res.boardCleared) {
          this.active = false;
          // Board cleared - the SAFE_TILES revealed tiles account for
          // everything except the mines, so we can infer their positions
          // without the server needing to send them explicitly.
          const mines = Array.from({ length: TOTAL_TILES }, (_, i) => i).filter((i) => !this.revealed.has(i));
          this.revealMines(mines);
          this.messageText.setText(`Board cleared! +${res.payout ?? 0} Tickets`).setColor(Theme.textAccent);
          this.updateBalance();
          this.endRound();
          return;
        }

        this.messageText.setText("Cash out or keep picking").setColor(Theme.textMuted);
        this.cashOutBtn?.container.setVisible(true);
        this.cashOutBtn?.setEnabled(true);
        this.renderGridState();
      })
      .catch((err) => {
        this.busy = false;
        this.renderGridState();
        this.showApiError(err, "Something went wrong - please try again.");
      });
  }

  private cashOut() {
    if (!this.active || this.busy || this.picksMade < 1 || !this.roundId) return;

    this.busy = true;
    this.cashOutBtn?.setEnabled(false);
    this.renderGridState();

    api
      .cashOutMines(this.roundId)
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.busy = false;
        this.active = false;
        this.revealMines(res.minePositions);
        this.messageText.setText(`Cashed out! +${res.payout} Tickets`).setColor(Theme.textAccent);
        this.updateBalance();
        this.endRound();
      })
      .catch((err) => {
        this.busy = false;
        this.cashOutBtn?.setEnabled(true);
        this.renderGridState();
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

  private endRound() {
    this.roundId = null;
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
    this.balanceText.setText(`🎟️ ${gameState.goldCoins}   💰 ${gameState.tickets}`);
  }
}
