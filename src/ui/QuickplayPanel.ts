import Phaser from "phaser";
import { Tokens } from "./DesignTokens";
import { makeText } from "./uiHelpers";
import { playSfx } from "./SoundManager";
import {
  GridGeometry,
  QuickplayGame,
  cardPosition,
  clampScroll,
  contentHeight,
  hitTestGrid
} from "./quickplayGrid";

/**
 * The Quickplay screen: a scrollable grid of every game, tap a card to jump
 * straight in. Founder ask: "a button that changes the layout of the games
 * to one like Stake" - a grid of cards instead of walking the casino floor.
 *
 * FULL-SCREEN VIEW (2026-08-30 follow-up, founder ask: "the quickplay
 * button needs to take up the full screen with all the buttons where they
 * usually are, but swap the quickplay button with an 'Arcade' button that
 * takes players back to the regular game screen"). This still opens as a
 * panel over OverworldScene rather than a real Phaser Scene change -
 * deliberately, so the existing panelOpen plumbing (which the overworld
 * already resets defensively on every create(), see its own doc comment on
 * the softlock this fixed) keeps working unchanged rather than needing a
 * second copy of that same defensive reset in a brand-new scene. "Full
 * screen" here means: a full-canvas backdrop instead of a centered card,
 * geometry read from the LIVE `scene.scale.width`/`height` at open time
 * (not a literal 800x600) so it matches whatever width the overworld's own
 * corner buttons are using, and no more Close button - see
 * QuickplayViewHandle below, which is how OverworldScene's swapped-in
 * "Arcade" corner button closes this from the outside instead. The corner
 * buttons themselves are untouched by this module: they're real
 * screen-fixed game objects OverworldScene already owns, drawn at their own
 * depth (150) above this panel's content depth (see DEPTH_BG/DEPTH_CONTENT
 * below), so they stay visible and clickable on top of the grid exactly as
 * the founder asked, with no geometry duplicated or guessed at here.
 *
 * STRUCTURE follows ChallengesPanel.ts/ShopPanel.ts - one exported `open*`
 * function, a closure holding the panel's own state, a `render()` that
 * (re)builds the static chrome once, a host interface for the two things
 * only the scene can do. What's NEW here (neither of those panels needed
 * it - they paginate instead) is real touch-drag scrolling, since a card
 * grid reads as a grid you scroll, not a list you page through. The scroll
 * math itself is Phaser-free and unit-tested - see quickplayGrid.ts.
 *
 * NO "N PLAYING" COUNTS. The founder's own reference screenshot (stake.us)
 * has them; explicit founder decision to leave them off here - there are
 * about five real players right now, and a made-up number would tell
 * players something untrue. If real per-game player counts ever exist,
 * that's a separate, deliberate feature - not a default to restore.
 *
 * ARTWORK is the same procedurally-drawn cabinet textures the floor itself
 * uses (BootScene.ts) - no new art, per the founder's "needs no art
 * assets" constraint elsewhere in this project. They're small pixel art
 * (48x64 for most, 64x64/96x112 for a few) scaled up to fill a card; the
 * game runs with `pixelArt: true` (main.ts) so that's a crisp nearest-
 * neighbour upscale, not a blur - the same look the floor itself already
 * has at this kind of scale, not a new visual regression.
 */

/** What this panel needs from whoever hosts it - a structural subset of ShopPanelHost/ChallengesPanelHost. */
export interface QuickplayPanelHost {
  /** The scene the panel draws into. */
  readonly scene: Phaser.Scene;
  /** Raises/lowers the host's modal flag (real side effects on the host - see OverworldScene). */
  setPanelOpen(open: boolean): void;
  /**
   * Hands off to a game scene - the exact same chokepoint every walk-up
   * floor cabinet uses (OverworldScene.goToGame), so a game entered via
   * Quickplay is tracked, resumable and exited identically to one entered
   * by walking up to it. Leaving the game (every game's own Walk Away
   * button) always returns to the plain floor, which is the sensible
   * behaviour here too - Quickplay is a shortcut INTO a game, not a mode
   * the game itself needs to know it was entered from.
   */
  goToGame(sceneKey: string): void;
}

