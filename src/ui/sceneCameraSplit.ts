import Phaser from "phaser";

/**
 * Support for scenes that zoom their MAIN camera (to show less of a large
 * world at once - see OverworldScene.ts/RoomScene.ts's own zoom setup
 * comment) while keeping screen-fixed UI (HUD, corner buttons, modals,
 * toasts, the touch joystick) rendering at its authored size/position,
 * unaffected by that zoom.
 *
 * THE PROBLEM: Phaser's `Camera.zoom` scales literally everything the
 * camera renders, INCLUDING objects with `scrollFactor(0)` - scrollFactor
 * only blocks camera SCROLL/pan from moving an object, not zoom (a
 * documented Phaser limitation, confirmed live in this codebase before
 * zoom was ever turned on: a scrollFactor(0) object at anything but the
 * exact camera center rendered off-screen the moment zoom moved off 1).
 *
 * THE FIX: a second camera (`uiCamera` below), zoom always 1, added on top
 * of the zoomed main camera. Every screen-fixed object needs to render via
 * ONE camera only - rendering via both would show it twice (correctly via
 * whichever camera doesn't zoom it, and distorted via the other) - so:
 *   - Screen-fixed UI calls `isolateFixedUi()`, which tells the MAIN
 *     camera to skip it (it still renders normally via `uiCamera`).
 *   - The rare WORLD-space object created dynamically after a scene's
 *     initial `create()` synchronous pass (this codebase has exactly one:
 *     TutorialGuide.ts's `showHighlightRing` in its non-screen-fixed
 *     mode, pointing at a station) calls `isolateWorldObject()`, which
 *     tells `uiCamera` to skip it instead, so it only renders via the
 *     zoomed main camera (matching whatever it's pointing at).
 *
 * A scene that never registers a `uiCamera` (every one of the 14 games,
 * StartMenuScene, etc.) makes both functions below a no-op - safe to call
 * unconditionally from shared UI code (uiHelpers.ts and friends) without
 * every caller needing to know whether ITS scene happens to zoom.
 *
 * Keyed by scene rather than passed explicitly everywhere because the
 * various panel modules (ChallengesPanel.ts and friends) already take a
 * bare `scene: Phaser.Scene` with no camera-split-specific field on it -
 * threading a second parameter through every one of their host interfaces
 * would be a much bigger diff for the same result.
 */
const uiCameras = new WeakMap<Phaser.Scene, Phaser.Cameras.Scene2D.Camera>();

/** Registers `camera` as `scene`'s screen-fixed-UI camera. Call once, right after creating it. */
export function registerUiCamera(scene: Phaser.Scene, camera: Phaser.Cameras.Scene2D.Camera): void {
  uiCameras.set(scene, camera);
}

/** True once `scene` has an actual world/UI camera split - primarily for the caller to decide whether it needs to compute `screenFixed` isolation at all. */
export function hasUiCameraSplit(scene: Phaser.Scene): boolean {
  return uiCameras.has(scene);
}

type Ignorable = Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[];

/**
 * Call right after creating any screen-fixed (`scrollFactor(0)`) object, in
 * a scene that might have a zoomed main camera - tells that camera to skip
 * it, so it renders once, at its authored size/position, via the scene's
 * `uiCamera` instead. No-op (and perfectly safe to call) in a scene with no
 * `uiCamera` registered - the object just renders via the scene's one and
 * only camera as normal.
 */
export function isolateFixedUi(scene: Phaser.Scene, objs: Ignorable): void {
  if (!uiCameras.has(scene)) return;
  scene.cameras.main.ignore(objs);
}

/**
 * Call right after creating a WORLD-space object OUTSIDE a scene's initial
 * synchronous `create()` pass (see this module's own header - currently
 * only TutorialGuide.ts's non-screen-fixed `showHighlightRing`). Tells the
 * scene's `uiCamera`, if it has one, to skip it, so it only renders once,
 * correctly zoomed, via the main camera. No-op in a scene with no
 * `uiCamera`.
 */
export function isolateWorldObject(scene: Phaser.Scene, objs: Ignorable): void {
  const uiCamera = uiCameras.get(scene);
  if (!uiCamera) return;
  uiCamera.ignore(objs);
}
