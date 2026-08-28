/**
 * Character rig descriptors - the single explicit source of truth for how a
 * character spritesheet is laid out, how big it should be drawn, where its
 * physics footprint sits, and where the top of its head is.
 *
 * ## Why this file exists
 *
 * Until now this project carried THREE incompatible character rigs and told
 * them apart implicitly, by guessing from the frame height (`height <= 16`)
 * in three separate places (OverworldScene's idleFrameForDir /
 * applyPlayerBody / applyPlayerScale), with a fourth and fifth copy of the
 * layout knowledge inlined in BootScene's two createWalkAnims variants,
 * OverworldScene's AMBIENT_IDLE_FRAME_FOR_DIR table and updatePetFollow's
 * "same formula, inlined" idle-frame math. That heuristic works only as long
 * as exactly one rig is <= 16px tall; the moment a second small-or-large rig
 * lands it silently mislabels one of them, and the failure mode is a
 * character that moonwalks or faces the wrong way rather than an error.
 *
 * Adding the LPC rig (64x64, 13 columns, 54 rows) breaks that heuristic
 * outright, so the guess is replaced here by an explicit declaration: each
 * sheet says what it is, and every consumer reads the answer instead of
 * re-deriving it. The three existing rigs are declared exactly as they
 * already were, so nothing about them changes - see the per-rig comments,
 * which record the value each field is reproducing.
 *
 * ## Frame numbering
 *
 * Phaser numbers a loaded spritesheet's frames row-major over its columns:
 * `frame = row * columns + col`. Every absolute frame index below is derived
 * from that, so `columns` has to be right or every index is wrong.
 */

export type Direction = "down" | "left" | "right" | "up";

export const DIRECTIONS: readonly Direction[] = ["down", "left", "right", "up"];

/** Physics footprint as fractions of the NATIVE frame size (not the displayed size). */
export interface RigBodyFractions {
  widthFrac: number;
  heightFrac: number;
  offsetXFrac: number;
  offsetYFrac: number;
}

export interface CharacterRig {
  /** Stable id, used by the sheet registry below and in test assertions. */
  id: string;
  frameWidth: number;
  frameHeight: number;
  /** Frames per sheet row. Drives the `row * columns + col` frame math above. */
  columns: number;
  /** Absolute frame indices of each direction's walk cycle, in play order. */
  walkFrames: Record<Direction, number[]>;
  /** Absolute frame index of each direction's standing/idle pose. */
  idleFrames: Record<Direction, number>;
  /**
   * Scale this rig is drawn at so every rig lands at roughly the same
   * on-screen height regardless of its native resolution.
   */
  displayScale: number;
  /** Small "feet" collision box, as fractions of the native frame. */
  body: RigBodyFractions;
  /**
   * Where the top of the character's HEAD sits inside the frame, as a
   * fraction of frame height measured down from the top edge.
   *
   * 0 means "the head touches the top edge of the frame", which is what the
   * old hardcoded `y - displayHeight / 2` accessory/HUD math assumed. All
   * three legacy rigs declare 0 so their badge/label positions are
   * bit-identical to before; only a rig with real headroom inside its frame
   * (LPC) declares anything else.
   */
  headTopFrac: number;
  /**
   * Multiplier applied to the sprite's own scale when drawing a worn
   * accessory. The accessory textures (BootScene's createAccessoryTextures)
   * were drawn to sit on a head about 8-10px wide, which is what the three
   * legacy rigs have - so they all declare 1. A rig whose head is wider in
   * frame space needs the badge scaled up to match, or the hat perches on
   * top of the head like a party favour instead of being worn.
   */
  accessoryScaleMul: number;
}

/**
 * How far behind the player the companion pet trails, as a fraction of the
 * player rig's BASE display height (`frameHeight * displayScale`) - not its
 * live displayHeight, deliberately: on touch devices the player is scaled up
 * a further 1.5x (MOBILE_CHAR_SCALE_BOOST) and the trail distance has always
 * been a flat 26px on every device. Anchoring to the base height keeps that
 * exactly true (0.8125 * 32 == 26 for both existing player rigs, on both
 * desktop and mobile) while still giving a taller rig a proportionally
 * longer trail.
 */
