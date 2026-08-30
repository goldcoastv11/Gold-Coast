import Phaser from "phaser";
import { Theme, DISPLAY_FONT } from "./ui/Theme";
import { BootScene } from "./scenes/BootScene";
import { LoginScene } from "./scenes/LoginScene";
import { StartMenuScene } from "./scenes/StartMenuScene";
import { OverworldScene } from "./scenes/OverworldScene";
import { RoomScene } from "./scenes/RoomScene";
import { SlotsScene } from "./scenes/SlotsScene";
import { BlackjackScene } from "./scenes/BlackjackScene";
import { RouletteScene } from "./scenes/RouletteScene";
import { CoinFlipScene } from "./scenes/CoinFlipScene";
import { DragonTowerScene } from "./scenes/DragonTowerScene";
import { MinesScene } from "./scenes/MinesScene";
import { DiceScene } from "./scenes/DiceScene";
import { LimboScene } from "./scenes/LimboScene";
import { PlinkoScene } from "./scenes/PlinkoScene";
import { KenoScene } from "./scenes/KenoScene";
import { WheelScene } from "./scenes/WheelScene";
import { HiLoScene } from "./scenes/HiLoScene";
import { BaccaratScene } from "./scenes/BaccaratScene";
import { VideoPokerScene } from "./scenes/VideoPokerScene";
import { LevelUpMinigameScene } from "./scenes/LevelUpMinigameScene";
import { setUnauthorizedHandler } from "./api/client";
import { startTracking, track, EVENTS } from "./api/track";
import { gameState } from "./GameState";
import { isTouchDevice } from "./ui/TouchControls";

// Retention Leg 1 (see src/api/track.ts): one session.start per app load,
// fired here - before Phaser even boots - so it's recorded for every
// visit, including the ones that bounce off the login screen without ever
// creating an account. That anonymous denominator is the whole point; a
// funnel measured only from signup onward can't show what it's losing.
// Cannot throw and never blocks boot - see track.ts's header.
startTracking();
track(EVENTS.SESSION_START, { touch: isTouchDevice() });

/**
 * Makes DISPLAY_FONT (see ui/Theme.ts) the default for every `scene.add.text()`
 * in the game, in one place.
 *
 * Phaser has no global text-style config - `TextStyle` hardcodes its own
 * fallback of `'Courier'` when a style object omits `fontFamily`, and every
 * one of the ~100 `add.text()` call sites in this project omitted it, so the
 * entire game was rendering in a cold monospace by accident rather than by
 * choice. The alternatives were both worse: adding `fontFamily` to all ~100
 * call sites is a huge diff that the next new `add.text()` immediately starts
 * drifting from, and it would additionally require editing
 * OverworldScene.ts (23 of those call sites), which is off-limits here -
 * it's being restructured under a separate change. Wrapping the factory once
 * covers every call site including those, and covers future ones for free.
 *
 * `remove()` before `register()` is required, not defensive: Phaser's
 * `GameObjectFactory.register` is a no-op if the type is already registered
 * (`if (!prototype.hasOwnProperty(factoryType))`), and core registers "text"
 * at import time - so registering without removing first would silently do
 * nothing at all. The pair is Phaser's own supported way to replace a
 * built-in factory.
 *
 * A call site that passes its own `fontFamily` (or the `font` shorthand,
 * which sets family too) still wins - this only fills in a default. Runs at
 * module scope, before `new Phaser.Game()` below, so it is in place long
 * before any scene's create() runs.
 */
type PhaserTextFactory = (
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle
) => Phaser.GameObjects.Text;

const basePhaserTextFactory = Phaser.GameObjects.GameObjectFactory.prototype.text as PhaserTextFactory;

