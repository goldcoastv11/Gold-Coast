import Phaser from "phaser";
import { embeddedGame, loungePresentation } from "../mobile/arcadeBridge";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Tokens } from "../ui/DesignTokens";
import {
  makeButton,
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
import { track, EVENTS } from "../api/track";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";
import { createQuickplayStage, drawManualAuto, drawQuickLabel, drawQuickReadout, makeQuickBackButton, makeQuickBetControl } from "../ui/quickplayGameUi";

const GRID_SIZE = 5; // 5x5 = 25 tiles
const TOTAL_TILES = GRID_SIZE * GRID_SIZE;
const MINE_COUNT = 3;
const SAFE_TILES = TOTAL_TILES - MINE_COUNT;

const TILE_SIZE = 62;
const TILE_GAP = Tokens.space.sm;
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

type TileState = "hidden" | "clickable" | "gem" | "mine";

/**
 * MINES tile states, on the Stake-style direction (see ui/DesignTokens.ts).
 *
 * Every tile used to be a fill PLUS a 2px coloured outline, so the grid read
 * as 25 boxed cells. Here a tile is a bare surface and nothing else: an
 * un-started tile is a recessed well, a playable tile is a raised control,
 * and a resolved tile takes one of the two muted state tints. What a
 * resolved tile MEANS is carried by its glyph and that glyph's colour - so
 * the saturated accent stays reserved for the primary action and the win
 * state (direction note 2), and no stroke boxes anything in (note 3).
 */
const TILE_FILL: Record<TileState, number> = {
  hidden: Tokens.color.inset,
  clickable: Tokens.color.surfaceRaised,
  gem: Tokens.color.positiveMuted,
  mine: Tokens.color.negativeMuted
};

export class MinesScene extends Phaser.Scene {
  private revealed: Set<number> = new Set();
  private picksMade = 0;
  private active = false;
  /** True while a start/pick/cash-out request is in flight - blocks further input without ending the round. */
  private busy = false;
  private roundId: string | null = null;
  /** Gold Coins staked on the round currently in play - kept so endRound() can report the round's real stake (see its doc comment). */
  private roundBet = 0;
  private tiles: TileVisual[] = [];

  private messageText!: Phaser.GameObjects.Text;
  private multiplierText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private startBtn?: UIButton;
  private cashOutBtn?: UIButton;
  private walkAwayBtn?: UIButton;
  private betControl?: BetControl;
  private shell!: GameShellHandle;
  private directQuickplay = false;
  private gridCenterX = GRID_CENTER_X;
  private gridCenterY = GRID_CENTER_Y;
  private tileSize: number = TILE_SIZE;
  private tileGap: number = TILE_GAP;
  private selectedMineCount = MINE_COUNT;

  constructor() {
    super("MinesScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "retroMystic");
    this.active = false;
    this.busy = false;
    this.picksMade = 0;
    this.roundId = null;
    this.revealed = new Set();
    this.tiles = [];
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    this.directQuickplay = !!embeddedGame() && !loungePresentation();
    if (this.directQuickplay) {
      this.scale.once("resize", () => this.scene.restart());
      this.createDirectQuickplayLayout();
      this.buildEmptyGridVisuals();
      this.updateBalance();
      return;
    }

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

    // Cabinet frame hugs the grid's exact height (it already sits right at
    // the mobile-landscape safe zone's top/bottom edges - see
    // uiHelpers.ts's SAFE_ZONE_TOP/BOTTOM - so no vertical padding is added,
    // only horizontal, which has plenty of spare room).
    const gridSpan = GRID_SIZE * TILE_SIZE + (GRID_SIZE - 1) * TILE_GAP;
    drawCabinetFrame(this, GRID_CENTER_X, GRID_CENTER_Y, gridSpan + Tokens.space.huge, gridSpan);

    this.buildEmptyGridVisuals();
    this.updateBalance();
  }

  private createDirectQuickplayLayout() {
    const stage = createQuickplayStage(this);
    drawManualAuto(this, stage);
    drawQuickLabel(this, stage, 61, "AMOUNT");
    this.balanceText = makeText(this, stage.right, stage.top + 61, "", { size: Tokens.type.size.xs, color: Tokens.text.muted, align: "right", originX: 1 }).setScrollFactor(0);
    this.betControl = makeQuickBetControl(this, stage, 89);
    drawQuickReadout(this, stage, 120, "MINES", String(this.selectedMineCount));
    makeText(this, stage.right - Tokens.space.md, stage.top + 150, "⌄", { size: Tokens.type.size.lg, color: Tokens.text.primary, align: "right", originX: 1, originY: 0.5 }).setScrollFactor(0);
    this.add.zone(stage.controls.x + stage.controls.w / 2, stage.top + 150, stage.contentW, 40).setScrollFactor(0).setInteractive({ useHandCursor: true }).on("pointerup", () => this.showMineCountMenu(stage));
    drawQuickReadout(this, stage, 191, "GEMS", String(TOTAL_TILES - this.selectedMineCount));

    this.startBtn = makeButton(this, stage.controls.x + stage.controls.w / 2, stage.top + 270, stage.contentW, 44, "PLAY", Tokens.color.info, Tokens.color.infoHover, () => this.startGame(), Tokens.text.primary, Tokens.radius.md);
    this.cashOutBtn = makeButton(this, stage.controls.x + stage.controls.w / 2, stage.top + 322, stage.contentW, 44, "CASH OUT", Tokens.color.accent, Tokens.color.accentHover, () => this.cashOut(), Tokens.text.onAccent, Tokens.radius.md);
    this.cashOutBtn.container.setVisible(false);
    this.cashOutBtn.setEnabled(false);
    drawQuickLabel(this, stage, 360, "TOTAL NET GAIN");
    const gainBg = this.add.graphics().setScrollFactor(0);
    gainBg.fillStyle(Tokens.color.inset, 1).fillRoundedRect(stage.left, stage.top + 376, stage.contentW, 40, Tokens.radius.md);
    gainBg.lineStyle(1, Tokens.color.hairline, 1).strokeRoundedRect(stage.left, stage.top + 376, stage.contentW, 40, Tokens.radius.md);
    this.multiplierText = makeText(this, stage.left + Tokens.space.md, stage.top + 396, "Multiplier: 1.00x", { size: Tokens.type.size.sm, weight: Tokens.type.weight.semibold, color: Tokens.text.primary, originY: 0.5 }).setScrollFactor(0);
    this.messageText = makeText(this, stage.left, stage.top + 432, `${this.selectedMineCount} mines hidden among ${TOTAL_TILES} tiles`, { size: Tokens.type.size.xs, color: Tokens.text.muted, wordWrapWidth: stage.contentW, originY: 0 }).setScrollFactor(0);
    this.walkAwayBtn = makeQuickBackButton(this, stage, () => this.leaveGame());
    for (const button of [this.startBtn, this.cashOutBtn]) button.container.setScrollFactor(0);

    this.gridCenterX = stage.board.x + stage.board.w / 2;
    this.gridCenterY = stage.board.y + stage.board.h / 2;
    this.tileGap = Math.max(8, Math.min(12, stage.board.w / 70));
    this.tileSize = Math.min(76, (stage.board.w - 72 - this.tileGap * 4) / GRID_SIZE, (stage.board.h - 72 - this.tileGap * 4) / GRID_SIZE);
  }

  private showMineCountMenu(stage: ReturnType<typeof createQuickplayStage>) {
    if (this.active || this.busy) return;
    const values = [1, 3, 5, 10, 15, 20, 24];
    const menu = this.add.container(0, 0).setDepth(2200).setScrollFactor(0);
    const rowH = 32;
    const top = stage.top + 172;
    const panel = this.add.graphics();
    panel.fillStyle(Tokens.color.surfaceRaised, 1).fillRoundedRect(stage.left, top, stage.contentW, rowH * values.length, Tokens.radius.md);
    panel.lineStyle(1, Tokens.color.hairline, 1).strokeRoundedRect(stage.left, top, stage.contentW, rowH * values.length, Tokens.radius.md);
    menu.add(panel);
    values.forEach((value, index) => {
      const y = top + index * rowH;
      if (index) panel.lineStyle(1, Tokens.color.hairline, 0.7).lineBetween(stage.left, y, stage.right, y);
      menu.add(makeText(this, stage.left + Tokens.space.md, y + rowH / 2, `${value} mines`, { size: Tokens.type.size.sm, weight: value === this.selectedMineCount ? Tokens.type.weight.bold : Tokens.type.weight.semibold, color: value === this.selectedMineCount ? Tokens.text.accent : Tokens.text.primary, originY: 0.5 }));
      menu.add(makeText(this, stage.right - Tokens.space.md, y + rowH / 2, `${TOTAL_TILES - value} gems`, { size: Tokens.type.size.xs, color: Tokens.text.secondary, align: "right", originX: 1, originY: 0.5 }));
      const hit = this.add.zone(stage.controls.x + stage.controls.w / 2, y + rowH / 2, stage.contentW, rowH).setInteractive({ useHandCursor: true });
      hit.on("pointerup", () => { this.selectedMineCount = value; this.scene.restart(); });
      menu.add(hit);
    });
  }

  private buildEmptyGridVisuals() {
    this.tiles.forEach((t) => t.container.destroy());
    this.tiles = [];

    const totalWidth = GRID_SIZE * this.tileSize + (GRID_SIZE - 1) * this.tileGap;
    const totalHeight = GRID_SIZE * this.tileSize + (GRID_SIZE - 1) * this.tileGap;
    const startX = this.gridCenterX - totalWidth / 2 + this.tileSize / 2;
    const startY = this.gridCenterY - totalHeight / 2 + this.tileSize / 2;

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const x = startX + col * (this.tileSize + this.tileGap);
        const y = startY + row * (this.tileSize + this.tileGap);
        this.tiles.push(this.makeTile(x, y));
      }
    }
  }

  private makeTile(x: number, y: number): TileVisual {
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    const label = makeText(this, 0, 0, "", {
      size: Tokens.type.glyph.sm,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });
    container.add([bg, label]);
    this.paintTile(bg, label, "hidden");
    return { container, bg, label };
  }

  private paintTile(bg: Phaser.GameObjects.Graphics, label: Phaser.GameObjects.Text, state: TileState) {
    this.fillTile(bg, this.directQuickplay && state === "hidden" ? Tokens.color.surfaceRaised : TILE_FILL[state]);

    if (state === "gem") label.setText("💎").setColor(Tokens.text.accent);
    else if (state === "mine") label.setText("💣").setColor(Tokens.text.negative);
    else label.setText("").setColor(Tokens.text.muted);
  }

  private fillTile(bg: Phaser.GameObjects.Graphics, fill: number) {
    bg.clear();
    if (this.directQuickplay) {
      bg.fillStyle(Tokens.color.scrim, 0.75);
      bg.fillRoundedRect(-this.tileSize / 2, -this.tileSize / 2 + 5, this.tileSize, this.tileSize, Tokens.radius.sm);
    }
    bg.fillStyle(fill, 1);
    bg.fillRoundedRect(-this.tileSize / 2, -this.tileSize / 2, this.tileSize, this.tileSize, Tokens.radius.sm);
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
      .startMines(bet, "GC", this.directQuickplay ? this.selectedMineCount : MINE_COUNT)
      .then((res) => {
        gameState.hydrateFromServer(res.user);
        this.roundId = res.roundId;
        this.roundBet = bet;
        this.active = true;
        this.busy = false;
        this.picksMade = 0;
        this.revealed = new Set();

        this.messageText.setText("Pick a tile - avoid the mines").setColor(Tokens.text.muted);
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
        tile.container.setSize(this.tileSize, this.tileSize);
        tile.container.setInteractive({ useHandCursor: true });
        // Hover lifts the tile one surface step, the same way every button
        // in this system signals "you can press this" - no glow, no ring.
        tile.container.on("pointerover", () => this.fillTile(tile.bg, Tokens.color.surfaceHover));
        tile.container.on("pointerout", () => this.fillTile(tile.bg, TILE_FILL.clickable));
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
          this.messageText.setText("💥 Boom! You lose your bet.").setColor(Tokens.text.negative);
          playSfx(this, "bust");
          playSfx(this, "lose");
          this.updateBalance();
          this.endRound("loss", 0);
          return;
        }

        this.revealed = new Set(res.revealed ?? []);
        this.picksMade = this.revealed.size;
        this.multiplierText.setText(`Multiplier: ${res.multiplier.toFixed(2)}x`);
        popIn(this, this.multiplierText);
        playSfx(this, "reveal");
        // Pop the specific tile that was just clicked - the gem reveal
        // itself gets the same "juice" as the multiplier readout, not just
        // an instant repaint (renderGridState() below repaints every tile
        // every call, so this popIn has to target the one real tile here).
        if (this.tiles[index]) popIn(this, this.tiles[index].container);

        if (res.boardCleared) {
          this.active = false;
          // Board cleared - the SAFE_TILES revealed tiles account for
          // everything except the mines, so we can infer their positions
          // without the server needing to send them explicitly.
          const mines = Array.from({ length: TOTAL_TILES }, (_, i) => i).filter((i) => !this.revealed.has(i));
          this.revealMines(mines);
          this.messageText.setText(`Board cleared! +${res.payout ?? 0} Gold Coins`).setColor(Tokens.text.accent);
          this.updateBalance();
          showWinCelebration(this, res.payout ?? 0);
          this.endRound("win", res.payout ?? 0);
          return;
        }

        this.messageText.setText("Cash out or keep picking").setColor(Tokens.text.muted);
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
        this.messageText.setText(`Cashed out! +${res.payout} Gold Coins`).setColor(Tokens.text.accent);
        this.updateBalance();
        showWinCelebration(this, res.payout);
        this.endRound("win", res.payout);
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
      this.messageText.setText(insufficientBalanceMessage).setColor(Tokens.text.negative);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
    }
  }

  /**
   * The single terminal path for a Mines round - all three endings (hit a
   * mine, cleared the board, cashed out) funnel through here, which makes
   * it the one place worth tracking from for a stateful game.
   *
   * Retention Leg 1 (see src/api/track.ts): `outcome`/`payout` are passed
   * in by each ending. A round the player walks away from mid-way is
   * deliberately NOT tracked as played here - that path forfeits via
   * POST /games/abandon and never reaches endRound.
   */
  private endRound(outcome: "win" | "loss", payout: number) {
    track(EVENTS.GAME_ROUND_PLAYED, {
      game: "mines",
      betAmount: this.roundBet,
      outcome,
      payout
    });
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
    this.balanceText.setText(formatBalance(gameState.goldCoins));
  }
}
