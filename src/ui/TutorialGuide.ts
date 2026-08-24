import Phaser from "phaser";
import { Theme } from "./Theme";
import { makeButton, makePanel } from "./uiHelpers";

/**
 * Onboarding tutorial - a short guided tour that runs once, right after a
 * brand-new signup, in OverworldScene. A mascot "guide" character (a drawn
 * placeholder texture - see BootScene's createTutorialGuideTexture) appears
 * in a screen-fixed dialogue box (the "voice box") explaining one beat at a
 * time; the camera pans to whatever station is being introduced instead of
 * requiring the player to walk there themselves (per user direction).
 * Skippable at any point via the always-visible "Skip" button - per user
 * direction, "Skip" advances to the NEXT step rather than ending the whole
 * tutorial (for the two informational steps here, that's identical to
 * "Next"; for the three hands-on steps OverworldScene chains afterward,
 * see its own runHandsOn*Step methods for what "next" means there).
 *
 * Deliberately NOT persisted anywhere - no server flag, no localStorage.
 * OverworldScene only ever passes `startTutorial: true` from the one-time
 * signup flow (see LoginScene.reconcileAndEnter's `startTutorial` param,
 * threaded through StartMenuScene), so "runs exactly once per account"
 * falls out for free from signup itself only ever happening once - nothing
 * extra to keep in sync, and nothing to migrate/backfill for existing
 * accounts (they simply never pass the flag).
 */
export interface TutorialStep {
  title: string;
  text: string;
  /** World position to pan the camera to before showing this step. Omit to keep the camera wherever it already is (the first step, right after stopFollow, or a step at the same spot as the previous one). */
  panTo?: { x: number; y: number };
  /**
   * If true, movement is unlocked and the camera resumes following the
   * player while THIS step's dialogue is shown - for the "this is you, try
   * WASD" step, so the tutorial's own instruction actually does something
   * instead of the player pressing keys and nothing happening (movement is
   * locked by default for every other step, since the player shouldn't be
   * wandering off mid-tour while the camera's about to pan somewhere else).
   * Locks again (and the camera stops following again) the moment they
   * advance past it.
   */
  allowMovement?: boolean;
}

const PANEL_X = 400;
// Top of the screen, not the bottom - this panel is nearly full-width
// (680 of the 800px canvas), so at its original PANEL_Y=520 it directly
// overlapped the mobile touch joystick/interact button band (both sit
// around y=500, see TouchControls.ts) - reported live as the tutorial
// blocking the exact controls its own hands-on steps ask the player to
// use. Nothing at the top of the overworld competes for this space the
// way the bottom does.
const PANEL_Y = 100;
const PANEL_W = 680;
const PANEL_H = 150;
const DEPTH = 500; // above every other Overworld panel (buy/wardrobe/chip panels top out around 201-401)
const PAN_MS = 700;

interface DialogueHandle {
  destroy: () => void;
}

/** Renders one step's "voice box": mascot portrait + title + body + Next/Skip. Every element gets its own explicit setScrollFactor(0) - see ShuffleCupReveal.ts's #32 postmortem for why that's load-bearing (not just cosmetic) once the camera is mid-pan, not only for rendering but for correct input hit-testing too. */
function showDialogue(
  scene: Phaser.Scene,
  title: string,
  text: string,
  nextLabel: string,
  onNext: () => void,
  onSkip: () => void
): DialogueHandle {
  const panel = makePanel(scene, PANEL_X, PANEL_Y, PANEL_W, PANEL_H, DEPTH).setScrollFactor(0);

  const portrait = scene.add
    .image(PANEL_X - PANEL_W / 2 + 55, PANEL_Y, "tutorial_guide")
    .setScrollFactor(0)
    .setDepth(DEPTH + 1)
    .setScale(1.5);

  const titleText = scene.add
    .text(PANEL_X - PANEL_W / 2 + 110, PANEL_Y - 42, title, {
      fontSize: "15px",
      color: Theme.textGold,
      fontStyle: "bold"
    })
    .setScrollFactor(0)
    .setDepth(DEPTH + 1);

  const bodyText = scene.add
    .text(PANEL_X - PANEL_W / 2 + 110, PANEL_Y - 20, text, {
      fontSize: "13px",
      color: Theme.textPrimary,
      wordWrap: { width: 380 }
    })
    .setScrollFactor(0)
    .setDepth(DEPTH + 1);

  const nextBtn = makeButton(
    scene,
    PANEL_X + PANEL_W / 2 - 85,
    PANEL_Y + 42,
    130,
    40,
    nextLabel,
    Theme.accent,
    Theme.accentHover,
    onNext
  );
  nextBtn.container.setScrollFactor(0).setDepth(DEPTH + 1);

  const skipBtn = makeButton(
    scene,
    PANEL_X + PANEL_W / 2 - 85,
    PANEL_Y - 42,
    130,
    30,
    "Skip",
    Theme.neutral,
    Theme.neutralHover,
    onSkip
  );
  skipBtn.container.setScrollFactor(0).setDepth(DEPTH + 1);

  return {
    destroy: () => {
      panel.destroy();
      portrait.destroy();
      titleText.destroy();
      bodyText.destroy();
      nextBtn.destroy();
      skipBtn.destroy();
    }
  };
}