Phaser.GameObjects.GameObjectFactory.remove("text");
Phaser.GameObjects.GameObjectFactory.register("text", function (
  this: Phaser.GameObjects.GameObjectFactory,
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle
) {
  const stylesOwnFamily =
    style !== undefined && (style.fontFamily !== undefined || style.font !== undefined);
  const withDefaultFont = stylesOwnFamily ? style : { ...style, fontFamily: DISPLAY_FONT };
  return basePhaserTextFactory.call(this, x, y, text, withDefaultFont);
});

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: "game-container",
  backgroundColor: Theme.bgDark,
  pixelArt: true,
  // Phaser's loader defaults to at most 32 concurrent downloads - BootScene
  // preloads well over that (tiles/characters + the 8 sound effects from
  // ui/SoundManager.ts pushed the total past 32 for the first time, back
  // when 17 skin spritesheets were also in the queue - those are gone, but
  // the wardrobe's own art will refill it as real pieces land, so the
  // raised cap stays). Files queued beyond the cap are only supposed to
  // start as earlier ones finish, but in practice the last few silently
  // never started at all (confirmed live: loader.list left them stuck in
  // the FILE_POPULATED state, never promoted to inflight) - so raise the
  // cap well above BootScene's real total instead of relying on that
  // refill behavior.
  loader: {
    maxParallelDownloads: 64
  },
  // Mobile support: real HTML <input> elements (LoginScene's username/
  // password fields) need Phaser's DOM Element support turned on - it
  // creates an overlay div that Phaser keeps positioned/scaled in lockstep
  // with the canvas (including under Scale.FIT), so a DOM element placed at
  // game coordinates (x, y) tracks the canvas correctly on any screen size.
  dom: {
    createContainer: true
  },
  // Mobile touch controls (ui/TouchControls.ts) need 2 simultaneous active
  // pointers - the movement joystick held with one thumb while the other
  // taps the interact button - Phaser only tracks 1 by default.
  input: {
    activePointers: 2
  },
  scale: {
    // FIT at boot, ENVELOP switched on at runtime for touch devices only
    // (see the isTouchDevice() block below) - desktop keeps FIT
    // unconditionally, letterboxed but with zero crop risk.
    //
    // History: ENVELOP was tried and reverted once already - it fills the
    // viewport edge-to-edge with no bars, but crops whatever overflows to
    // get there, and on a typical wide phone aspect ratio that meant
    // cropping roughly the top/bottom 100px of the 800x600 canvas, which
    // put the touch joystick out of reach (confirmed live). This time,
    // every scene's UI (uiHelpers.ts's makeGameShell/makeBetControl,
    // TouchControls.ts, TutorialGuide.ts, and OverworldScene's own
    // corner/prompt/panel elements) has been deliberately laid out to fit
    // entirely within that same safe y=[100,500] band first, so the crop
    // this time doesn't cut off anything real - see each file's own
    // "SAFE_ZONE"/"main.ts's Scale.ENVELOP" comments for the specific
    // repositioning. Kept mobile-only (not applied on desktop) since
    // desktop windows aren't usually pushed to the same aspect-ratio
    // extremes a phone's landscape screen is, and FIT already has zero
    // downside there.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 600
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false
    }
  },
  scene: [
    BootScene,
    LoginScene,
    StartMenuScene,
    OverworldScene,
    RoomScene,
    SlotsScene,
    BlackjackScene,
    RouletteScene,
    CoinFlipScene,
    DragonTowerScene,
    MinesScene,
    DiceScene,
    LimboScene,
    PlinkoScene,
    KenoScene,
    WheelScene,
    HiLoScene,
    BaccaratScene,
    VideoPokerScene,
    // Not a Stake Original - the founder-directed level-up "stop the
    // marker" skill minigame (see src/scenes/LevelUpMinigameScene.ts and
    // src/levelUpMinigameLauncher.ts for how it's reached).
    LevelUpMinigameScene
  ]
};

const game = new Phaser.Game(config);
// Debug handle only - lets the browser console inspect the running game
// (e.g. `__game.scene.getScene("LoginScene")`). Harmless to leave in.
(window as unknown as { __game: Phaser.Game }).__game = game;

