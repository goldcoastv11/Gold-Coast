import Phaser from "phaser";
import { gameState } from "../GameState";
import { Tokens } from "./DesignTokens";
import { makeButton, makeText, type BetControl, type UIButton } from "./uiHelpers";

export interface QuickplayRect { x: number; y: number; w: number; h: number }

export interface QuickplayStage {
  portrait: boolean;
  controls: QuickplayRect;
  board: QuickplayRect;
  left: number;
  right: number;
  contentW: number;
  top: number;
}

/** Shared full-canvas structure used by the modern direct Quickplay games. */
export function createQuickplayStage(scene: Phaser.Scene, portraitBoardHeight = 600): QuickplayStage {
  const width = scene.scale.width;
  const height = scene.scale.height;
  const portrait = height > width;
  const controls = portrait
    ? { x: 0, y: portraitBoardHeight, w: width, h: Math.max(400, height - portraitBoardHeight) }
    : { x: 0, y: 0, w: Math.max(236, Math.min(306, Math.round(width * 0.255))), h: height };
  const board = portrait
    ? { x: 0, y: 0, w: width, h: portraitBoardHeight }
    : { x: controls.w, y: 0, w: width - controls.w, h: height };

  const ground = scene.add.graphics().setDepth(-1000).setScrollFactor(0);
  ground.fillStyle(Tokens.color.bg, 1).fillRect(0, 0, width, height);
  const boardSurface = scene.add.graphics().setDepth(-20);
  boardSurface.fillStyle(0x0d202d, 1).fillRect(board.x, board.y, board.w, board.h);
  boardSurface.fillStyle(Tokens.color.surface, 0.42).fillRect(board.x, board.y, board.w, 16);
  const controlSurface = scene.add.graphics().setDepth(-10).setScrollFactor(0);
  controlSurface.fillStyle(Tokens.color.surface, 1).fillRect(controls.x, controls.y, controls.w, controls.h);
  if (portrait) controlSurface.lineStyle(2, Tokens.color.hairline, 1).lineBetween(0, controls.y, width, controls.y);

  const left = controls.x + Tokens.space.md;
  const right = controls.x + controls.w - Tokens.space.md;
  return { portrait, controls, board, left, right, contentW: right - left, top: controls.y };
}

export function drawManualAuto(scene: Phaser.Scene, stage: QuickplayStage, y = 30) {
  const x = stage.controls.x + stage.controls.w / 2;
  const width = stage.contentW;
  const bg = scene.add.graphics().setScrollFactor(0);
  bg.fillStyle(Tokens.color.inset, 1).fillRoundedRect(x - width / 2, stage.top + y - 22, width, 44, 22);
  bg.fillStyle(Tokens.color.surfaceHover, 1).fillRoundedRect(x - width / 2 + 3, stage.top + y - 19, width / 2 - 3, 38, 19);
  makeText(scene, x - width / 4, stage.top + y, "Manual", { size: Tokens.type.size.sm, weight: Tokens.type.weight.semibold, color: Tokens.text.primary, align: "center", originX: 0.5, originY: 0.5 }).setScrollFactor(0);
  makeText(scene, x + width / 4, stage.top + y, "Auto", { size: Tokens.type.size.sm, weight: Tokens.type.weight.semibold, color: Tokens.text.secondary, align: "center", originX: 0.5, originY: 0.5 }).setScrollFactor(0);
}