// --- Geometry. Computed at open() time from the LIVE canvas size (see
// geometryFor below), not module-level constants - this view now fills the
// whole screen rather than sitting at a fixed 800x600-relative spot, and
// main.ts can widen the canvas's logical width on a wide phone (see its own
// scale-config comment). Height stays out of that concern: main.ts pins it
// at a fixed 600 specifically so every existing y-coordinate in the game,
// including the SAFE_ZONE_TOP/BOTTOM band this reuses (uiHelpers.ts), keeps
// meaning exactly what it always meant. VIEW_BOTTOM sits well past that
// band's old 428/452 footer-button floor since there's no footer Close
// button any more (see the module doc comment on QuickplayViewHandle) -
// genuinely most of the 600-tall canvas is now grid. ---
const VIEW_TOP = 190;
const VIEW_BOTTOM = 560;
const VIEW_H = VIEW_BOTTOM - VIEW_TOP;

const COLS = 4;
const GAP = Tokens.space.md;
const CARD_H = 170;

const IMG_PAD_TOP = 14;
const IMG_BOX_H = 96;

/** Below the corner buttons' own depth (150, see OverworldScene.ts) so they stay visibly on top of this full-screen backdrop, per the founder's "buttons stay where they usually are" ask. */
const DEPTH_BG = 120;
const DEPTH_CONTENT = 121;

interface Geometry {
  screenW: number;
  screenH: number;
  cx: number;
  colL: number;
  colR: number;
  gridW: number;
  cardW: number;
  imgBoxW: number;
  geo: GridGeometry;
}

/** Recomputes every screen-size-dependent number from the live canvas at open() time - see the block comment above. */
function geometryFor(scene: Phaser.Scene): Geometry {
  const screenW = scene.scale.width;
  const screenH = scene.scale.height;
  const cx = screenW / 2;
  const marginX = Tokens.space.xxl;
  const colL = marginX;
  const colR = screenW - marginX;
  const gridW = colR - colL;
  // COLS columns exactly fill gridW with GAP between them - no leftover
  // slop on either edge, same rule the old fixed-width version used.
  const cardW = (gridW - (COLS - 1) * GAP) / COLS;
  return {
    screenW,
    screenH,
    cx,
    colL,
    colR,
    gridW,
    cardW,
    imgBoxW: cardW - 24,
    geo: { cols: COLS, cardW, cardH: CARD_H, gap: GAP }
  };
}

/** A tap moving less than this many px (in either axis) counts as a tap, not a scroll drag. */
const TAP_SLOP = 10;
/** Mouse-wheel step, in content px per wheel "line" - desktop-only convenience alongside touch drag. */
const WHEEL_STEP = 0.6;

function inViewport(y: number): boolean {
  return y >= VIEW_TOP && y <= VIEW_BOTTOM;
}

/**
 * Draws one game's card into `elements` at content-local top-left (x, y) -
 * background well, the cabinet art scaled to fit, and the label. Pure
 * drawing, no interactivity of its own: the whole grid is read by one
 * drag/tap surface in openQuickplayPanel below (see that function's doc
 * comment on why per-card hit areas would fight a drag gesture).
 */
function drawCard(
  scene: Phaser.Scene,
  game: QuickplayGame,
  x: number,
  y: number,
  cardW: number,
  imgBoxW: number,
  elements: Phaser.GameObjects.GameObject[]
) {
  const cx = x + cardW / 2;
  const cy = y + CARD_H / 2;

  const bg = scene.add.graphics({ x: cx, y: cy });
  bg.fillStyle(Tokens.color.surfaceRaised, 1);
  bg.fillRoundedRect(-cardW / 2, -CARD_H / 2, cardW, CARD_H, Tokens.radius.md);
  elements.push(bg);

  const imgCenterY = -CARD_H / 2 + IMG_PAD_TOP + IMG_BOX_H / 2;
  if (scene.textures.exists(game.textureKey)) {
    const img = scene.add.image(cx, cy + imgCenterY, game.textureKey);
    const scale = Math.min(imgBoxW / img.width, IMG_BOX_H / img.height);
    img.setScale(scale);
    elements.push(img);
  }

  const label = makeText(scene, cx, cy + CARD_H / 2 - 30, game.label, {
    size: Tokens.type.size.sm,
    weight: Tokens.type.weight.semibold,
    color: Tokens.text.primary,
    align: "center",
    originX: 0.5,
    originY: 0.5,
    wordWrapWidth: cardW - 16
  });
  elements.push(label);
}

