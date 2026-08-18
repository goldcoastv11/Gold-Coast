/**
 * Server-authoritative port of casino-poc/src/scenes/MinesScene.ts's
 * combinatorial payout math and mine placement (#36). The whole point of
 * moving this server-side: mine positions must never be knowable
 * client-side while a round is active, or a player could just read them
 * out of memory/network traffic. See roundStore.ts for how round state
 * (this module's `MinesRoundState`) actually persists between requests.
 */

import { randInt } from "../rng";

export const MINES_GRID_SIZE = 5;
export const MINES_TOTAL_TILES = MINES_GRID_SIZE * MINES_GRID_SIZE;
export const MINES_COUNT = 3;
export const MINES_SAFE_TILES = MINES_TOTAL_TILES - MINES_COUNT;
const HOUSE_EDGE = 0.02; // 2%, folded into the fair multiplier below - identical to the client's constant

/**
 * Fair cumulative multiplier for having safely revealed `picks` tiles out
 * of MINES_TOTAL_TILES with MINES_COUNT mines, then shaved by HOUSE_EDGE.
 * Byte-for-byte the same formula as the client's multiplierForPicks.
 */
export function minesMultiplier(picks: number): number {
  let m = 1;
  for (let k = 0; k < picks; k++) {
    m *= (MINES_TOTAL_TILES - k) / (MINES_SAFE_TILES - k);
  }
  return Math.round(m * (1 - HOUSE_EDGE) * 100) / 100;
}

/** MINES_COUNT distinct tile indices, chosen via a CSPRNG-backed Fisher-Yates (not Math.random()). */
export function generateMinePositions(): number[] {
  const indices = Array.from({ length: MINES_TOTAL_TILES }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, MINES_COUNT).sort((a, b) => a - b);
}

export interface MinesRoundState {
  minePositions: number[];
  revealed: number[];
}

export function newMinesState(): MinesRoundState {
  return { minePositions: generateMinePositions(), revealed: [] };
}

/** The slice of round state that's safe to ever send to the client - never minePositions while active. */
export interface MinesPublicState {
  revealed: number[];
  picksMade: number;
  multiplier: number;
}

export function publicMinesState(state: MinesRoundState): MinesPublicState {
  return {
    revealed: state.revealed,
    picksMade: state.revealed.length,
    multiplier: minesMultiplier(state.revealed.length)
  };
}

export class InvalidMinesPickError extends Error {}

export interface MinesPickResult {
  state: MinesRoundState;
  hitMine: boolean;
  boardCleared: boolean;
}

/** Reveals `tileIndex`. Throws InvalidMinesPickError for an out-of-range or already-revealed tile (a client bug, not a game outcome). */
export function applyMinesPick(state: MinesRoundState, tileIndex: number): MinesPickResult {
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= MINES_TOTAL_TILES) {
    throw new InvalidMinesPickError(`Tile index out of range: ${tileIndex}`);
  }
  if (state.revealed.includes(tileIndex)) {
    throw new InvalidMinesPickError(`Tile ${tileIndex} already revealed`);
  }

  if (state.minePositions.includes(tileIndex)) {
    return { state, hitMine: true, boardCleared: false };
  }

  const revealed = [...state.revealed, tileIndex].sort((a, b) => a - b);
  const boardCleared = revealed.length >= MINES_SAFE_TILES;
  return { state: { ...state, revealed }, hitMine: false, boardCleared };
}