export const PET_TRAIL_OFFSET_FRAC = 26 / 32;

/**
 * Pet sprites are drawn smaller than a full character - reproduces the
 * previous hardcoded `setScale(1.4)` from the Kenney pet rig's own
 * displayScale of 2 (2 * 0.7 == 1.4).
 */
export const PET_SCALE_OF_RIG = 0.7;

/** Shared "feet" footprint of the three pre-existing rigs - the exact 14x10 box at offset (3.5, 20) that applyPlayerBody has always produced on a 21x32 legacy frame, expressed as fractions so it scales to any of them. */
const LEGACY_ERA_BODY: RigBodyFractions = {
  widthFrac: 14 / 21,
  heightFrac: 10 / 32,
  offsetXFrac: 3.5 / 21,
  offsetYFrac: 20 / 32
};

/** Builds `{down,left,right,up}` walk-frame arrays for a 4-columns-of-direction x N-rows-of-frame sheet (the Kenney/flat layout). */
function columnMajorWalkFrames(
  columns: number,
  rows: number,
  dirColumn: Record<Direction, number>
): Record<Direction, number[]> {
  const out = {} as Record<Direction, number[]>;
  for (const dir of DIRECTIONS) {
    out[dir] = Array.from({ length: rows }, (_, row) => row * columns + dirColumn[dir]);
  }
  return out;
}

/** Builds `{down,left,right,up}` walk-frame arrays for a N-columns-of-frame x 4-rows-of-direction sheet (the legacy/LPC layout). */
function rowMajorWalkFrames(
  columns: number,
  dirRow: Record<Direction, number>,
  frameColumns: number[]
): Record<Direction, number[]> {
  const out = {} as Record<Direction, number[]>;
  for (const dir of DIRECTIONS) {
    out[dir] = frameColumns.map((col) => dirRow[dir] * columns + col);
  }
  return out;
}

/**
 * Kenney "RPG Urban Pack" rig - 16x16 frames, 4 columns (direction) x 3 rows
 * (walk frame), column order [left, down, up, right]. Used by the NPC/dealer/
 * bystander sheets and by all three purchasable pets.
 *
 * Reproduces BootScene's old createKenneyWalkAnims DIRECTION_FRAMES exactly:
 * left [0,4,8], down [1,5,9], up [2,6,10], right [3,7,11]. The idle pose is
 * each direction's MIDDLE frame (col + 4), matching the old idleFrameForDir.
 */
export const KENNEY_RIG: CharacterRig = {
  id: "kenney",
  frameWidth: 16,
  frameHeight: 16,
  columns: 4,
  walkFrames: columnMajorWalkFrames(4, 3, { left: 0, down: 1, up: 2, right: 3 }),
  idleFrames: { left: 4, down: 5, up: 6, right: 7 },
  displayScale: 2,
  body: LEGACY_ERA_BODY,
  headTopFrac: 0,
  accessoryScaleMul: 1
};

/**
 * The flat/vector player sheet generated procedurally in BootScene
 * (createFlatCharacterSheet). Deliberately built to the Kenney layout so it
 * could drop in without touching the old rig-detection branches - so it is
 * the Kenney rig in every respect except its id.
 */
export const FLAT_RIG: CharacterRig = { ...KENNEY_RIG, id: "flat" };

/**
 * The old Jephed-pack rig still used by all 17 purchasable skins and the
 * ambient bystanders - 21x32 frames, 3 columns (walk frame) x 4 rows
 * (direction), row order [down, left, right, up].
 *
 * Reproduces createLegacySkinWalkAnims' `start = row * 3, end = start + 2`
 * exactly, and idleFrameForDir's `row * 3 + 1` (the middle frame). The
 * bystander code separately wants each direction's FIRST frame, which is now
 * read off `walkFrames[dir][0]` instead of its own duplicate table.
 */