export interface HighlightHandle {
  destroy: () => void;
}

/**
 * A pulsing gold ring drawing attention to (x, y) - for "go do this for
 * real" tutorial steps (walk up to a station and actually interact with
 * it), as opposed to the informational steps' simple dialogue+Next flow.
 * World-space by default (scrolls with the camera, so it stays pinned to
 * whatever it's highlighting as the player walks around) - pass
 * `screenFixed: true` for a UI target instead (e.g. a button inside a game
 * scene that never scrolls).
 */
export function showHighlightRing(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius: number,
  screenFixed = false
): HighlightHandle {
  const ring = scene.add.graphics().setPosition(x, y).setDepth(DEPTH + 2);
  if (screenFixed) ring.setScrollFactor(0);
  ring.lineStyle(4, Theme.gold, 1);
  ring.strokeCircle(0, 0, radius);

  const tween = scene.tweens.add({
    targets: ring,
    scale: { from: 1, to: 1.25 },
    alpha: { from: 1, to: 0.35 },
    duration: 700,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut"
  });

  return {
    destroy: () => {
      tween.stop();
      ring.destroy();
    }
  };
}

export interface InstructionHandle {
  destroy: () => void;
}

/**
 * A lighter-weight sibling of the dialogue box above, for a "go do this
 * for real" step - same title/body/mascot/Skip layout, but NO Next button,
 * since progression here is driven by the player actually completing the
 * real action (a real claim, purchase, or game round), not a click. The
 * caller is responsible for listening for that real completion itself and
 * calling `.destroy()` (this handle doesn't know what "done" means for any
 * given station). `onSkip` here means "skip THIS step, move to the next
 * one" (per user direction, same as every other step's Skip button) - the
 * caller decides what "next" actually is.
 */
export function showInstruction(scene: Phaser.Scene, title: string, text: string, onSkip: () => void): InstructionHandle {
  const panel = makePanel(scene, PANEL_X, PANEL_Y, PANEL_W, PANEL_H, DEPTH).setScrollFactor(0);

  const portrait = scene.add
    .image(PANEL_X - PANEL_W / 2 + 55, PANEL_Y, "tutorial_guide")
    .setScrollFactor(0)
    .setDepth(DEPTH + 1)
    .setScale(1.5);

  const titleText = scene.add
    .text(PANEL_X - PANEL_W / 2 + 110, PANEL_Y - 42, title, {
      fontSize: "15px",
      color: Theme.textGold,
      fontStyle: "bold"
    })
    .setScrollFactor(0)
    .setDepth(DEPTH + 1);

  const bodyText = scene.add
    .text(PANEL_X - PANEL_W / 2 + 110, PANEL_Y - 20, text, {
      fontSize: "13px",
      color: Theme.textPrimary,
      wordWrap: { width: 380 }
    })
    .setScrollFactor(0)
    .setDepth(DEPTH + 1);

  const skipBtn = makeButton(
    scene,
    PANEL_X + PANEL_W / 2 - 85,
    PANEL_Y,
    130,
    40,
    "Skip",
    Theme.neutral,
    Theme.neutralHover,
    onSkip
  );
  skipBtn.container.setScrollFactor(0).setDepth(DEPTH + 1);

  return {
    destroy: () => {
      panel.destroy();
      portrait.destroy();
      titleText.destroy();
      bodyText.destroy();
      skipBtn.destroy();
    }
  };
}

