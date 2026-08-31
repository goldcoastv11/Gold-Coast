import Phaser from "phaser";
import { PALETTE, LIT_ALPHA, SHADE_ALPHA, CONTACT_SHADOW_ALPHA } from "./palette";
import { drawCabinetBody, drawCabinetBase, drawCabinetScreen } from "./cabinetShell";

/**
 * Game-cabinet overworld sprites - one procedurally-drawn texture per game
 * screen (mines/dice/limbo/plinko/keno/wheel/hilo/baccarat/video poker/
 * roulette/slots/blackjack/coin flip/dragon tower), all built on the shared
 * cabinetShell.ts pieces. Moved out of BootScene.ts unchanged.
 */

/**
 * The game furniture pieces below are drawn placeholders (procedural
 * Graphics + generateTexture, same technique throughout this file) so
 * these games don't need to wait on real tileset art to be walkable-up-to
 * in the overworld. Palette per STYLE_GUIDE.md: saturated flat fills,
 * warm dark-brown outlines (never pure black), rounded corners.
 */
export function createMinesTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();
  drawCabinetBody(g, w, h);

  drawCabinetScreen(g, 9, 16, w - 18, 30);

  const cell = 7;
  const gap = 2;
  const gridW = cell * 3 + gap * 2;
  const startX = w / 2 - gridW / 2;
  const startY = 20;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const isMine = r === 1 && c === 1;
      g.fillStyle(isMine ? PALETTE.danger : PALETTE.mint, 1);
      g.fillRoundedRect(startX + c * (cell + gap), startY + r * (cell + gap), cell, cell, 1.5);
    }
  }

  drawCabinetBase(g, w, h);
  g.generateTexture("mines_machine", w, h);
  g.destroy();
}


export function createDiceTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();

  g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
  g.fillEllipse(w / 2, h - 3, w - 10, 7);

  g.fillStyle(PALETTE.cabinetDark, 1);
  g.fillRoundedRect(10, h - 18, w - 20, 14, 3);
  g.fillStyle(PALETTE.felt, 1);
  g.fillRoundedRect(2, h - 42, w - 4, 26, 6);
  // Lit top edge / shaded lower edge on the felt bed, plus a shadow the
  // dice below can sit in.
  g.fillStyle(PALETTE.litEdge, 0.12);
  g.fillRoundedRect(5, h - 40, w - 10, 3, 1.5);
  g.fillStyle(PALETTE.shadeEdge, 0.16);
  g.fillRoundedRect(5, h - 20, w - 10, 3, 1.5);
  g.lineStyle(2, PALETTE.outline, 1);
  g.strokeRoundedRect(2, h - 42, w - 4, 26, 6);

  drawDie(g, 12, h - 36, 14, 5);
  drawDie(g, 28, h - 30, 14, 3);

  g.generateTexture("dice_table", w, h);
  g.destroy();
}


/** Draws a single cream die with warm-brown pips for the given face value (3 or 5 used here). */
export function drawDie(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, value: number) {
  g.fillStyle(PALETTE.cream, 1);
  g.fillRoundedRect(x, y, size, size, 3);
  g.lineStyle(1, PALETTE.outline, 1);
  g.strokeRoundedRect(x, y, size, size, 3);

  g.fillStyle(PALETTE.outline, 1);
  const cx = x + size / 2;
  const cy = y + size / 2;
  const o = size * 0.25;
  const pipLayouts: Record<number, Array<[number, number]>> = {
    3: [
      [-o, -o],
      [0, 0],
      [o, o]
    ],
    5: [
      [-o, -o],
      [o, -o],
      [0, 0],
      [-o, o],
      [o, o]
    ]
  };
  for (const [dx, dy] of pipLayouts[value] ?? []) {
    g.fillCircle(cx + dx, cy + dy, size * 0.09);
  }
}


export function createLimboTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();
  drawCabinetBody(g, w, h);

  drawCabinetScreen(g, 9, 16, w - 18, 30);

  g.lineStyle(3, PALETTE.gold, 1);
  g.beginPath();
  g.moveTo(13, 42);
  g.lineTo(24, 30);
  g.lineTo(33, 20);
  g.strokePath();
  g.fillStyle(PALETTE.gold, 1);
  g.fillTriangle(33, 18, 27, 22, 33, 26);

  drawCabinetBase(g, w, h);
  g.generateTexture("limbo_machine", w, h);
  g.destroy();
}


