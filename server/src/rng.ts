/**
 * Server-side RNG for #36 (all game outcomes must be resolved server-side,
 * never trusting a client-computed result). Backed by Node's `crypto`
 * module (a CSPRNG) rather than `Math.random()` - the server is the real
 * trust boundary now, so it's worth not cutting corners here the same way
 * the client-side game math avoided invented odds/house edges.
 */

import { randomInt, randomBytes } from "node:crypto";

/** Uniform random integer in [min, max] inclusive. */
export function randInt(min: number, max: number): number {
  return randomInt(min, max + 1);
}

/** Uniform random float in [0, 1) - same contract as Math.random(), CSPRNG-backed. */
export function randFloat(): number {
  // 6 bytes -> 48 bits of entropy, divided down to [0,1). Matches the
  // precision Math.random() typically provides (53 bits) closely enough
  // for game-fairness purposes (not used for anything requiring exact
  // uniform-double guarantees).
  const buf = randomBytes(6);
  const value = buf.readUIntBE(0, 6);
  return value / 0x1000000000000;
}

/** Fisher-Yates shuffle, in place, returns the same array for convenience. Uses randInt (CSPRNG), not Math.random(). */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Picks one element uniformly at random from `arr`. */
export function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)];
}
