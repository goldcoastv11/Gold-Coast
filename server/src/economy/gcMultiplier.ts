/**
 * Shuffle-cup mini-game GC multiplier - server-authoritative port of
 * casino-poc/src/economy/gcMultiplier.ts.
 *
 * Trust-boundary shift from the client version (per the task brief): the
 * client used to report which cup it "picked" for grantSignupBonus/
 * claimAttendantBonus to trust directly. That's no longer acceptable once
 * there's a server - a client could just claim it always picks the 2x cup.
 * So this module also owns *resolving* the multiplier fairly
 * (`pickRandomGcMultiplier`), server-side, using a CSPRNG. The client's
 * role becomes purely presentational: play the shuffle-cup animation, then
 * call the API (POST /auth/signup or POST /claim-bonus) to find out what
 * was actually resolved - the response's `multiplier`/`gcGranted` fields
 * ARE the source of truth the animation should reconcile to, not a value
 * the client computed itself.
 *
 * Math/validation (resolveGcAmount, isValidGcMultiplier) is otherwise
 * unchanged from the client - GC_MULTIPLIER_BASE * multiplier, guarded at
 * runtime against out-of-range values regardless of what TypeScript's
 * static type says at the call site.
 */

import { randomInt } from "node:crypto";

export const GC_MULTIPLIER_BASE = 1000;

export const GC_MULTIPLIERS = [0.5, 1, 2] as const;

export type GcMultiplier = (typeof GC_MULTIPLIERS)[number];

export class InvalidGcMultiplierError extends Error {
  constructor(value: unknown) {
    super(
      `Invalid GC multiplier ${JSON.stringify(value)} - must be one of ${GC_MULTIPLIERS.join(", ")}.`
    );
    this.name = "InvalidGcMultiplierError";
  }
}

export function isValidGcMultiplier(value: number): value is GcMultiplier {
  return (GC_MULTIPLIERS as readonly number[]).includes(value);
}

/**
 * GC_MULTIPLIER_BASE * multiplier, e.g. 0.5 -> 500, 1 -> 1000, 2 -> 2000.
 * Throws InvalidGcMultiplierError for anything outside GC_MULTIPLIERS.
 */
export function resolveGcAmount(multiplier: GcMultiplier): number {
  if (!isValidGcMultiplier(multiplier)) {
    throw new InvalidGcMultiplierError(multiplier);
  }
  return GC_MULTIPLIER_BASE * multiplier;
}

/**
 * Fairly (uniform, CSPRNG-backed) picks one of GC_MULTIPLIERS server-side.
 * This is the "which cup wins" resolution - the client never gets a say.
 * Uniform odds (1/3 each) is a deliberate, simple default; if the game
 * design ever wants weighted odds (e.g. 2x rarer than 0.5x/1x), change the
 * distribution here - this is the one chokepoint every caller goes through.
 */
export function pickRandomGcMultiplier(): GcMultiplier {
  const index = randomInt(GC_MULTIPLIERS.length);
  return GC_MULTIPLIERS[index];
}