export function createPlinkoTexture(scene: Phaser.Scene) {
  const w = 64;
  const h = 64;
  const g = scene.add.graphics();

  g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
  g.fillEllipse(w / 2, h - 3, w - 12, 7);

  drawCabinetScreen(g, 2, 4, w - 4, h - 18, PALETTE.screen);
  g.lineStyle(2, PALETTE.outline, 1);
  g.strokeRoundedRect(2, 4, w - 4, h - 18, 6);

  g.fillStyle(PALETTE.cabinetDark, 1);
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    const count = r + 2;
    const rowY = 14 + r * 7;
    const totalW = (count - 1) * 8;
    const startX = w / 2 - totalW / 2;
    for (let c = 0; c < count; c++) {
      g.fillCircle(startX + c * 8, rowY, 1.4);
    }
  }

  const slotColors = [PALETTE.coral, PALETTE.gold, PALETTE.mint, PALETTE.gold, PALETTE.coral];
  const slotW = (w - 8) / slotColors.length;
  slotColors.forEach((color, i) => {
    g.fillStyle(color, 1);
    g.fillRect(4 + i * slotW, h - 24, slotW - 1, 6);
  });

  drawCabinetBase(g, w, h);
  g.generateTexture("plinko_board", w, h);
  g.destroy();
}


/** A small drawn "board" of numbered squares on a cabinet - stands in for a real Keno terminal sprite. */
export function createKenoTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();
  drawCabinetBody(g, w, h);

  drawCabinetScreen(g, 9, 16, w - 18, 30);

  const cell = 5;
  const gap = 1.5;
  const cols = 4;
  const rows = 4;
  const gridW = cols * cell + (cols - 1) * gap;
  const startX = w / 2 - gridW / 2;
  const startY = 20;
  const highlighted = new Set([1, 3, 6, 9, 12, 14]);
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.fillStyle(highlighted.has(i) ? PALETTE.gold : PALETTE.mint, 1);
      g.fillRoundedRect(startX + c * (cell + gap), startY + r * (cell + gap), cell, cell, 1);
      i++;
    }
  }

  drawCabinetBase(g, w, h);
  g.generateTexture("keno_machine", w, h);
  g.destroy();
}


/** A small drawn segmented-wheel cabinet, cabinet-scale like keno_machine/dice_table. */
export function createWheelTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();
  drawCabinetBody(g, w, h);

  const cx = w / 2;
  const cy = 30;
  const radius = 14;
  const colors = [
    PALETTE.mint,
    PALETTE.gold,
    PALETTE.coral,
    PALETTE.cream,
    PALETTE.mint,
    PALETTE.gold,
    PALETTE.coral,
    PALETTE.cream
  ];
  const slice = (Math.PI * 2) / colors.length;
  colors.forEach((color, i) => {
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, radius, i * slice, (i + 1) * slice, false);
    g.closePath();
    g.fillPath();
  });
  g.lineStyle(1.5, PALETTE.outline, 1);
  g.strokeCircle(cx, cy, radius);
  g.fillStyle(PALETTE.cream, 1);
  g.fillTriangle(cx - 3, cy - radius - 6, cx + 3, cy - radius - 6, cx, cy - radius + 1);

  drawCabinetBase(g, w, h);
  g.generateTexture("wheel_machine", w, h);
  g.destroy();
}


/**
 * A small drawn card-cabinet with an up/down arrow - cabinet-scale
 * (48x64, matching keno_machine/dice_table) per floor's spacing note for
 * the col67 corridor between CoinFlip and Slots.
 */
export function createHiLoTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();
  drawCabinetBody(g, w, h);

  drawCabinetScreen(g, 9, 16, w - 18, 30);

  // two overlapping mini playing cards
  g.fillStyle(PALETTE.cream, 1);
  g.fillRoundedRect(14, 20, 14, 20, 2);
  g.fillRoundedRect(21, 24, 14, 20, 2);
  g.lineStyle(1, PALETTE.outline, 1);
  g.strokeRoundedRect(14, 20, 14, 20, 2);
  g.strokeRoundedRect(21, 24, 14, 20, 2);

  // up/down arrow between them
  g.fillStyle(PALETTE.mint, 1);
  g.fillTriangle(40, 22, 36, 28, 44, 28);
  g.fillStyle(PALETTE.danger, 1);
  g.fillTriangle(40, 44, 36, 38, 44, 38);

  drawCabinetBase(g, w, h);
  g.generateTexture("hilo_table", w, h);
  g.destroy();
}


