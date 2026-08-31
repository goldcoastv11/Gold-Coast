import Phaser from "phaser";

/**
 * SCREEN GEOMETRY - the one place that knows the canvas is not fixed.
 * =====================================================================
 *
 * Every scene and panel in this game was originally authored against a
 * fixed 800x600 canvas, and a LOT of code still assumes that by writing
 * the literal numbers 400 (center X), 300 (center Y), 800 (width) or 600
 * (height) directly. That assumption is false at runtime: `src/main.ts`
 * keeps height pinned at 600 but WIDENS the live canvas to match the
 * device's own aspect ratio (`computeLandscapeWidth()`), clamped to
 * [800, 1600]. A phone in landscape commonly lands around 1300-1400 wide.
 * Height never varies (600, always), but width only equals 800 on desktop
 * or at the narrow floor - everywhere else, `400`/`800` as "the middle of
 * the screen" / "the right edge" is simply wrong.
 *
 * Three separate reported bugs (the coin balance vanishing on Samsung, game
 * screens sitting off to one side, panels opening off-centre) all traced
 * back to exactly this: a hardcoded 400/800/600 that was correct on the
 * design canvas and silently wrong on any device wider than it.
 *
 * THE RULE: never write 400, 800, 600, or any other bare screen position -
 * read it from this module instead. If a number you're about to type is a
 * screen coordinate rather than a bet amount, a colour, a duration or some
 * other non-geometric value, it belongs here.
 *
 * TWO DIFFERENT THINGS THAT BOTH GET CALLED "CENTERING":
 * --------------------------------------------------------------------
 * 1. A standalone panel/dialog (Login's panel, a shop modal, a toast) has
 *    nothing else sharing the screen with it - it should sit on the LIVE
 *    center of the canvas. Use `liveCenterX`/`liveCenterY` directly.
 *
 * 2. The 14 game scenes' shared shell (`makeGameShell` below) is NOT
 *    centered on the screen as a whole - it's a left-docked sidebar next to
 *    a right-side board, and the two halves together were authored as one
 *    800-wide composition. On a wider canvas the correct fix is to slide
 *    that WHOLE composition sideways until it's centered as one block, not
 *    to re-center each half independently (an earlier attempt at exactly
 *    that pulled the sidebar and board apart - see `centerDesignBlock`'s
 *    own doc comment). Use `blockOffsetX`/`toLiveX`/`centerDesignBlock` for
 *    anything laid out relative to the original design canvas rather than
 *    to the screen as a whole.
 */

/** The canvas width every screen in this game was originally authored against, before main.ts began widening it to match a device's aspect ratio. Also the floor `computeLandscapeWidth()` never resizes narrower than. */
export const DESIGN_WIDTH = 800;
/** The canvas height. Unlike width this never actually varies at runtime - main.ts keeps it pinned at 600 in every scale mode - but it's named here rather than left as a bare 600 so nothing has to guess whether that's still true. */
export const DESIGN_HEIGHT = 600;
/** Center of the design canvas. This is what "400" almost always meant wherever it appears in older code. */
export const DESIGN_CENTER_X = DESIGN_WIDTH / 2;
/** Center of the design canvas. Height doesn't vary, so this - unlike DESIGN_CENTER_X - happens to still equal the live center on every device. Named anyway so intent is explicit and it isn't the one surviving bare "300" in a diff. */
export const DESIGN_CENTER_Y = DESIGN_HEIGHT / 2;

/**
 * Every interactive/informational element in the shared game shell and
 * most panels sits within this vertical band (130-470, symmetric around
 * DESIGN_CENTER_Y). Originally load-bearing against a scale mode that
 * cropped the canvas edges on wide phones; main.ts no longer crops
 * (it resizes the canvas instead - see its own scale-config comment), so
 * this band isn't strictly required anymore, but every screen already
 * lays out against it and there's no benefit to reclaiming the margin.
 */
export const SAFE_ZONE_TOP = 130;
export const SAFE_ZONE_BOTTOM = 470;
export const SAFE_ZONE_HEIGHT = SAFE_ZONE_BOTTOM - SAFE_ZONE_TOP;

/** The scene's actual, live canvas width right now. Never assume 800 - read it. */
export function liveWidth(scene: Phaser.Scene): number {
  return scene.scale.width;
}

/** The scene's actual, live canvas height right now. Always 600 in practice (see DESIGN_HEIGHT), but reads the real value rather than assuming that stays true forever. */
export function liveHeight(scene: Phaser.Scene): number {
  return scene.scale.height;
}