export const LEGACY_SKIN_RIG: CharacterRig = {
  id: "legacy",
  frameWidth: 21,
  frameHeight: 32,
  columns: 3,
  walkFrames: rowMajorWalkFrames(3, { down: 0, left: 1, right: 2, up: 3 }, [0, 1, 2]),
  idleFrames: { down: 1, left: 4, right: 7, up: 10 },
  displayScale: 1,
  body: LEGACY_ERA_BODY,
  headTopFrac: 0,
  accessoryScaleMul: 1
};

// --- LPC (Universal LPC Spritesheet Generator) -------------------------------
//
// The numbers below are NOT guesses - they are the published layout constants
// of the generator itself (sources/state/constants.ts in
// LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator):
//
//   FRAME_SIZE = 64
//   STANDARD_ANIMATION_FRAMES_PER_ROW = 13   (sheet is 832px wide)
//   DIRECTIONS = ["up", "left", "down", "right"]   <- LPC row order
//   ANIMATION_CONFIGS.walk = { row: 8, num: 4, cycle: [1,2,3,4,5,6,7,8] }
//
// Two details are the classic ways this gets got wrong, so they are spelled
// out here:
//
//  1. LPC's direction order is up, left, down, right - NOT the down-first
//     order both of this project's other rigs use. Walk rows are therefore
//     8 = up, 9 = left, 10 = down, 11 = right. Getting this backwards makes
//     characters face the wrong way, which looks like a movement bug.
//  2. A walk row has NINE columns, and column 0 is the STANDING pose, not
//     part of the cycle - the generator's own cycle is [1..8]. Including
//     column 0 in the walk animation is what makes an LPC character look
//     like it hitches or moonwalks once per stride. Column 0 is exactly what
//     we want for the idle frame instead.
//
// The full sheet the generator's "Download PNG" button produces is
// 832 x 3456 (13 columns x 54 rows) and contains every animation; we only
// address the four walk rows out of it, so the rest costs nothing but file
// size. See docs/character-art-spec.md for the founder-facing export recipe.
/** Frames per row on a standard LPC sheet (13 * 64px = 832px wide). */
export const LPC_COLUMNS = 13;
/** Row index of the first walk row (`ANIMATION_CONFIGS.walk.row`). */
export const LPC_WALK_ROW = 8;
/** The generator's own walk cycle: columns 1-8. Column 0 is the standing pose. */
export const LPC_WALK_CYCLE = [1, 2, 3, 4, 5, 6, 7, 8];

export const LPC_RIG: CharacterRig = {
  id: "lpc",
  frameWidth: 64,
  frameHeight: 64,
  columns: LPC_COLUMNS,
  walkFrames: rowMajorWalkFrames(
    LPC_COLUMNS,
    {
      up: LPC_WALK_ROW + 0,
      left: LPC_WALK_ROW + 1,
      down: LPC_WALK_ROW + 2,
      right: LPC_WALK_ROW + 3
    },
    LPC_WALK_CYCLE
  ),
  idleFrames: {
    up: (LPC_WALK_ROW + 0) * LPC_COLUMNS,
    left: (LPC_WALK_ROW + 1) * LPC_COLUMNS,
    down: (LPC_WALK_ROW + 2) * LPC_COLUMNS,
    right: (LPC_WALK_ROW + 3) * LPC_COLUMNS
  },
  // An LPC character stands roughly 48px tall inside its 64px frame, vs the
  // ~32px on-screen height both existing rigs land at. 0.7 puts it at ~34px -
  // the same apparent size as today's characters next to unchanged 48x64
  // cabinet furniture. This is the one number here that is a judgement call
  // rather than a published constant, and it is the knob to turn if real LPC
  // art reads too big or too small on the floor.
  displayScale: 0.7,
  // Feet footprint inside a 64px frame: the character is ~20px wide, centred,
  // standing on roughly y 52-60. Much narrower and much lower than
  // LEGACY_ERA_BODY, which assumed a frame the character fills edge to edge.
  body: {
    widthFrac: 20 / 64,
    heightFrac: 8 / 64,
    offsetXFrac: 22 / 64,
    offsetYFrac: 52 / 64
  },
  // ~12px of empty headroom above the head inside the frame. Without this the
  // hat/HUD label would float a full 12 device px above where the head
  // actually is (the frame's top edge, not the character's).
  headTopFrac: 12 / 64,
  // An LPC head is ~14px wide in frame space vs ~8px on the legacy rigs, so
  // the accessory art has to grow with it to still read as worn.
  accessoryScaleMul: 1.7
};