/** A small drawn baccarat table cabinet - two mini playing cards over a felt strip, cabinet-scale like the others. */
export function createBaccaratTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();
  drawCabinetBody(g, w, h);

  // felt playing surface
  g.fillStyle(PALETTE.felt, 1);
  g.fillRoundedRect(9, 16, w - 18, 30, 4);
  g.lineStyle(1, PALETTE.gold, 0.6);
  g.strokeRoundedRect(9, 16, w - 18, 30, 4);

  // two mini cards (player/banker)
  g.fillStyle(PALETTE.cream, 1);
  g.fillRoundedRect(13, 22, 10, 15, 2);
  g.fillRoundedRect(25, 22, 10, 15, 2);
  g.lineStyle(1, PALETTE.outline, 1);
  g.strokeRoundedRect(13, 22, 10, 15, 2);
  g.strokeRoundedRect(25, 22, 10, 15, 2);
  g.fillStyle(PALETTE.danger, 1);
  g.fillCircle(18, 29, 1.6);
  g.fillStyle(PALETTE.outline, 1);
  g.fillCircle(30, 29, 1.6);

  drawCabinetBase(g, w, h);
  g.generateTexture("baccarat_table", w, h);
  g.destroy();
}


/** A small drawn video poker cabinet - a mini screen showing a 5-card hand, cabinet-scale like the others. */
export function createVideoPokerTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();
  drawCabinetBody(g, w, h);

  // screen - starts a row lower than it used to (15 -> 16) so it clears
  // the marquee header drawCabinetBody now draws above it.
  drawCabinetScreen(g, 9, 16, w - 18, 23, PALETTE.screenAlt);

  // five tiny cards on the screen
  const cardW = 4;
  const cardH = 10;
  const cardGap = 1.5;
  const totalW = 5 * cardW + 4 * cardGap;
  const startX = w / 2 - totalW / 2;
  for (let i = 0; i < 5; i++) {
    g.fillStyle(PALETTE.cream, 1);
    g.fillRoundedRect(startX + i * (cardW + cardGap), 20, cardW, cardH, 1);
  }

  // control buttons row
  const btnColors = [PALETTE.coral, PALETTE.mint, PALETTE.mint, PALETTE.mint, PALETTE.gold];
  const btnW = 4;
  const btnGap = 1.5;
  const btnTotal = 5 * btnW + 4 * btnGap;
  const btnStartX = w / 2 - btnTotal / 2;
  btnColors.forEach((color, i) => {
    g.fillStyle(color, 1);
    g.fillRoundedRect(btnStartX + i * (btnW + btnGap), 42, btnW, 4, 1);
  });

  drawCabinetBase(g, w, h);
  g.generateTexture("video_poker_machine", w, h);
  g.destroy();
}


/**
 * Roulette table - top-down cabinet-style table, 112x64 (same footprint
 * as the old Jephed roulette_table.png). Terracotta rail, mint felt
 * inset, a small segmented wheel centered like createWheelTexture's.
 */
