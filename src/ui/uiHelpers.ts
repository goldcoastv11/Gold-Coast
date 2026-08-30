import Phaser from "phaser";
import { Tokens, toCss } from "./DesignTokens";
import { gameState, BET_STEP } from "../GameState";
import { playSfx } from "./SoundManager";

/**
 * SHARED GAME CHROME - rebuilt against `DesignTokens.ts` for the Stake-style
 * visual direction (flat, minimal, dark; precise spacing; one restrained
 * accent; hierarchy from weight and space rather than borders and boxes).
 *
 * What changed, and why it matters beyond this file: every helper here is
 * shared by all 14 game screens, so restyling the helpers moves all 14 off
 * the old heavily-outlined, gold-trimmed, fully-rounded "arcade cabinet"
 * look in one place, without editing a single game scene. What the helpers
 * CANNOT reach is each game's own board art and its own Text objects - those
 * still use `Theme.ts` and Phaser's default Courier font until that game is
 * converted individually. Exactly one game (Limbo) has been converted so
 * far, on purpose; see the PR description.
 *
 * `Theme.ts` is deliberately left untouched - it also drives BootScene's
 * procedural overworld textures and OverworldScene, which are a separate
 * (much larger) job. Anything still reading `Theme.*` here is an
 * intentional not-yet-converted seam, not an oversight.
 */

/** Numeric Theme/Tokens colour -> CSS hex string, for styling real DOM elements (LoginScene's inputs, makeBetControl's bet-amount input). */
export function cssHex(n: number): string {
  return toCss(n);
}

/**
 * Applies the token letter-spacing scale. Phaser only gained
 * `Text.setLetterSpacing` in 3.60, and the project pins `^3.80.1`, but this
 * stays feature-detected so the chrome degrades to plain tracking rather
 * than throwing if the dependency is ever pinned back.
 */
function applyTracking(text: Phaser.GameObjects.Text, tracking: number): Phaser.GameObjects.Text {
  const withSpacing = text as unknown as { setLetterSpacing?: (v: number) => void };
  if (tracking !== 0 && typeof withSpacing.setLetterSpacing === "function") {
    withSpacing.setLetterSpacing(tracking);
  }
  return text;
}

/**
 * The one place a UI string gets turned into a Phaser Text. Guarantees the
 * token font stack is applied - Phaser's own default is Courier, which is a
 * large part of why the un-converted screens read as "old software".
 */
export function makeText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string,
  opts: {
    size?: string;
    weight?: string;
    color?: string;
    align?: string;
    wordWrapWidth?: number;
    tracking?: number;
    originX?: number;
    originY?: number;
  } = {}
): Phaser.GameObjects.Text {
  const {
    size = Tokens.type.size.md,
    weight = Tokens.type.weight.regular,
    color = Tokens.text.primary,
    align = "left",
    wordWrapWidth,
    tracking = Tokens.type.tracking.tight,
    originX = 0,
    originY = 0.5
  } = opts;

  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: Tokens.type.family,
    fontSize: size,
    fontStyle: weight,
    color,
    align
  };
  if (wordWrapWidth !== undefined) style.wordWrap = { width: wordWrapWidth };

  const text = scene.add.text(x, y, content, style).setOrigin(originX, originY);
  return applyTracking(text, tracking);
}

/** A flat, interactive button with hover feedback. */
export interface UIButton {
  container: Phaser.GameObjects.Container;
  setLabel: (text: string) => void;
  setEnabled: (enabled: boolean) => void;
  destroy: () => void;
}

/**
 * Flat button surface. No stroke: in this system a button separates from
 * the panel behind it by being a lighter SURFACE, not by being outlined
 * (direction note 3). Radius is small - fully-round pills read as "toy"
 * (direction note 4).
 */
function drawButtonSurface(
  g: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
  fill: number,
  radius: number
) {
  g.clear();
  g.fillStyle(fill, 1);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
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
  return relativeLuminance(fill) > 0.3 ? Tokens.text.onAccent : Tokens.text.primary;
}