/**
 * The X to center a standalone, full-screen element on (a dialog, a modal,
 * a toast, a login panel) - the live canvas center, NOT the design center.
 * On any device wider than the 800 floor these two differ, which is
 * exactly the "panels opening off-centre" bug class this module exists to
 * remove. This is what most panel code wants; only the shared game shell
 * (a sidebar + board composition, not a single centered thing) needs the
 * design-block helpers below instead.
 */
export function liveCenterX(scene: Phaser.Scene): number {
  return scene.scale.width / 2;
}

/** The Y to center a standalone element on. Included for symmetry/clarity even though it never actually differs from DESIGN_CENTER_Y today - see DESIGN_HEIGHT. */
export function liveCenterY(scene: Phaser.Scene): number {
  return scene.scale.height / 2;
}

/**
 * How far the live canvas is wider than the DESIGN_WIDTH block, split
 * evenly on both sides - i.e. how far a design-authored composition needs
 * to slide right to sit centered as one block within the live canvas. 0 at
 * or below the 800 floor (desktop, or a phone at minimum width), since
 * main.ts never resizes narrower than that - nothing already laid out for
 * 800x600 ever loses space or moves.
 */
export function blockOffsetX(scene: Phaser.Scene): number {
  return Math.max(0, (scene.scale.width - DESIGN_WIDTH) / 2);
}

/**
 * Converts a design-space X (authored assuming an 800-wide canvas) to the
 * live-canvas X it should actually render at, so a whole design-authored
 * composition re-centers as one block on a wider canvas rather than
 * staying pinned to its original literal position. For any single point
 * that already sits at DESIGN_CENTER_X, this is identical to `liveCenterX`
 * - use whichever reads more clearly at the call site.
 */
export function toLiveX(scene: Phaser.Scene, designX: number): number {
  return designX + blockOffsetX(scene);
}

/**
 * Re-centers a design-authored, two-part composition (a screen-fixed
 * sidebar alongside a world-space board, e.g. `makeGameShell`) as ONE
 * block on a live canvas wider than DESIGN_WIDTH, without touching either
 * half's own internal layout math.
 *
 * HOW: `screenFixedObjects` (anything with `scrollFactor(0)`, e.g. the
 * sidebar chrome) gets nudged right by `blockOffsetX`; the scene's main
 * camera gets scrolled left by the same amount, which shifts every
 * default-scrollFactor (world-space) object - e.g. a game's own board
 * art - by that same visual distance for free, without iterating it.
 * Both halves move together, so the composition holds its shape and lands
 * centered as a whole. 0 offset at the design width floor, so desktop (and
 * a phone at minimum width) is completely unaffected.
 *
 * A previous version of this fix re-centered ONLY the board (world-space,
 * scrollFactor 1) while leaving the sidebar (scrollFactor 0) pinned at its
 * original literal position - on a wide phone that pulled the two halves
 * apart (sidebar jammed against the left edge, board floating off to the
 * right), which is what the founder reported as "the whole game screen
 * sits off to one side". Moving both halves by the same amount is what
 * fixes that for good.
 */
export function centerDesignBlock(
  scene: Phaser.Scene,
  screenFixedObjects: Iterable<{ x: number }>
): void {
  const offset = blockOffsetX(scene);
  scene.cameras.main.scrollX = -offset;
  if (offset !== 0) {
    for (const obj of screenFixedObjects) {
      obj.x += offset;
    }
  }
}

/**
 * GAME SHELL geometry - see `makeGameShell` in `uiHelpers.ts`. The shell is
 * a left-docked sidebar beside an open right-side display area; all 14
 * game scenes compute their own board layout (card/tile/grid positions)
 * from `GAME_SHELL_DISPLAY_CENTER_X/Y` at MODULE load time (e.g. `const DX
 * = GAME_SHELL_DISPLAY_CENTER_X;` at the top of BaccaratScene.ts and its
 * siblings), not inside a per-instance method, so these two stay fixed
 * "design" values - correct for the original 800-wide canvas - rather than
 * becoming live-width-aware themselves. `makeGameShell` is what actually
 * re-centers the whole composition on a live wide canvas, via
 * `centerDesignBlock` above; these constants, and everything the 14 games
 * derive from them, keep meaning exactly what they always meant.
 */
export const GAME_SHELL_DESIGN_WIDTH = DESIGN_WIDTH;
export const GAME_SHELL_DISPLAY_CENTER_X = 570;
export const GAME_SHELL_DISPLAY_CENTER_Y = DESIGN_CENTER_Y;