export function createRouletteTableTexture(scene: Phaser.Scene) {
  const w = 112;
  const h = 64;
  const g = scene.add.graphics();

  // Contact shadow, so the table stands on the floor instead of floating.
  g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
  g.fillRoundedRect(5, 6, w - 8, h - 6, 12);

  // Padded wood rail, lit along the top and shaded underneath.
  g.fillStyle(PALETTE.cabinetDark, 1);
  g.fillRoundedRect(2, 2, w - 4, h - 4, 12);
  g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
  g.fillRoundedRect(5, 4, w - 10, 3, 1.5);
  g.fillStyle(PALETTE.shadeEdge, SHADE_ALPHA);
  g.fillRoundedRect(5, h - 7, w - 10, 3, 1.5);
  // Grain along the rail.
  g.fillStyle(PALETTE.shadeEdge, 0.12);
  for (let x = 12; x < w - 12; x += 7) {
    g.fillRect(x, 3, 1, 4);
    g.fillRect(x + 3, h - 7, 1, 4);
  }
  g.lineStyle(3, PALETTE.outline, 1);
  g.strokeRoundedRect(2, 2, w - 4, h - 4, 12);

  g.fillStyle(PALETTE.felt, 1);
  g.fillRoundedRect(8, 8, w - 16, h - 16, 9);
  // Felt sits BELOW the rail, so it catches a shadow from the rail on its
  // top edge and a little bounce light at the bottom - the inset that
  // makes the playing surface read as recessed rather than painted on.
  g.fillStyle(PALETTE.shadeEdge, 0.18);
  g.fillRoundedRect(9, 9, w - 18, 3, 1.5);
  g.fillStyle(PALETTE.litEdge, 0.07);
  g.fillRoundedRect(9, h - 13, w - 18, 2, 1);
  g.lineStyle(1, PALETTE.gold, 0.6);
  g.strokeRoundedRect(8, 8, w - 16, h - 16, 9);

  // betting-grid hint on either side of the wheel
  for (const gx of [16, w - 16 - 18]) {
    for (let i = 0; i < 3; i++) {
      g.fillStyle(PALETTE.cream, 0.85);
      g.fillRoundedRect(gx, 16 + i * 11, 18, 8, 2);
      g.lineStyle(1, PALETTE.outline, 0.8);
      g.strokeRoundedRect(gx, 16 + i * 11, 18, 8, 2);
    }
  }

  // wheel
  const cx = w / 2;
  const cy = h / 2;
  const radius = 15;
  const colors = [
    PALETTE.mint,
    PALETTE.gold,
    PALETTE.coral,
    PALETTE.cream,
    PALETTE.mint,
    PALETTE.gold,
    PALETTE.coral,
    PALETTE.cream,
    PALETTE.mint,
    PALETTE.gold
  ];
  const slice = (Math.PI * 2) / colors.length;
  colors.forEach((color, i) => {
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, radius, i * slice, (i + 1) * slice, false);
    g.closePath();
    g.fillPath();
  });
  // Fret lines between the pockets, then the outer rim, hub and a lit
  // sliver on the wheel's top-left - a spinning metal wheel, not a pie
  // chart.
  g.lineStyle(1, PALETTE.outline, 0.55);
  for (let i = 0; i < colors.length; i++) {
    const a = i * slice;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    g.strokePath();
  }
  g.lineStyle(2, PALETTE.outline, 1);
  g.strokeCircle(cx, cy, radius);
  g.lineStyle(1, PALETTE.litEdge, 0.4);
  g.strokeCircle(cx, cy, radius - 2);
  g.fillStyle(PALETTE.cabinetDark, 1);
  g.fillCircle(cx, cy, 4);
  g.fillStyle(PALETTE.litEdge, 0.4);
  g.fillCircle(cx - 1, cy - 1, 1.6);
  g.lineStyle(1, PALETTE.outline, 1);
  g.strokeCircle(cx, cy, 4);

  g.generateTexture("roulette_table", w, h);
  g.destroy();
}


/**
 * Slot machine cabinet - 48x64 (same footprint as the old Jephed
 * slot_machine.png). Terracotta cabinet, cream screen with three
 * fruit-style reel symbols, a gold lever on the side.
 */