/** What closing the Quickplay view from the outside needs - see OverworldScene's swapped-in "Arcade" corner button, which is the only way out now that there's no in-panel Close button (a full-screen view doesn't need one - it has its own dedicated corner button, same as the floor itself never needed a "Close" button to leave it). */
export interface QuickplayViewHandle {
  /** Idempotent - safe to call even if the view already closed itself (e.g. a card tap already navigated away). */
  close: () => void;
}

/**
 * Opens the Quickplay grid. `games` is normally OverworldScene's own
 * GAME_STATIONS, deduplicated by scene key (uniqueGames) - passed in
 * rather than imported directly so this module stays a plain leaf (no
 * scenes/ -> ui/ -> scenes/ import cycle) the way ShopPanel.ts and
 * ChallengesPanel.ts already are.
 */
export function openQuickplayPanel(host: QuickplayPanelHost, games: QuickplayGame[]): QuickplayViewHandle {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");

  // Geometry is read once, here, from the live canvas - not reactively on
  // resize (same "correct for the shape the device is in when this opens,
  // not live mid-view window resizing" scope boundary uiHelpers.ts's
  // GAME_SHELL_DISPLAY_CENTER_X and OverworldScene's own corner-button
  // layout already use).
  const { screenW, screenH, colL: COL_L, colR: COL_R, gridW: GRID_W, cardW: CARD_W, imgBoxW: IMG_BOX_W, geo: GEO } =
    geometryFor(scene);

  let elements: Phaser.GameObjects.GameObject[] = [];
  let closed = false;

  // Scroll state. gridContainer.y tracks VIEW_TOP - scrollY every frame it
  // changes, so a tap's local Y (pointer.y - gridContainer.y) already
  // accounts for however far the grid has been dragged - see onPointerUp.
  let scrollY = 0;
  const contentH = contentHeight(games.length, GEO);
  const gridContainer = scene.add.container(COL_L, VIEW_TOP).setScrollFactor(0).setDepth(DEPTH_CONTENT);

  // Mask graphics is detached from the display list (never added via
  // scene.add) - only its shape matters. It must share the content's
  // setScrollFactor(0) or the two would drift apart the instant the
  // player's world camera (which follows them around the floor) isn't
  // sitting at its very first position - confirmed against GeometryMask's
  // own doc comment ("naturally respects the camera's visual properties").
  const maskShape = scene.make.graphics(undefined, false).setScrollFactor(0);
  maskShape.fillStyle(0xffffff, 1);
  maskShape.fillRect(COL_L, VIEW_TOP, GRID_W, VIEW_H);
  const mask = maskShape.createGeometryMask();
  gridContainer.setMask(mask);

  let dragging = false;
  let dragStartPointerY = 0;
  let dragStartScroll = 0;
  let dragMoved = 0;

  const applyScroll = () => {
    gridContainer.y = VIEW_TOP - scrollY;
  };

  const cleanup = () => {
    elements.forEach((e) => e.destroy());
    elements = [];
    gridContainer.destroy();
    maskShape.destroy();
  };

  const detachInput = () => {
    scene.input.off("pointerdown", onPointerDown);
    scene.input.off("pointermove", onPointerMove);
    scene.input.off("pointerup", onPointerUp);
    scene.input.off("pointerupoutside", onPointerUp);
    scene.input.off("wheel", onWheel);
  };

  const close = () => {
    // Guards against a double-close (e.g. OverworldScene's "Arcade" button
    // firing after a card tap already closed this view on its way into
    // goToGame) re-destroying already-destroyed game objects - see
    // QuickplayViewHandle's own doc comment on why this has to be
    // idempotent now that an external button, not just this module's own
    // internal paths, can call it.
    if (closed) return;
    closed = true;
    detachInput();
    cleanup();
    host.setPanelOpen(false);
  };

  // A scene swap mid-drag (a card tap fires selectGame -> host.goToGame,
  // which already calls close() itself first - but this is the same
  // belt-and-suspenders net ChallengesPanel.ts uses for any OTHER path
  // that might stop this scene while the panel is still open) stops the
  // listeners from ever touching a torn-down scene's input plugin.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    closed = true;
    detachInput();
  });

  const selectGame = (game: QuickplayGame) => {
    playSfx(scene, "click");
    close();
    host.goToGame(game.sceneKey);
  };

  const onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (closed || !inViewport(pointer.y)) return;
    dragging = true;
    dragStartPointerY = pointer.y;
    dragStartScroll = scrollY;
    dragMoved = 0;
  };

  const onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (closed || !dragging) return;
    const delta = pointer.y - dragStartPointerY;
    dragMoved = Math.max(dragMoved, Math.abs(delta));
    scrollY = clampScroll(dragStartScroll - delta, contentH, VIEW_H);
    applyScroll();
  };

  const onPointerUp = (pointer: Phaser.Input.Pointer) => {
    if (closed || !dragging) return;
    dragging = false;
    if (dragMoved < TAP_SLOP) {
      const localX = pointer.x - gridContainer.x;
      const localY = pointer.y - gridContainer.y;
      const index = hitTestGrid(localX, localY, games.length, GEO);
      if (index !== null) selectGame(games[index]);
    }
  };

  const onWheel = (pointer: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
    if (closed || !inViewport(pointer.y)) return;
    scrollY = clampScroll(scrollY + dy * WHEEL_STEP, contentH, VIEW_H);
    applyScroll();
  };

  scene.input.on("pointerdown", onPointerDown);
  scene.input.on("pointermove", onPointerMove);
  scene.input.on("pointerup", onPointerUp);
  scene.input.on("pointerupoutside", onPointerUp);
  scene.input.on("wheel", onWheel);

  // --- Static chrome (drawn once - nothing here changes as the grid scrolls) ---
  // Full-canvas backdrop rather than a centered card - this replaces the
  // floor entirely while open (same "one flat ground rect sized from the
  // live canvas" approach makeGameShell's own `ground` uses), which is what
  // makes this a screen, not a panel over one.
  const backdrop = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH_BG);
  backdrop.fillStyle(Tokens.color.bg, 1);
  backdrop.fillRect(0, 0, screenW, screenH);
  elements.push(backdrop);

  elements.push(
    makeText(scene, COL_L, 144, "QUICKPLAY", {
      size: Tokens.type.size.lg,
      weight: Tokens.type.weight.semibold,
      color: Tokens.text.secondary,
      tracking: Tokens.type.tracking.caps
    }).setScrollFactor(0).setDepth(DEPTH_CONTENT)
  );
  elements.push(
    makeText(scene, COL_R, 144, "Tap a game to jump in", {
      size: Tokens.type.size.sm,
      color: Tokens.text.muted,
      align: "right",
      originX: 1
    }).setScrollFactor(0).setDepth(DEPTH_CONTENT)
  );

  // --- The grid itself. Each card's pieces are collected into their own
  // array and handed to gridContainer, NOT pushed into the flat `elements`
  // cleanup list above - gridContainer.destroy() (in cleanup()) already
  // destroys every child it holds, and re-parenting is what makes the
  // cards scroll and clip against the mask in the first place. ---
  const cardElements: Phaser.GameObjects.GameObject[] = [];
  games.forEach((game, i) => {
    const pos = cardPosition(i, GEO);
    drawCard(scene, game, pos.x, pos.y, CARD_W, IMG_BOX_W, cardElements);
  });
  gridContainer.add(cardElements);

  // No in-panel Close button any more - the corner "Arcade" button
  // (OverworldScene, swapped in for "Quickplay" while this view is open)
  // is the one way back to the floor now, matching the founder's own
  // framing of this as a screen swap rather than a dialog to dismiss. See
  // QuickplayViewHandle above for how that button reaches back in here.
  return { close };
}