export const RIGS = {
  flat: FLAT_RIG,
  kenney: KENNEY_RIG,
  legacy: LEGACY_SKIN_RIG,
  lpc: LPC_RIG
} as const;

export type RigId = keyof typeof RIGS;

/**
 * One LPC outfit sheet exported from the generator.
 *
 * DELIBERATELY EMPTY until real art exists. This is the whole "make the
 * codebase ready" seam: dropping a PNG into public/assets/characters/lpc/ and
 * adding one entry here is all it takes for BootScene to load it, build its
 * walk animations and register its rig. Nothing else has to change.
 *
 * `textureKey` doubles as the walk-animation prefix (same convention as
 * SKIN_CATALOG, where a skin's id is its anim prefix).
 */
export interface LpcSheetDef {
  textureKey: string;
  /** Filename inside public/assets/characters/lpc/ */
  file: string;
}

export const LPC_CHARACTER_SHEETS: LpcSheetDef[] = [];

/**
 * Which rig each already-loaded character sheet uses. Explicit, because the
 * old `height <= 16` guess cannot survive a fourth rig - see this file's
 * header.
 */
const SHEET_RIGS = new Map<string, CharacterRig>([
  ["player_flat_sheet", FLAT_RIG],
  ["player_sheet", KENNEY_RIG],
  ["npc_sheet", KENNEY_RIG],
  ["dealer_sheet", KENNEY_RIG],
  ["npc2_sheet", KENNEY_RIG],
  ["npc3_sheet", KENNEY_RIG],
  ["npc4_sheet", KENNEY_RIG]
]);

// Every purchasable skin sheet (skin_000 .. skin_016) is the legacy rig.
// Registered by loop rather than 17 hand-written lines so a new legacy skin
// can never be half-registered.
for (let i = 0; i <= 16; i++) {
  SHEET_RIGS.set(`skin_${String(i).padStart(3, "0")}`, LEGACY_SKIN_RIG);
}

for (const sheet of LPC_CHARACTER_SHEETS) {
  SHEET_RIGS.set(sheet.textureKey, LPC_RIG);
}

/**
 * The rig a given character texture key uses.
 *
 * `nativeFrameHeight` is an optional last-resort fallback for a sheet nobody
 * registered: it reproduces the old `height <= 16` guess so an unregistered
 * sheet degrades to exactly the behaviour it would have had before this file
 * existed, rather than to something new. Registered sheets never reach it.
 */
export function resolveRig(textureKey: string, nativeFrameHeight?: number): CharacterRig {
  const known = SHEET_RIGS.get(textureKey);
  if (known) return known;
  return nativeFrameHeight !== undefined && nativeFrameHeight <= 16 ? KENNEY_RIG : LEGACY_SKIN_RIG;
}

/** True if `textureKey` has an explicit rig declared (i.e. resolveRig won't fall back to the legacy guess). */
export function hasRegisteredRig(textureKey: string): boolean {
  return SHEET_RIGS.has(textureKey);
}

/**
 * World Y of the top of the character's head.
 *
 * For every pre-existing rig `headTopFrac` is 0, so this reduces to the
 * `spriteY - displayHeight / 2` the accessory badge and HUD label have always
 * used - identical pixels, just no longer assuming the character fills its
 * frame vertically.
 */
export function headTopY(rig: CharacterRig, spriteY: number, displayHeight: number): number {
  return spriteY - displayHeight / 2 + rig.headTopFrac * displayHeight;
}

/** How far behind the player the pet trails, in world px. See PET_TRAIL_OFFSET_FRAC. */
export function petTrailOffset(rig: CharacterRig): number {
  return PET_TRAIL_OFFSET_FRAC * rig.frameHeight * rig.displayScale;
}
