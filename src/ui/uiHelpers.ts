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
 * Relative luminance (WCAG) of a packed 0xRRGGBB color, 0 (black) to 1 (white).
 */
function relativeLuminance(color: number): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = channel((color >> 16) & 0xff);
  const g = channel((color >> 8) & 0xff);
  const b = channel(color & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Picks a button label color that is actually readable on `fill`, used as
 * makeButton's default when a caller doesn't name one explicitly.
 *
 * Every button used to default to the near-white Theme.textPrimary
 * regardless of what it was sitting on, which was fine while every button
 * fill was dark but was already failing on the brightest one: white on the
 * orange Theme.accent measured 2.41:1 under the old "Arcade Nights" palette -
 * i.e. the game's single most important button, the BET/START CTA, was the
 * least legible label in the UI, and had been for some time. Warming the
 * palette doesn't cause that (the equivalent new pairing measures 2.32:1,
 * essentially unchanged) but it's not worth carrying forward either.
 *
 * Choosing by measured luminance rather than hardcoding "accent and gold get
 * dark text" is deliberate: this file's whole design is that re-pointing a
 * token in Theme.ts cascades everywhere without editing call sites, and a
 * hardcoded list silently goes stale the moment someone lightens a fill -
 * which is exactly the failure this project has already hit twice with the
 * duplicated fade color in ui/sceneTransition.ts. This rule can't go stale;
 * it re-derives itself from whatever the token currently is.
 *
 * The 0.3 threshold sits in a wide empty gap in the current palette, not
 * near any fill: accent (0.37) and gold (0.54) are above it and take the
 * dark label; danger (0.22), secondary (0.15) and neutral (0.15) are below
 * it and keep the near-white one. Measured pairings after this change are
 * 6.25:1 on accent and 8.75:1 on gold, up from 2.32:1 and (already dark, via
 * an explicit argument) unchanged respectively.
 */
export function readableLabelOn(fill: number): string {
  return relativeLuminance(fill) > 0.3 ? Theme.cardTextBlack : Theme.textPrimary;
}

/**
 * Creates a pill-shaped button. Pass baseColor/hoverColor to theme it
 * (e.g. Theme.accent for a primary action, Theme.neutral for secondary).
 *
 * `textColor` defaults to whichever of the two Theme text colors is actually
 * readable on `baseColor` (see readableLabelOn) - pass one explicitly only to
 * override that, as the CASH OUT button in makeGameShell does.
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
  textColor = readableLabelOn(baseColor)
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
    // Was a hardcoded 0xf5f6fa - a duplicate of what Theme.textPrimary
    // happened to be at the time, which silently went stale when the "Warm
    // Daylight" pass warmed that token. Points at the token now.
    color: Theme.textPrimary,
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
  // stopPropagation on every keystroke - see LoginScene.ts's createTextInput
  // for why (reported live: letters matching OverworldScene's movement
  // keys failed to type in a real HTML input; no global/window-level
  // listener should ever see a keystroke meant for a focused text field
  // regardless of the exact mechanism). Less directly applicable here
  // (this field is numeric-only) but the same defensive principle holds.
  const stopKeyPropagation = (event: KeyboardEvent) => event.stopPropagation();
  el.addEventListener("keydown", stopKeyPropagation);
  el.addEventListener("keyup", stopKeyPropagation);
  el.addEventListener("keypress", stopKeyPropagation);
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
/**
 * Every interactive/informational sidebar element sits within this band
 * (130-470, symmetric around the canvas's own vertical center 300) - see
 * main.ts's Scale.ENVELOP-on-mobile comment for why: filling a wide phone
 * screen edge-to-edge crops roughly the top/bottom of the 800x600 canvas
 * to cover the extra width, so nothing anyone actually needs to see or
 * tap can live outside this range. 130, not an initial-pass 100 - measured
 * live against a real ~19.5:9 phone viewport (844x390, iPhone 14 Pro
 * landscape proportions) and the actual crop came out to ~115-122px, more
 * than the first pass budgeted for; 130 keeps real margin beyond that
 * measured worst case rather than sitting right on the edge of it.
 * GAME_SHELL_DISPLAY_CENTER_Y (below) deliberately stays at the same 300
 * center for the same reason - each game's own display-area content
 * should stay within roughly ±170 of it too.
 */
