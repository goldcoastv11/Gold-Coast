import Phaser from "phaser";
import { fadeToScene } from "./ui/sceneTransition";
import type { PendingLevelMinigame } from "./api/types";

/**
 * The one function every "a level-up minigame might now be owed" call site
 * should call - kept as its own tiny module (rather than living inside
 * ui/ChallengesPanel.ts, which is where both real call sites are) so this
 * feature's wiring can land without editing a file another change is
 * actively restructuring. See this repo's PR for the level-up minigame for
 * the exact one-line calls still needed at each call site - neither has
 * been wired in yet.
 *
 * CALL SITE 1 - right after a challenge claim (ui/ChallengesPanel.ts's
 * `claim()`, inside its `api.claimChallenge(...).then((res) => { ... })`):
 * the claim response already carries `res.pendingLevelMinigame` (added to
 * `ClaimChallengeResponse` in api/types.ts) but nothing reads it yet. Add,
 * right after the existing `showClaimCelebration(...)` call and before the
 * `if (res.levelsGained.length > 0) { ... }` block that schedules the
 * level-up banner:
 *
 *     launchLevelUpMinigame(scene, res.pendingLevelMinigame);
 *
 * This intentionally supersedes the level-up banner when a minigame is
 * owed (the minigame's own "LEVEL n" display covers the same information,
 * and this function fades the current scene out - see below - which stops
 * whatever delayed banner call was about to fire). When nothing is owed
 * (`pendingLevelMinigame` is null, e.g. this environment's migration isn't
 * deployed yet - see levelMinigameAvailable() server-side) this is a no-op
 * and the existing banner still plays exactly as it does today.
 *
 * CALL SITE 2 - RESUMPTION, on opening the Challenges panel
 * (ui/ChallengesPanel.ts's `load()`, in its `Promise.all([...]).then(...)`
 * success branch): a player who closed the tab mid-minigame still owes it
 * (see PlayerProgress.pendingMinigameLevel's schema.prisma doc comment).
 * `nextProgression.pendingLevelMinigame` already carries this. Add, right
 * after `progression = nextProgression;` and before `if (!nextBoard.available)`:
 *
 *     if (nextProgression.pendingLevelMinigame) {
 *       launchLevelUpMinigame(scene, nextProgression.pendingLevelMinigame);
 *       return;
 *     }
 *
 * So opening Challenges with an unplayed minigame goes straight into it
 * instead of showing a panel with nothing to claim yet.
 *
 * Neither call site has an equivalent hook on plain login/session-restore
 * (there is currently no "check on boot" GET /progression call anywhere) -
 * a player who reloads WITHOUT opening Challenges keeps the flag pending
 * silently until they do. Documented as a known gap, not fixed here: the
 * only place that already calls GET /progression is ChallengesPanel.ts's
 * own load(), which is exactly call site 2 above.
 */
export function launchLevelUpMinigame(scene: Phaser.Scene, pending: PendingLevelMinigame): void {
  if (!pending) return;
  fadeToScene(scene, "LevelUpMinigameScene", { returnScene: scene.scene.key, level: pending.level });
}
