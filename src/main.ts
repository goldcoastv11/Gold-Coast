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
  scale: {
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
