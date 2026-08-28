/**
 * Design tokens - the single source of truth for the "Stake-style" visual
 * direction (flat, minimal, dark; precise spacing; restrained colour;
 * generous whitespace; clean tightly-set type; subtle motion).
 *
 * WHY A NEW MODULE RATHER THAN RE-POINTING `Theme.ts`
 * ---------------------------------------------------
 * `Theme.ts` is the "Arcade Nights" palette and is consumed by BootScene's
 * procedural texture generators and by OverworldScene's walk-around art as
 * well as by the game screens. Re-pointing its values would silently
 * restyle the overworld too, which is a separate and much larger job.
 * So this is an ADDITIVE system: new surface, new module, adopted screen by
 * screen. `Theme.ts` stays exactly as-is and keeps driving everything that
 * has not been converted yet.
 *
 * HOW TO USE
 * ----------
 * - `Tokens.color.*`      numeric 0xRRGGBB - for Phaser Graphics fills/strokes
 * - `Tokens.text.*`       CSS "#rrggbb" strings - for Phaser Text styles
 * - `Tokens.space.*`      4pt spacing scale - never hand-pick a gap
 * - `Tokens.type.*`       size/weight scale + the one font stack
 * - `Tokens.radius.*`     corner radii
 * - `Tokens.elevation.*`  how a surface separates from the one behind it
 * - `Tokens.motion.*`     durations/eases, so motion is consistent and quiet
 *
 * DIRECTION NOTES (the rules the numbers below encode)
 * ----------------------------------------------------
 * 1. Surfaces are dark DESATURATED NAVY/SLATE, never pure black and never
 *    saturated. Depth comes from a small number of stacked surface values
 *    (`bg` -> `surface` -> `surfaceRaised`), not from borders and boxes.
 * 2. ONE accent, used sparingly. Green is the primary action and the win
 *    state and nothing else. If two things on a screen are accent-coloured,
 *    one of them is wrong.
 * 3. Hierarchy comes from WEIGHT, SIZE and SPACE - not from outlines. A
 *    hairline divider is allowed once or twice per screen; a stroked box
 *    around every element is not.
 * 4. Radii are small (4-8px). Fully-round pills read as "toy"; Stake's
 *    chrome is nearly-square with just enough softening to not feel sharp.
 * 5. Motion is short and eased-out. Nothing bounces, nothing overshoots
 *    more than a hair.
 */

