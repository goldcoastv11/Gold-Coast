import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";

const TOTAL_NUMBERS = 40; // board is numbers 1-40
const DRAWN_COUNT = 10; // 10 numbers get drawn each round
const MAX_PICKS = 10; // player can pick up to 10 numbers
const HOUSE_EDGE = 0.06; // 6%, folded into the fair multiplier below
const MAX_MULTIPLIER = 10000; // caps the (extremely rare) top-hit jackpot tiers, same spirit as a real Keno paytable cap

const GRID_COLS = 10;
const GRID_ROWS = 4;
const CELL_SIZE = 34;
const CELL_GAP = 5;
const GRID_CENTER_X = 400;
const GRID_CENTER_Y = 262;

/** n-choose-k, computed iteratively so it stays exact in floating point for n<=40. */
function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

/**
 * Exact hypergeometric probability of matching exactly `hits` of the
 * DRAWN_COUNT drawn numbers, given the player picked `picks` numbers out of
 * TOTAL_NUMBERS. Same combinatorial-odds approach as Mines' pick math.
 */
function hyperProb(hits: number, picks: number): number {
  const den = comb(TOTAL_NUMBERS, picks);
  if (den === 0) return 0;
  const num = comb(DRAWN_COUNT, hits) * comb(TOTAL_NUMBERS - DRAWN_COUNT, picks - hits);
  return num / den;
}

/** Below this many hits, the round pays nothing (matches how real Keno paytables work). */
function minPayHits(picks: number): number {
  return Math.max(1, Math.ceil(picks * 0.4));
}

/** How many distinct hit-counts actually pay out for a given number of picks. */
function payingTierCount(picks: number): number {
  return Math.max(0, picks - minPayHits(picks) + 1);
}

/**
 * Fair multiplier for landing exactly `hits` out of `picks`, shaved by HOUSE_EDGE and capped.
 *
 * A round has several mutually-exclusive paying outcomes (hit counts from minPayHits(picks) up
 * to picks). Naively pricing each one as if it were the *only* winning outcome
 * (multiplier = (1-edge)/P) would make the sum of (probability * multiplier) across all paying
 * tiers add up to (1-edge) * numberOfTiers instead of (1-edge) - the house would hemorrhage money
 * the more paying tiers there are. Dividing by payingTierCount spreads the edge-adjusted value
 * evenly across tiers so the whole paytable's expected return is exactly (1-HOUSE_EDGE), same as
 * a single bet * multiplier formula, just generalized to many outcomes.
 */
function multiplierFor(picks: number, hits: number): number {
  if (picks <= 0 || hits < minPayHits(picks)) return 0;
  const p = hyperProb(hits, picks);
  const tiers = payingTierCount(picks);
  if (p <= 0 || tiers <= 0) return 0;
  const raw = (1 - HOUSE_EDGE) / (tiers * p);
  return Math.min(MAX_MULTIPLIER, Math.round(raw * 100) / 100);
}

