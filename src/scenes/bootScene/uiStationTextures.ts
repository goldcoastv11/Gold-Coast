import Phaser from "phaser";
import { PALETTE, LIT_ALPHA, SHADE_ALPHA, CONTACT_SHADOW_ALPHA } from "./palette";
import { drawCabinetBody, drawCabinetBase, drawCabinetScreen } from "./cabinetShell";

/**
 * Overworld "station" sprites that aren't one of the 14 games: the Coin
 * Kiosk, Item Shop, Challenge Board, Level-Up Kiosk, an unused "Coming
 * Soon" signpost, and the tutorial guide character prop. Moved out of
 * BootScene.ts unchanged.
 */

/**
 * The overworld Coin Kiosk - per user direction, a TV/screen-on-a-stand
 * rather than a person character (it used to be the "npc_sheet" Kenney
 * character sprite - see OverworldScene.ts's registerStation call for
 * this station). Same 48x64 cabinet scale as the other game furniture,
 * with an antenna on top (the same "reads as a screen/TV, not a game
 * machine" trick the old, since-retired standalone Ad Kiosk cabinet
 * used) and a coral play-triangle on the screen, since watching a
 * simulated ad is still literally step one of what this station does.
 */
export function createCoinKioskTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();
  drawCabinetBody(g, w, h);

  // antenna, reads as "screen/TV" not "slot machine"
  g.lineStyle(2, PALETTE.outline, 1);
  g.beginPath();
  g.moveTo(w / 2, 10);
  g.lineTo(w / 2 - 6, 2);
  g.moveTo(w / 2, 10);
  g.lineTo(w / 2 + 6, 2);
  g.strokePath();
  g.fillStyle(PALETTE.gold, 1);
  g.fillCircle(w / 2 - 6, 2, 1.8);
  g.fillCircle(w / 2 + 6, 2, 1.8);

  drawCabinetScreen(g, 9, 16, w - 18, 30);

  // coral play triangle, centered on the screen
  g.fillStyle(PALETTE.coral, 1);
  g.fillTriangle(w / 2 - 6, 22, w / 2 - 6, 40, w / 2 + 8, 31);

  drawCabinetBase(g, w, h);
  g.generateTexture("coin_kiosk", w, h);
  g.destroy();
}


/**
 * The overworld Item Shop - per user direction, a booth/counter similar
 * to the Coin Kiosk (same cabinet-scale construction) rather than a
 * person character (it used to be a purchasable character skin
 * standing in as the attendant - see OverworldScene.ts's
 * registerStation call for this station). A small orange-and-white
 * awning up top instead of the Coin Kiosk's antenna (reads as "market
 * stall," not "screen"), and a simple shirt icon on the screen panel
 * instead of a play triangle, since this station sells outfits.
 */
export function createItemShopTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();
  drawCabinetBody(g, w, h);

  // awning - a small triangular pennant on top
  g.fillStyle(PALETTE.coral, 1);
  g.fillTriangle(w / 2, 1, w / 2 - 11, 12, w / 2 + 11, 12);
  g.lineStyle(2, PALETTE.outline, 1);
  g.strokeTriangle(w / 2, 1, w / 2 - 11, 12, w / 2 + 11, 12);

  drawCabinetScreen(g, 9, 16, w - 18, 30);

  // shirt icon, centered on the screen panel
  const cx = w / 2;
  const cy = 31;
  g.fillStyle(PALETTE.cream, 1);
  g.fillTriangle(cx - 7, cy - 6, cx - 13, cy, cx - 7, cy + 2); // left sleeve
  g.fillTriangle(cx + 7, cy - 6, cx + 13, cy, cx + 7, cy + 2); // right sleeve
  g.fillRoundedRect(cx - 7, cy - 6, 14, 16, 2); // body
  g.fillStyle(PALETTE.screen, 1);
  g.fillCircle(cx, cy - 6, 3); // neckline notch, cut from the body with the screen's own color

  drawCabinetBase(g, w, h);
  g.generateTexture("item_shop_booth", w, h);
  g.destroy();
}


/**
 * The overworld Challenge Board - the walk-up station for challenges, XP
 * and levels (see OverworldScene's registerStation call and
 * ui/ChallengesPanel.ts). Same 48x64 cabinet construction as the Coin
 * Kiosk and Item Shop so it belongs to the same floor furniture family,
 * with a pinboard read: a gold-trimmed board on the screen panel carrying
 * three "pinned notice" rows and a star finial on top, since what this
 * station shows is a list of things to do plus a prestige number.
 */
export function createChallengeBoardTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();
  drawCabinetBody(g, w, h);

  // Star finial on top - the "achievement" read, and the one thing that
  // distinguishes this silhouette from the Coin Kiosk's antenna at a
  // glance when walking past.
  g.fillStyle(PALETTE.gold, 1);
  const cx = w / 2;
  g.fillTriangle(cx, 1, cx - 6, 12, cx + 6, 12);
  g.fillTriangle(cx, 13, cx - 6, 3, cx + 6, 3);

  drawCabinetScreen(g, 9, 16, w - 18, 30);

  // Gold-trimmed notice board inset into the screen panel.
  g.lineStyle(1.5, PALETTE.gold, 1);
  g.strokeRoundedRect(12, 19, w - 24, 24, 3);

  // Three pinned notice rows, the shortest last so it reads as a list
  // rather than a solid block.
  g.fillStyle(PALETTE.cream, 1);
  g.fillRect(15, 23, w - 30, 3);
  g.fillRect(15, 30, w - 30, 3);
  g.fillRect(15, 37, w - 38, 3);
  // A single filled pin on the top row - the "one of these is ready"
  // note the panel itself makes so much of.
  g.fillStyle(PALETTE.mint, 1);
  g.fillCircle(w - 15, 24, 2.4);

  drawCabinetBase(g, w, h);
  g.generateTexture("challenge_board", w, h);
  g.destroy();
}


