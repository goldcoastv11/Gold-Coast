/**
 * Shared visual theme so every game screen and the coin panel match.
 *
 * "Warm Daylight" reskin (this pass): the previous "Arcade Nights" direction
 * (near-black charcoal / cold navy surfaces, neon-on-black accents) read as a
 * dark night-time arcade. Per direction, the target reference is now
 * Adventure Academy - warm, rounded, soft-lit, inviting - so every surface
 * moves off the cold blue-black axis onto a warm brown/amber one, and the
 * saturated neon accents are softened toward sunlit versions of themselves.
 * This supersedes the "Arcade Nights" note (and, before it, the "Bright
 * Social-Hub" pastel palette in STYLE_GUIDE.md, whose asset-licensing/
 * attribution sections are still the accurate ones).
 *
 * Key names are kept stable (bgDark, panel, accent, etc.) even though most no
 * longer literally match their name's original color - every scene references
 * these tokens by name via Theme.ts / uiHelpers.ts, so re-pointing the values
 * here is what makes the new look cascade everywhere without touching call
 * sites. That is also why this pass deliberately did NOT flip the chrome's
 * light-text-on-dark-surface polarity: see "Contrast contract" below.
 *
 * ## Contrast contract - read before changing any value here
 * Every one of the ~100 `scene.add.text()` call sites across the 14 game
 * scenes picks its color from the Text tokens at the bottom of this file and
 * draws it on one of the Surface tokens at the top. Those pairings are only
 * safe because the surfaces stay DARKER than the text, so the invariant this
 * file has to hold is:
 *
 *   bgDark / outline / inset / panel stay dark enough that the near-white
 *   Text tokens keep >= 4.5:1 contrast on them.
 *
 * `panel` is the lightest of the four and therefore the binding constraint -
 * it is a warm mid-walnut here (relative luminance ~0.10), which puts
 * textPrimary at ~6.5:1 and the 12px textMuted at ~5.2:1 on it. Lightening
 * `panel` much further would start failing textMuted first. Warming a surface
 * is free; LIGHTENING one is not, and a genuinely light "cream panel" look
 * would require flipping every Text token to dark AND re-checking every
 * button fill in this file - a much larger, riskier change than a re-point.
 *
 * `bgDark` in particular stays dark for a non-obvious reason: it is the Phaser
 * canvas `backgroundColor` (main.ts), so it is what game-screen text that sits
 * OUTSIDE a panel (each scene's own display-area multiplier/result labels)
 * actually renders against. It is nearly invisible in the overworld, which is
 * fully tiled over by BootScene's floor textures - so keeping it dark costs
 * the overworld nothing and keeps all 14 game screens legible.
 *
 * The genuinely light, sunlit surfaces in this reskin are the overworld's own
 * ground/wall/furniture textures, which carry no text at all - those live in
 * BootScene.ts's PALETTE, not here.
 */
export const Theme = {
  // --- Surfaces (see "Contrast contract" above before lightening any of these) ---
  bgDark: 0x2b211b, // scene/world backdrop - warm dark cocoa (was near-black charcoal 0x0e0f14)
  panel: 0x70543d, // rounded panel/card fill - warm walnut (was dark navy 0x1a2138)
  panelBorder: 0xc9a273, // sunlit tan rim-light outline - deliberately LIGHTER than the panel it strokes, so panel edges catch light instead of being drawn as a darker seam (was the darker steel-blue 0x2e3a5c)
  inset: 0x5c452f, // inset "well" fill (reel cells, balance pills) - recessed warm brown (was near-black navy 0x12182a)
  outline: 0x2e211a, // deep warm brown line art - card/board strokes, dividers, pins, and drawCabinetFrame's backdrop fill (was near-black 0x05070c)

  // --- Brand / actions (softened toward sunlit, away from neon) ---
  accent: 0xef8b3f, // warm sunlit orange - main buttons / positive actions / CTAs (was the more neon 0xff7a29)
  accentHover: 0xffa563,
  secondary: 0x3a6fae, // softened mid-blue - headers / secondary panels / info (was electric 0x2f5fbf); held near its old luminance since makeButton draws near-white text on it
  secondaryHover: 0x5a8cc9,
  danger: 0xd9564a, // warmer, less shrill red - negative actions / losses
  dangerHover: 0xef7a6d,
  neutral: 0x7d6853, // warm taupe - plain/secondary buttons (was cold slate-blue 0x39435c)
  neutralHover: 0x998272,
  gold: 0xf0b95e, // warm honey - cash-out / jackpot highlights, distinct from the primary orange accent
  goldHover: 0xffd08a,
  success: 0x4fb872, // leafy green - win states (universal "safe/win" signal, kept as a functional accent, just softened off neon)

  // --- Soft tint fills (zone bars / cell states) ---
  winZone: 0x3f7a52, // muted sage green - "this side wins" fills
  loseZone: 0x8a4a3e, // muted terracotta - "this side loses" fills

  // --- Playing cards (used by Blackjack/VideoPoker/Baccarat/HiLo) ---
  cardFace: 0xfdf6e8, // warm ivory
  cardBorder: 0x4a3628,
  cardTextBlack: "#2e211a", // warm near-black, matches `outline`
  cardTextRed: "#c0392b",

  // --- Text ---
  textPrimary: "#fff6e9", // warm off-white - primary readable text on the dark surfaces above
  textMuted: "#efdcc4", // warm sand - secondary/muted text. Lighter than the old cold #9aa3bd on purpose: this is the smallest text in the game (12px) and `panel` is warmer/lighter than it used to be, so the old muted value would have dropped under 4.5:1 on it
  textGold: "#ffcc7a",
  textAccent: "#ffa763",
  textDanger: "#ff8a7d",
  textOnDark: "#fff6e9" // label text for dark-fill buttons - same warm off-white as textPrimary (keep in sync if `panel` changes)
};

