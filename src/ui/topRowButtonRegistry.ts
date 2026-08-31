/**
 * Self-registration for the overworld's top button row (Leaderboard,
 * Magazine, Clothes, Challenges, Quickplay today - see
 * OverworldScene.create()'s "Top button row" block).
 *
 * Mirrors server/src/routes/registry.ts's shape on purpose (see that
 * file's header for the fuller rationale): a feature calls
 * `registerTopRowButton(spec)` once, at its own module's top level, and
 * `OverworldScene` never names the feature. `topRowButtonFeatures.ts` is
 * the single barrel of `import "./whatever";` lines that makes each
 * feature module's registration call actually run (needed for the same
 * reason the server side needs `routes/index.ts` - see that file's
 * comment on why a runtime directory scan doesn't work here either: this
 * is a one-time module-load-time registration, so a filesystem scan would
 * need the exact same kind of loader-compatibility care for no benefit
 * over a plain import list).
 *
 * This registry only covers buttons that are happy with the generic
 * `TopRowButtonHost` shape below. The five buttons that already existed
 * when this registry was added (Leaderboard/Magazine/Clothes/Challenges/
 * Quickplay) stay defined as a small local array inside
 * OverworldScene.create() instead of going through `registerTopRowButton`
 * - Challenges and Quickplay each carry real per-scene state (the pulsing
 * "ready" ring, the open/closed toggle) that's cheaper and clearer to keep
 * as ordinary private scene methods than to force through a generic click
 * handler. That's an intentional scope boundary, not a gap: any NEW button
 * that just needs to pop its own panel open can register here and never
 * touch OverworldScene.ts.
 */
import Phaser from "phaser";
import { UIButton } from "./uiHelpers";

/**
 * What a registered button's `onClick` gets back from the scene hosting
 * it. Deliberately the union of every existing `*PanelHost` interface in
 * this codebase (LeaderboardPanelHost, MagazinePanelHost, ShopPanelHost,
 * ChallengesPanelHost, QuickplayPanelHost) rather than a bespoke shape, so
 * an `open*Panel(host)` function written for one of those can be handed
 * this host directly - TypeScript's structural typing only requires the
 * fields it actually reads.
 */
export interface TopRowButtonHost {
  /** The scene the button (and whatever it opens) draws into. */
  readonly scene: Phaser.Scene;
  /** Raises/lowers the host's modal flag - see any `*PanelHost.setPanelOpen` doc comment for why this stays the host's job. */
  setPanelOpen(open: boolean): void;
  /** Repaints the host's coin/level HUD after a balance or level change. */
  updateHud(): void;
  /** Brief fading confirmation/error message above whatever the button opened. */
  showToast(message: string, color: string): void;
  /** Hands off to a game scene - see OverworldScene.goToGame's own doc comment. */
  goToGame(sceneKey: string): void;
}

export interface TopRowButtonSpec {
  /**
   * Stable, unique id. Not shown to players - used to look a created
   * button back up later (e.g. a highlight ring, a relabel). Must not
   * collide with the built-in ids: "leaderboard", "magazine", "clothes",
   * "challenges", "quickplay".
   */
  id: string;
  /** Initial label, with its emoji prefix (this codebase's convention - see the built-in buttons in OverworldScene.create()). */
  label: string;
  /** Click handler. `button` is the live UIButton, in case a feature ever wants to relabel itself the way the Quickplay button does. */
  onClick: (host: TopRowButtonHost, button: UIButton) => void;
}

const registered: TopRowButtonSpec[] = [];

/**
 * Adds one button to the overworld's top row. Call this once, at the top
 * level of the feature's own module (not inside a function) - and add
 * that module to `topRowButtonFeatures.ts`'s import list so it actually
 * loads.
 */
export function registerTopRowButton(spec: TopRowButtonSpec): void {
  registered.push(spec);
}

/** Every externally-registered button, in registration order. */
export function getRegisteredTopRowButtons(): TopRowButtonSpec[] {
  return registered;
}
