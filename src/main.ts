import Phaser from "phaser";
import { Theme } from "./ui/Theme";
import { BootScene } from "./scenes/BootScene";
import { LoginScene } from "./scenes/LoginScene";
import { StartMenuScene } from "./scenes/StartMenuScene";
import { OverworldScene } from "./scenes/OverworldScene";
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
import { setUnauthorizedHandler } from "./api/client";
import { gameState } from "./GameState";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: "game-container",
  backgroundColor: Theme.bgDark,
  pixelArt: true,
  // Phaser's loader defaults to at most 32 concurrent downloads - BootScene
  // preloads well over that (17 skin spritesheets + tiles/characters + the
  // 8 sound effects from ui/SoundManager.ts pushed the total past 32 for
  // the first time). Files queued beyond the cap are only supposed to
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
    // FIT, not ENVELOP - reverted after a real-device test. ENVELOP scales
    // up to fully cover the viewport with no letterbox bars, but crops
    // whatever overflows to get there - on a typical phone's wide
    // landscape aspect ratio (~19.5:9-21:9) vs this game's fixed 4:3
    // layout, that meant cropping roughly 20% off the TOP AND BOTTOM to
    // cover the extra width. Every bottom-anchored control (the touch
    // joystick/interact button, Walk Away, every game's Cash Out button)
    // sits close enough to y=500-600 to land inside that cropped zone -
    // confirmed live: the joystick became unreachable. FIT always shows
    // 100% of the canvas (letterboxed, never cropped), which is the
    // correct tradeoff here - every control staying reachable matters more
    // than eliminating the bars. The fullscreen toggle button (below) is
    // a separate, compatible way to reclaim screen space (hides the
    // browser's own chrome) without this cropping problem.
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
    VideoPokerScene
  ]
};

const game = new Phaser.Game(config);
// Debug handle only - lets the browser console inspect the running game
// (e.g. `__game.scene.getScene("LoginScene")`). Harmless to leave in.
(window as unknown as { __game: Phaser.Game }).__game = game;

// Mobile landscape-lock defensive backstop (see index.html's #game-container
// visibility:hidden comment for the actual root-cause fix - this is extra
// insurance on top of that, not a replacement for it). A real phone's
// browser chrome (address bar collapsing/expanding on scroll, the on-screen
// keyboard appearing) can shift the visual viewport independently of any
// CSS change, which can leave the DOM Element overlay (LoginScene's real
// <input>s) positioned against stale geometry even after the canvas itself
// re-renders at the right size. `scale.refresh()` forces Phaser to fully
// recompute both the canvas AND the DOM container's position/scale against
// current, real layout - cheap to call, so just do it after every
// orientation/resize event rather than trying to guess which ones actually
// need it. The short delay lets the browser's own layout/CSS settle first
// (immediately-after-rotation dimensions are sometimes still mid-transition).
window.addEventListener("orientationchange", () => {
  setTimeout(() => game.scale.refresh(), 100);
});
window.addEventListener("resize", () => {
  setTimeout(() => game.scale.refresh(), 100);
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
