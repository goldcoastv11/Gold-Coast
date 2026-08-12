/**
 * Shared visual theme so every game screen and the coin panel match.
 *
 * "Bright Social-Hub" reskin (task #22) — palette and direction sourced from
 * `STYLE_GUIDE.md` (task #21): saturated mint-teal / sky-blue / coral-orange,
 * warm cream backdrops, thick warm dark-brown outlines (never pure black),
 * rounded shapes, no neon glow. Replaces the old dark-neon-casino theme.
 *
 * Key names are kept stable (bgDark, panel, accent, etc.) even though a few
 * no longer literally match their name (e.g. `bgDark` now holds a light
 * cream) — every scene references these tokens by name via Theme.ts /
 * uiHelpers.ts, so re-pointing the values here is what makes the new look
 * cascade everywhere without touching call sites.
 */
export const Theme = {
  // --- Surfaces ---
  bgDark: 0xfff6e9, // scene/world backdrop - warm cream (STYLE_GUIDE "Background")
  panel: 0xfdf3e1, // rounded panel/card fill - warm off-white (STYLE_GUIDE "Panel / card fill")
  panelBorder: 0x8a5a3b, // warm mid-brown outline stroke - never pure black (direction note 2)
  inset: 0xeaf7fb, // inset "well" fill (reel cells, balance pills) - pale sky blue (STYLE_GUIDE "Background-alt")
  outline: 0x5c2e22, // darker warm-brown line art - card/board strokes, dividers, pins

  // --- Brand / actions ---
  accent: 0x3bd2ab, // primary mint-teal (STYLE_GUIDE "Primary") - main buttons / positive actions
  accentHover: 0x6fe3c5,
  secondary: 0x59b6d8, // sky blue (STYLE_GUIDE "Secondary") - headers / secondary panels / info
  secondaryHover: 0x8ccbe6,
  danger: 0xc2504d, // brick-red (STYLE_GUIDE "Danger / warning") - negative actions / losses
  dangerHover: 0xd47a77,
  neutral: 0xc6bc9f, // neutral sand (STYLE_GUIDE "Neutral sand") - plain/secondary buttons
  neutralHover: 0xd9d0b6,
  gold: 0xf5aa57, // accent-warm gold-orange (STYLE_GUIDE "Accent-warm") - cash-out / jackpot highlights
  goldHover: 0xf8c489,
  success: 0x42dfab, // bright green (STYLE_GUIDE "Success / positive")

  // --- Soft tint fills (pale, for zone bars / cell states - readable on light bg) ---
  winZone: 0xbff0de, // pale mint - "this side wins" fills
  loseZone: 0xf3cfc9, // pale coral - "this side loses" fills

  // --- Playing cards (used by Blackjack/VideoPoker/Baccarat/HiLo) ---
  cardFace: 0xfdf9f0,
  cardBorder: 0x5c2e22,
  cardTextBlack: "#3a2a20",
  cardTextRed: "#c2504d",

  // --- Text ---
  textPrimary: "#2b2340", // deep plum-navy (STYLE_GUIDE "Text - primary")
  textMuted: "#6b5b73", // muted mauve-gray (STYLE_GUIDE "Text - secondary / muted")
  textGold: "#b9762b",
  textAccent: "#1f8e73",
  textDanger: "#9c3f3d",
  textOnDark: "#fdf3e1" // light label text for dark-fill buttons (string form of `panel`) - keep in sync if `panel` changes
};
