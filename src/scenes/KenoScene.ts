import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import {
  makeButton,
  makeGameShell,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  popIn,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";

const TOTAL_NUMBERS = 40; // board is numbers 1-40
const DRAWN_COUNT = 10; // 10 numbers get drawn each round
const MAX_PICKS = 10; // player can pick up to 10 numbers
const HOUSE_EDGE = 0.06; // 6%, folded into the fair multiplier below
const MAX_MULTIPLIER = 10000; // caps the (extremely rare) top-hit jackpot tiers, same spirit as a real Keno paytable cap

const GRID_COLS = 10;
const GRID_ROWS = 4;
const CELL_SIZE = 34;
const CELL_GAP = 5;
// Stake-style layout: grid centered in the shell's right-side display area
// (see ui/uiHelpers.ts's makeGameShell), not the old canvas center - the
// sidebar now occupies the left third of the screen. Y unchanged since it
// was already offset from the old center the same way it is from the new one.
const GRID_CENTER_X = GAME_SHELL_DISPLAY_CENTER_X;
const GRID_CENTER_Y = 262;

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
    this.messageText.setText(`Pick up to ${MAX_PICKS} numbers, then draw`).setColor(Theme.textMuted);

    this.infoText = this.add
      .text(GAME_SHELL_DISPLAY_CENTER_X, 130, "", { fontSize: "13px", color: Theme.textMuted })
      .setOrigin(0.5);

    this.buildGrid();

    this.paytableText = this.add
      .text(GAME_SHELL_DISPLAY_CENTER_X, 356, "", {
        fontSize: "10px",
        color: Theme.textGold,
        align: "center",
        wordWrap: { width: 400 }
      })
      .setOrigin(0.5);

    this.quickPickBtn = makeButton(
      this,
      GAME_SHELL_DISPLAY_CENTER_X - 110,
      412,
      140,
      34,
      "QUICK PICK",
      Theme.neutral,
      Theme.neutralHover,
      () => this.quickPick()
    );
    this.clearBtn = makeButton(
      this,
      GAME_SHELL_DISPLAY_CENTER_X + 110,
      412,
      140,
      34,
      "CLEAR",
      Theme.neutral,
      Theme.neutralHover,
      () => this.clearPicks()
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
    // Cell-state tint fills, tied to Theme tokens so they track the shared
    // dark "Arcade Nights" palette. "picked"/"drawn" used to be pale
    // light-theme pastels (0xbee8f5/0xfce8c7) left over from the old
    // cream-background look - unreadable now (their paired text colors,
    // textPrimary/textGold, would sit near-invisible on a near-white fill
    // against the new near-black surfaces), so both now use Theme.neutral,
    // the same muted slate-blue dark fill the rest of the chrome system
    // uses for a "plain/secondary" surface - still visually distinct from
    // "empty" (Theme.inset) while keeping their border/text colors readable.
    const colors: Record<CellState, number> = {
      empty: Theme.inset,
      picked: Theme.neutral, // "selected, not drawn yet"
      hit: Theme.winZone, // matched number
      miss: Theme.loseZone, // drawn, not picked
      drawn: Theme.neutral // drawn, not picked, informational
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

  /** #36: the draw and payout are resolved server-side (POST /games/keno/play) before any animation starts - the reveal-one-at-a-time sequence here just replays the server's real `drawn` order visually. */
  private play() {
    if (this.drawing) return;
    if (this.picks.size === 0) {
      this.messageText.setText("Pick at least 1 number first!").setColor(Theme.textDanger);
      return;
    }
    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Tickets!").setColor(Theme.textDanger);
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
    this.messageText.setText("Drawing...").setColor(Theme.textMuted);

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
      delay: 160,
      repeat: order.length - 1,
      callback: () => {
        const idx = order[step];
        this.revealedSoFar.add(idx);
        this.paintCell(idx, this.cellState(idx));
        if (this.cellState(idx) === "hit") popIn(this, this.cells[idx].container);
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
        .setText(`${hits}/${picksCount} matched - ${multiplier}x! +${payout} Tickets`)
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

  private handlePlayError(err: unknown) {
    this.drawing = false;
    this.drawBtn?.setEnabled(true);
    this.quickPickBtn?.setEnabled(true);
    this.clearBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Tickets!").setColor(Theme.textDanger);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Theme.textDanger);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Theme.textDanger);
    }
  }

  private updateBalance() {
    this.balanceText.setText(`🎟️ ${gameState.goldCoins}   💰 ${gameState.tickets}`);
  }
}
