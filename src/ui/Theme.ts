/**
 * Shared visual theme so every game screen and the coin panel match.
 *
 * "Arcade Nights" reskin (Gold Coast Arcade rebrand): dark charcoal-black /
 * navy-blue surfaces with vivid orange + white brand accents, per direction
 * ("look more like Dave and Busters - blacks and dark blues as primary
 * colors, orange and white as secondary"). Replaces the previous "Bright
 * Social-Hub" pastel palette (see STYLE_GUIDE.md - superseded, kept only
 * for its still-accurate asset-licensing/attribution sections). The old
 * "never pure black" rule is explicitly OVER-RIDDEN here - true dark
 * surfaces are the whole point of this direction now, not something to
 * avoid.
 *
 * Key names are kept stable (bgDark, panel, accent, etc.) even though most
 * no longer literally match their name's original color (e.g. `bgDark` was
 * a light cream under the old theme; it's an actual dark charcoal now) -
 * every scene references these tokens by name via Theme.ts / uiHelpers.ts,
 * so re-pointing the values here is what makes the new look cascade
 * everywhere without touching call sites.
 */
export const Theme = {
  // --- Surfaces ---
  bgDark: 0x0e0f14, // scene/world backdrop - near-black charcoal
  panel: 0x1a2138, // rounded panel/card fill - dark navy-blue
  panelBorder: 0x2e3a5c, // steel-blue structural outline
  inset: 0x12182a, // inset "well" fill (reel cells, balance pills) - recessed near-black navy
  outline: 0x05070c, // near-black line art - card/board strokes, dividers, pins

  // --- Brand / actions ---
  accent: 0xff7a29, // vivid orange (Secondary/brand accent) - main buttons / positive actions / CTAs
  accentHover: 0xff9552,
  secondary: 0x2f5fbf, // electric dark blue (Primary family) - headers / secondary panels / info
  secondaryHover: 0x4a7ad9,
  danger: 0xe0473f, // red - negative actions / losses
  dangerHover: 0xf06860,
  neutral: 0x39435c, // muted slate-blue - plain/secondary buttons
  neutralHover: 0x4c5878,
  gold: 0xffb347, // amber-gold - cash-out / jackpot highlights, distinct from primary orange accent
  goldHover: 0xffc774,
  success: 0x33d17a, // bright green - win states (universal "safe/win" signal, kept as a functional accent)

  // --- Soft tint fills (zone bars / cell states - now darker/desaturated for a dark bg) ---
  winZone: 0x1f6b4a, // deep muted green - "this side wins" fills
  loseZone: 0x6b2620, // deep muted red - "this side loses" fills

  // --- Playing cards (used by Blackjack/VideoPoker/Baccarat/HiLo) ---
  cardFace: 0xf5f0e6,
  cardBorder: 0x141824,
  cardTextBlack: "#1a1d24",
  cardTextRed: "#c0392b",

  // --- Text ---
  textPrimary: "#f5f6fa", // near-white - primary readable text on dark surfaces
  textMuted: "#9aa3bd", // muted steel-gray-blue - secondary/muted text
  textGold: "#ffb347",
  textAccent: "#ff8a3d",
  textDanger: "#ff6b60",
  textOnDark: "#f5f6fa" // label text for dark-fill buttons - same near-white as textPrimary now that most surfaces are dark (keep in sync if `panel` changes)
};