const SAFE_ZONE_TOP = 130;
const SAFE_ZONE_BOTTOM = 470;

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

  // Panel height 360 (was 580) - compressed to fit inside the safe zone
  // (see SAFE_ZONE_TOP/BOTTOM above), spans 120-480: a few px of
  // background bleeds past the safe zone at each edge (harmless - it's
  // not interactive, just the panel's own rounded corner) so every real
  // element below has a little breathing room inside it.
  makePanel(scene, CX, 300, 340, 360);

  scene.add
    .text(CX, 145, title, { fontSize: "20px", color: Theme.textAccent, fontStyle: "bold" })
    .setOrigin(0.5);

  makeInset(scene, CX, 175, 300, 26, 13);
  const balanceText = scene.add
    .text(CX, 175, "", { fontSize: "13px", color: Theme.textPrimary })
    .setOrigin(0.5);

  const betControl = makeBetControl(scene, CX, 213, handlers.onBetChange ?? (() => {}));

  const multiplierText = scene.add
    .text(CX, 248, "", { fontSize: "16px", color: Theme.textGold, fontStyle: "bold" })
    .setOrigin(0.5);

  const messageText = scene.add
    .text(CX, 272, "", {
      fontSize: "12px",
      color: Theme.textMuted,
      align: "center",
      wordWrap: { width: 300 }
    })
    .setOrigin(0.5);

  // Heights 54/36 (not the original 50/34) - still a mobile touch-target
  // bump, just slightly smaller than the first pass to make room in the
  // now-compressed band. Positions 400/445 keep both safely inside
  // SAFE_ZONE_BOTTOM (470) with real margin, not sitting right on the edge.
  const startBtn = makeButton(scene, CX, 400, 300, 54, startLabel, Theme.accent, Theme.accentHover, handlers.onStart);
  const cashOutBtn = makeButton(
    scene,
    CX,
    400,
    300,
    54,
    "CASH OUT",
    Theme.gold,
    Theme.goldHover,
    handlers.onCashOut,
    Theme.cardTextBlack
  );
  cashOutBtn.setEnabled(false);
  cashOutBtn.container.setVisible(false);

  const walkAwayBtn = makeButton(scene, CX, 445, 230, 36, "WALK AWAY", Theme.danger, Theme.dangerHover, handlers.onWalkAway);

  return { balanceText, multiplierText, messageText, betControl, startBtn, cashOutBtn, walkAwayBtn };
}

/**
 * Gold-trimmed "arcade cabinet" backdrop - a rounded near-black panel with a
 * thick gold outer border and a thinner steel-blue inner border, drawn at
 * depth -1 so every default-depth game object (reels, cards, grids, wheels)
 * always renders in front of it regardless of creation order. First built
 * for SlotsScene's reel cabinet, now shared so every game gets the same
 * "arcade machine" framing instead of bare content floating on the flat
 * scene background.
 *
 * IMPORTANT for callers: size (w, h) to hug the game's EXISTING content
 * bounds - don't add new elements that extend beyond what was already
 * on-screen and working. SlotsScene's first cabinet pass added a lever 20px
 * outside the frame and it bled 8px past the canvas's actual right edge
 * (800) on every platform; every cabinet since sizes strictly around
 * content that was already verified to fit.
 */
export function drawCabinetFrame(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  w: number,
  h: number,
  radius = 20
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(-1);
  g.fillStyle(Theme.outline, 1);
  g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, radius);
  g.lineStyle(5, Theme.gold, 1);
  g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, radius);
  g.lineStyle(2, Theme.panelBorder, 1);
  g.strokeRoundedRect(cx - w / 2 + 8, cy - h / 2 + 8, w - 16, h - 16, Math.max(4, radius - 6));
  return g;
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
