/**
 * The one file to edit when adding a new self-registering overworld top-row
 * button: add an `import "./whatever";` line below, and call
 * `registerTopRowButton(...)` (see topRowButtonRegistry.ts) at the top
 * level of that module. OverworldScene.ts imports only this file, once -
 * it never names an individual feature.
 *
 * Empty right now: the five buttons that exist today (Leaderboard,
 * Magazine, Clothes, Challenges, Quickplay) predate this mechanism and
 * stay defined locally in OverworldScene.create() - see
 * topRowButtonRegistry.ts's header for why. This file (and the import of
 * it in OverworldScene.ts) exists so the NEXT button doesn't have to touch
 * OverworldScene.ts at all.
 */
export {};
