import Phaser from "phaser";
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
  popIn,
  drawCabinetFrame,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";

const TOTAL_NUMBERS = 40; // board is numbers 1-40
const DRAWN_COUNT = 10; // 10 numbers get drawn each round
const MAX_PICKS = 10; // player can pick up to 10 numbers
const HOUSE_EDGE = 0.06; // 6%, folded into the fair multiplier below
const MAX_MULTIPLIER = 10000; // caps the (extremely rare) top-hit jackpot tiers, same spirit as a real Keno paytable cap

const GRID_COLS = 10;
const GRID_ROWS = 4;
const CELL_SIZE = 34;
const CELL_GAP = Tokens.space.xs;
// Stake-style layout: grid centered in the shell's right-side display area
// (see ui/uiHelpers.ts's makeGameShell), not the old canvas center - the
// sidebar now occupies the left third of the screen. Y unchanged since it
// was already offset from the old center the same way it is from the new one.
const GRID_CENTER_X = GAME_SHELL_DISPLAY_CENTER_X;
const GRID_CENTER_Y = 262;
/** Paytable strip + the two pick helpers sit below the board, on the token rhythm. */
const PAYTABLE_Y = 356;
const ACTION_ROW_Y = 412;
const ACTION_BTN_W = 140;
const ACTION_BTN_H = 34;

// #36: the actual draw/hits/payout are now resolved server-side (POST
// /games/keno/play, mirrored 1:1 in server/src/games/keno.ts) - everything
// below is kept here only to drive the live paytable preview before the
// player draws, never to settle a round.

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

/**
 * #45: mirrors server/src/games/keno.ts's buildPayoutTable() byte-for-byte
 * (iterative water-filling instead of a flat equal split) - MUST stay in
 * sync by hand, same as every other cosmetic client-side copy in this file.
 *
 * The naive "equal share per tier, multiplier = share/P" approach (this
 * function's previous version) breaks down at picks 7-10: the top
 * ("hit everything") tier is astronomically rare there (picks=10,hits=10 is
 * ~1-in-850-million), so its fair equal share needs a multiplier far past
 * MAX_MULTIPLIER. Silently capping it without recovering the shortfall
 * elsewhere quietly drags real RTP for those pick counts down to 67-82%
 * instead of the documented ~94% - this was a real bug (#45, caught by QA),
 * not just a client/server preview mismatch, and is now fixed on both
 * sides: any tier that would need to exceed MAX_MULTIPLIER gets capped
 * there instead, and the RTP budget that tier couldn't use is redistributed
 * across the remaining uncapped tiers so total expected return still lands
 * on ~94% for every pick count. Converges in at most `tiers` iterations.
 */
function buildPayoutTable(picks: number): Map<number, number> {
  const minHits = minPayHits(picks);
  const tierHits: number[] = [];
  for (let h = minHits; h <= picks; h++) tierHits.push(h);

  const probs = tierHits.map((h) => hyperProb(h, picks));
  const mult = new Array<number>(tierHits.length).fill(0);
  const capped = new Array<boolean>(tierHits.length).fill(false);
  let remainingBudget = 1 - HOUSE_EDGE;

  for (let iter = 0; iter < tierHits.length; iter++) {
    const uncappedIdx: number[] = [];
    for (let i = 0; i < tierHits.length; i++) if (!capped[i]) uncappedIdx.push(i);
    if (uncappedIdx.length === 0) break;

    const share = remainingBudget / uncappedIdx.length;
    let cappedSomethingThisPass = false;

    for (const i of uncappedIdx) {
      const raw = probs[i] > 0 ? share / probs[i] : Infinity;
      if (raw > MAX_MULTIPLIER) {
        mult[i] = MAX_MULTIPLIER;
        capped[i] = true;
        remainingBudget -= probs[i] * MAX_MULTIPLIER;
        cappedSomethingThisPass = true;
      }
    }

    if (!cappedSomethingThisPass) {
      for (const i of uncappedIdx) mult[i] = share / probs[i];
      break;
    }
  }

  const table = new Map<number, number>();
  tierHits.forEach((h, i) => table.set(h, Math.max(0, Math.round(mult[i] * 100) / 100)));
  return table;
}

