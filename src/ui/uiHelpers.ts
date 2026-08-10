import Phaser from "phaser";
import { Theme } from "./Theme";
import { gameState, BET_STEP } from "../GameState";

/** A pill-shaped, interactive button with hover feedback. */
export interface UIButton {
  container: Phaser.GameObjects.Container;
  setLabel: (text: string) => void;
  setEnabled: (enabled: boolean) => void;
  destroy: () => void;
}

function drawPill(
  g: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
  fill: number,
  alpha = 1
) {
  g.clear();
  g.fillStyle(fill, alpha);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  g.lineStyle(2, 0x000000, 0.25);
  g.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
}

/**
 * Creates a pill-shaped button. Pass baseColor/hoverColor to theme it
 * (e.g. Theme.accent for a primary action, Theme.neutral for secondary).
 */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  baseColor: number,
  hoverColor: number,
  onClick: () => void,
  textColor = "#0e1015"
): UIButton {
  const container = scene.add.container(x, y);
  const bg = scene.add.graphics();
  drawPill(bg, w, h, baseColor);

  const text = scene.add
    .text(0, 0, label, {
      fontSize: "16px",
      color: textColor,
      fontStyle: "bold"
    })
    .setOrigin(0.5);

  container.add([bg, text]);
  container.setSize(w, h);
  container.setInteractive({ useHandCursor: true });

  let enabled = true;

  container.on("pointerover", () => {
    if (enabled) drawPill(bg, w, h, hoverColor);
  });
  container.on("pointerout", () => {
    if (enabled) drawPill(bg, w, h, baseColor);
  });
  container.on("pointerdown", () => {
    if (enabled) onClick();
  });

  return {
    container,
    setLabel: (t: string) => text.setText(t),
    setEnabled: (v: boolean) => {
      enabled = v;
      container.setAlpha(v ? 1 : 0.45);
      if (v) {
        container.setInteractive({ useHandCursor: true });
      } else {
        container.disableInteractive();
      }
      drawPill(bg, w, h, baseColor);
    },
    destroy: () => container.destroy()
  };
}

/** A dark rounded panel used as a backdrop for game screens and dialogs. */
export function makePanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  depth = 0
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y }).setDepth(depth);
  g.fillStyle(Theme.panel, 0.97);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, 18);
  g.lineStyle(2, Theme.panelBorder, 1);
  g.strokeRoundedRect(-w / 2, -h / 2, w, h, 18);
  return g;
}

/** A small dark inset "well" - used for reel cells, balance pills, etc. */
export function makeInset(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 10
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  g.fillStyle(Theme.inset, 1);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
  g.lineStyle(1, Theme.panelBorder, 1);
  g.strokeRoundedRect(-w / 2, -h / 2, w, h, radius);
  return g;
}

export interface BetControl {
  container: Phaser.GameObjects.Container;
  refresh: () => void;
  setEnabled: (enabled: boolean) => void;
  destroy: () => void;
}

/**
 * Shared "Bet: N GC  [-] [+]" stepper, backed by gameState.betAmount so the
 * chosen size carries over between games. Click the amount itself to type a
 * custom value on the keyboard (digits, Backspace, Enter to confirm, Escape
 * to cancel). Call refresh() if something else changes betAmount while this
 * control is on screen. Call onChange after every adjustment so the caller
 * can update any payout previews.
 */
export function makeBetControl(
  scene: Phaser.Scene,
  x: number,
  y: number,
  onChange: () => void
): BetControl {
  const container = scene.add.container(x, y);

  const inset = makeInset(scene, 0, 0, 260, 40, 12);

  const label = scene.add
    .text(0, 0, "", { fontSize: "14px", color: Theme.textPrimary, fontStyle: "bold" })
    .setOrigin(0.5);

  let editing = false;
  let editValue = "";
  let controlEnabled = true;
  let cursorOn = true;
  let cursorTimer: Phaser.Time.TimerEvent | undefined;

  const refresh = () => {
    if (editing) return;
    label.setText(`Bet: ${gameState.betAmount} GC  ✎`);
  };

  const renderEditLabel = () => {
    label.setText(`Bet: ${editValue}${cursorOn ? "_" : " "}`);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key >= "0" && event.key <= "9") {
      if (editValue.length < 5) editValue += event.key;
      renderEditLabel();
    } else if (event.key === "Backspace") {
      editValue = editValue.slice(0, -1);
      renderEditLabel();
    } else if (event.key === "Enter") {
      stopEdit(true);
    } else if (event.key === "Escape") {
      stopEdit(false);
    }
  };

  const startEdit = () => {
    if (!controlEnabled || editing) return;
    editing = true;
    editValue = "";
    cursorOn = true;
    label.setColor(Theme.textAccent);
    renderEditLabel();
    minusBtn.setEnabled(false);
    plusBtn.setEnabled(false);
    scene.input.keyboard?.on("keydown", onKeyDown);
    cursorTimer = scene.time.addEvent({
      delay: 450,
      loop: true,
      callback: () => {
        cursorOn = !cursorOn;
        renderEditLabel();
      }
    });
  };

  const stopEdit = (commit: boolean) => {
    if (!editing) return;
    editing = false;
    scene.input.keyboard?.off("keydown", onKeyDown);
    cursorTimer?.remove(false);
    cursorTimer = undefined;
    if (commit && editValue.length > 0) {
      gameState.setBet(parseInt(editValue, 10));
      onChange();
    }
    label.setColor(Theme.textPrimary);
    if (controlEnabled) {
      minusBtn.setEnabled(true);
      plusBtn.setEnabled(true);
    }
    refresh();
  };

  // Invisible click target over the amount label - separate from the +/-
  // buttons so it can't be triggered by clicking them.
  const hitZone = scene.add.zone(0, 0, 150, 40).setInteractive({ useHandCursor: true });
  hitZone.on("pointerdown", () => {
    if (editing) stopEdit(true);
    else startEdit();
  });

  const minusBtn = makeButton(scene, -102, 0, 36, 32, "-", Theme.neutral, Theme.neutralHover, () => {
    if (editing) stopEdit(false);
    gameState.adjustBet(-BET_STEP);
    refresh();
    onChange();
  });
  const plusBtn = makeButton(scene, 102, 0, 36, 32, "+", Theme.neutral, Theme.neutralHover, () => {
    if (editing) stopEdit(false);
    gameState.adjustBet(BET_STEP);
    refresh();
    onChange();
  });

  container.add([inset, label, hitZone, minusBtn.container, plusBtn.container]);
  refresh();

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.input.keyboard?.off("keydown", onKeyDown);
    cursorTimer?.remove(false);
  });

  return {
    container,
    refresh,
    setEnabled: (enabled: boolean) => {
      controlEnabled = enabled;
      if (editing && !enabled) stopEdit(false);
      minusBtn.setEnabled(enabled);
      plusBtn.setEnabled(enabled);
    },
    destroy: () => {
      scene.input.keyboard?.off("keydown", onKeyDown);
      cursorTimer?.remove(false);
      hitZone.destroy();
      minusBtn.destroy();
      plusBtn.destroy();
      container.destroy();
    }
  };
}

/** Punchy scale-pop animation for win text / results. */
export function popIn(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject) {
  const obj = target as unknown as { setScale: (s: number) => void };
  obj.setScale(0.4);
  scene.tweens.add({
    targets: target,
    scale: 1,
    duration: 220,
    ease: "Back.Out"
  });
}