/** Numeric colour (0xRRGGBB) -> CSS hex string, for Phaser Text styles and real DOM elements. */
export function toCss(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

/** Numeric colour + a 0-1 alpha -> CSS "#rrggbbaa", for Phaser Text `backgroundColor` (string-only). */
export function toCssAlpha(n: number, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `${toCss(n)}${a.toString(16).padStart(2, "0")}`;
}

const color = {
  // --- Surfaces: a deliberately short ladder. Three steps, no more. ---
  /** Page/canvas ground. The darkest thing on screen. */
  bg: 0x0f212e,
  /** Cards, sidebars, the game board - one step up from the ground. */
  surface: 0x213743,
  /** Buttons, hovered rows, segmented-control cells - one step up again. */
  surfaceRaised: 0x2f4553,
  /** Hover/active state for a raised surface. */
  surfaceHover: 0x3d5564,
  /** Recessed "well" (a text field, a value readout) - reads as a hole, so it goes back DOWN to bg. */
  inset: 0x0f212e,
  /** Hairline rules and the only stroke colour that should ever be used. Use sparingly. */
  hairline: 0x2f4553,
  /** Full-screen scrim behind modals/overlays. */
  scrim: 0x0b1720,

  // --- The one accent. Primary action + win state, nothing else. ---
  accent: 0x00e701,
  accentHover: 0x1fff20,
  /** Text/label colour to sit ON the accent - the accent is bright, so this is dark. */
  onAccent: 0x0f212e,

  // --- Functional signals. Not decoration; only for real state. ---
  positive: 0x00e701,
  negative: 0xed4163,
  negativeHover: 0xf2647e,
  /** Informational/secondary action (rare). */
  info: 0x1475e1,
  infoHover: 0x2d8bf0,

  /**
   * Muted state tints for a CELL in a grid (a revealed gem, a matched Keno
   * number, a cleared tower step / a mine, a miss). These are surfaces, not
   * signals: they sit at roughly the same lightness as `surface` so a grid
   * of them still reads as one dark board, and the actual win/lose meaning
   * is carried by the glyph and text colour on top (direction note 2 - the
   * saturated accent stays reserved). Do NOT use these for text or strokes.
   */
  positiveMuted: 0x143c2c,
  negativeMuted: 0x3f1e28,

  // --- Text, as numbers (see `text` below for the CSS-string versions). ---
  textPrimary: 0xffffff,
  textSecondary: 0xb1bad3,
  textMuted: 0x7f92a6
} as const;

/**
 * Playing-card faces (Blackjack / Video Poker / Baccarat / Hi-Lo).
 *
 * A card is a real-world object, not a UI surface, so it is the one thing
 * in this system allowed to be light on a dark screen - that is what makes
 * a hand of cards read as cards. It is deliberately a DESATURATED near-white
 * rather than the old warm ivory, so it belongs to the same cool navy/slate
 * family as everything else. The face-down back is just `surfaceRaised`, so
 * an unturned card reads as "a control", which is exactly what it is.
 */
const card = {
  /** Face-up card face. */
  face: 0xe8ecf2,
  /** Face-down card back / an empty card slot's fill comes from `inset` instead. */
  back: color.surfaceRaised,
  /** Black suits (spades/clubs) - the page ground colour, printed on the light face. */
  ink: toCss(color.bg),
  /** Red suits (hearts/diamonds) - reuses the one functional red rather than inventing a card-only hue. */
  inkRed: toCss(color.negative)
} as const;

/**
 * Game-specific colour that genuinely cannot be expressed by the surface
 * ladder alone. Kept to an absolute minimum and mapped ONTO existing tokens
 * wherever possible rather than introducing new hues.
 */
const game = {
  /**
   * Roulette's three pockets. A wheel needs exactly three distinguishable
   * colours, and all three fall out of tokens already: black is simply a
   * raised surface, green is the accent (it is also the win state on this
   * screen), red is the one functional negative.
   */
  roulette: {
    red: color.negative,
    redHover: color.negativeHover,
    black: color.surfaceRaised,
    blackHover: color.surfaceHover,
    green: color.accent,
    greenHover: color.accentHover
  },

  /**
   * Wheel's payout ladder. A wheel of fortune is a pie chart, so its slices
   * genuinely have to be distinguishable from each other - but that does NOT
   * mean four hues. Three of the four steps are the surface ladder itself
   * (a losing slice is just a raised surface; the paying tiers step up
   * through the lighter surface and the muted positive tint), and only the
   * jackpot tier takes the one accent - it IS the win state, so it is the
   * single saturated thing on the screen (direction note 2). The result: a
   * dark wheel where the good slices visibly glow, rather than a carnival
   * colour wheel.
   */
  wheel: {
    zero: color.surfaceRaised,
    low: color.surfaceHover,
    mid: color.positiveMuted,
    jackpot: color.accent,
    /**
     * Slice separator. Deliberately the page GROUND rather than `hairline`:
     * a hairline in this system is a rule drawn on top of a surface, but
     * this is a gap cut between two slices, and `hairline` is the same value
     * as a losing slice so the two would merge into one blob.
     */
    divider: color.bg,
    /** Hub - a hole punched through the middle of the wheel, so it goes down to ground. */
    hub: color.bg
  }
} as const;

/** CSS-string colours - Phaser Text styles only accept strings, not numeric tokens. */
const text = {
  primary: toCss(color.textPrimary),
  secondary: toCss(color.textSecondary),
  muted: toCss(color.textMuted),
  accent: toCss(color.accent),
  onAccent: toCss(color.onAccent),
  positive: toCss(color.positive),
  negative: toCss(color.negative)
} as const;

/**
 * 4pt spacing scale. Every gap, pad and offset in a converted screen comes
 * from here - that regularity IS the "precise spacing" half of the look.
 */
const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40
} as const;