const payoutTableCache = new Map<number, Map<number, number>>();

function getPayoutTable(picks: number): Map<number, number> {
  let table = payoutTableCache.get(picks);
  if (!table) {
    table = buildPayoutTable(picks);
    payoutTableCache.set(picks, table);
  }
  return table;
}

/** Preview-only multiplier for landing exactly `hits` out of `picks` - matches what the server will actually pay (see buildPayoutTable's doc comment), never used to settle a round itself. */
function multiplierFor(picks: number, hits: number): number {
  if (picks <= 0 || hits < minPayHits(picks)) return 0;
  return getPayoutTable(picks).get(hits) ?? 0;
}

interface CellVisual {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

type CellState = "empty" | "picked" | "hit" | "miss" | "drawn";

/**
 * KENO cell states, on the Stake-style direction (see ui/DesignTokens.ts).
 *
 * Every cell used to be a fill plus a 2px coloured border, five different
 * border colours deep - a 40-cell grid of boxes. It is now purely the
 * surface ladder: an untouched number is a recessed well, a number the
 * player picked is a raised control, a number the machine drew but the
 * player didn't sits on the plain panel surface in between, and the two
 * resolved outcomes take the muted state tints. Meaning is carried by the
 * number's own colour, which is the only thing that changes hue.
 */
const CELL_FILL: Record<CellState, number> = {
  empty: Tokens.color.inset,
  picked: Tokens.color.surfaceRaised,
  hit: Tokens.color.positiveMuted,
  miss: Tokens.color.negativeMuted,
  drawn: Tokens.color.surface
};
const CELL_TEXT: Record<CellState, string> = {
  empty: Tokens.text.muted,
  picked: Tokens.text.primary,
  hit: Tokens.text.accent,
  miss: Tokens.text.negative,
  drawn: Tokens.text.secondary
};

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
  private shell!: GameShellHandle;