/** Compact Stake-style amount row: value and Gold Coin plus half/double controls. */
export function makeQuickBetControl(scene: Phaser.Scene, stage: QuickplayStage, y: number): BetControl {
  const x = stage.controls.x + stage.controls.w / 2;
  const width = stage.contentW;
  const container = scene.add.container(x, stage.top + y).setScrollFactor(0);
  const cellW = 44;
  const gap = Tokens.space.xs;
  const fieldW = width - cellW * 2 - gap * 2;
  const left = -width / 2;
  const fieldX = left + fieldW / 2;
  const field = scene.add.graphics();
  field.fillStyle(Tokens.color.inset, 1).fillRoundedRect(fieldX - fieldW / 2, -20, fieldW, 40, Tokens.radius.md);
  field.lineStyle(1, Tokens.color.hairline, 1).strokeRoundedRect(fieldX - fieldW / 2, -20, fieldW, 40, Tokens.radius.md);
  const amount = makeText(scene, fieldX - fieldW / 2 + Tokens.space.md, 0, "", { size: Tokens.type.size.lg, weight: Tokens.type.weight.semibold, color: Tokens.text.primary, originY: 0.5 });
  const coin = scene.add.graphics();
  coin.fillStyle(0xffc800, 1).fillCircle(fieldX + fieldW / 2 - 15, 0, 9);
  const coinLabel = makeText(scene, fieldX + fieldW / 2 - 15, 0, "G", { size: Tokens.type.size.xs, weight: Tokens.type.weight.bold, color: Tokens.text.onAccent, align: "center", originX: 0.5, originY: 0.5 });
  const refresh = () => amount.setText(gameState.betAmount.toFixed(2));
  const half = makeButton(scene, left + fieldW + gap + cellW / 2, 0, cellW, 40, "½", Tokens.color.surfaceRaised, Tokens.color.surfaceHover, () => { gameState.setBet(gameState.betAmount / 2); refresh(); }, Tokens.text.secondary, Tokens.radius.sm);
  const twice = makeButton(scene, left + fieldW + gap * 2 + cellW * 1.5, 0, cellW, 40, "2×", Tokens.color.surfaceRaised, Tokens.color.surfaceHover, () => { gameState.setBet(gameState.betAmount * 2); refresh(); }, Tokens.text.secondary, Tokens.radius.sm);
  container.add([field, amount, coin, coinLabel, half.container, twice.container]);
  refresh();
  return {
    container,
    refresh,
    setPosition: (nextX: number, nextY: number) => container.setPosition(nextX, nextY),
    setEnabled: (enabled: boolean) => { half.setEnabled(enabled); twice.setEnabled(enabled); container.setAlpha(enabled ? 1 : Tokens.motion.disabledAlpha); },
    destroy: () => container.destroy()
  };
}

export function makeQuickBackButton(scene: Phaser.Scene, stage: QuickplayStage, onPress: () => void): UIButton {
  const button = makeButton(scene, stage.controls.x + stage.controls.w / 2, stage.controls.y + stage.controls.h - 28, stage.contentW, 34, "BACK TO GAMES", Tokens.color.surfaceRaised, Tokens.color.surfaceHover, onPress, Tokens.text.secondary, Tokens.radius.sm);
  button.container.setScrollFactor(0);
  return button;
}

export function drawQuickLabel(scene: Phaser.Scene, stage: QuickplayStage, y: number, label: string) {
  return makeText(scene, stage.left, stage.top + y, label, {
    size: Tokens.type.size.xs,
    weight: Tokens.type.weight.semibold,
    color: Tokens.text.secondary,
    tracking: Tokens.type.tracking.label
  }).setScrollFactor(0);
}

export function drawQuickReadout(scene: Phaser.Scene, stage: QuickplayStage, y: number, label: string, value: string) {
  drawQuickLabel(scene, stage, y, label);
  const fieldY = stage.top + y + 30;
  const bg = scene.add.graphics().setScrollFactor(0);
  bg.fillStyle(Tokens.color.inset, 1).fillRoundedRect(stage.left, fieldY - 20, stage.contentW, 40, Tokens.radius.md);
  bg.lineStyle(1, Tokens.color.hairline, 1).strokeRoundedRect(stage.left, fieldY - 20, stage.contentW, 40, Tokens.radius.md);
  return makeText(scene, stage.left + Tokens.space.md, fieldY, value, { size: Tokens.type.size.sm, weight: Tokens.type.weight.semibold, color: Tokens.text.primary, originY: 0.5 }).setScrollFactor(0);
}
