import Phaser from "phaser";
import { Theme } from "./Theme";
import { gameState, BET_STEP } from "../GameState";
import { playSfx } from "./SoundManager";

/** Numeric Theme color (e.g. Theme.inset) -> CSS hex string, for styling real DOM elements (LoginScene's inputs, makeBetControl's bet-amount input). */
export function cssHex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

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
  // Warm dark-brown outline, never pure black - STYLE_GUIDE direction note 2.
  // Full opacity to match every other bordered element in the chrome system
  // (makePanel/makeInset/ShuffleCupReveal's cups all stroke at alpha 1) -
  // this used to be a faint 0.35, which made buttons the one outlier that
  // read flatter/lighter than everything drawn next to them.
  g.lineStyle(2, Theme.outline, 1);
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
  textColor = Theme.textPrimary
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
    // Also undoes the pointerdown press-scale below, in case the pointer
    // drags off the button before releasing - otherwise it could get stuck
    // visually "pressed."
    container.setScale(1);
    if (enabled) drawPill(bg, w, h, baseColor);
  });
  container.on("pointerdown", () => {
    if (!enabled) return;
    // Tasteful, conservative "press" affordance - a small scale-down while
    // held, on top of the existing hover recolor (STYLE_GUIDE direction
    // note 3: rounded/soft, not a hard bevel/glow state change). Purely
    // visual - onClick still fires on pointerdown exactly as before, so no
    // interaction timing changes for any caller.
    container.setScale(0.96);
    // Every button in the game (floor panels, Item Shop, Coin Kiosk, every
    // game's Bet/Cash Out/Walk Away/+/-/½/2x) goes through makeButton, so
    // this one hook covers a click sound everywhere at once - see
    // ui/SoundManager.ts.
    playSfx(scene, "click");
    onClick();
  });
  container.on("pointerup", () => {
    if (enabled) container.setScale(1);
  });

  return {
    container,
    setLabel: (t: string) => text.setText(t),
    setEnabled: (v: boolean) => {
      enabled = v;
      container.setAlpha(v ? 1 : 0.45);
      container.setScale(1); // in case this lands mid-press
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

export interface TextChip {
  container: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text;
  setText: (t: string) => void;
  destroy: () => void;
}

/**
 * A small rounded "chip" - a Theme.panel pill sized to fit a line of text,
 * stroked the same way as makePanel/makeInset. Used for floating HUD/
 * prompt-bubble/toast text that used to draw a flat CSS-style rectangular
 * `backgroundColor` straight on a Phaser Text object - Text's own
 * `backgroundColor` has no rounding or outline support, so those bubbles
 * were the one place still reading as sharp/flat against STYLE_GUIDE
 * direction notes 2 ("thick, consistent dark outlines... rounded corners")
 * and 3 ("rounded everything"). This wraps the same look every other panel
 * in the chrome system already uses instead.
 *
 * `originX`/`originY` mirror Phaser's text origin (0.5/0.5 = centered on
 * (x, y); 0.5/1 = bottom-anchored, growing upward - e.g. a label that
 * should stay pinned just above a moving point).
 */
export function makeTextChip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  initialText: string,
  textStyle: Phaser.Types.GameObjects.Text.TextStyle,
  opts: {
    originX?: number;
    originY?: number;
    paddingX?: number;
    paddingY?: number;
    fillAlpha?: number;
  } = {}
): TextChip {
  const { originX = 0.5, originY = 0.5, paddingX = 10, paddingY = 6, fillAlpha = 0.92 } = opts;

  const container = scene.add.container(x, y);
  const bg = scene.add.graphics();
  const text = scene.add.text(0, 0, initialText, textStyle).setOrigin(0.5);
  container.add([bg, text]);

  const redraw = () => {
    const chipW = text.width + paddingX * 2;
    const chipH = text.height + paddingY * 2;
    // Shift both the text and the pill so the chip's own (x, y) behaves
    // like a Phaser text origin of (originX, originY) rather than always
    // being dead-center - e.g. a bottom-anchored HUD label that should grow
    // upward as its text changes, not grow from its center.
    const offX = (0.5 - originX) * chipW;
    const offY = (0.5 - originY) * chipH;
    text.setPosition(offX, offY);
    bg.clear();
    bg.fillStyle(Theme.panel, fillAlpha);
    bg.fillRoundedRect(offX - chipW / 2, offY - chipH / 2, chipW, chipH, chipH / 2);
    bg.lineStyle(1.5, Theme.panelBorder, 0.7);
    bg.strokeRoundedRect(offX - chipW / 2, offY - chipH / 2, chipW, chipH, chipH / 2);
  };
  redraw();

  return {
    container,
    text,
    setText: (t: string) => {
      text.setText(t);
      redraw();
    },
    destroy: () => container.destroy()
  };
}

export interface BetControl {
  container: Phaser.GameObjects.Container;
  refresh: () => void;
  setEnabled: (enabled: boolean) => void;
  destroy: () => void;
}

/**
 * Shared "Bet Amount" stepper, backed by gameState.betAmount so the chosen
 * size carries over between games. Click/tap the amount itself to type a
 * custom value. Call refresh() if something else changes betAmount while
 * this control is on screen. Call onChange after every adjustment so the
 * caller can update any payout previews.
 *
 * Layout: [½] [-] [amount] [+] [2x] - the quick half/double buttons are a
 * deliberate Stake-style convention (every Stake Originals bet input has
 * exactly this ½/2x pair beside the stepper) added as part of the "match
 * Stake's UI" pass. Kept to the exact same height/vertical footprint as
 * before (only wider, not taller) so it drops into every existing scene's
 * already-tuned vertical layout with no other per-scene changes needed.
 *
 * The amount field is a real HTML <input> (Phaser DOM Element, same
 * approach as LoginScene's username/password fields), not a hand-rolled
 * canvas keydown editor - that used to be the last remaining spot in the
 * game where typing was completely impossible on mobile (no physical
 * keyboard means no on-screen keyboard, since there was nothing real for
 * it to focus). `inputMode: "numeric"` gets a numeric-only virtual
 * keyboard on mobile without losing normal text-input behavior/styling on
 * desktop.
 */
export function makeBetControl(
  scene: Phaser.Scene,
  x: number,
  y: number,
  onChange: () => void
): BetControl {
  const container = scene.add.container(x, y);

  // Height 44, not the original 40 - part of a mobile touch-target pass
  // (Apple HIG/Android guidelines land around 44pt/48dp; this game's fixed
  // 800x600 canvas typically renders at ~0.6-0.7x scale on a phone, so
  // these buttons were landing meaningfully under that at their original
  // size). Only height grows here, not width - the half/minus/plus/double
  // buttons are already tightly packed horizontally (as little as 6px
  // between neighbors), so widening them risks real overlap; growing
  // height is safe since there's vertical headroom in the sidebar.
  const inset = makeInset(scene, 0, 0, 260, 44, 12);

  let controlEnabled = true;

  const el = document.createElement("input");
  el.type = "text";
  el.inputMode = "numeric";
  el.maxLength = 5;
  el.autocomplete = "off";
  Object.assign(el.style, {
    width: "130px",
    height: "32px",
    padding: "0",
    textAlign: "center",
    fontSize: "14px",
    fontFamily: "inherit",
    fontWeight: "bold",
    color: cssHex(0xf5f6fa),
    background: "transparent",
    border: "2px solid transparent",
    borderRadius: "6px",
    outline: "none",
    boxSizing: "border-box"
  });

  const commit = () => {
    const parsed = parseInt(el.value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      gameState.setBet(parsed);
      onChange();
    }
    refresh();
  };

  el.addEventListener("input", () => {
    // inputMode="numeric" is only a virtual-keyboard hint, not real
    // enforcement - a physical keyboard or paste can still type/insert
    // non-digit characters, so sanitize on every change regardless.
    el.value = el.value.replace(/[^0-9]/g, "").slice(0, 5);
  });
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      el.blur(); // triggers the blur listener below, which commits
    } else if (event.key === "Escape") {
      el.value = String(gameState.betAmount);
      el.blur();
    }
  });
  el.addEventListener("focus", () => {
    el.style.borderColor = cssHex(Theme.accent);
    el.style.background = cssHex(Theme.inset);
    minusBtn.setEnabled(false);
    plusBtn.setEnabled(false);
  });
  el.addEventListener("blur", () => {
    el.style.borderColor = "transparent";
    el.style.background = "transparent";
    if (controlEnabled) {
      minusBtn.setEnabled(true);
      plusBtn.setEnabled(true);
    }
    commit();
  });

  // Standalone DOM Element at this control's absolute scene position
  // (not nested inside `container`) - matches LoginScene's approach
  // exactly, and sidesteps any question of whether a Container's own
  // transform correctly composes into a child DOM Element's position.
  const input = scene.add.dom(x, y, el);

  const refresh = () => {
    if (document.activeElement !== el) {
      el.value = String(gameState.betAmount);
    }
  };
  refresh();

  const minusBtn = makeButton(scene, -102, 0, 36, 38, "-", Theme.neutral, Theme.neutralHover, () => {
    gameState.adjustBet(-BET_STEP);
    refresh();
    onChange();
  });
  const plusBtn = makeButton(scene, 102, 0, 36, 38, "+", Theme.neutral, Theme.neutralHover, () => {
    gameState.adjustBet(BET_STEP);
    refresh();
    onChange();
  });
  // Stake-style quick half/double buttons, outside the -/+ pair - same Y,
  // just wider overall (see this function's doc comment).
  const halfBtn = makeButton(scene, -142, 0, 32, 38, "½", Theme.neutral, Theme.neutralHover, () => {
    gameState.setBet(gameState.betAmount / 2);
    refresh();
    onChange();
  });
  const doubleBtn = makeButton(scene, 142, 0, 32, 38, "2×", Theme.neutral, Theme.neutralHover, () => {
    gameState.setBet(gameState.betAmount * 2);
    refresh();
    onChange();
  });

  container.add([inset, halfBtn.container, minusBtn.container, plusBtn.container, doubleBtn.container]);

  return {
    container,
    refresh,
    setEnabled: (enabled: boolean) => {
      controlEnabled = enabled;
      el.disabled = !enabled;
      if (!enabled && document.activeElement === el) el.blur();
      minusBtn.setEnabled(enabled);
      plusBtn.setEnabled(enabled);
      halfBtn.setEnabled(enabled);
      doubleBtn.setEnabled(enabled);
    },
    destroy: () => {
      input.destroy();
      minusBtn.destroy();
      plusBtn.destroy();
      halfBtn.destroy();
      doubleBtn.destroy();
      container.destroy();
    }
  };
}