  constructor() {
    super("KenoScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "germanVirtue");
    this.picks = new Set();
    this.drawn = new Set();
    this.revealedSoFar = new Set();
    this.drawing = false;
    this.cells = [];
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.drawTimer) {
        this.drawTimer.remove(false);
        this.drawTimer = undefined;
      }
    });

    // Stake-style shell: left sidebar (title/balance/bet/message/Draw/Walk
    // Away) + open right-side display area for the picks grid - see
    // ui/uiHelpers.ts's makeGameShell doc comment.
    this.shell = makeGameShell(this, "KENO", "DRAW", {
      onStart: () => this.play(),
      onCashOut: () => {},
      onWalkAway: () => fadeToScene(this, "OverworldScene")
    });
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.drawBtn = this.shell.startBtn;
    this.betControl = this.shell.betControl;
    this.messageText.setText(`Pick up to ${MAX_PICKS} numbers, then draw`).setColor(Tokens.text.muted);

    this.infoText = makeText(this, GAME_SHELL_DISPLAY_CENTER_X, 134, "", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5
    });

    // Cabinet frame hugging just the number grid (not the info/paytable
    // text above/below it) - Keno's grid is short enough to have generous
    // room in every direction, unlike the taller grid games.
    const gridW = GRID_COLS * CELL_SIZE + (GRID_COLS - 1) * CELL_GAP;
    const gridH = GRID_ROWS * CELL_SIZE + (GRID_ROWS - 1) * CELL_GAP;
    const boardW = gridW + Tokens.space.xxl;
    drawCabinetFrame(this, GRID_CENTER_X, GRID_CENTER_Y, boardW, gridH + Tokens.space.xxl);

    this.buildGrid();

    this.paytableText = makeText(this, GAME_SHELL_DISPLAY_CENTER_X, PAYTABLE_Y, "", {
      size: Tokens.type.size.xs,
      color: Tokens.text.secondary,
      align: "center",
      originX: 0.5,
      wordWrapWidth: boardW
    });

    // Quick Pick / Clear are helpers, not the action - a quiet raised
    // surface with a muted label, so the accent stays on DRAW alone.
    this.quickPickBtn = makeButton(
      this,
      GRID_CENTER_X - ACTION_BTN_W / 2 - Tokens.space.xs,
      ACTION_ROW_Y,
      ACTION_BTN_W,
      ACTION_BTN_H,
      "QUICK PICK",
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => this.quickPick(),
      Tokens.text.secondary,
      Tokens.radius.sm
    );
    this.clearBtn = makeButton(
      this,
      GRID_CENTER_X + ACTION_BTN_W / 2 + Tokens.space.xs,
      ACTION_ROW_Y,
      ACTION_BTN_W,
      ACTION_BTN_H,
      "CLEAR",
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => this.clearPicks(),
      Tokens.text.secondary,
      Tokens.radius.sm
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
    const label = makeText(this, 0, 0, String(index + 1), {
      size: Tokens.type.size.lg,
      weight: Tokens.type.weight.semibold,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });
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
    cell.bg.clear();
    cell.bg.fillStyle(CELL_FILL[state], 1);
    cell.bg.fillRoundedRect(-CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, Tokens.radius.xs);
    cell.label.setColor(CELL_TEXT[state]);
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
    this.messageText.setText(`Pick up to ${MAX_PICKS} numbers, then draw`).setColor(Tokens.text.muted);
  }

  private updateInfo() {
    this.infoText.setText(`PICKED ${this.picks.size} / ${MAX_PICKS}`);
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

  /** #36: the draw and payout are resolved server-side (POST /games/keno/play) before any animation starts - the reveal-one-at-a-time sequence here just replays the server's real `drawn` order visually. */
  private play() {
    if (this.drawing) return;
    if (this.picks.size === 0) {
      this.messageText.setText("Pick at least 1 number first!").setColor(Tokens.text.negative);
      return;
    }
    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    this.currentBet = gameState.betAmount;
    const pickList = Array.from(this.picks);

    this.drawing = true;
    this.revealedSoFar = new Set();
    this.drawBtn?.setEnabled(false);
    this.quickPickBtn?.setEnabled(false);
    this.clearBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Drawing...").setColor(Tokens.text.muted);

    api
      .playKeno(this.currentBet, "GC", pickList)
      .then((res) => {
        this.drawn = new Set(res.result.drawn);
        this.repaintAll();
        this.animateReveal(res);
      })
      .catch((err) => this.handlePlayError(err));
  }

  private animateReveal(res: Awaited<ReturnType<typeof api.playKeno>>) {
    const order = res.result.drawn;
    let step = 0;
    this.drawTimer = this.time.addEvent({
      delay: Tokens.motion.duration.stagger,
      repeat: order.length - 1,
      callback: () => {
        const idx = order[step];
        this.revealedSoFar.add(idx);
        this.paintCell(idx, this.cellState(idx));
        if (this.cellState(idx) === "hit") {
          popIn(this, this.cells[idx].container);
          playSfx(this, "reveal");
        }
        step++;
        if (step >= order.length) {
          this.resolveRound(res);
        }
      }
    });
  }

  private resolveRound(res: Awaited<ReturnType<typeof api.playKeno>>) {
    gameState.hydrateFromServer(res.user);

    const { hits, multiplier, payout } = res.result;
    const picksCount = res.result.picks.length;
    if (payout > 0) {
      this.messageText
        .setText(`${hits}/${picksCount} matched - ${multiplier}x! +${payout} Gold Coins`)
        .setColor(Tokens.text.accent);
      showWinCelebration(this, payout);
    } else {
      this.messageText.setText(`${hits}/${picksCount} matched - not enough to win`).setColor(Tokens.text.negative);
      playSfx(this, "lose");
    }

    this.updateBalance();
    this.repaintAll();

    this.drawing = false;
    this.drawBtn?.setEnabled(true);
    this.quickPickBtn?.setEnabled(true);
    this.clearBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private handlePlayError(err: unknown) {
    this.drawing = false;
    this.drawBtn?.setEnabled(true);
    this.quickPickBtn?.setEnabled(true);
    this.clearBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
    }
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins));
  }
}