/**
 * Display typeface for every piece of text the game draws.
 *
 * Baloo 2 (Google Fonts, SIL Open Font License 1.1 - commercial use fine, no
 * attribution required) - a warm, rounded, slightly chunky display face,
 * chosen to match the same Adventure Academy reference the palette above is
 * aiming at. Before this, no `scene.add.text()` call site in the project set
 * a fontFamily at all, so every one of them silently fell back to Phaser's
 * own built-in default of "Courier" - a cold monospace, which is a large part
 * of why the UI read as a utilitarian terminal rather than a friendly game.
 *
 * Applied globally, NOT per call site: main.ts wraps Phaser's `text` game
 * object factory so this stack is injected as the default into every
 * `scene.add.text()` in the project at once. That is what lets the overworld
 * pick the font up without editing OverworldScene.ts (which is being
 * restructured under a separate change), and it means a call site that DOES
 * pass its own fontFamily still wins.
 *
 * The fallbacks are real, ordered, and deliberately not just "sans-serif":
 * Trebuchet MS and Verdana both ship on Windows/macOS and are the widest,
 * friendliest, highest-x-height faces in the default set, so a failed webfont
 * load degrades to something with roughly Baloo 2's proportions rather than
 * reflowing hard into a narrow default.
 */
export const DISPLAY_FONT = '"Baloo 2", "Trebuchet MS", Verdana, sans-serif';

/**
 * The specific weights/sizes BootScene warms up before it hands off to the
 * first text-bearing scene (see BootScene.create). Phaser measures and
 * rasterizes text once at creation time and does not re-measure when a
 * webfont finishes loading later, so any text created before the font is
 * ready would stay stuck in the fallback for that scene's whole lifetime -
 * not just for one frame. 400 is body/label text, 700 covers the `fontStyle:
 * "bold"` headings and button labels.
 */
export const DISPLAY_FONT_PRELOAD = ['400 16px "Baloo 2"', '700 16px "Baloo 2"'];

/**
 * Resolves once the display font is actually usable for rendering - or gives
 * up and resolves `false` after `timeoutMs`. Awaited by BootScene before it
 * hands off to the first scene that draws text.
 *
 * Why this is needed at all: the `<link>` in index.html only kicks off the
 * download, and `font-display: swap` (the `&display=swap` on that URL) means
 * the browser deliberately renders a fallback first and swaps later. A DOM
 * page re-flows for free when that swap happens; a Phaser canvas does not -
 * Phaser measures and rasterizes each Text object once at creation time and
 * has no notion of re-measuring later. So text created during the swap window
 * doesn't just flash the fallback for a frame, it stays in the fallback (at
 * fallback metrics, so also mis-centered) until that object is destroyed.
 *
 * `fonts.load()` per weight, not just `fonts.ready`: `ready` resolves once
 * font loading for the *current layout* has settled, and nothing in this
 * canvas-only game ever lays out DOM text in Baloo 2, so no load would have
 * been triggered for `ready` to wait on. `load()` is what actually requests
 * each weight; `ready` afterward is the cheap belt-and-braces wait.
 *
 * Never rejects and never hangs - a blocked CDN, an offline first load, or a
 * browser without the CSS Font Loading API all resolve `false` and let boot
 * continue in the fallback stack. A missing font is a cosmetic problem; a
 * boot that never reaches LoginScene is a broken game.
 */
export async function whenDisplayFontReady(timeoutMs = 3000): Promise<boolean> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return false;

  const loaded = Promise.all(DISPLAY_FONT_PRELOAD.map((spec) => fonts.load(spec)))
    .then(() => fonts.ready)
    .then(() => true)
    .catch(() => false);
  const timedOut = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), timeoutMs);
  });

  return Promise.race([loaded, timedOut]);
}