export function createSlotMachineTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();

  // Contact shadow, matching every other piece of floor furniture.
  g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
  g.fillEllipse(w / 2 - 3, h - 3, w - 12, 7);

  g.fillStyle(PALETTE.cabinet, 1);
  g.fillRoundedRect(4, 6, w - 12, h - 10, 8);
  // Same top-left light / bottom-right shade as drawCabinetBody, so this
  // cabinet belongs to the same lit floor as the eight that use it.
  g.fillStyle(PALETTE.shadeEdge, SHADE_ALPHA);
  g.fillRect(w - 12, 10, 3, h - 20);
  g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
  g.fillRect(6, 10, 2, h - 20);
  g.fillRect(6, 8, w - 18, 2);
  g.lineStyle(2, PALETTE.outline, 1);
  g.strokeRoundedRect(4, 6, w - 12, h - 10, 8);

  // Reel window - recessed glass with a gloss band, drawn the same way
  // the arcade cabinets' screens are.
  drawCabinetScreen(g, 8, 12, w - 20, 26, PALETTE.screenAlt);
  g.lineStyle(1.5, PALETTE.outline, 1);
  g.strokeRoundedRect(8, 12, w - 20, 26, 5);

  // Reel separators, so it reads as three spinning reels behind one pane.
  g.fillStyle(PALETTE.outline, 0.35);
  g.fillRect(16.5, 13, 1, 24);
  g.fillRect(24.5, 13, 1, 24);

  // three reel symbols, each with a small specular dot
  const reelColors = [PALETTE.coral, PALETTE.gold, PALETTE.mint];
  reelColors.forEach((color, i) => {
    g.fillStyle(color, 1);
    g.fillCircle(13 + i * 8, 25, 4.5);
    g.fillStyle(PALETTE.litEdge, 0.45);
    g.fillCircle(11.5 + i * 8, 23.5, 1.4);
    g.lineStyle(1, PALETTE.outline, 1);
    g.strokeCircle(13 + i * 8, 25, 4.5);
  });

  // lever
  g.lineStyle(3, PALETTE.cabinetDark, 1);
  g.beginPath();
  g.moveTo(w - 6, 16);
  g.lineTo(w - 6, 6);
  g.strokePath();
  g.fillStyle(PALETTE.gold, 1);
  g.fillCircle(w - 6, 5, 4);
  g.lineStyle(1.5, PALETTE.outline, 1);
  g.strokeCircle(w - 6, 5, 4);

  // control buttons row
  const btnColors = [PALETTE.coral, PALETTE.mint, PALETTE.gold];
  btnColors.forEach((color, i) => {
    g.fillStyle(color, 1);
    g.fillCircle(13 + i * 8, 46, 3);
  });

  drawCabinetBase(g, w, h);
  g.generateTexture("slot_machine", w, h);
  g.destroy();
}


/**
 * Blackjack table - 96x112 (same footprint as the old Jephed
 * blackjack_table.png). A tall semi-circular felt table with a terracotta
 * rail, a couple of mini playing cards and a small chip stack.
 */
export function createBlackjackTableTexture(scene: Phaser.Scene) {
  const w = 96;
  const h = 112;
  const g = scene.add.graphics();

  // Contact shadow under the table.
  g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
  g.fillRoundedRect(9, 10, w - 14, h - 12, 22);

  // wood rail, lit on top and shaded underneath, with grain
  g.fillStyle(PALETTE.cabinetDark, 1);
  g.fillRoundedRect(6, 6, w - 12, h - 12, 22);
  g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
  g.fillRoundedRect(24, 8, w - 48, 3, 1.5);
  g.fillStyle(PALETTE.shadeEdge, SHADE_ALPHA);
  g.fillRoundedRect(24, h - 12, w - 48, 3, 1.5);
  g.fillStyle(PALETTE.shadeEdge, 0.12);
  for (let y = 26; y < h - 26; y += 8) {
    g.fillRect(7, y, 4, 1);
    g.fillRect(w - 11, y + 4, 4, 1);
  }
  g.lineStyle(3, PALETTE.outline, 1);
  g.strokeRoundedRect(6, 6, w - 12, h - 12, 22);

  // felt, recessed below the rail (shadow along its top edge)
  g.fillStyle(PALETTE.felt, 1);
  g.fillRoundedRect(16, 16, w - 32, h - 32, 16);
  g.fillStyle(PALETTE.shadeEdge, 0.18);
  g.fillRoundedRect(22, 17, w - 44, 4, 2);
  g.fillStyle(PALETTE.litEdge, 0.07);
  g.fillRoundedRect(22, h - 21, w - 44, 3, 1.5);
  g.lineStyle(1.5, PALETTE.gold, 0.6);
  g.strokeRoundedRect(16, 16, w - 32, h - 32, 16);

  // dealt cards, fanned near the top
  const cardPositions: Array<[number, number, number]> = [
    [w / 2 - 20, 34, -10],
    [w / 2 - 6, 30, 0],
    [w / 2 + 8, 34, 10]
  ];
  for (const [x, y, angle] of cardPositions) {
    g.save();
    g.translateCanvas(x, y);
    g.rotateCanvas(Phaser.Math.DegToRad(angle));
    g.fillStyle(PALETTE.cream, 1);
    g.fillRoundedRect(-8, -11, 16, 22, 2.5);
    g.lineStyle(1.5, PALETTE.outline, 1);
    g.strokeRoundedRect(-8, -11, 16, 22, 2.5);
    g.fillStyle(PALETTE.danger, 1);
    g.fillCircle(0, 0, 2.2);
    g.restore();
  }

  // chip stack, lower-center
  const chipColors = [PALETTE.coral, PALETTE.gold, PALETTE.mint];
  chipColors.forEach((color, i) => {
    g.fillStyle(color, 1);
    g.fillEllipse(w / 2, h - 26 - i * 5, 22, 9);
    g.lineStyle(1.5, PALETTE.outline, 1);
    g.strokeEllipse(w / 2, h - 26 - i * 5, 22, 9);
  });

  g.generateTexture("blackjack_table", w, h);
  g.destroy();
}