/**
 * Mobile scale mode is not a fixed choice - it depends on BOTH orientation
 * AND which scene is showing:
 *
 * - Landscape, any scene: ENVELOP (fills the screen edge-to-edge - every
 *   scene's UI was laid out to survive this crop, see uiHelpers.ts's
 *   SAFE_ZONE_TOP/BOTTOM).
 * - Portrait, LoginScene/BootScene: FIT (letterboxed, zero crop) - per
 *   user direction, typing a username/password is easier holding the
 *   phone upright, so login is deliberately exempted from the landscape
 *   lock (see index.html's "portrait-ok" class, toggled below). ENVELOP
 *   would be actively wrong here, not just unnecessary: in portrait,
 *   ENVELOP fills based on the TALLER dimension, which for this 4:3
 *   canvas means cropping away roughly two-thirds of the WIDTH to cover
 *   the extra height - the login form would render badly cut off, not
 *   just small. FIT avoids that entirely (shows the whole canvas,
 *   letterboxed instead of cropped) at the cost of the form appearing
 *   smaller than a landscape/ENVELOP fill would.
 * - Portrait, any other scene: doesn't matter which mode - the canvas is
 *   hidden behind #rotate-prompt regardless (index.html), so nothing
 *   renders either way; FIT is used here too just to avoid computing a
 *   heavily-cropped layout behind the scenes for no reason.
 *
 * Setting `game.scale.scaleMode` alone is NOT enough, despite reading
 * back correctly afterward - verified live (checked Phaser's own source,
 * then confirmed with actual canvas measurements): the real FIT/ENVELOP/
 * etc. sizing math reads `displaySize.aspectMode` (a separate internal
 * value on the Size helper object), which Phaser only ever copies
 * `scaleMode` into once, during initial config parsing at boot. Setting
 * `game.scale.scaleMode` after that point updates a value nothing else
 * actually reads. `displaySize.setAspectMode()` is what updates the
 * value the layout math uses; `refresh()` then forces an immediate
 * recompute against it (this pairing is undocumented as a public runtime
 * API - Phaser expects scaleMode to be set once via config - but it's
 * what the source shows actually drives the sizing decision).
 */
/**
 * Sign Up/Sign In tab pair (LoginScene.ts) - the WIDEST real element on
 * the login screen, spanning logical x=[192,608] around center 400 (half-
 * width 208). Used below to compute how far portrait+login can safely
 * zoom in without cropping anything a player actually needs to see/tap.
 */
const LOGIN_CONTENT_HALF_WIDTH = 208;

/**
 * Portrait+login additionally gets a CSS zoom on top of FIT - per user
 * direction ("zoom the image in more", explicitly not a layout redesign).
 * FIT alone shows the WHOLE canvas letterboxed, which in portrait means a
 * fairly small login form (FIT is width-constrained there, since a phone
 * held upright is much taller than it is wide relative to this 4:3
 * canvas). Rather than fight the Scale Manager for a third custom scale
 * mode, this applies a plain CSS `transform: scale()` to #game-container
 * itself - both the canvas AND the DOM Element overlay (the real
 * username/password <input>s) are children of it, so they scale together
 * and stay aligned - with body's own `overflow:hidden` (index.html)
 * cropping whatever overflows past the viewport.
 *
 * The FULL zoom factor is computed, not hardcoded - targeting
 * LOGIN_CONTENT_HALF_WIDTH (+20px margin) so the crop it introduces would
 * never eat into anything real - but the APPLIED zoom is only halfway
 * between that full factor and 1 (i.e. no zoom, plain FIT - "the last
 * distance") per explicit follow-up direction, a gentler zoom-in than the
 * computed maximum-safe one. Halving the excess only makes the existing
 * safety margin larger, never smaller, so this can't reintroduce any
 * cropping risk.
 *
 * Deliberately only called from updateMobileLayoutMode() when
 * isPortraitLogin actually CHANGES - see that function's own comment for
 * why recomputing on every poll tick caused the whole screen to visibly
 * drift while typing.
 */
function applyPortraitLoginZoom(active: boolean): void {
  const container = document.getElementById("game-container");
  if (!container) return;
  if (!active) {
    container.style.transform = "none";
    return;
  }
  const currentFitScale = game.scale.displaySize.width / 800;
  if (currentFitScale <= 0) return;
  const desiredScale = window.innerWidth / ((LOGIN_CONTENT_HALF_WIDTH + 20) * 2);
  const fullZoomFactor = Math.max(1, desiredScale / currentFitScale);
  const zoomFactor = 1 + (fullZoomFactor - 1) / 2;
  container.style.transformOrigin = "center center";
  container.style.transform = `scale(${zoomFactor})`;
}

let lastAppliedMode: number | null = null;
let lastAppliedPortraitLogin: boolean | null = null;

