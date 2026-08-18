/** Server-authoritative port of WheelScene.ts's segment-multiplier derivation (#36) - see that file's comments for the full derivation/rationale. */

import { randInt } from "../rng";

export const WHEEL_SEGMENT_COUNT = 20;
const HOUSE_EDGE = 0.03;

export type WheelRisk = "low" | "medium" | "high";

interface WheelTier {
  count: number;
  weight?: number;
}

interface RiskConfig {
  zeroCount: number;
  tiers: WheelTier[];
}

const RISK_CONFIGS: Record<WheelRisk, RiskConfig> = {
  low: { zeroCount: 2, tiers: [{ count: 12 }, { count: 6 }] },
  medium: { zeroCount: 6, tiers: [{ count: 8 }, { count: 4 }, { count: 2 }] },
  high: {
    zeroCount: 16,
    tiers: [
      { count: 2, weight: 3 },
      { count: 1, weight: 8 },
      { count: 1, weight: 40 }
    ]
  }
};

function tierMultipliers(cfg: RiskConfig): number[] {
  const weights = cfg.tiers.map((t) => t.weight ?? 1 / t.count);
  const weightedSum = cfg.tiers.reduce((sum, t, i) => sum + t.count * weights[i], 0);
  if (weightedSum <= 0) return cfg.tiers.map(() => 0);
  const k = ((1 - HOUSE_EDGE) * WHEEL_SEGMENT_COUNT) / weightedSum;
  return cfg.tiers.map((t, i) => Math.round(k * weights[i] * 100) / 100);
}

/** Builds the 20 physical segment values, interleaved so zeros/tiers alternate around the wheel instead of clumping - matches the client's visual layout exactly (same interleave order) so the server-picked landingIndex lines up with what the client renders. */
export function buildWheelSegments(risk: WheelRisk): number[] {
  const cfg = RISK_CONFIGS[risk];
  const mults = tierMultipliers(cfg);
  const groups: number[][] = [Array(cfg.zeroCount).fill(0)];
  cfg.tiers.forEach((t, i) => groups.push(Array(t.count).fill(mults[i])));

  const maxLen = Math.max(...groups.map((g) => g.length));
  const result: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    for (const g of groups) {
      if (i < g.length) result.push(g[i]);
    }
  }
  return result;
}

export interface WheelResult {
  risk: WheelRisk;
  segments: number[];
  landingIndex: number;
  multiplier: number;
  payout: number;
}

export function playWheel(betAmount: number, risk: WheelRisk): WheelResult {
  const segments = buildWheelSegments(risk);
  const landingIndex = randInt(0, WHEEL_SEGMENT_COUNT - 1);
  const multiplier = segments[landingIndex];
  const payout = Math.round(betAmount * multiplier);
  return { risk, segments, landingIndex, multiplier, payout };
}
