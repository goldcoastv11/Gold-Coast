import Phaser from "phaser";
import { Tokens } from "./DesignTokens";
import { makeButton, makePanel, makeText } from "./uiHelpers";
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

// --- Geometry. Panel spans y 126-474; every element sits inside 130-470
// (see uiHelpers.ts's SAFE_ZONE_TOP/BOTTOM) - same budget ChallengesPanel
// uses, and this reuses its exact CX/PANEL_W/COL_L/COL_R so the two panels'
// content columns line up if a player opens one right after the other. ---
const CX = 400;
const PANEL_W = 664;
const PANEL_H = 348;
const COL_L = CX - PANEL_W / 2 + Tokens.space.xl;
const COL_R = CX + PANEL_W / 2 - Tokens.space.xl;
const GRID_W = COL_R - COL_L;

/** Scrollable viewport - the region the grid mask clips to and the region drag/tap input is read from. Below it, the footer Close button gets its own untouched strip of the safe zone. */
const VIEW_TOP = 178;
const VIEW_BOTTOM = 428;
const VIEW_H = VIEW_BOTTOM - VIEW_TOP;

const COLS = 4;
const GAP = Tokens.space.md;
/** 4 columns exactly fill GRID_W with GAP between them - no leftover slop on either edge. */
const CARD_W = (GRID_W - (COLS - 1) * GAP) / COLS;
const CARD_H = 170;
const GEO: GridGeometry = { cols: COLS, cardW: CARD_W, cardH: CARD_H, gap: GAP };

const IMG_PAD_TOP = 14;
const IMG_BOX_W = CARD_W - 24;
const IMG_BOX_H = 96;

const DEPTH_PANEL = 200;
const DEPTH_CONTENT = 201;

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
  elements: Phaser.GameObjects.GameObject[]
) {
  const cx = x + CARD_W / 2;
  const cy = y + CARD_H / 2;

  const bg = scene.add.graphics({ x: cx, y: cy });
  bg.fillStyle(Tokens.color.surfaceRaised, 1);
  bg.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, Tokens.radius.md);
  elements.push(bg);

  const imgCenterY = -CARD_H / 2 + IMG_PAD_TOP + IMG_BOX_H / 2;
  if (scene.textures.exists(game.textureKey)) {
    const img = scene.add.image(cx, cy + imgCenterY, game.textureKey);
    const scale = Math.min(IMG_BOX_W / img.width, IMG_BOX_H / img.height);
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
    wordWrapWidth: CARD_W - 16
  });
  elements.push(label);
}

/**
 * Opens the Quickplay grid. `games` is normally OverworldScene's own
 * GAME_STATIONS, deduplicated by scene key (uniqueGames) - passed in
 * rather than imported directly so this module stays a plain leaf (no
 * scenes/ -> ui/ -> scenes/ import cycle) the way ShopPanel.ts and
 * ChallengesPanel.ts already are.
 */
export function openQuickplayPanel(host: QuickplayPanelHost, games: QuickplayGame[]) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");

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
  const panel = makePanel(scene, CX, 300, PANEL_W, PANEL_H, DEPTH_PANEL).setScrollFactor(0);
  elements.push(panel);

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
    drawCard(scene, game, pos.x, pos.y, cardElements);
  });
  gridContainer.add(cardElements);

  const closeBtn = makeButton(
    scene,
    CX,
    452,
    140,
    32,
    "Close",
    Tokens.color.surfaceRaised,
    Tokens.color.surfaceHover,
    close,
    Tokens.text.secondary,
    Tokens.radius.sm
  );
  closeBtn.container.setScrollFactor(0).setDepth(DEPTH_CONTENT);
  elements.push(closeBtn.container);
}
