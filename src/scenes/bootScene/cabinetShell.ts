import Phaser from "phaser";
import { PALETTE, LIT_ALPHA, SHADE_ALPHA, CONTACT_SHADOW_ALPHA } from "./palette";

/**
 * Shared 48x64 "arcade cabinet" shell pieces, reused by every game-cabinet
 * and UI-station texture generator (mines/limbo/keno/wheel/hilo/baccarat/
 * video poker/coin flip, plus the Coin Kiosk/Item Shop/Challenge Board/
 * Level-Up Kiosk/Coming Soon stations) - a rounded terracotta body with a
 * warm dark-brown outline, a matching base bar, and a lit-glass screen
 * panel. Callers draw their own content on top between the calls. Split out
 * of BootScene.ts unchanged (pure functions over a passed-in Graphics
 * object; nothing here ever touched `this`).
 */

/**
 * Shared cabinet-shell pieces reused by every 48x64 "arcade cabinet"
 * style game texture below (mines/limbo/keno/wheel/hilo/baccarat/video
 * poker/coin flip) - a rounded terracotta body with a warm dark-brown
 * outline and a matching base bar. Callers draw their own screen/content
 * on top between the two calls.
 */
export function drawCabinetBody(g: Phaser.GameObjects.Graphics, w: number, h: number) {
  // Contact shadow on the floor under the cabinet. Without one, every
  // cabinet looked pasted onto the floor rather than standing on it - the
  // single cheapest thing that makes a top-down floor read as having depth.
  g.fillStyle(PALETTE.shadeEdge, CONTACT_SHADOW_ALPHA);
  g.fillEllipse(w / 2, h - 3, w - 10, 7);

  g.fillStyle(PALETTE.cabinet, 1);
  g.fillRoundedRect(4, 10, w - 8, h - 16, 6);

  // Shaded right-hand face, then the lit top-left edge: the two together
  // are what turn a flat rounded rectangle into a box with a light on it.
  // Both sit outside the 9..w-9 window every caller draws its screen into,
  // so a caller's own content always lands on top of plain cabinet colour.
  g.fillStyle(PALETTE.shadeEdge, SHADE_ALPHA);
  g.fillRect(w - 10, 12, 4, h - 20);
  g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
  g.fillRect(6, 12, 2, h - 22);

  // Marquee header - the strip above the screen that a real cabinet
  // carries its game's name on, finished with a gold pinstripe. Ends at
  // y 15, one pixel clear of the screen bezel every caller draws at y 16
  // (see drawCabinetScreen, which insets its bezel by 1px for exactly
  // this reason).
  g.fillStyle(PALETTE.cabinetDark, 1);
  g.fillRoundedRect(7, 11.5, w - 14, 3.5, 1.5);
  g.fillStyle(PALETTE.gold, 0.8);
  g.fillRect(7, 14, w - 14, 1);

  g.lineStyle(2, PALETTE.outline, 1);
  g.strokeRoundedRect(4, 10, w - 8, h - 16, 6);
}


export function drawCabinetBase(g: Phaser.GameObjects.Graphics, w: number, h: number) {
  g.fillStyle(PALETTE.cabinetDark, 1);
  g.fillRoundedRect(10, h - 10, w - 20, 8, 3);
  // Lit top face of the plinth plus a shaded underside, so the base reads
  // as a solid block the cabinet stands on rather than a painted stripe.
  g.fillStyle(PALETTE.litEdge, LIT_ALPHA);
  g.fillRect(12, h - 9, w - 24, 1);
  g.fillStyle(PALETTE.shadeEdge, SHADE_ALPHA);
  g.fillRect(12, h - 4, w - 24, 2);
}


/**
 * The lit-glass screen panel every cabinet carries, drawn once here rather
 * than as a bare `fillRoundedRect` repeated at eight call sites.
 *
 * Adds what a flat fill can't say: a dark bezel around the glass, a gloss
 * band across the top, and faint scanlines. Callers still draw their own
 * content on top afterwards, exactly as before.
 */
export function drawCabinetScreen(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number = PALETTE.screen
) {
  // Bezel - a dark recess the glass sits inside.
  g.fillStyle(PALETTE.outline, 0.9);
  g.fillRoundedRect(x - 1, y - 1, w + 2, h + 2, 5);

  g.fillStyle(color, 1);
  g.fillRoundedRect(x, y, w, h, 4);

  // Scanlines - very low contrast, just enough to read as a lit panel
  // rather than a painted rectangle.
  g.fillStyle(PALETTE.outline, 0.09);
  for (let i = 3; i < h - 1; i += 3) {
    g.fillRect(x + 1, y + i, w - 2, 1);
  }

  // Gloss: a bright band across the top of the glass, fading out.
  g.fillStyle(PALETTE.litEdge, 0.12);
  g.fillRoundedRect(x + 1, y + 1, w - 2, Math.max(3, h * 0.28), 3);
}
