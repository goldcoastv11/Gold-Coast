import Phaser from "phaser";

/**
 * Shared smooth scene-transition helper - per user request ("the camera
 * jolts between scenes, make it smooth"). Every previous `this.scene.start(
 * key, data)` call site (Overworld <-> all 14 game scenes, Boot -> Login,
 * Login <-> StartMenu, StartMenu -> Overworld) was an instant hard cut with
 * no transition at all. `fadeToScene()` fades the CURRENT scene's camera to
 * a flat color first, then starts the target scene once the fade
 * completes; `fadeInOnCreate()`, called at the very top of a target scene's
 * own `create()`, fades back in from that same color instead of popping in
 * instantly - together they read as one continuous smooth transition
 * rather than two independent, differently-timed cuts.
 *
 * Deliberately still uses plain `scene.start(key, data)` underneath (not
 * Phaser's own `scene.transition()` API, which manages the source scene's
 * lifecycle differently - e.g. sleep vs. stop by default) - this is purely
 * a visual wrapper around the exact same transition mechanism already in
 * place, so it doesn't risk reintroducing the scene-data retention class
 * of bug that OverworldScene.create() already had to fix once (see that
 * doc comment) by changing how/when scenes actually start.
 */

const FADE_MS = 220;
// Warm dark-brown, matching Theme.outline (#5C2E22) - STYLE_GUIDE.md
// direction note 2 says "never pure black" for UI chrome; applied here to
// the one moment that otherwise WOULD be a flash of pure black (the
// default camera fade color), since an abrupt unfaded cut was the exact
// "jolt" being fixed - no point trading one jarring moment for another.
const FADE_R = 0x5c;
const FADE_G = 0x2e;
const FADE_B = 0x22;

/**
 * Fades `scene`'s camera out, then starts `key` (with optional `data`) once
 * the fade completes. Use in place of a raw `this.scene.start(key, data)`
 * for any transition between Overworld and a game scene (or any other
 * scene-to-scene hop) - pair with `fadeInOnCreate(this)` at the top of the
 * target scene's own `create()`.
 */
export function fadeToScene(scene: Phaser.Scene, key: string, data?: object): void {
  scene.cameras.main.fadeOut(FADE_MS, FADE_R, FADE_G, FADE_B);
  scene.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
    scene.scene.start(key, data);
  });
}

/** Call at the very top of a scene's create() (before anything else draws) to fade in from the same warm-brown fadeToScene() fades out to, instead of popping in instantly. */
export function fadeInOnCreate(scene: Phaser.Scene): void {
  scene.cameras.main.fadeIn(FADE_MS, FADE_R, FADE_G, FADE_B);
}
