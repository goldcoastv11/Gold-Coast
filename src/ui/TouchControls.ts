import Phaser from "phaser";
import { Theme } from "./Theme";

/**
 * On-screen touch controls for the overworld: a drag-based virtual
 * joystick (bottom-left) for movement, and a big round "interact" button
 * (bottom-right) standing in for the keyboard's E key. Only created when
 * `isTouchDevice()` is true - desktop keeps using WASD/arrows/E exactly as
 * before, this is purely additive.
 *
 * Both controls are screen-fixed (scrollFactor 0) and drawn at a depth
 * above everything else the overworld renders. All listeners are attached
 * to `scene.input`/the individual GameObjects, which are torn down
 * automatically when the scene shuts down (same as this file's keyboard
 * equivalent, OverworldScene's `this.cursors`/`this.wasd` - Phaser's
 * per-scene InputPlugin instance is destroyed with the scene, taking every
 * listener registered on it with it), so no manual cleanup wiring is
 * needed beyond destroying the display objects themselves.
 */

const JOYSTICK_X = 90;
// Y=385, not the original 500 - main.ts's Scale.ENVELOP-on-mobile crops
// the canvas to fill a wide phone screen edge-to-edge, so nothing
// tappable can sit outside the safe y=[130,470] band any more (see
// uiHelpers.ts's SAFE_ZONE_TOP/BOTTOM for the measured numbers this is
// based on) - 385 keeps the joystick's full hit radius (74, see below)
// inside that band with real margin.
const JOYSTICK_Y = 385;
const JOYSTICK_RADIUS = 50;
const KNOB_RADIUS = 24;
const DEADZONE_FRACTION = 0.25; // fraction of JOYSTICK_RADIUS before a direction registers

const INTERACT_X = 730;
const INTERACT_Y = 385; // see JOYSTICK_Y's comment - same safe-zone constraint
const INTERACT_RADIUS = 40;

const CONTROLS_DEPTH = 500;

export function isTouchDevice(): boolean {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

export interface TouchControlsState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export interface TouchControlsHandle {
  state: TouchControlsState;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
}

/** `onInteract` fires once per tap on the interact button (not held/repeated), matching the keyboard path's JustDown semantics. */
export function createTouchControls(scene: Phaser.Scene, onInteract: () => void): TouchControlsHandle {
  const state: TouchControlsState = { left: false, right: false, up: false, down: false };

  const base = scene.add
    .circle(JOYSTICK_X, JOYSTICK_Y, JOYSTICK_RADIUS, Theme.panel, 0.55)
    .setStrokeStyle(2, Theme.panelBorder, 0.85)
    .setScrollFactor(0)
    .setDepth(CONTROLS_DEPTH);
  const knob = scene.add
    .circle(JOYSTICK_X, JOYSTICK_Y, KNOB_RADIUS, Theme.neutral, 0.9)
    .setStrokeStyle(2, Theme.panelBorder, 1)
    .setScrollFactor(0)
    .setDepth(CONTROLS_DEPTH + 1);
  // Larger, near-invisible hit zone around the visible base - easier to
  // land a thumb on than the thin ring itself, same "generous tap target"
  // idea as every makeButton in this game.
  const hitZone = scene.add
    .circle(JOYSTICK_X, JOYSTICK_Y, JOYSTICK_RADIUS + 24, 0x000000, 0.001)
    .setScrollFactor(0)
    .setDepth(CONTROLS_DEPTH + 2)
    .setInteractive();

  let activePointerId: number | null = null;

  const updateFromPointer = (px: number, py: number) => {
    const dx = px - JOYSTICK_X;
    const dy = py - JOYSTICK_Y;
    const dist = Math.min(Math.hypot(dx, dy), JOYSTICK_RADIUS);
    const angle = Math.atan2(dy, dx);
    knob.setPosition(JOYSTICK_X + Math.cos(angle) * dist, JOYSTICK_Y + Math.sin(angle) * dist);

    const deadzone = JOYSTICK_RADIUS * DEADZONE_FRACTION;
    if (dist < deadzone) {
      state.left = state.right = state.up = state.down = false;
      return;
    }
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    state.left = nx < -0.3;
    state.right = nx > 0.3;
    state.up = ny < -0.3;
    state.down = ny > 0.3;
  };

  const resetStick = () => {
    activePointerId = null;
    knob.setPosition(JOYSTICK_X, JOYSTICK_Y);
    state.left = state.right = state.up = state.down = false;
  };

  hitZone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
    activePointerId = pointer.id;
    updateFromPointer(pointer.x, pointer.y);
  });
  scene.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
    if (pointer.id !== activePointerId) return;
    updateFromPointer(pointer.x, pointer.y);
  });
  scene.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
    if (pointer.id === activePointerId) resetStick();
  });
  scene.input.on("pointerupoutside", (pointer: Phaser.Input.Pointer) => {
    if (pointer.id === activePointerId) resetStick();
  });

  const interactBtn = scene.add
    .circle(INTERACT_X, INTERACT_Y, INTERACT_RADIUS, Theme.accent, 0.88)
    .setStrokeStyle(2, Theme.outline, 1)
    .setScrollFactor(0)
    .setDepth(CONTROLS_DEPTH + 1)
    .setInteractive({ useHandCursor: true });
  const interactLabel = scene.add
    .text(INTERACT_X, INTERACT_Y, "E", { fontSize: "22px", color: Theme.textOnDark, fontStyle: "bold" })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(CONTROLS_DEPTH + 2);

  interactBtn.on("pointerdown", () => {
    interactBtn.setScale(0.9);
    onInteract();
  });
  interactBtn.on("pointerup", () => interactBtn.setScale(1));
  interactBtn.on("pointerout", () => interactBtn.setScale(1));

  return {
    state,
    // Hides the joystick/interact button while a real panel is open (see
    // OverworldScene's panelOpen setter) - most modals don't visually cover
    // the bottom-right interact circle, so leaving it up would look
    // tappable while doing nothing (interaction is already gated off in
    // that state, this is purely so it doesn't look broken). The hit zone
    // stays interactive-disabled too, not just hidden, so a stray tap
    // can't reset the joystick's drag state mid-panel.
    setVisible: (visible: boolean) => {
      base.setVisible(visible);
      knob.setVisible(visible);
      interactBtn.setVisible(visible);
      interactLabel.setVisible(visible);
      if (visible) {
        hitZone.setInteractive();
        interactBtn.setInteractive({ useHandCursor: true });
      } else {
        hitZone.disableInteractive();
        interactBtn.disableInteractive();
        resetStick();
      }
    },
    destroy: () => {
      base.destroy();
      knob.destroy();
      hitZone.destroy();
      interactBtn.destroy();
      interactLabel.destroy();
    }
  };
}
