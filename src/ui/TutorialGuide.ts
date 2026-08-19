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
 * Skippable at any point via the always-visible "Skip Tutorial" button.
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
}

const PANEL_X = 400;
const PANEL_Y = 520;
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
    "Skip Tutorial",
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

/**
 * Runs `steps` in order: pans the camera (if `panTo` is given), shows the
 * dialogue, waits for "Next"/"Skip", advances - "Got it!" on the final
 * step's button instead of "Next". Stops following the player with the
 * camera for the duration (`stopFollow`) - this module doesn't know the
 * caller's `startFollow` lerp settings, so resuming it is the caller's job
 * via `onComplete`, called exactly once whether the tutorial finished
 * normally or was skipped. `onLockMovement(true)` fires immediately;
 * `onLockMovement(false)` fires right before `onComplete`.
 */
export function runOnboardingTutorial(
  scene: Phaser.Scene,
  steps: readonly TutorialStep[],
  callbacks: { onLockMovement: (locked: boolean) => void; onComplete: () => void }
): void {
  if (steps.length === 0) {
    callbacks.onComplete();
    return;
  }

  callbacks.onLockMovement(true);
  scene.cameras.main.stopFollow();

  let index = 0;

  const finish = () => {
    callbacks.onLockMovement(false);
    callbacks.onComplete();
  };

  const showStep = () => {
    const step = steps[index];
    const isLast = index === steps.length - 1;
    const handle = showDialogue(
      scene,
      step.title,
      step.text,
      isLast ? "Got it!" : "Next →",
      () => {
        handle.destroy();
        index++;
        if (index >= steps.length) {
          finish();
        } else {
          goToStep();
        }
      },
      () => {
        handle.destroy();
        finish();
      }
    );
  };

  const goToStep = () => {
    const step = steps[index];
    if (step.panTo) {
      scene.cameras.main.pan(step.panTo.x, step.panTo.y, PAN_MS, "Sine.InOut", false, (_cam, progress) => {
        if (progress === 1) showStep();
      });
    } else {
      showStep();
    }
  };

  goToStep();
}
