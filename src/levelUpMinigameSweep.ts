/**
 * Client-side mirror of server/src/progression/levelMinigame.ts's
 * `sweepPosition` - VISUAL ONLY.
 *
 * There is no shared package between client and server in this repo (see
 * src/api/types.ts's header), so this formula is hand-duplicated rather
 * than imported. It must be kept byte-for-byte identical in behaviour to
 * the server's copy, because that's what makes the bar the player watches
 * line up with what the server actually scores - see
 * server/src/progression/levelMinigameSession.ts's header comment.
 *
 * TRUST BOUNDARY: this function's output NEVER decides a reward. It is
 * used only to draw the moving marker in
 * src/scenes/LevelUpMinigameScene.ts. The real result comes back from
 * `POST /minigame/levelup/stop`, computed by the server from its own
 * clock against its own copy of this formula - a client that reported a
 * fabricated position here would change nothing about what gets paid.
 */

/**
 * The marker's position on the bar at `elapsedMs` since the sweep started,
 * as a triangle wave in [-1, 1] (-1 and +1 are the two ends of the bar, 0 is
 * dead centre) that repeats every `periodMs`.
 */
export function sweepPosition(elapsedMs: number, periodMs: number): number {
  if (!(periodMs > 0)) return -1;
  const half = periodMs / 2;
  const t = ((elapsedMs % periodMs) + periodMs) % periodMs;
  const phase = t / half; // [0, 2)
  return phase <= 1 ? -1 + 2 * phase : 3 - 2 * phase;
}
