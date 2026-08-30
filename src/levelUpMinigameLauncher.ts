import Phaser from "phaser";
import { fadeToScene } from "./ui/sceneTransition";
import type { PendingLevelMinigame } from "./api/types";

/**
 * The one function every "actually start the level-up minigame" call site
 * should call - kept as its own tiny module (rather than living inside
 * whichever UI happens to trigger it) so more than one call site can share
 * it without a dependency cycle.
 *
 * CALL SITE: OverworldScene's Level-Up station (see OverworldScene.ts's
 * `openLevelUpKiosk()`/`refreshLevelUpStation()`). The minigame used to
 * launch itself automatically - right after a challenge claim crossed a
 * level, and again on opening the Challenges panel with one still owed
 * (ui/ChallengesPanel.ts's `claim()` and `load()`) - which interrupted
 * whatever the player was doing. Founder direction, from real play: make it
 * "its own kiosk that has a ring around it ... when it is activated"
 * instead. Both automatic launches were removed; ui/ChallengesPanel.ts's
 * claim celebration and level-up banner now play uninterrupted, and a
 * pending minigame instead shows as a highlight ring (see
 * ui/TutorialGuide.ts's showHighlightRing, reused from the onboarding
 * tutorial) on a real walk-up-and-press-E station until the player goes and
 * plays it.
 *
 * refreshLevelUpStation() calls GET /progression on every OverworldScene
 * `create()` (i.e. on every scene entry, including plain login/session
 * restore, not just on opening Challenges) - so a player who levelled up
 * and reloaded without ever opening Challenges still sees the ring, closing
 * the gap this module used to document as unfixed.
 */
export function launchLevelUpMinigame(scene: Phaser.Scene, pending: PendingLevelMinigame): void {
  if (!pending) return;
  fadeToScene(scene, "LevelUpMinigameScene", { returnScene: scene.scene.key, level: pending.level });
}