/**
 * Only touches the Scale Manager / zoom transform when the DESIRED state
 * actually changed since the last call - not unconditionally on every
 * poll tick. Reported live: with an earlier version that called
 * `game.scale.refresh()` and `applyPortraitLoginZoom()` unconditionally
 * every 400ms, the portrait login screen visibly drifted/wobbled while
 * typing on a real iPhone. Root cause: iOS Safari shrinks the visible
 * viewport while the on-screen keyboard is up (and its address bar
 * animates independently too), which changes #game-container's live
 * height - `refresh()` picks that up and recomputes Phaser's FIT sizing
 * from it, and the zoom factor is derived from that same computation, so
 * every 400ms tick was recalculating a slightly different answer purely
 * from keyboard/chrome noise, not from anything that should actually
 * matter (the scene hasn't changed, the phone hasn't rotated). Gating
 * both calls behind "did scaleMode or isPortraitLogin actually flip"
 * means neither runs again until a REAL change happens - a scene
 * transition or a genuine portrait/landscape flip - so the screen stays
 * completely still through keyboard/chrome noise instead.
 */
function updateMobileLayoutMode(): void {
  if (!isTouchDevice()) return;

  const isPortrait = window.innerHeight > window.innerWidth;
  const loginOk = game.scene.isActive("BootScene") || game.scene.isActive("LoginScene");
  const isPortraitLogin = isPortrait && loginOk;
  document.body.classList.toggle("portrait-ok", loginOk);

  const desiredMode = isPortraitLogin ? Phaser.Scale.FIT : Phaser.Scale.ENVELOP;
  const modeChanged = desiredMode !== lastAppliedMode;
  const portraitLoginChanged = isPortraitLogin !== lastAppliedPortraitLogin;

  if (modeChanged) {
    game.scale.scaleMode = desiredMode;
    game.scale.displaySize.setAspectMode(desiredMode);
    lastAppliedMode = desiredMode;
  }
  if (modeChanged || portraitLoginChanged) {
    game.scale.refresh();
  }
  if (portraitLoginChanged) {
    applyPortraitLoginZoom(isPortraitLogin);
    lastAppliedPortraitLogin = isPortraitLogin;
  }
}

updateMobileLayoutMode();
// Polled, not event-driven, for the scene-transition half of this (Login
// -> StartMenu doesn't fire any resize/orientation event to hang a
// listener off of) - 400ms is frequent enough that the rotate-prompt/
// scale-mode swap feels immediate. Safe to poll this often now that the
// function itself is a no-op unless something real actually changed (see
// its own doc comment).
setInterval(updateMobileLayoutMode, 400);

// Mobile landscape-lock defensive backstop (see index.html's #game-container
// visibility:hidden comment for the actual root-cause fix - this is extra
// insurance on top of that, not a replacement for it). A real phone's
// browser chrome (address bar collapsing/expanding on scroll, the on-screen
// keyboard appearing) can shift the visual viewport independently of any
// CSS change, which can leave the DOM Element overlay (LoginScene's real
// <input>s) positioned against stale geometry even after the canvas itself
// re-renders at the right size. The short delay lets the browser's own
// layout/CSS settle first (immediately-after-rotation dimensions are
// sometimes still mid-transition).
window.addEventListener("orientationchange", () => {
  setTimeout(updateMobileLayoutMode, 100);
});
window.addEventListener("resize", () => {
  setTimeout(updateMobileLayoutMode, 100);
});

/**
 * Top-left corner button (markup/styling in index.html) - hides browser
 * chrome (address bar, tab strip) so the game gets more real screen space,
 * via whichever mechanism the current browser actually supports:
 *
 * - Fullscreen API available (desktop browsers, Android Chrome, etc.):
 *   a real fullscreen toggle, via Phaser's Scale Manager.
 * - iOS Safari: the Fullscreen API doesn't exist for arbitrary web content
 *   at all, on any site - no toggle is possible. The only real chrome-free
 *   path there is launching from a home-screen icon (see public/
 *   manifest.json + index.html's apple-mobile-web-app-* meta tags), and
 *   iOS also exposes no JS API to trigger "Add to Home Screen" itself
 *   (unlike Android's beforeinstallprompt) - so this becomes an
 *   instruction hint instead of a toggle, since that's the most this
 *   platform allows a web page to do.
 * - Already launched standalone (already added to the home screen, on
 *   either platform): there's nothing left to offer - hidden entirely.
 *
 * Checked on Phaser's READY event, not synchronously right after `new
 * Phaser.Game()` returns - the Game constructor kicks off its own boot
 * sequence asynchronously, and checking synchronously risked reading the
 * Scale Manager's fullscreen feature-detection before it had actually run,
 * which would report unavailable even on a browser that genuinely
 * supports it. READY fires only once boot has fully finished.
 */