/**
 * Creates a flat button. Pass baseColor/hoverColor to theme it (e.g.
 * `Tokens.color.accent` for the one primary action on a screen,
 * `Tokens.color.surfaceRaised` for everything secondary).
 *
 * The signature is unchanged from the previous pill-shaped version so all
 * 14 game scenes, the overworld and the shops keep working untouched - only
 * the drawn form changed. `radius` is optional and defaults to the token
 * button radius.
 *
 * `textColor` defaults to whichever token text colour is actually readable on
 * `baseColor` (see readableLabelOn) rather than always the light one - pass a
 * colour explicitly only to override that, as the CASH OUT button in
 * makeGameShell does.
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
  textColor = readableLabelOn(baseColor),
  radius: number = Tokens.radius.sm
): UIButton {
  const container = scene.add.container(x, y);
  const bg = scene.add.graphics();
  drawButtonSurface(bg, w, h, baseColor, radius);

  const text = makeText(scene, 0, 0, label, {
    size: Tokens.type.size.lg,
    weight: Tokens.type.weight.semibold,
    color: textColor,
    align: "center",
    originX: 0.5,
    originY: 0.5
  });

  container.add([bg, text]);
  container.setSize(w, h);
  container.setInteractive({ useHandCursor: true });

  let enabled = true;

  container.on("pointerover", () => {
    if (enabled) drawButtonSurface(bg, w, h, hoverColor, radius);
  });
  container.on("pointerout", () => {
    // Also undoes the pointerdown press-scale below, in case the pointer
    // drags off the button before releasing - otherwise it could get stuck
    // visually "pressed."
    container.setScale(1);
    if (enabled) drawButtonSurface(bg, w, h, baseColor, radius);
  });
  container.on("pointerdown", () => {
    if (!enabled) return;
    // Press affordance, deliberately tiny (direction note 5: motion is
    // short and quiet). Purely visual - onClick still fires on pointerdown
    // exactly as before, so no interaction timing changes for any caller.
    container.setScale(Tokens.motion.pressScale);
    // Every button in the game goes through makeButton, so this one hook
    // covers a click sound everywhere at once - see ui/SoundManager.ts.
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
      container.setAlpha(v ? 1 : Tokens.motion.disabledAlpha);
      container.setScale(1); // in case this lands mid-press
      if (v) {
        container.setInteractive({ useHandCursor: true });
      } else {
        container.disableInteractive();
      }
      drawButtonSurface(bg, w, h, baseColor, radius);
    },
    destroy: () => container.destroy()
  };
}

/**
 * A flat surface panel - the backdrop for game screens and dialogs. One
 * step up from the page ground, no outline: the surface value itself is
 * what reads as "this is a card" (Tokens.elevation.raised).
 */
export function makePanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  depth = 0
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y }).setDepth(depth);
  g.fillStyle(Tokens.elevation.raised.fill, 1);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, Tokens.radius.lg);
  return g;
}

/**
 * A recessed "well" - a value readout, a text field, a reel cell. Reads as
 * a hole punched in the panel, so it goes back DOWN to the page ground
 * colour rather than up to another surface.
 */
export function makeInset(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number = Tokens.radius.sm
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  g.fillStyle(Tokens.color.inset, 1);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
  return g;
}

/** A 1px hairline rule. The only stroke in the system - use once or twice per screen, never as a box. */
export function makeDivider(
  scene: Phaser.Scene,
  x1: number,
  y: number,
  x2: number
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.lineStyle(1, Tokens.color.hairline, 1);
  g.lineBetween(x1, y, x2, y);
  return g;
}

export interface TextChip {
  container: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text;
  setText: (t: string) => void;
  destroy: () => void;
}