function drawNumbers(): Set<number> {
  const indices = Array.from({ length: TOTAL_NUMBERS }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Phaser.Math.Between(0, i);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return new Set(indices.slice(0, DRAWN_COUNT));
}

interface CellVisual {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

type CellState = "empty" | "picked" | "hit" | "miss" | "drawn";

export class KenoScene extends Phaser.Scene {
  private picks: Set<number> = new Set();
  private drawn: Set<number> = new Set();
  private revealedSoFar: Set<number> = new Set();
  private drawing = false;
  private cells: CellVisual[] = [];
  private drawTimer?: Phaser.Time.TimerEvent;
  private currentBet = 0;

  private balanceText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private paytableText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private drawBtn?: UIButton;
  private quickPickBtn?: UIButton;
  private clearBtn?: UIButton;
  private betControl?: BetControl;

  constructor() {
    super("KenoScene");
  }

  create() {
    this.picks = new Set();
    this.drawn = new Set();
    this.revealedSoFar = new Set();
    this.drawing = false;
    this.cells = [];
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.drawTimer) {
        this.drawTimer.remove(false);
        this.drawTimer = undefined;
      }
    });

    makePanel(this, 400, 300, 560, 560);

    this.add
      .text(400, 40, "KENO", {
        fontSize: "26px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    makeInset(this, 400, 72, 420, 28, 14);
    this.balanceText = this.add
      .text(400, 72, "", { fontSize: "13px", color: Theme.textPrimary })
      .setOrigin(0.5);

    this.betControl = makeBetControl(this, 400, 103, () => {});

    this.infoText = this.add
      .text(400, 130, "", { fontSize: "13px", color: Theme.textMuted })
      .setOrigin(0.5);

    this.buildGrid();

    this.paytableText = this.add
      .text(400, 356, "", { fontSize: "11px", color: Theme.textGold })
      .setOrigin(0.5);

    this.messageText = this.add
      .text(400, 378, `Pick up to ${MAX_PICKS} numbers, then draw`, {
        fontSize: "13px",
        color: Theme.textMuted
      })
      .setOrigin(0.5);

    this.quickPickBtn = makeButton(
      this,
      290,
      412,
      140,
      34,
      "QUICK PICK",
      Theme.neutral,
      Theme.neutralHover,
      () => this.quickPick()
    );
    this.clearBtn = makeButton(this, 510, 412, 140, 34, "CLEAR", Theme.neutral, Theme.neutralHover, () =>
      this.clearPicks()
    );

    this.drawBtn = makeButton(this, 400, 460, 200, 48, "DRAW", Theme.accent, Theme.accentHover, () =>
      this.play()
    );

    makeButton(this, 400, 520, 200, 36, "WALK AWAY", Theme.danger, Theme.dangerHover, () =>
      this.scene.start("OverworldScene")
    );

    this.updateBalance();
    this.updateInfo();
    this.updatePaytable();
  }

  private buildGrid() {
    this.cells.forEach((c) => c.container.destroy());
    this.cells = [];

    const totalWidth = GRID_COLS * CELL_SIZE + (GRID_COLS - 1) * CELL_GAP;
    const totalHeight = GRID_ROWS * CELL_SIZE + (GRID_ROWS - 1) * CELL_GAP;
    const startX = GRID_CENTER_X - totalWidth / 2 + CELL_SIZE / 2;
    const startY = GRID_CENTER_Y - totalHeight / 2 + CELL_SIZE / 2;

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const index = row * GRID_COLS + col;
        const x = startX + col * (CELL_SIZE + CELL_GAP);
        const y = startY + row * (CELL_SIZE + CELL_GAP);
        this.cells.push(this.makeCell(x, y, index));
      }
    }
  }

  private makeCell(x: number, y: number, index: number): CellVisual {
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    const label = this.add
      .text(0, 0, String(index + 1), { fontSize: "13px", fontStyle: "bold" })
      .setOrigin(0.5);
    container.add([bg, label]);
    container.setSize(CELL_SIZE, CELL_SIZE);
    container.setInteractive({ useHandCursor: true });
    container.on("pointerdown", () => this.toggleCell(index));
    const cell: CellVisual = { container, bg, label };
    this.paintCellVisual(cell, "empty");
    return cell;
  }

  private paintCell(index: number, state: CellState) {
    const cell = this.cells[index];
    if (!cell) return;
    this.paintCellVisual(cell, state);
  }

  private paintCellVisual(cell: CellVisual, state: CellState) {
    // Pale, high-key tint fills per state (STYLE_GUIDE: light/warm, no dark
    // near-black cell backgrounds) - border/text stay tied to Theme tokens
    // so they keep tracking the shared palette.
    const colors: Record<CellState, number> = {
      empty: Theme.inset,
      picked: 0xbee8f5, // deeper pale sky-blue - "selected, not drawn yet"
      hit: Theme.winZone, // pale mint - matched number
      miss: Theme.loseZone, // pale coral - drawn, not picked
      drawn: 0xfce8c7 // pale warm gold - drawn, not picked, informational
    };
    const border: Record<CellState, number> = {
      empty: Theme.panelBorder,
      picked: Theme.secondary,
      hit: Theme.accent,
      miss: Theme.danger,
      drawn: Theme.gold
    };
    const textColor: Record<CellState, string> = {
      empty: Theme.textMuted,
      picked: Theme.textPrimary,
      hit: Theme.textAccent,
      miss: Theme.textDanger,
      drawn: Theme.textGold
    };

    cell.bg.clear();
    cell.bg.fillStyle(colors[state], 1);
    cell.bg.fillRoundedRect(-CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 6);
    cell.bg.lineStyle(2, border[state], 1);
    cell.bg.strokeRoundedRect(-CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 6);
    cell.label.setColor(textColor[state]);
  }

  private cellState(index: number): CellState {
    const isPicked = this.picks.has(index);
    const isDrawn = this.revealedSoFar.has(index);
    if (isPicked && isDrawn) return "hit";
    if (isDrawn) return "drawn";
    if (isPicked) return this.drawn.size > 0 && !this.drawing ? "miss" : "picked";
    return "empty";
  }

  private repaintAll() {
    for (let i = 0; i < this.cells.length; i++) {
      this.paintCell(i, this.cellState(i));
    }
  }

  private toggleCell(index: number) {
    if (this.drawing) return;
    // Starting a fresh selection after a completed round clears the old draw
    if (this.drawn.size > 0) {
      this.drawn = new Set();
      this.revealedSoFar = new Set();
    }
    if (this.picks.has(index)) {
      this.picks.delete(index);
    } else {
      if (this.picks.size >= MAX_PICKS) return;
      this.picks.add(index);
    }
    this.repaintAll();
    this.updateInfo();
    this.updatePaytable();
  }

  private quickPick() {
    if (this.drawing) return;
    this.picks = new Set();
    this.drawn = new Set();
    this.revealedSoFar = new Set();
    const indices = Array.from({ length: TOTAL_NUMBERS }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Phaser.Math.Between(0, i);
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (const idx of indices.slice(0, MAX_PICKS)) this.picks.add(idx);
    this.repaintAll();
    this.updateInfo();
    this.updatePaytable();
  }

  private clearPicks() {
    if (this.drawing) return;
    this.picks = new Set();
    this.drawn = new Set();
    this.revealedSoFar = new Set();
    this.repaintAll();
    this.updateInfo();
    this.updatePaytable();
    this.messageText.setText(`Pick up to ${MAX_PICKS} numbers, then draw`).setColor(Theme.textMuted);
  }

  private updateInfo() {
    this.infoText.setText(`Picked: ${this.picks.size} / ${MAX_PICKS}`);
  }

  private updatePaytable() {
    const picks = this.picks.size;
    if (picks === 0) {
      this.paytableText.setText("Pick numbers to see the payout table");
      return;
    }
    const start = minPayHits(picks);
    const parts: string[] = [];
    for (let hits = start; hits <= picks; hits++) {
      const mult = multiplierFor(picks, hits);
      if (mult <= 0) continue;
      const label = hits === picks && mult >= MAX_MULTIPLIER ? `${hits}+` : `${hits}`;
      parts.push(`${label}:${mult}x`);
    }
    this.paytableText.setText(parts.join("   "));
  }

  private play() {
    if (this.drawing) return;
    if (this.picks.size === 0) {
      this.messageText.setText("Pick at least 1 number first!").setColor(Theme.textDanger);
      return;
    }
    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    this.currentBet = gameState.betAmount;
    gameState.goldCoins -= this.currentBet;
    this.updateBalance();

    this.drawing = true;
    this.drawn = drawNumbers();
    this.revealedSoFar = new Set();
    this.drawBtn?.setEnabled(false);
    this.quickPickBtn?.setEnabled(false);
    this.clearBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Drawing...").setColor(Theme.textMuted);
    this.repaintAll();

    const order = Array.from(this.drawn);
    let step = 0;
    this.drawTimer = this.time.addEvent({
      delay: 160,
      repeat: order.length - 1,
      callback: () => {
        const idx = order[step];
        this.revealedSoFar.add(idx);
        this.paintCell(idx, this.cellState(idx));
        if (this.cellState(idx) === "hit") popIn(this, this.cells[idx].container);
        step++;
        if (step >= order.length) {
          this.resolveRound();
        }
      }
    });
  }

  private resolveRound() {
    const picksCount = this.picks.size;
    let hits = 0;
    this.picks.forEach((idx) => {
      if (this.drawn.has(idx)) hits++;
    });

    const multiplier = multiplierFor(picksCount, hits);
    const payout = Math.round(this.currentBet * multiplier);
    if (payout > 0) {
      gameState.goldCoins += payout;
      this.messageText
        .setText(`${hits}/${picksCount} matched - ${multiplier}x! +${payout} GC`)
        .setColor(Theme.textAccent);
    } else {
      this.messageText.setText(`${hits}/${picksCount} matched - not enough to win`).setColor(Theme.textDanger);
    }

    this.updateBalance();
    this.repaintAll();

    this.drawing = false;
    this.drawBtn?.setEnabled(true);
    this.quickPickBtn?.setEnabled(true);
    this.clearBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