function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
}

function isStandaloneLaunch(): boolean {
  return (
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

const fullscreenBtn = document.getElementById("fullscreen-btn");
const installHint = document.getElementById("install-hint");
if (fullscreenBtn) {
  game.events.once(Phaser.Core.Events.READY, () => {
    if (isStandaloneLaunch()) {
      fullscreenBtn.style.display = "none";
      return;
    }

    if (game.scale.fullscreen.available) {
      fullscreenBtn.style.display = "block";
      fullscreenBtn.setAttribute("aria-label", "Toggle fullscreen");
      fullscreenBtn.addEventListener("click", () => {
        game.scale.toggleFullscreen();
      });
      game.scale.on(Phaser.Scale.Events.ENTER_FULLSCREEN, () => {
        fullscreenBtn.textContent = "⤢";
      });
      game.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, () => {
        fullscreenBtn.textContent = "⛶";
      });
    } else if (isIOS() && installHint) {
      fullscreenBtn.style.display = "block";
      fullscreenBtn.textContent = "📲";
      fullscreenBtn.setAttribute("aria-label", "Add to Home Screen for fullscreen");
      fullscreenBtn.addEventListener("click", () => {
        installHint.style.display = installHint.style.display === "block" ? "none" : "block";
      });
      // Tapping anywhere else dismisses the hint, same as any tooltip.
      document.addEventListener("pointerdown", (event) => {
        if (event.target !== fullscreenBtn && event.target !== installHint) {
          installHint.style.display = "none";
        }
      });
    } else {
      // Some other browser with neither the Fullscreen API nor a known
      // manual-install path (e.g. an obscure in-app browser) - nothing
      // actionable to offer, so stay hidden rather than show a dead button.
      fullscreenBtn.style.display = "none";
    }
  });
}

/**
 * Task #37 follow-up: a 401 from any authenticated API call (expired/
 * invalid JWT - see src/api/client.ts's `setUnauthorizedHandler`) drops the
 * player back to LoginScene instead of leaving whatever scene they were on
 * stuck showing a generic error forever. No-op if LoginScene is already the
 * active scene - it already runs its own GET /me session-restore/401
 * handling on boot, so there's nothing extra to do here in that case (and
 * calling scene.start on an already-active scene would just restart it
 * mid-restore for no benefit).
 *
 * Task #44 fix: this handler runs outside any scene's own context (it's a
 * plain callback registered on the API client, not a scene method), so it
 * only has the *global* SceneManager (`game.scene`) to work with - not a
 * scene-relative `this.scene`. Calling `game.scene.start(key)` directly on
 * the manager does NOT implicitly stop whatever scene(s) are currently
 * active - that stop-then-start pairing is something only a scene's own
 * ScenePlugin does (`this.scene.start(key)` from inside a scene stops the
 * calling scene as part of the same op). Verified live: the previous
 * version of this handler left the interrupted scene fully active (update
 * loop, input handlers, everything) running invisibly underneath
 * LoginScene - `game.scene.getScenes(true)` returned both keys afterward,
 * not just "LoginScene". Fixed by explicitly stopping every other active
 * scene before starting LoginScene, so the global call gets the same
 * "leave everything else behind" semantics a scene-relative call gets for
 * free.
 */
setUnauthorizedHandler(() => {
  if (game.scene.isActive("LoginScene")) return;
  gameState.logout(); // clears the stored token too - see GameState.logout()
  for (const scene of game.scene.getScenes(true)) {
    if (scene.scene.key !== "LoginScene") game.scene.stop(scene.scene.key);
  }
  game.scene.start("LoginScene");
});