/**
 * Coin Flip machine - 49x64 (same footprint as the old Jephed
 * coinflip_machine.png). Same cabinet shell as the arcade-scale games,
 * with a big gold coin on the screen.
 */
export function createCoinFlipMachineTexture(scene: Phaser.Scene) {
  const w = 49;
  const h = 64;
  const g = scene.add.graphics();
  drawCabinetBody(g, w, h);

  drawCabinetScreen(g, 9, 16, w - 18, 30);

  const cx = w / 2;
  const cy = 31;
  g.fillStyle(PALETTE.gold, 1);
  g.fillCircle(cx, cy, 10);
  g.lineStyle(2, PALETTE.outline, 1);
  g.strokeCircle(cx, cy, 10);
  g.lineStyle(1.5, PALETTE.cabinetDark, 1);
  g.strokeCircle(cx, cy, 6.5);
  g.fillStyle(PALETTE.cabinetDark, 1);
  g.fillRoundedRect(cx - 1.5, cy - 5, 3, 10, 1.5);

  drawCabinetBase(g, w, h);
  g.generateTexture("coinflip_machine", w, h);
  g.destroy();
}


/**
 * Dragon Tower pedestal - 48x64 (same footprint as the old Jephed
 * dragon_pedestal.png). A terracotta column on a plinth, topped with a
 * small ascending stack of tower "levels" and a gold finial gem.
 */
export function createDragonPedestalTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();

  g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
  g.fillEllipse(w / 2, h - 3, w - 16, 7);

  // base plinth
  g.fillStyle(PALETTE.cabinetDark, 1);
  g.fillRoundedRect(10, h - 14, w - 20, 10, 3);
  g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
  g.fillRect(12, h - 13, w - 24, 1);
  g.lineStyle(2, PALETTE.outline, 1);
  g.strokeRoundedRect(10, h - 14, w - 20, 10, 3);

  // column - shorter than the plinth-to-canopy span used to give the
  // ascending tower-level blocks below enough headroom (an earlier
  // version stacked full-height blocks on a 32px column and pushed the
  // top two levels above the canvas entirely - verified via a live
  // texture-manager snapshot; these fixed coordinates keep every level
  // and the finial gem on-canvas with room to spare).
  g.fillStyle(PALETTE.cabinet, 1);
  g.fillRoundedRect(16, 34, 16, 20, 4);
  g.lineStyle(2, PALETTE.outline, 1);
  g.strokeRoundedRect(16, 34, 16, 20, 4);

  // ascending tower-level blocks, each seated a couple px into the one below
  g.fillStyle(PALETTE.mint, 1);
  g.fillRoundedRect(11, 27, 26, 9, 3);
  g.lineStyle(1.5, PALETTE.outline, 1);
  g.strokeRoundedRect(11, 27, 26, 9, 3);

  g.fillStyle(PALETTE.gold, 1);
  g.fillRoundedRect(14, 20, 20, 8, 3);
  g.lineStyle(1.5, PALETTE.outline, 1);
  g.strokeRoundedRect(14, 20, 20, 8, 3);

  g.fillStyle(PALETTE.coral, 1);
  g.fillRoundedRect(17, 13, 14, 7, 3);
  g.lineStyle(1.5, PALETTE.outline, 1);
  g.strokeRoundedRect(17, 13, 14, 7, 3);

  // finial gem
  g.fillStyle(PALETTE.gold, 1);
  g.fillCircle(w / 2, 8, 4.5);
  g.lineStyle(1.5, PALETTE.outline, 1);
  g.strokeCircle(w / 2, 8, 4.5);

  g.generateTexture("dragon_pedestal", w, h);
  g.destroy();
}