const radius = {
  /** Segmented-control cells, chips. */
  xs: 3,
  /** Inputs, small buttons - Stake's workhorse radius. */
  sm: 4,
  /** Primary buttons, readout wells. */
  md: 6,
  /** Panels, cards, the sidebar. */
  lg: 8,
  /** Only for something genuinely circular (a coin, a dot). */
  pill: 999
} as const;

const type = {
  /**
   * One font stack for the whole UI. Deliberately a SYSTEM stack: no web
   * font to download, no licence to clear, no layout shift - and on every
   * target platform it resolves to a clean neutral grotesque (Segoe UI on
   * Windows, SF on Apple, Roboto on Android). Phaser Text defaults to
   * Courier if `fontFamily` is not set, which is a large part of why the
   * current screens read as "old software".
   */
  family: '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif',
  size: {
    /** Micro-labels above a field. */
    xs: "10px",
    /** Field labels, footnotes, helper text. */
    sm: "11px",
    /** Body/message text. */
    md: "12px",
    /** Values, button labels. */
    lg: "13px",
    /** Emphasised values, screen title. */
    xl: "15px",
    /** Section heading. */
    xxl: "20px",
    /** Secondary hero (a card's rank, a spun number) - large, but not the one hero on the screen. */
    xxxl: "28px",
    /** Hero number (a multiplier, a result). */
    display: "44px"
  },
  /**
   * Pictogram sizes. Emoji and suit glyphs are ARTWORK, not type - they
   * carry no weight or tracking and they are sized to fill a cell rather
   * than to sit on a text baseline, so they get their own short scale
   * instead of borrowing (and quietly distorting) the type ramp above.
   */
  glyph: {
    /** Suit + rank on a small card slot. */
    xs: "16px",
    /** A grid tile's state icon (gem, bomb, tick). */
    sm: "18px",
    /** Suit + rank on a full-size card. */
    md: "22px",
    /** A single large card's rank. */
    lg: "32px",
    /** A slot reel symbol. */
    xl: "52px",
    /** The one big object on a screen (Coin Flip's coin). */
    hero: "90px"
  },
  weight: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700"
  },
  /**
   * Uppercase micro-labels get tracked out; everything else is set tight.
   * Phaser Text has no letter-spacing before 3.60's `setLetterSpacing`, so
   * this is applied via `setLetterSpacing` where available and is otherwise
   * a no-op - see `uiHelpers.ts`'s `applyTracking`.
   */
  tracking: {
    tight: 0,
    label: 0.6,
    caps: 1.2
  }
} as const;

/**
 * Elevation in a flat system is not shadows - it is which surface value you
 * sit on, plus (occasionally) a 1px lighter top edge. These are the only
 * three levels; anything needing a fourth is over-built.
 */
const elevation = {
  /** Sits directly on the page. No fill of its own. */
  flat: { fill: color.bg, topHighlight: 0 },
  /** A panel/card/sidebar. */
  raised: { fill: color.surface, topHighlight: 0 },
  /** A control sitting on a panel. Faint top edge to lift it a hair. */
  control: { fill: color.surfaceRaised, topHighlight: 0.05 }
} as const;

const motion = {
  duration: {
    /** Hover/press feedback. Should feel instant. */
    instant: 90,
    /** The default. Fades, colour changes, small moves. */
    base: 160,
    /** Entrances, result reveals. */
    slow: 260,
    /**
     * Cadence between items in a staggered reveal (cards dealt one at a
     * time, Keno numbers drawn one at a time). Longer than `slow` on
     * purpose: this is a rhythm the player watches, not a transition.
     */
    stagger: 200,
    /**
     * A long mechanical settle - a wheel coasting to a stop. The one
     * genuinely slow motion in the system, and only ever eased-out.
     */
    spin: 2400,
    /** How long a resolved result is left on screen before the game moves on by itself. */
    dwell: 1200
  },
  ease: {
    /** Default - decelerate into place. */
    out: "Cubic.Out",
    inOut: "Sine.easeInOut",
    /** The ONLY overshoot allowed, and only on a result number. */
    emphasis: "Back.Out"
  },
  /** Press-down scale for a button. Barely perceptible on purpose. */
  pressScale: 0.985,
  /** Alpha for a disabled control. */
  disabledAlpha: 0.35
} as const;

export const Tokens = { color, text, card, game, space, radius, type, elevation, motion } as const;