/**
 * Center of the game shell's right-side display area (see makeGameShell) -
 * scenes using the shell should center their grid/tower/card visuals here
 * instead of the canvas center (400,300), since the left sidebar now
 * occupies the left third of the screen.
 */
export const GAME_SHELL_DISPLAY_CENTER_X = 570;
export const GAME_SHELL_DISPLAY_CENTER_Y = 300;

export interface GameShellHandle {
  balanceText: Phaser.GameObjects.Text;
  multiplierText: Phaser.GameObjects.Text;
  messageText: Phaser.GameObjects.Text;
  betControl: BetControl;
  startBtn: UIButton;
  cashOutBtn: UIButton;
  walkAwayBtn: UIButton;
}

/**
 * Shared "Stake-style" game shell: a left-docked control panel (title,
 * balance, bet amount, multiplier/profit readout, message, Bet/Cash Out,
 * Walk Away) beside an open right-side display area for the game's own
 * grid/tower/cards - matching the real Stake Originals convention of a
 * fixed sidebar next to the game view, instead of everything stacked in
 * one center panel. Center game-specific visuals on
 * (GAME_SHELL_DISPLAY_CENTER_X, GAME_SHELL_DISPLAY_CENTER_Y), not the
 * canvas center - the sidebar occupies the left third of the screen.
 *
 * `startBtn`/`cashOutBtn` occupy the exact same slot and swap visibility
 * (same pattern every game already used before this shell existed) -
 * callers still call `.setLabel()`/`.setEnabled()`/`.container.setVisible()`
 * on them directly for round-state transitions (start -> new run, etc.),
 * this just centralizes where they're built and positioned.
 */
