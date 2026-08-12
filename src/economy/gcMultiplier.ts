/**
 * Shuffle-cup mini-game GC multiplier (#27, driven by games/floor's #28/#29
 * mini-game).
 *
 * Two flows previously granted a hardcoded flat GC amount: the signup
 * bonus (src/economy/signupBonus.ts) and the attendant claim
 * (src/economy/attendantClaim.ts). Both now accept a resolved multiplier
 * instead - whatever cup the player picked in the shuffle-cup mini-game -
 * and compute the GC amount as GC_MULTIPLIER_BASE * multiplier. The SC leg
 * of both flows is explicitly untouched by this: still flat, same
 * transaction types, same playthrough registration (see each module's own
 * comments).
 *
 * The multiplier itself is resolved entirely by games/floor's mini-game -
 * this module has no opinion on odds, animation, or which cup is picked,
 * it just defines the closed set of valid outcomes and the math to turn
 * one into a GC amount.
 *
 * Runtime enforcement (QA finding, closed before #29 lands): `GcMultiplier`
 * is a TypeScript union, which only constrains code that's actually
 * type-checked - #29 is about to feed real (client-side, still-untrusted)
 * mini-game output into `resolveGcAmount` via grantSignupBonus/
 * claimAttendantBonus, and that value won't necessarily arrive as a
 * TS-narrowed literal (e.g. it may come off an event/JSON boundary as a
 * plain `number`). `isValidGcMultiplier` existed but nothing called it, so
 * an out-of-range value (999) sailed straight through the arithmetic and
 * granted a bogus amount, and a negative value (-5) produced a *negative*
 * "grant" - either silently debiting GC disguised as a successful claim
 * (on a funded ledger) or throwing an unrelated InsufficientBalanceError
 * from deep inside the ledger (on an empty one) instead of a clear
 * rejection at the actual point of invalid input. `resolveGcAmount` is the
 * one chokepoint both grantSignupBonus and claimAttendantBonus call to
 * turn a multiplier into an amount, so the guard lives here: every caller,
 * present or future, gets it for free rather than needing to remember to
 * validate before calling.
 */

export const GC_MULTIPLIER_BASE = 1000;

export const GC_MULTIPLIERS = [0.5, 1, 2] as const;

export type GcMultiplier = (typeof GC_MULTIPLIERS)[number];

export class InvalidGcMultiplierError extends Error {
  constructor(value: unknown) {
    super(
      `Invalid GC multiplier ${JSON.stringify(value)} - must be one of ${GC_MULTIPLIERS.join(", ")}. ` +
        "This must be validated before it reaches resolveGcAmount (e.g. immediately after reading it " +
        "off the shuffle-cup mini-game's resolved output)."
    );
    this.name = "InvalidGcMultiplierError";
  }
}

export function isValidGcMultiplier(value: number): value is GcMultiplier {
  return (GC_MULTIPLIERS as readonly number[]).includes(value);
}

/**
 * GC_MULTIPLIER_BASE * multiplier, e.g. 0.5 -> 500, 1 -> 1000, 2 -> 2000.
 * Throws InvalidGcMultiplierError for anything outside GC_MULTIPLIERS,
 * regardless of what TypeScript's static type says at the call site - this
 * is the runtime backstop for values arriving from untrusted/unchecked
 * sources (see file header).
 */
export function resolveGcAmount(multiplier: GcMultiplier): number {
  if (!isValidGcMultiplier(multiplier)) {
    throw new InvalidGcMultiplierError(multiplier);
  }
  return GC_MULTIPLIER_BASE * multiplier;
}