/**
 * The overworld Level-Up station - a walk-up cabinet for the "stop the
 * marker" level-up minigame (see OverworldScene's registerStation call,
 * levelUpMinigameLauncher.ts, and LevelUpMinigameScene.ts). Same 48x64
 * cabinet construction as the Coin Kiosk/Item Shop/Challenge Board so it
 * reads as part of the same floor furniture family, with a rank-chevron
 * read: an upward arrowhead finial on top (this station's whole job is
 * signalling "go up a level," so an unmissable "up" shape distinguishes it
 * from the Challenge Board's star and the Coin Kiosk's antenna at a
 * glance), plus three stacked gold chevrons on the screen panel - the
 * universal "promotion/level up" rank-stripe motif. The founder's own
 * highlight ring (OverworldScene's showHighlightRing, reused from the
 * tutorial) is what actually signals "one is waiting" - this texture is
 * just the station's resting-state look.
 */
export function createLevelUpKioskTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();
  drawCabinetBody(g, w, h);

  // Up-arrow finial on top - a single arrowhead + stem, unmistakably "up."
  const cx = w / 2;
  g.fillStyle(PALETTE.gold, 1);
  g.fillTriangle(cx, 0, cx - 7, 9, cx + 7, 9);
  g.fillRect(cx - 2, 8, 4, 5);

  drawCabinetScreen(g, 9, 16, w - 18, 30);

  // Three stacked rank chevrons ("∧∧∧"), cream at the base brightening to
  // gold at the top so the eye reads them bottom-up like a real level
  // ladder.
  const chevronColors = [PALETTE.cream, PALETTE.coral, PALETTE.gold];
  const chevronYs = [39, 31, 23];
  for (let i = 0; i < 3; i++) {
    g.lineStyle(3, chevronColors[i], 1);
    g.beginPath();
    g.moveTo(cx - 10, chevronYs[i] + 5);
    g.lineTo(cx, chevronYs[i]);
    g.lineTo(cx + 10, chevronYs[i] + 5);
    g.strokePath();
  }

  drawCabinetBase(g, w, h);
  g.generateTexture("levelup_kiosk", w, h);
  g.destroy();
}


/**
 * A caution-sign placeholder for floor spots reserved for a game whose
 * scene doesn't exist yet (see OverworldScene's RESERVED_STATIONS). Same
 * 48x64 cabinet scale as Mines/Dice/Limbo/Keno so it doesn't disturb the
 * verified spacing those reserved spots were placed with.
 */
export function createComingSoonTexture(scene: Phaser.Scene) {
  const w = 48;
  const h = 64;
  const g = scene.add.graphics();

  // signpost
  g.fillStyle(PALETTE.outline, 1);
  g.fillRect(w / 2 - 4, 34, 8, 26);

  // sign board
  g.fillStyle(PALETTE.gold, 1);
  g.fillRoundedRect(4, 6, w - 8, 32, 6);
  g.lineStyle(2, PALETTE.outline, 1);
  g.strokeRoundedRect(4, 6, w - 8, 32, 6);

  // exclamation mark
  g.fillStyle(PALETTE.outline, 1);
  g.fillRoundedRect(w / 2 - 3, 12, 6, 15, 3);
  g.fillCircle(w / 2, 32, 3.2);

  g.generateTexture("coming_soon_sign", w, h);
  g.destroy();
}


/**
 * A friendly gold-chip mascot for the onboarding tutorial's dialogue box
 * (src/ui/TutorialGuide.ts) - a drawn placeholder in the same style as
 * every other texture in this file, not a spritesheet, since it never
 * walks/animates - it's a static portrait icon inside a screen-fixed
 * panel. Uses the same shared PALETTE as every other texture in this file
 * (flagged during the chrome-polish pass: this function previously used
 * ad-hoc hex values, including a near-black `0x1a1d24` face - the one
 * spot in the whole file that still violated STYLE_GUIDE.md direction
 * note 2's "never pure black" rule. Fixed here to PALETTE.outline, same
 * warm dark-brown as every other drawn texture's line art.
 */
export function createTutorialGuideTexture(scene: Phaser.Scene) {
  const w = 44;
  const h = 44;
  const g = scene.add.graphics();

  g.fillStyle(PALETTE.gold, 1);
  g.fillCircle(w / 2, h / 2, w / 2 - 2);
  g.lineStyle(3, PALETTE.outline, 1);
  g.strokeCircle(w / 2, h / 2, w / 2 - 2);

  // poker-chip-style inner ring, purely decorative
  g.lineStyle(2, 0xffffff, 0.5);
  g.strokeCircle(w / 2, h / 2, w / 2 - 9);

  // face
  g.fillStyle(PALETTE.outline, 1);
  g.fillCircle(w / 2 - 7, h / 2 - 3, 2.6);
  g.fillCircle(w / 2 + 7, h / 2 - 3, 2.6);
  g.lineStyle(2.5, PALETTE.outline, 1);
  g.beginPath();
  g.arc(w / 2, h / 2 + 1, 8, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160));
  g.strokePath();

  g.generateTexture("tutorial_guide", w, h);
  g.destroy();
}
