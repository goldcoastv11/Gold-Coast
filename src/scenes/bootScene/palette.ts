/**
 * Shared warm "Daylight" drawing palette used by every procedural texture
 * generator under src/scenes/bootScene/ - split out of BootScene.ts (which
 * used to hold every generator directly) so each domain module (characters,
 * cabinets, room decor, UI stations, floor/wall tiles) can reference the
 * SAME tokens without re-declaring them.
 *
 * "Warm Daylight" reskin (this pass): every procedurally-drawn ground, wall
 * and cabinet/table texture in src/scenes/bootScene/ moves off the previous
 * "Arcade Nights" dark charcoal-navy body onto a warm, sunlit brown/sand/
 * amber register, per direction - the target reference is Adventure Academy
 * (warm, rounded, soft-lit, inviting) rather than the dark night-time arcade
 * the old palette produced. Supersedes the "Arcade Nights" direction, which
 * itself replaced the "Bright Social-Hub" pastel palette in STYLE_GUIDE.md.
 *
 * Key names are kept stable (cabinet, felt, mint, coral, cream, etc.) even
 * though most no longer literally match their old color - every
 * create*Texture() generator across src/scenes/bootScene/ references PALETTE
 * by name, so re-pointing the values here is what makes the new look
 * cascade everywhere without touching each drawing function. As part of
 * this pass the four ground/wall tiles were brought INTO that scheme:
 * createFloorTanTexture/createCarpetBlueTexture/createCarpetRedTexture/
 * createWallTexture used to hardcode their own inline hex literals, which
 * made them the one set of textures a PALETTE re-point could NOT reach -
 * they now reference the ground tokens below like everything else, so
 * PALETTE is finally the single chokepoint this comment always claimed it
 * was. (Those four are drawn procedurally, not loaded: the Kenney "RPG Urban
 * Pack" they came from had no dark equivalent when "Arcade Nights" landed,
 * and they've stayed procedural since.)
 *
 * Theme.ts/uiHelpers.ts (chrome UI palette) is a separate token set, kept in
 * sync by hand (not literally shared) since this file has no import
 * relationship to it. Note the two are deliberately NOT the same lightness:
 * nothing in this file has text drawn on top of it, so these surfaces are
 * free to go genuinely light/sunlit, whereas Theme.ts's surfaces have to stay
 * dark enough to carry near-white text - see Theme.ts's "Contrast contract".
 */