/**
 * Runs `steps` in order: pans the camera (if `panTo` is given), shows the
 * dialogue, waits for "Next"/"Skip", advances - "Got it!" on the final
 * step's button instead of "Next".
 *
 * Movement is unlocked per-step via `onLockMovement` for a step with
 * `allowMovement: true` (e.g. "try WASD now"), but the camera deliberately
 * stays static (never resumes live `startFollow`) for the ENTIRE tutorial,
 * even on that step - only `onComplete` (once the whole tutorial ends)
 * resumes real camera-follow. This used to resume live follow during the
 * movement-enabled step too, so the player could see themselves walk
 * around - but that combination (a live camera actively re-centering every
 * frame while a screen-fixed *interactive* dialogue with hover/click
 * targets is simultaneously open) was directly correlated with a full
 * browser-tab hang reported in testing, never fully root-caused. Every
 * other step in this tutorial keeps the camera static while its dialogue
 * shows; this just makes the movement-enabled step consistent with that
 * instead of being the one exception - the player can still see their
 * character move within the current (static) viewport, just without the
 * camera chasing them if they walk far enough to leave it.
 */
export function runOnboardingTutorial(
  scene: Phaser.Scene,
  steps: readonly TutorialStep[],
  callbacks: {
    onLockMovement: (locked: boolean) => void;
    onComplete: () => void;
  }
): void {
  if (steps.length === 0) {
    callbacks.onComplete();
    return;
  }

  let index = 0;

  const applyStepInteractivity = (step: TutorialStep) => {
    callbacks.onLockMovement(!step.allowMovement);
    scene.cameras.main.stopFollow();
  };

  const finish = () => {
    callbacks.onLockMovement(false);
    callbacks.onComplete();
  };

  const showStep = () => {
    const step = steps[index];
    const isLast = index === steps.length - 1;
    // Guards against ever advancing/destroying twice for this one dialogue
    // instance - belt-and-suspenders against a stray double pointerdown
    // (fast double-click/tap) firing both handlers, or one twice, before
    // the button's hit area is actually torn down. Without this, a
    // double-fire would create two overlapping dialogue boxes (the exact
    // "text will overlay" symptom) since a second showStep() call renders
    // on top of the first's before its own click ever destroys it.
    let handled = false;
    // Skip means "skip THIS step, move to the next one" (per user
    // direction), which for these two purely informational steps is
    // identical to clicking Next - both just call this same advance().
    const advance = () => {
      if (handled) return;
      handled = true;
      handle.destroy();
      index++;
      if (index >= steps.length) {
        finish();
      } else {
        goToStep();
      }
    };
    const handle = showDialogue(scene, step.title, step.text, isLast ? "Got it!" : "Next →", advance, advance);
  };

  const goToStep = () => {
    const step = steps[index];
    applyStepInteractivity(step);
    if (step.panTo) {
      // force: true - a fresh pan should never silently no-op just because
      // Phaser's Pan effect happened to still consider itself "running"
      // (e.g. `isRunning` not yet reset the instant this fires) - without
      // force, `Camera.pan()`'s `if (!force && this.isRunning) return cam;`
      // would drop the call (and its callback) entirely, which reads
      // exactly like the tutorial silently freezing on the previous step.
      //
      // "Sine.easeInOut", NOT "Sine.InOut" - this is the actual root cause
      // of the real browser-tab hang reported in testing (found via a
      // console stack trace: "Uncaught TypeError: this.ease is not a
      // function", thrown every single frame from inside Phaser's Pan
      // effect). Phaser's Tween system (see ShuffleCupReveal.ts's own
      // "Sine.InOut" usages, which are fine) has smart fallback string
      // normalization that accepts "Sine.InOut" and corrects it - but the
      // Camera Pan effect (Phaser.Cameras.Scene2D.Effects.Pan#start) does
      // a raw `EaseMap.hasOwnProperty(ease)` lookup with NO fallback, so
      // an unrecognized string leaves its internal `this.ease` unset. Every
      // subsequent frame then calls `this.ease(progress)` and throws,
      // forever - the effect never reaches its own completion, so the pan
      // (and the whole tutorial) never advances, and repeatedly throwing
      // an uncaught exception every frame (compounded by DevTools capturing
      // a full stack trace each time) is exactly what made the tab feel
      // unresponsive. Two earlier fix attempts (removing live camera-
      // follow, then blocking station interaction during movement) were
      // both reasonable hardening but neither was the actual cause.
      let panDone = false;
      scene.cameras.main.pan(step.panTo.x, step.panTo.y, PAN_MS, "Sine.easeInOut", true, (_cam, progress) => {
        if (progress === 1 && !panDone) {
          panDone = true;
          showStep();
        }
      });
    } else {
      showStep();
    }
  };

  goToStep();
}
