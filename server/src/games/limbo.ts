/** Server-authoritative port of LimboScene.ts's crash-point roll (#36). */

import { randFloat } from "../rng";

const HOUSE_EDGE = 0.01; // 1%

// Client currently offers 8 presets (1.5x-100x), but the server validates a
// broader sane range rather than restricting to exactly those - a target
// just needs to be a meaningful multiplier above 1x with some abuse-proof
// upper cap, matching "server enforces its own bounds, doesn't just trust
// client intent" (see games/shared.ts's BET_MIN/MAX comment for the same
// philosophy).
export const LIMBO_TARGET_MIN = 1.01;
export const LIMBO_TARGET_MAX = 1000;

/** Standard provably-fair-style crash-point roll: heavy tail, frequent low results. */
export function rollCrashPoint(): number {
  const r = randFloat();
  const raw = (1 - HOUSE_EDGE) / (1 - r);
  return Math.max(1.0, Math.floor(raw * 100) / 100);
}

export interface LimboResult {
  target: number;
  crashPoint: number;
  won: boolean;
  payout: number;
}

export function playLimbo(betAmount: number, target: number): LimboResult {
  const crashPoint = rollCrashPoint();
  const won = crashPoint >= target;
  const payout = won ? Math.round(betAmount * target) : 0;
  return { target, crashPoint, won, payout };
}