/**
 * A small flat "chip" sized to fit a line of text - floating HUD labels,
 * prompt bubbles, toasts. Exists because Phaser's Text `backgroundColor` is
 * a flat un-rounded CSS rectangle with no radius support, which is the one
 * thing that always looked pasted-on.
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
  const {
    originX = 0.5,
    originY = 0.5,
    paddingX = Tokens.space.md,
    paddingY = Tokens.space.sm,
    fillAlpha = 0.94
  } = opts;

  const container = scene.add.container(x, y);
  const bg = scene.add.graphics();
  const text = scene.add
    .text(0, 0, initialText, { fontFamily: Tokens.type.family, ...textStyle })
    .setOrigin(0.5);
  container.add([bg, text]);

  const redraw = () => {
    const chipW = text.width + paddingX * 2;
    const chipH = text.height + paddingY * 2;
    // Shift both the text and the chip so the chip's own (x, y) behaves
    // like a Phaser text origin of (originX, originY) rather than always
    // being dead-center - e.g. a bottom-anchored HUD label that should grow
    // upward as its text changes, not grow from its center.
    const offX = (0.5 - originX) * chipW;
    const offY = (0.5 - originY) * chipH;
    text.setPosition(offX, offY);
    bg.clear();
    bg.fillStyle(Tokens.color.surface, fillAlpha);
    bg.fillRoundedRect(offX - chipW / 2, offY - chipH / 2, chipW, chipH, Tokens.radius.sm);
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

/** Overall width of the bet row - matches the shell sidebar's content column. */
const BET_ROW_W = 290;
/** Row height. 40 keeps every cell a comfortable touch target at this canvas's real on-phone scale. */
const BET_ROW_H = 40;
/** The four quick-adjust cells: half, minus, plus, double - in magnitude order. */
const BET_CELL_W = 34;
const BET_CELL_GAP = 2;

/**
 * Shared bet-amount row, backed by gameState.betAmount so the chosen size
 * carries over between games. Call refresh() if something else changes
 * betAmount while this control is on screen; onChange fires after every
 * adjustment so the caller can update any payout previews.
 *
 * Layout is Stake's: one wide recessed amount FIELD on the left, with the
 * quick-adjust cells docked as a tight segmented strip on the right -
 * [ 000000 ][½][−][+][2×] - rather than the previous symmetric
 * [½][−][ amount ][+][2×] cluster. Same overall footprint, but the amount
 * (the thing you actually read) now gets the space, and the adjusters read
 * as one secondary control instead of four scattered pills.
 *
 * The amount field is a real HTML <input> (Phaser DOM Element, same
 * approach as LoginScene's username/password fields), not a hand-rolled
 * canvas keydown editor - that used to be the last remaining spot in the
 * game where typing was impossible on mobile (no physical keyboard means no
 * on-screen keyboard, since there was nothing real for it to focus).
 * `inputMode: "numeric"` gets a numeric-only virtual keyboard on mobile
 * without losing normal text-input behavior/styling on desktop.
 */