export function makeGameShell(
  scene: Phaser.Scene,
  title: string,
  startLabel: string,
  handlers: {
    onStart: () => void;
    onCashOut: () => void;
    onWalkAway: () => void;
    onBetChange?: () => void;
  }
): GameShellHandle {
  const CX = 180; // sidebar center x - sidebar spans x:10-350

  makePanel(scene, CX, 300, 340, 580);

  scene.add
    .text(CX, 45, title, { fontSize: "22px", color: Theme.textAccent, fontStyle: "bold" })
    .setOrigin(0.5);

  makeInset(scene, CX, 82, 300, 30, 15);
  const balanceText = scene.add
    .text(CX, 82, "", { fontSize: "13px", color: Theme.textPrimary })
    .setOrigin(0.5);

  const betControl = makeBetControl(scene, CX, 132, handlers.onBetChange ?? (() => {}));

  const multiplierText = scene.add
    .text(CX, 178, "", { fontSize: "17px", color: Theme.textGold, fontStyle: "bold" })
    .setOrigin(0.5);

  const messageText = scene.add
    .text(CX, 212, "", {
      fontSize: "13px",
      color: Theme.textMuted,
      align: "center",
      wordWrap: { width: 300 }
    })
    .setOrigin(0.5);

  // Heights 58/42 (not the original 50/34) - mobile touch-target pass, see
  // makeBetControl's doc comment above for the same reasoning (this
  // canvas typically renders at ~0.6-0.7x scale on a phone). These two
  // are the most-tapped buttons in every game (the primary action, and
  // the way out), so they get the largest bump of anything touched in
  // this pass.
  const startBtn = makeButton(scene, CX, 505, 300, 58, startLabel, Theme.accent, Theme.accentHover, handlers.onStart);
  const cashOutBtn = makeButton(
    scene,
    CX,
    505,
    300,
    58,
    "CASH OUT",
    Theme.gold,
    Theme.goldHover,
    handlers.onCashOut,
    Theme.cardTextBlack
  );
  cashOutBtn.setEnabled(false);
  cashOutBtn.container.setVisible(false);

  const walkAwayBtn = makeButton(scene, CX, 560, 230, 42, "WALK AWAY", Theme.danger, Theme.dangerHover, handlers.onWalkAway);

  return { balanceText, multiplierText, messageText, betControl, startBtn, cashOutBtn, walkAwayBtn };
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