export const PALETTE = {
  /** Deep warm brown outline used on every drawn shape - soft-lit line art rather than the previous near-black 0x05070c, which read as hard/inky against the new light surfaces. Still dark enough to hold every shape's silhouette. */
  outline: 0x3d2a1e,
  /** Warm ivory - "cabinet" furniture body (was terracotta, then dark navy, then cold white 0xf2f3f7). The white was chosen so cabinets would pop against a near-black floor; with the floor now light sand, separation instead comes from the cabinet being the LIGHTEST and least saturated thing on the floor, plus its full-strength `outline` stroke. */
  cabinet: 0xfbf1de,
  /** Warm tan - trim/base/plinth accents, a shade darker than `cabinet` for shape definition (was cold light gray). */
  cabinetDark: 0xd8bd94,
  /** Muted slate-teal "screen" panel background - still clearly a lit screen against the ivory cabinet body, but warmer and less inky than the old 0x131a2c so it reads as glass catching daylight rather than a black void. */
  screen: 0x2f4a63,
  /** Slightly deeper alt panel. */
  screenAlt: 0x263c52,
  /** Sunlit emerald felt for card/dice tables - classic table-felt green, which sits far warmer against the ivory cabinet rail than the old royal blue 0x1b3a6b did against a near-black one. */
  felt: 0x37806a,
  /** Green - "positive/safe" grid-cell color (mines' safe cells, keno default cells, plant foliage) - kept as a green functional accent (universal win/safe signal), softened off the previous neon 0x2ecc71 now that it no longer has to shout over a dark background. */
  mint: 0x5cc47f,
  /** Lighter green variant. */
  mintBright: 0x8ade9f,
  /** Soft sky blue - secondary accent, and the flat player character's body color (see createFlatCharacterSheet). Softened from the old electric 0x3d7fd9; still the most saturated cool note on the floor, which is what keeps the player readable against warm sand. */
  sky: 0x5b9fd6,
  /** Warm sunlit orange - primary brand accent, matches Theme.accent. */
  coral: 0xef8b3f,
  /** Warm honey - jackpot/highlight accent, matches Theme.gold. */
  gold: 0xf0b95e,
  /** Warmer, less shrill red - danger/loss accent, matches Theme.danger. */
  danger: 0xd9564a,
  /** Warm ivory - card faces / light elements on furniture (matches Theme.cardFace). */
  cream: 0xfdf6e8,

  // --- Ground & walls (new tokens this pass - previously inline hex
  // literals inside the four create*Texture methods below, see the class
  // comment). These are the largest surfaces in the overworld by area and
  // therefore the single biggest lever on how the world reads; they carry no
  // text, so they're free to be genuinely light. ---
  /** Warm sunlit sand - the main plaza floor (was near-black charcoal 0x1c1e24, the single darkest and largest surface in the game). */
  floor: 0xd9c39b,
  /** Slightly deeper sand fleck for plaza floor texture. NOTE the polarity is inverted from the old palette on purpose: the flecks used to be LIGHTER than their base because the base was near-black and a darker fleck was invisible on it. The rule being preserved is "a fleck has to be visible," which on a light floor means going darker, not lighter. */
  floorFleck: 0xc6a97e,
  /** Warm terracotta - the gaming-floor "rug" tile. Reads as a clay/kilim rug laid over the sand plaza, and stays clearly distinct from it in both hue and value (the old pairing relied on a dark-grey vs dark-blue distinction that was nearly invisible in practice). */
  rug: 0xb9724c,
  /** Deeper terracotta fleck for the rug. */
  rugFleck: 0xa9633f,
  /** Deep warm red - the unused-but-kept `carpet_red` tile (see createCarpetRedTexture). */
  rugRed: 0x9e4a3a,
  /** Deeper fleck for the red rug variant. */
  rugRedFleck: 0x8c3f30,
  /** Warm sandstone plaster - the perimeter wall (was dark navy brick 0x161c30). */
  wall: 0xc9a27a,
  /** Mortar/course line on the wall, a shade deeper than `wall` (was a near-black 0x0a0e1a seam). */
  wallLine: 0xa8825d,

  // --- Shading tokens (detail pass) ---------------------------------------
  // Every surface in this file used to be a FLAT fill inside an outline: no
  // light direction, no volume, no material. That - not the pixel count - is
  // what made the floor read as blocky next to hand-drawn reference art. The
  // world is drawn 1:1 into the 800x600 canvas (TILE is 16 and every tile
  // image is a 16px texture at scale 1; cabinets are 48x64 textures at scale
  // 1), so a bigger texture at the same world size would add no visible
  // pixels at all - it would just be resampled straight back down by
  // `pixelArt: true`'s NEAREST filter, which drops rows rather than blending
  // them. The detail therefore has to come from USING the pixels that are
  // already there: a consistent light direction (top-left), a shadow side,
  // a contact shadow, and real material texture (paving joints, brick
  // courses, weave, screen glass).
  //
  // These two are drawn at low alpha over whatever is beneath them, so one
  // pair works on every surface regardless of its base colour.
  /** Warm white, used at low alpha as the lit (top-left) edge of a form. */
  litEdge: 0xfffaf0,
  /** The outline brown, used at low alpha as the shaded (bottom-right) edge and as contact shadow. */
  shadeEdge: 0x3d2a1e
} as const;

/** Light comes from the top-left, consistently, on every surface in this file. */
export const LIT_ALPHA = 0.28;
export const SHADE_ALPHA = 0.22;
/** Contact shadow cast on the floor directly under a piece of furniture. */
export const CONTACT_SHADOW_ALPHA = 0.16;