export function makeBetControl(
  scene: Phaser.Scene,
  x: number,
  y: number,
  onChange: () => void
): BetControl {
  const container = scene.add.container(x, y);

  const left = -BET_ROW_W / 2;
  const right = BET_ROW_W / 2;
  const stripW = BET_CELL_W * 4 + BET_CELL_GAP * 3;
  const stripLeft = right - stripW;
  const fieldW = stripLeft - Tokens.space.sm - left;
  const fieldCx = left + fieldW / 2;

  const field = makeInset(scene, fieldCx, 0, fieldW, BET_ROW_H, Tokens.radius.sm);

  let controlEnabled = true;

  const el = document.createElement("input");
  el.type = "text";
  el.inputMode = "numeric";
  el.maxLength = 5;
  el.autocomplete = "off";
  Object.assign(el.style, {
    width: `${fieldW - Tokens.space.xxl}px`,
    height: "26px",
    padding: "0",
    textAlign: "left",
    fontSize: "14px",
    fontFamily: Tokens.type.family,
    fontWeight: Tokens.type.weight.semibold,
    // Was a hardcoded 0xf5f6fa - a duplicate of whatever the text colour
    // happened to be at the time, which silently went stale when the palette
    // pass warmed it. Points at the token now.
    color: Tokens.text.primary,
    background: "transparent",
    border: "none",
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
  // for why (reported live: letters matching OverworldScene's movement keys
  // failed to type in a real HTML input; no global/window-level listener
  // should ever see a keystroke meant for a focused text field regardless of
  // the exact mechanism). Less directly applicable here (this field is
  // numeric-only) but the same defensive principle holds.
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
  // Focus is signalled by the FIELD lighting up, not by an outline drawn
  // around the input - same "surface, not border" rule as everything else.
  el.addEventListener("focus", () => {
    field.clear();
    field.fillStyle(Tokens.color.surfaceRaised, 1);
    field.fillRoundedRect(-fieldW / 2, -BET_ROW_H / 2, fieldW, BET_ROW_H, Tokens.radius.sm);
    minusBtn.setEnabled(false);
    plusBtn.setEnabled(false);
  });
  el.addEventListener("blur", () => {
    field.clear();
    field.fillStyle(Tokens.color.inset, 1);
    field.fillRoundedRect(-fieldW / 2, -BET_ROW_H / 2, fieldW, BET_ROW_H, Tokens.radius.sm);
    if (controlEnabled) {
      minusBtn.setEnabled(true);
      plusBtn.setEnabled(true);
    }
    commit();
  });

  // Standalone DOM Element at this control's absolute scene position (not
  // nested inside `container`) - matches LoginScene's approach exactly, and
  // sidesteps any question of whether a Container's own transform correctly
  // composes into a child DOM Element's position.
  const input = scene.add.dom(x + fieldCx + Tokens.space.xs, y, el);

  const refresh = () => {
    if (document.activeElement !== el) {
      el.value = String(gameState.betAmount);
    }
  };
  refresh();

  const cellCx = (i: number) => stripLeft + BET_CELL_W / 2 + i * (BET_CELL_W + BET_CELL_GAP);
  const makeCell = (i: number, label: string, onPress: () => void) =>
    makeButton(
      scene,
      cellCx(i),
      0,
      BET_CELL_W,
      BET_ROW_H,
      label,
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => {
        onPress();
        refresh();
        onChange();
      },
      Tokens.text.secondary,
      Tokens.radius.xs
    );

  const halfBtn = makeCell(0, "½", () => gameState.setBet(gameState.betAmount / 2));
  const minusBtn = makeCell(1, "−", () => gameState.adjustBet(-BET_STEP));
  const plusBtn = makeCell(2, "+", () => gameState.adjustBet(BET_STEP));
  const doubleBtn = makeCell(3, "2×", () => gameState.setBet(gameState.betAmount * 2));

  container.add([
    field,
    halfBtn.container,
    minusBtn.container,
    plusBtn.container,
    doubleBtn.container
  ]);

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
 * instead of the canvas center (400,300), since the left sidebar occupies
 * the left third of the screen. Unchanged by the restyle on purpose: all 14
 * scenes lay their boards out around these two numbers.
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
 * Every interactive/informational sidebar element sits within this band
 * (130-470, symmetric around the canvas's own vertical center 300) - see
 * main.ts's Scale.ENVELOP-on-mobile comment for why: filling a wide phone
 * screen edge-to-edge crops roughly the top/bottom of the 800x600 canvas to
 * cover the extra width, so nothing anyone actually needs to see or tap can
 * live outside this range. 130, not an initial-pass 100 - measured live
 * against a real ~19.5:9 phone viewport (844x390, iPhone 14 Pro landscape
 * proportions) and the actual crop came out to ~115-122px, more than the
 * first pass budgeted for; 130 keeps real margin beyond that measured worst
 * case rather than sitting right on the edge of it.
 * GAME_SHELL_DISPLAY_CENTER_Y deliberately stays at the same 300 center for
 * the same reason - each game's own display-area content should stay within
 * roughly +/-170 of it too.
 */
const SAFE_ZONE_TOP = 130;
const SAFE_ZONE_BOTTOM = 470;

/** Sidebar geometry. All of it derives from the token spacing scale. */
const SIDEBAR_CX = 180;
const SIDEBAR_W = 330;
const SIDEBAR_PAD = Tokens.space.xl;
/** Left/right edges of the sidebar's single content column - everything inside aligns to these. */
const COL_LEFT = SIDEBAR_CX - SIDEBAR_W / 2 + SIDEBAR_PAD;
const COL_RIGHT = SIDEBAR_CX + SIDEBAR_W / 2 - SIDEBAR_PAD;
const COL_W = COL_RIGHT - COL_LEFT;

/**
 * Shared game shell: a left-docked control column (title, balance, bet
 * amount, a readout line, a message line, the primary action and Walk Away)
 * beside an open right-side display area for the game's own board. Center
 * game-specific visuals on (GAME_SHELL_DISPLAY_CENTER_X,
 * GAME_SHELL_DISPLAY_CENTER_Y), not the canvas center.
 *
 * VISUAL DIRECTION (see DesignTokens.ts): the sidebar is one flat surface
 * with no outline; rows are separated by whitespace and by a single hairline
 * under the title, not by a stack of bordered boxes. Labels are small, muted
 * and left-aligned; the values they describe are right-aligned on the same
 * baseline, so the eye reads a clean two-column ledger down the panel. The
 * single accent-green primary action at the bottom is the only saturated
 * colour on the screen.
 *
 * `startBtn`/`cashOutBtn` occupy the exact same slot and swap visibility
 * (same pattern every game already used) - callers still call
 * `.setLabel()`/`.setEnabled()`/`.container.setVisible()` on them directly
 * for round-state transitions.
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
  // Page ground. Drawn as a real full-canvas rect behind everything rather
  // than relying on each scene's own camera background colour, so the whole
  // shell sits on the token ground even in scenes that have not been
  // converted yet. Depth is far below drawCabinetFrame's -1.
  const ground = scene.add.graphics().setDepth(-1000);
  ground.fillStyle(Tokens.color.bg, 1);
  ground.fillRect(0, 0, 800, 600);

  // Sidebar panel: spans y 118-484. A few px of the rounded corner bleeds
  // past the safe zone at each edge, which is harmless - it is background,
  // not something anyone needs to see or tap - and it gives every real
  // element below breathing room inside the band.
  const panelTop = SAFE_ZONE_TOP - Tokens.space.md;
  const panelBottom = SAFE_ZONE_BOTTOM + Tokens.space.md + Tokens.space.xxs;
  makePanel(scene, SIDEBAR_CX, (panelTop + panelBottom) / 2, SIDEBAR_W, panelBottom - panelTop);

  // --- Title row -----------------------------------------------------
  makeText(scene, COL_LEFT, 140, title.toUpperCase(), {
    size: Tokens.type.size.lg,
    weight: Tokens.type.weight.semibold,
    color: Tokens.text.secondary,
    tracking: Tokens.type.tracking.caps
  });
  makeDivider(scene, COL_LEFT, 158, COL_RIGHT);

  // --- Balance row: muted label left, live value right ---------------
  makeText(scene, COL_LEFT, 180, "Balance", {
    size: Tokens.type.size.sm,
    color: Tokens.text.muted,
    tracking: Tokens.type.tracking.label
  });
  const balanceText = makeText(scene, COL_RIGHT, 180, "", {
    size: Tokens.type.size.lg,
    weight: Tokens.type.weight.medium,
    color: Tokens.text.primary,
    align: "right",
    originX: 1
  });

  // --- Bet amount ----------------------------------------------------
  // "Gold Coins" spelled out: GC is the play currency, spent on every bet
  // win or lose (see CLAUDE.md's economy rules), and naming it here is part
  // of the outstanding display-copy pass.
  makeText(scene, COL_LEFT, 208, "Bet Amount (Gold Coins)", {
    size: Tokens.type.size.sm,
    color: Tokens.text.muted,
    tracking: Tokens.type.tracking.label
  });
  const betControl = makeBetControl(scene, SIDEBAR_CX, 238, handlers.onBetChange ?? (() => {}));

  // --- Readout line (multiplier / target / profit, per game) ---------
  // No static label: several games leave this blank for whole phases of a
  // round, and a label with nothing beside it is worse than no row at all.
  const multiplierText = makeText(scene, COL_LEFT, 278, "", {
    size: Tokens.type.size.xl,
    weight: Tokens.type.weight.semibold,
    color: Tokens.text.primary
  });

  // --- Message line --------------------------------------------------
  // Top-anchored so multi-line messages grow downward into the whitespace
  // above the buttons instead of pushing through the readout above.
  const messageText = makeText(scene, COL_LEFT, 300, "", {
    size: Tokens.type.size.md,
    color: Tokens.text.secondary,
    wordWrapWidth: COL_W,
    originY: 0
  });

  // --- Actions -------------------------------------------------------
  // The primary action is the only saturated colour on the screen
  // (direction note 2). Dark label on the bright accent, per token.
  const startBtn = makeButton(
    scene,
    SIDEBAR_CX,
    404,
    COL_W,
    46,
    startLabel,
    Tokens.color.accent,
    Tokens.color.accentHover,
    handlers.onStart,
    Tokens.text.onAccent,
    Tokens.radius.md
  );
  const cashOutBtn = makeButton(
    scene,
    SIDEBAR_CX,
    404,
    COL_W,
    46,
    "CASH OUT",
    Tokens.color.accent,
    Tokens.color.accentHover,
    handlers.onCashOut,
    Tokens.text.onAccent,
    Tokens.radius.md
  );
  cashOutBtn.setEnabled(false);
  cashOutBtn.container.setVisible(false);

  // Walk Away is a quiet secondary: a raised surface, muted label, no red.
  // Leaving a game is not a destructive action and should not shout.
  const walkAwayBtn = makeButton(
    scene,
    SIDEBAR_CX,
    452,
    COL_W,
    34,
    "WALK AWAY",
    Tokens.color.surfaceRaised,
    Tokens.color.surfaceHover,
    handlers.onWalkAway,
    Tokens.text.secondary,
    Tokens.radius.sm
  );

  return { balanceText, multiplierText, messageText, betControl, startBtn, cashOutBtn, walkAwayBtn };
}

/**
 * The game board surface - one flat panel behind the game's own art, drawn
 * at depth -1 so every default-depth game object (reels, cards, grids,
 * wheels) always renders in front of it regardless of creation order.
 *
 * Was a gold-trimmed "arcade cabinet" (a thick gold outer border plus a
 * second inner border). Now it is simply the same raised surface the
 * sidebar uses, so the two halves of the screen read as one composition -
 * the board is defined by where the surface ENDS, not by a frame drawn
 * around it (direction note 3).
 *
 * IMPORTANT for callers: size (w, h) to hug the game's EXISTING content
 * bounds - do not add elements that extend beyond what was already
 * on-screen and working. A previous pass added a lever 20px outside the
 * frame and it bled 8px past the canvas's actual right edge (800) on every
 * platform; every board since sizes strictly around content already
 * verified to fit.
 */
export function drawCabinetFrame(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  w: number,
  h: number,
  radius: number = Tokens.radius.lg
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(-1);
  g.fillStyle(Tokens.elevation.raised.fill, 1);
  g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, radius);
  return g;
}

/**
 * The sidebar balance line, worded and spaced identically in all 14 games.
 *
 * GC-only economy (2026-08-29, TICKETS retired - see repo-root CLAUDE.md):
 * Gold Coins is the only live balance, so this prints exactly one figure.
 * It used to take a second `tickets` argument and print both currencies -
 * that balance is retired and permanently 0 now, so showing it would just
 * read as a broken second wallet. Having exactly one function produce this
 * string is what stops the fourteen copies of it drifting apart again.
 */
export function formatBalance(goldCoins: number): string {
  return `${goldCoins} Gold Coins`;
}

/**
 * The four states a playing-card rectangle can be in, for the four games
 * that deal cards (Blackjack, Baccarat, Hi-Lo, Video Poker).
 *
 * - `empty`  an un-dealt slot: a recessed well, same as any other inset
 * - `back`   a face-down card: just a raised surface, i.e. a control
 * - `face`   a dealt card: the one light surface in the system (Tokens.card)
 * - `held`   a dealt card the player has locked in (Video Poker only)
 *
 * Note there is no stroke on the first three. Every one of these used to be
 * drawn as fill + a 1-2px outline; in this system a card separates from the
 * board by BEING a different surface (direction note 3), and the only
 * survivor is `held`'s accent ring, which marks a real player choice rather
 * than decorating an edge.
 */
export type CardSurface = "empty" | "back" | "face" | "held";

export function drawCardSurface(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  surface: CardSurface,
  radius: number = Tokens.radius.sm
) {
  const fill =
    surface === "empty"
      ? Tokens.color.inset
      : surface === "back"
        ? Tokens.card.back
        : Tokens.card.face;

  g.fillStyle(fill, 1);
  g.fillRoundedRect(x - w / 2, y - h / 2, w, h, radius);

  if (surface === "held") {
    g.lineStyle(2, Tokens.color.accent, 1);
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, radius);
  }
}

/**
 * Result-reveal pop. Kept much quieter than the old 0.4 -> 1 spring: this
 * is the one place the emphasis ease is allowed (direction note 5), and it
 * now reads as a confident settle rather than a cartoon bounce.
 */
export function popIn(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject) {
  const obj = target as unknown as { setScale: (s: number) => void };
  obj.setScale(0.88);
  scene.tweens.add({
    targets: target,
    scale: 1,
    duration: Tokens.motion.duration.slow,
    ease: Tokens.motion.ease.emphasis
  });
}
