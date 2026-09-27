/**
 * The one file to edit when adding a new self-registering overworld top-row
 * button: add an `import "./whatever";` line below, and call
 * `registerTopRowButton(...)` (see topRowButtonRegistry.ts) at the top
 * level of that module. OverworldScene.ts imports only this file, once -
 * it never names an individual feature.
 *
 * The five buttons that existed when this mechanism was added (Leaderboard,
 * Magazine, Clothes, Challenges, Quickplay) stay defined locally in
 * OverworldScene.create() - see topRowButtonRegistry.ts's header for why.
 * This file exists so every button AFTER them can be added without touching
 * OverworldScene.ts, and the emote picker below is the first to take it up.
 */

// The multiplayer emote picker. See EmotePanel.ts for why the vocabulary is
// closed and there is deliberately no free-text field.
import "./EmotePanel";

export {};
