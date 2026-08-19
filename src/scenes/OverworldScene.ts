import Phaser from "phaser";
import { gameState } from "../GameState";
import { listSkins, SkinDef } from "../economy/skinShop";
import { GC_MULTIPLIER_BASE } from "../economy/gcMultiplier";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, UIButton } from "../ui/uiHelpers";
import { createShuffleCupReveal } from "../ui/ShuffleCupReveal";
import { offerTripleChance, TripleChanceOutcome } from "../ui/TripleChanceOffer";
import { runOnboardingTutorial, TutorialStep } from "../ui/TutorialGuide";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";

const TILE = 16; // real tileset is 16x16 pixels per tile
const MAP_COLS = 80;
const MAP_ROWS = 56;
const PLAYER_SPEED = 160;
const INTERACT_PADDING = 16; // extra reach beyond a station's own footprint

// Floating text "chips" (prompt/HUD/labels/toasts) draw their own CSS-style
// backgroundColor rather than a Theme.ts Graphics fill, so they need string
// hex constants here instead of Theme's numeric ones. Task #23: swapped from
// the old near-black "#000000cc"/"#000000aa" tooltip chips (leftover
// old-dark-casino look, flagged during #22's audit) to a warm-cream chip
// matching Theme.panel, so nothing still reads as "casino at night" against
// the new bright backdrop (STYLE_GUIDE direction notes 1 & 7).
const CHIP_BG = "#fdf3e1e6"; // Theme.panel, ~90% opaque - prompt/HUD/toast
const CHIP_BG_SOFT = "#fdf3e1cc"; // Theme.panel, ~80% opaque - per-station labels (many on screen at once)

interface Interactable {
  sprite: Phaser.Physics.Arcade.Sprite;
  prompt: string;
  radius: number;
  onInteract: () => void;
}

interface OverworldSceneData {
  /** Set true only right after a brand-new signup - see StartMenuScene's doc comment and ui/TutorialGuide.ts for the full one-shot-by-construction explanation. */
  startTutorial?: boolean;
}

/**
 * One piece of walkable-up-to furniture that hands off to a game scene.
 * Declarative so the floor's game count can grow by appending to
 * GAME_STATIONS below instead of hand-editing scattered create() calls -
 * keeps concurrent edits (e.g. "games" adding Keno/Wheel/Hi-Lo) from
 * clobbering unrelated layout code. Coordinate placement via SendMessage
 * before adding entries here so spacing stays verified/non-overlapping.
 */
interface FurnitureStationDef {
  col: number;
  row: number;
  textureKey: string;
  sizeFracW: number;
  sizeFracH: number;
  offsetFracX: number;
  offsetFracY: number;
  label: string;
  prompt: string;
  sceneKey: string;
}

/** Every playable game's floor furniture. Grouped by zone/comment for readability. */
const GAME_STATIONS: FurnitureStationDef[] = [
  // Slots - lined along the right wall, any of them opens the same game
  ...([
    [74, 8],
    [74, 18],
    [74, 28],
    [74, 38],
    [74, 48]
  ] as Array<[number, number]>).map(([col, row]) => ({
    col,
    row,
    textureKey: "slot_machine",
    sizeFracW: 0.7,
    sizeFracH: 0.5,
    offsetFracX: 0.15,
    offsetFracY: 0.45,
    label: "Slots",
    prompt: "Press E to play Slots",
    sceneKey: "SlotsScene"
  })),

  // Blackjack tables - left side, spread top and bottom
  ...([
    [16, 14],
    [16, 42]
  ] as Array<[number, number]>).map(([col, row]) => ({
    col,
    row,
    textureKey: "blackjack_table",
    sizeFracW: 0.8,
    sizeFracH: 0.4,
    offsetFracX: 0.1,
    offsetFracY: 0.55,
    label: "Blackjack",
    prompt: "Press E to play Blackjack",
    sceneKey: "BlackjackScene"
  })),

  // Roulette tables - right-center, spread top and bottom
  ...([
    [60, 14],
    [60, 42]
  ] as Array<[number, number]>).map(([col, row]) => ({
    col,
    row,
    textureKey: "roulette_table",
    sizeFracW: 0.8,
    sizeFracH: 0.5,
    offsetFracX: 0.1,
    offsetFracY: 0.4,
    label: "Roulette",
    prompt: "Press E to play Roulette",
    sceneKey: "RouletteScene"
  })),

  // Coin Flip machines - far left and far right of the middle band
  ...([
    [20, 28],
    [60, 28]
  ] as Array<[number, number]>).map(([col, row]) => ({
    col,
    row,
    textureKey: "coinflip_machine",
    sizeFracW: 0.7,
    sizeFracH: 0.5,
    offsetFracX: 0.15,
    offsetFracY: 0.45,
    label: "Coin Flip",
    prompt: "Press E to play Coin Flip",
    sceneKey: "CoinFlipScene"
  })),

  // Dragon Tower pedestals - top-center, either side of the middle
  ...([
    [36, 10],
    [44, 10]
  ] as Array<[number, number]>).map(([col, row]) => ({
    col,
    row,
    textureKey: "dragon_pedestal",
    sizeFracW: 0.75,
    sizeFracH: 0.5,
    offsetFracX: 0.125,
    offsetFracY: 0.4,
    label: "Dragon Tower",
    prompt: "Press E to play Dragon Tower",
    sceneKey: "DragonTowerScene"
  })),

  // Mines cabinet - upper-left open gap
  {
    col: 28,
    row: 20,
    textureKey: "mines_machine",
    sizeFracW: 0.7,
    sizeFracH: 0.5,
    offsetFracX: 0.15,
    offsetFracY: 0.45,
    label: "Mines",
    prompt: "Press E to play Mines",
    sceneKey: "MinesScene"
  },

  // Dice table - upper-right open gap
  {
    col: 52,
    row: 20,
    textureKey: "dice_table",
    sizeFracW: 0.7,
    sizeFracH: 0.5,
    offsetFracX: 0.15,
    offsetFracY: 0.45,
    label: "Dice",
    prompt: "Press E to play Dice",
    sceneKey: "DiceScene"
  },

  // Limbo cabinet - lower-left open gap
  {
    col: 28,
    row: 36,
    textureKey: "limbo_machine",
    sizeFracW: 0.7,
    sizeFracH: 0.5,
    offsetFracX: 0.15,
    offsetFracY: 0.45,
    label: "Limbo",
    prompt: "Press E to play Limbo",
    sceneKey: "LimboScene"
  },

  // Plinko board - lower-right open gap
  {
    col: 52,
    row: 36,
    textureKey: "plinko_board",
    sizeFracW: 0.75,
    sizeFracH: 0.4,
    offsetFracX: 0.125,
    offsetFracY: 0.55,
    label: "Plinko",
    prompt: "Press E to play Plinko",
    sceneKey: "PlinkoScene"
  },

  // Keno cabinet - left strip (was RESERVED_STATIONS, now claimed by "games")
  {
    col: 10,
    row: 20,
    textureKey: "keno_machine",
    sizeFracW: 0.7,
    sizeFracH: 0.5,
    offsetFracX: 0.15,
    offsetFracY: 0.45,
    label: "Keno",
    prompt: "Press E to play Keno",
    sceneKey: "KenoScene"
  },

  // Wheel cabinet - left strip (was RESERVED_STATIONS, now claimed by "games")
  {
    col: 10,
    row: 36,
    textureKey: "wheel_machine",
    sizeFracW: 0.7,
    sizeFracH: 0.5,
    offsetFracX: 0.15,
    offsetFracY: 0.45,
    label: "Wheel",
    prompt: "Press E to play Wheel",
    sceneKey: "WheelScene"
  },

  // Hi-Lo table - right corridor midpoint (was RESERVED_STATIONS, now claimed by "games")
  {
    col: 67,
    row: 28,
    textureKey: "hilo_table",
    sizeFracW: 0.7,
    sizeFracH: 0.5,
    offsetFracX: 0.15,
    offsetFracY: 0.45,
    label: "Hi-Lo",
    prompt: "Press E to play Hi-Lo",
    sceneKey: "HiLoScene"
  },

  // Baccarat table - top of the left strip, above Keno (proposed to floor via SendMessage)
  {
    col: 10,
    row: 8,
    textureKey: "baccarat_table",
    sizeFracW: 0.7,
    sizeFracH: 0.5,
    offsetFracX: 0.15,
    offsetFracY: 0.45,
    label: "Baccarat",
    prompt: "Press E to play Baccarat",
    sceneKey: "BaccaratScene"
  },

  // Video Poker cabinet - bottom of the right corridor, below Hi-Lo (floor pre-approved)
  {
    col: 67,
    row: 48,
    textureKey: "video_poker_machine",
    sizeFracW: 0.7,
    sizeFracH: 0.5,
    offsetFracX: 0.15,
    offsetFracY: 0.45,
    label: "Video Poker",
    prompt: "Press E to play Video Poker",
    sceneKey: "VideoPokerScene"
  }
];

/**
 * Reserved spots for the next wave of Stake Originals ("games" teammate is
 * adding Keno/Wheel/Hi-Lo). Positions verified against every entry in
 * GAME_STATIONS so their interaction radii (see registerStation/
 * INTERACT_PADDING) don't overlap. Each renders as a "coming soon"
 * signpost (see addComingSoonStation) until "games" claims one - at that
 * point replace the matching entry here with a real GAME_STATIONS entry
 * (their real texture/label/sceneKey) rather than adding a brand new spot,
 * so the verified spacing is preserved. Coordinate via SendMessage first.
 */
const RESERVED_STATIONS: Array<{ col: number; row: number; label: string }> = [
  // Keno, Wheel, and Hi-Lo have all landed as real GAME_STATIONS entries
  // now (see above) - nothing left reserved. Leaving this array (and the
  // loop that consumes it in create()) in place rather than ripping it out,
  // since it's a harmless no-op empty list and future games can reuse the
  // same "reserve a spot, then claim it" pattern.
];

export class OverworldScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private promptText!: Phaser.GameObjects.Text;
  private hudText!: Phaser.GameObjects.Text;
  private panelOpen = false;
  private interactables: Interactable[] = [];
  private activeInteractable: Interactable | null = null;

  constructor() {
    super("OverworldScene");
  }

  create(data?: OverworldSceneData) {
    this.buildFloor();
    this.buildDecorations();

    // Player - spawn back where they were before entering a game, if known;
    // otherwise start near the bottom entrance/exit
    const spawn = gameState.lastPlayerPosition ?? { x: 40 * TILE, y: 46 * TILE };
    const equippedTexture = this.getSkinDef(gameState.currentSkin).textureKey;
    this.player = this.physics.add.sprite(spawn.x, spawn.y, equippedTexture, 1);
    this.player.setCollideWorldBounds(true);
    this.player.setDamping(true);
    this.player.setDrag(0.85);
    this.applyPlayerBody();
    this.applyPlayerScale();

    // NPC - the "chip person", now in the center of the floor. Always the
    // new Kenney rig (npc_sheet never changes texture), so a fixed scale is
    // safe here - see applyPlayerScale's comment for why the player can't
    // use a fixed value.
    const npc = this.physics.add.staticSprite(40 * TILE, 28 * TILE, "npc_sheet", 1).setScale(2);
    // Static bodies don't auto-resync to a post-creation setScale (see the
    // refreshBody() calls in addFurnitureStation/registerReservedStation
    // below) - without this the collider still uses the pre-scale 16x16
    // box while the sprite renders at 32x32.
    npc.refreshBody();
    this.physics.add.collider(this.player, npc);
    this.registerStation(npc, "Chip Attendant", "Press E to talk to the Chip Attendant", () =>
      this.openChipPanel()
    );

    // Exit - bottom-middle wall, sends you back to the title screen
    const exitDoor = this.physics.add.staticSprite(40 * TILE, 51 * TILE, "exit_door");
    this.physics.add.collider(this.player, exitDoor);
    this.registerStation(exitDoor, "Exit", "Press E to exit to the title screen", () => {
      gameState.lastPlayerPosition = { x: this.player.x, y: this.player.y };
      this.savePositionRemote(this.player.x, this.player.y);
      this.scene.start("StartMenuScene");
    });

    // Skin Attendant - buy new looks for your character
    const skinAttendant = this.physics.add.staticSprite(40 * TILE, 18 * TILE, "skin_000", 1);
    this.physics.add.collider(this.player, skinAttendant);
    this.registerStation(
      skinAttendant,
      "Skin Attendant",
      "Press E to browse skins",
      () => this.openSkinPanel("shop")
    );

    // Ambient bystanders - purely decorative "social hub" flavor (STYLE_GUIDE
    // direction note 4: "nature woven into a social hub, not wilderness"),
    // putting the 3 previously-unused Kenney character variants to work
    // (char_b_brick/char_d_hardhat/char_f_dark - see BootScene.ts preload).
    // No registerStation call - these aren't interactable, just people
    // milling around the plaza. See addAmbientNpc's doc comment for the
    // idle-frame convention.
    this.addAmbientNpc(40, 31, "npc2_sheet", 2); // between the two benches (37,31)/(43,31), facing up toward the Chip Attendant
    this.addAmbientNpc(35, 20, "npc3_sheet", 2); // browsing near the market stall (35,17)/Skin Attendant, facing up
    this.addAmbientNpc(37, 47, "npc4_sheet", 1); // strolling the lamp-post path toward the exit, facing down

    // Every playable game's furniture - declarative (see GAME_STATIONS
    // above) so new entries can be appended there instead of adding more
    // hand-written blocks here.
    for (const station of GAME_STATIONS) {
      this.addFurnitureStation(
        station.col,
        station.row,
        station.textureKey,
        station.sizeFracW,
        station.sizeFracH,
        station.offsetFracX,
        station.offsetFracY,
        station.label,
        station.prompt,
        station.sceneKey
      );
    }

    // Reserved spots for the next wave of games ("games" teammate is
    // building Keno/Wheel/Hi-Lo) - see RESERVED_STATIONS above for the
    // agreed coordinates. Shows a walkable-up-to "coming soon" signpost
    // until each scene lands; replace the matching entry with a real
    // GAME_STATIONS entry (real texture/sceneKey) once ready instead of
    // picking a new spot, so the verified spacing holds.
    for (const spot of RESERVED_STATIONS) {
      this.addComingSoonStation(spot.col, spot.row, spot.label);
    }

    this.buildZoneSigns();

    this.buildWalls();

    this.cameras.main.setBounds(0, 0, MAP_COLS * TILE, MAP_ROWS * TILE);
    this.physics.world.setBounds(0, 0, MAP_COLS * TILE, MAP_ROWS * TILE);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    // NOTE: deliberately NOT zooming this camera. Phaser zoom scales the
    // position of every object relative to the camera's center - including
    // scrollFactor(0) "screen-fixed" UI. Only elements sitting exactly at
    // the canvas center (400,300) happened to look right; anything off-
    // center (like a corner button) silently rendered off-screen. The map
    // is large enough (80x56 tiles vs an 800x600 viewport) that exploring
    // it still requires walking around even without an extra zoom.

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.interactKey = this.input.keyboard!.addKey("E");

    // UI (fixed to camera)
    this.promptText = this.add
      .text(400, 550, "", {
        fontSize: "16px",
        color: Theme.textPrimary,
        backgroundColor: CHIP_BG,
        padding: { x: 10, y: 6 }
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);

    this.hudText = this.add
      .text(0, 0, "", {
        fontSize: "13px",
        color: Theme.textGold,
        backgroundColor: CHIP_BG,
        padding: { x: 8, y: 4 }
      })
      .setOrigin(0.5, 1)
      .setDepth(90);

    // "Clothes" corner button - always available, opens the wardrobe
    // (switch between skins you already own)
    makeButton(this, 730, 30, 130, 40, "👕 Clothes", Theme.neutral, Theme.neutralHover, () =>
      this.openSkinPanel("wardrobe")
    ).container.setScrollFactor(0).setDepth(150);

    this.updateHud();

    // Onboarding tutorial - only right after a brand-new signup (see
    // OverworldSceneData's doc comment). Runs last, after every station/
    // camera/HUD setup above so its world coordinates (Chip Attendant/Dice/
    // Skin Attendant) are all valid.
    if (data?.startTutorial) {
      this.startOnboardingTutorial();
    }
  }

  /**
   * Guided tour (ui/TutorialGuide.ts) - a mascot "voice box" explains the
   * shuffle-cup bonus the player just received, introduces the character +
   * movement, then pans the camera to the Chip Attendant, a representative
   * game (Dice - already this codebase's other "reference" pick, see
   * games/dice.ts's own doc comments), and the Skin Attendant in turn.
   * World coordinates match each station's real placement above (NPC at
   * 40,28 / Dice at 52,20 / Skin Attendant at 40,18, all in tiles) - if
   * those ever move, update these to match.
   */
  private startOnboardingTutorial() {
    const steps: TutorialStep[] = [
      {
        title: "Welcome to Gold Coast!",
        text: "You just played the Shuffle Cups for your starting Gold Coins - shuffle, pick a cup, and reveal your prize. You'll see that again any time you get a bonus."
      },
      {
        title: "This Is You",
        text: "This is your character! Use WASD or the arrow keys to walk around the casino floor - try it now.",
        // Every other step keeps movement locked (the camera's about to
        // pan somewhere and the player shouldn't wander off mid-tour), but
        // THIS step's whole point is inviting the player to move - locking
        // it here would mean pressing WASD as instructed does nothing,
        // which reads as the tutorial being frozen (confirmed via live
        // testing). Camera resumes following the player for this one step.
        allowMovement: true
      },
      {
        title: "Chip Attendant",
        text: "Visit the Chip Attendant any time for a free Gold Coin claim. It's on a short cooldown, so check back often!",
        panTo: { x: 40 * TILE, y: 28 * TILE }
      },
      {
        title: "Play a Game",
        text: "Walk up to any table or machine - like Dice here - and press E to play. Place a bet, then win or lose Gold Coins on the result.",
        panTo: { x: 52 * TILE, y: 20 * TILE }
      },
      {
        title: "Skin Attendant",
        text: "The Skin Attendant sells new looks for your character with Gold Coins. Buy one and you'll be wearing it immediately!",
        panTo: { x: 40 * TILE, y: 18 * TILE }
      }
    ];

    runOnboardingTutorial(this, steps, {
      onLockMovement: (locked) => {
        this.panelOpen = locked;
        // handleProximity() (which normally owns promptText's visibility)
        // never runs while panelOpen is true, so if the player happened to
        // be standing near a station the instant the tutorial started, its
        // "Press E to..." bubble would otherwise stay frozen on screen for
        // the whole tutorial, sitting right inside the dialogue panel's own
        // footprint (both around y=520-550) and showing through faintly
        // since the panel isn't fully opaque - exactly the "text overlay"
        // reported. Explicitly clear it going in; handleProximity()
        // naturally re-establishes the correct state on its own once
        // movement unlocks, no explicit restore needed here.
        if (locked) {
          this.activeInteractable = null;
          this.promptText.setVisible(false);
        }
      },
      onResumeFollow: () => {
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
      },
      onComplete: () => {
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
      }
    });
  }

  update() {
    if (this.panelOpen) {
      this.player.setVelocity(0, 0);
      return;
    }

    this.handleMovement();
    this.handleProximity();
    this.handleInteraction();

    // keep the coin tracker hovering just above the player's head
    this.hudText.setPosition(this.player.x, this.player.y - this.player.displayHeight / 2 - 6);
  }

  private lastDir: "down" | "left" | "right" | "up" = "down";

  private handleMovement() {
    const left = this.cursors.left?.isDown || this.wasd.A.isDown;
    const right = this.cursors.right?.isDown || this.wasd.D.isDown;
    const up = this.cursors.up?.isDown || this.wasd.W.isDown;
    const down = this.cursors.down?.isDown || this.wasd.S.isDown;

    const vel = new Phaser.Math.Vector2(0, 0);
    if (left) vel.x -= 1;
    if (right) vel.x += 1;
    if (up) vel.y -= 1;
    if (down) vel.y += 1;
    vel.normalize().scale(PLAYER_SPEED);
    this.player.setVelocity(vel.x, vel.y);

    const moving = vel.x !== 0 || vel.y !== 0;
    if (moving) {
      // pick the dominant axis so diagonal movement still reads as one direction
      if (Math.abs(vel.x) > Math.abs(vel.y)) {
        this.lastDir = vel.x < 0 ? "left" : "right";
      } else {
        this.lastDir = vel.y < 0 ? "up" : "down";
      }
      this.player.play(`${gameState.currentSkin}_walk_${this.lastDir}`, true);
    } else {
      this.player.stop();
      this.player.setFrame(this.idleFrameForDir(this.lastDir));
    }
  }

  /**
   * Task #24 (Kenney reskin) left two different character rigs in play:
   * the free "Classic" skin is the new Kenney sheet (16x16, 4 cols
   * [left,down,up,right] x 3 rows - see BootScene's createKenneyWalkAnims/
   * DIRECTION_FRAMES), while every purchased skin is still the old
   * Jephed-pack rig (21x32, 3 cols x 4 rows [down,left,right,up] - see
   * createLegacySkinWalkAnims). Walking animations already resolve
   * correctly either way since they're looked up by name
   * (`${skin}_walk_${dir}`), but the idle pose sets a raw frame index, so
   * it has to know which rig is currently equipped. Discriminated by frame
   * height (16 vs 32) rather than skin id, so it keeps working if more
   * skins land on either rig later.
   */
  private idleFrameForDir(dir: "down" | "left" | "right" | "up"): number {
    if (this.player.height <= 16) {
      // New Kenney rig: frame = row*4 + col, walk rows are [start,mid,end]
      // 4 apart per direction (DIRECTION_FRAMES in BootScene) - mid frame
      // is col + 4.
      const col = { left: 0, down: 1, up: 2, right: 3 } as const;
      return col[dir] + 4;
    }
    // Old Jephed rig: 3 cols/row, frame = row*3 + col; middle frame (index 1)
    // of the current direction's row is the idle pose.
    const row = { down: 0, left: 1, right: 2, up: 3 } as const;
    return row[dir] * 3 + 1;
  }

  /**
   * Sizes/positions the player's physics body as a small "feet" footprint
   * (not the full sprite) proportional to whichever texture is currently
   * equipped - same width/height-fraction pattern addFurnitureStation uses
   * for furniture. Needed (not just a fixed pixel size) because, per #24,
   * SKIN_CATALOG now mixes two rig sizes (16x16 Kenney "Classic" vs 21x32
   * legacy purchased skins) - fractions computed from the original 21x32
   * tuning (14x10 body, 3.5/20 offset) reproduce that exact box for legacy
   * skins and scale proportionally for the new 16x16 rig. Call again after
   * switching skins (see openSkinPanel's "Wear" handler).
   */
  private applyPlayerBody() {
    const fracW = 14 / 21;
    const fracH = 10 / 32;
    const fracOffX = 3.5 / 21;
    const fracOffY = 20 / 32;
    this.player.setSize(this.player.width * fracW, this.player.height * fracH);
    this.player.setOffset(this.player.width * fracOffX, this.player.height * fracOffY);
  }

  /**
   * Task #24 follow-up (flagged by "environment"/#23): the new Kenney rig's
   * native frame is 16x16, vs. the legacy Jephed rig's 21x32 - rendered at
   * 1:1 scale (as it always was, and still is for legacy skins) the new
   * "Classic" character reads about half as tall as before, next to the
   * new 16x16 floor tiles and the untouched 48x64-cabinet-scale furniture.
   * A single fixed setScale can't be applied unconditionally though: it
   * would also double-size any equipped legacy 21x32 skin, which
   * applyPlayerBody's whole point is to keep looking exactly as it did
   * pre-#24. So this branches the same way applyPlayerBody/idleFrameForDir
   * do - by native frame height, not skin id - and only scales up the new
   * 16x16 rig. Call alongside applyPlayerBody(), same two call sites
   * (spawn + the "Wear" handler).
   */
  private applyPlayerScale() {
    this.player.setScale(this.player.height <= 16 ? 2 : 1);
  }

  /**
   * A purely decorative background character - not registered as an
   * Interactable (no "Press E" prompt/name label), just visual "social hub"
   * flavor. Same staticSprite + setScale(2) + refreshBody() pattern as the
   * Chip Attendant NPC above (refreshBody is required, not optional -
   * static bodies don't auto-resync to a post-creation setScale, so
   * skipping it leaves the pre-scale 16x16 collider under a 32x32 sprite).
   * Still collides with the player so it reads as a person standing there
   * rather than a background decal.
   *
   * idleFrame follows the same convention as the Chip Attendant's own
   * static frame (npc_sheet, frame 1): the first frame of a direction's
   * walk cycle in createKenneyWalkAnims' DIRECTION_FRAMES, i.e. the column
   * index of that direction - left=0, down=1, up=2, right=3.
   */
  private addAmbientNpc(col: number, row: number, sheetKey: string, idleFrame: number) {
    const npc = this.physics.add
      .staticSprite(col * TILE, row * TILE, sheetKey, idleFrame)
      .setScale(2);
    npc.refreshBody();
    this.physics.add.collider(this.player, npc);
  }

  private getSkinDef(id: string): SkinDef {
    const catalog = listSkins();
    return catalog.find((s) => s.id === id) ?? catalog[0];
  }

  private handleProximity() {
    this.activeInteractable = null;
    let closestNormalizedDist = 1; // fraction of that station's own radius

    for (const item of this.interactables) {
      const dist = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        item.sprite.x,
        item.sprite.y
      );
      const normalized = dist / item.radius;
      if (normalized < 1 && normalized < closestNormalizedDist) {
        closestNormalizedDist = normalized;
        this.activeInteractable = item;
      }
    }

    if (this.activeInteractable) {
      this.promptText.setText(this.activeInteractable.prompt).setVisible(true);
    } else {
      this.promptText.setVisible(false);
    }
  }

  private handleInteraction() {
    if (!Phaser.Input.Keyboard.JustDown(this.interactKey)) return;
    this.activeInteractable?.onInteract();
  }

  /**
   * Registers a walkable-up-to station: wires its interaction radius to its
   * own on-screen size (so big furniture like the blackjack table doesn't
   * require standing on its exact center), and adds a floating name label
   * above it so players can tell what it is before walking over.
   */
  private registerStation(
    sprite: Phaser.Physics.Arcade.Sprite,
    label: string,
    prompt: string,
    onInteract: () => void
  ) {
    const radius = Math.max(sprite.displayWidth, sprite.displayHeight) / 2 + INTERACT_PADDING;

    this.interactables.push({ sprite, prompt, radius, onInteract });

    this.add
      .text(sprite.x, sprite.y - sprite.displayHeight / 2 - 8, label, {
        fontSize: "12px",
        color: Theme.textPrimary,
        backgroundColor: CHIP_BG_SOFT,
        padding: { x: 6, y: 3 }
      })
      .setOrigin(0.5, 1);
  }

  /**
   * Places one piece of interactive furniture (a slot machine, table, etc.)
   * at a tile position, sizes its collision box from the given fractions of
   * its own texture, and registers it as a walkable-up-to station that
   * hands off to the given game scene.
   */
  private addFurnitureStation(
    col: number,
    row: number,
    textureKey: string,
    sizeFracW: number,
    sizeFracH: number,
    offsetFracX: number,
    offsetFracY: number,
    label: string,
    prompt: string,
    sceneKey: string
  ) {
    const sprite = this.physics.add.staticSprite(col * TILE, row * TILE, textureKey);
    sprite.setSize(sprite.width * sizeFracW, sprite.height * sizeFracH);
    sprite.setOffset(sprite.width * offsetFracX, sprite.height * offsetFracY);
    sprite.refreshBody();
    this.physics.add.collider(this.player, sprite);
    this.registerStation(sprite, label, prompt, () => this.goToGame(sceneKey));
  }

  /** Remembers where the player was standing, then hands off to a game scene. */
  private goToGame(sceneKey: string) {
    gameState.lastPlayerPosition = { x: this.player.x, y: this.player.y };
    this.savePositionRemote(this.player.x, this.player.y);
    this.scene.start(sceneKey);
  }

  /**
   * Task #37: POST /position, matching the pre-existing lastPlayerPosition
   * save/restore behavior but now persisted server-side instead of only in
   * this session's local `gameState.lastPlayerPosition`. Fire-and-forget on
   * purpose - a scene transition should never block (or fail) on this
   * call; a dropped save just means the next login restores an older spot,
   * which is the same failure mode localStorage had.
   */
  private savePositionRemote(x: number, y: number) {
    api.savePosition(x, y).catch(() => {
      // Best-effort - see doc comment above.
    });
  }

  /**
   * Places a walkable-up-to "coming soon" signpost for a game whose scene
   * doesn't exist yet (see RESERVED_STATIONS). Shows a small info panel on
   * interact instead of transitioning anywhere.
   */
  private addComingSoonStation(col: number, row: number, label: string) {
    const sprite = this.physics.add.staticSprite(col * TILE, row * TILE, "coming_soon_sign");
    sprite.setSize(sprite.width * 0.6, sprite.height * 0.35);
    sprite.setOffset(sprite.width * 0.2, sprite.height * 0.55);
    sprite.refreshBody();
    this.physics.add.collider(this.player, sprite);
    this.registerStation(sprite, label, `${label} - coming soon!`, () =>
      this.showComingSoonPanel(label)
    );
  }

  private showComingSoonPanel(label: string) {
    this.panelOpen = true;
    const panel = makePanel(this, 400, 300, 380, 170, 200).setScrollFactor(0);
    const title = this.add
      .text(400, 275, `🚧 ${label}`, {
        fontSize: "19px",
        color: Theme.textGold,
        fontStyle: "bold"
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    const sub = this.add
      .text(400, 305, "This game is on its way. Check back soon!", {
        fontSize: "13px",
        color: Theme.textMuted
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    const okBtn = makeButton(this, 400, 350, 120, 40, "OK", Theme.neutral, Theme.neutralHover, () => {
      panel.destroy();
      title.destroy();
      sub.destroy();
      okBtn.destroy();
      this.panelOpen = false;
    });
    okBtn.container.setScrollFactor(0).setDepth(201);
  }

  /**
   * Small floating category banner(s) so the floor reads as organized
   * zones rather than a flat list of stations as the game count grows.
   * Placed beside a cluster (not above it) so it never stacks with the
   * per-station name labels from registerStation.
   */
  private buildZoneSigns() {
    this.addZoneSign(68 * TILE, 8 * TILE, "🎰 SLOTS");
  }

  private addZoneSign(x: number, y: number, text: string) {
    this.add
      .text(x, y, text, {
        fontSize: "15px",
        color: Theme.textGold,
        fontStyle: "bold",
        backgroundColor: CHIP_BG_SOFT,
        padding: { x: 8, y: 4 }
      })
      .setOrigin(0.5);
  }

  private openChipPanel() {
    this.panelOpen = true;
    this.showConfirmPanel();
  }

  private showConfirmPanel() {
    const panel = makePanel(this, 400, 300, 420, 200, 200).setScrollFactor(0);

    const title = this.add
      .text(400, 260, "🪙 Get More Gold Coins", {
        fontSize: "19px",
        color: Theme.textGold,
        fontStyle: "bold"
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    const subtitle = this.add
      .text(400, 288, "Claim 1000 Gold Coins + 1 Stake Coin?", {
        fontSize: "14px",
        color: Theme.textMuted
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    const yesBtn = this.createAttendantClaimButton(340, 335, 120, 46, "Yes", () => {
      cleanup();
      this.runAttendantClaimShuffle();
    });
    yesBtn.container.setScrollFactor(0).setDepth(201);

    const noBtn = makeButton(this, 460, 335, 120, 46, "No", Theme.neutral, Theme.neutralHover, () => {
      cleanup();
      this.panelOpen = false;
    });
    noBtn.container.setScrollFactor(0).setDepth(201);

    const cleanup = () => {
      panel.destroy();
      title.destroy();
      subtitle.destroy();
      yesBtn.destroy();
      noBtn.destroy();
    };
  }

  /**
   * Creates a button wired to the attendant claim (#18/#19, #29). While the
   * 30s cooldown is active it auto-disables itself and shows a live
   * "Available in Ns" countdown instead of `readyLabel`, ticking off a
   * Phaser timer that's torn down when the button is destroyed - so
   * cooldown state (persisted in GameState/localStorage, #19) is always
   * reflected accurately even across a panel reopen or a reload.
   *
   * #29: the actual grant no longer happens on click - clicking now starts
   * the shuffle-cup mini-game, and the grant (with whatever multiplier the
   * cup resolves to) happens afterward. The cooldown is still checked here,
   * before calling `onConfirmed`, so it still gates *starting* the shuffle,
   * not just the eventual grant - a stale/raced button click just resyncs
   * the countdown instead of burning through the whole animation only to
   * fail at the end.
   */
  private createAttendantClaimButton(
    x: number,
    y: number,
    w: number,
    h: number,
    readyLabel: string,
    onConfirmed: () => void
  ): UIButton {
    const btn = makeButton(this, x, y, w, h, readyLabel, Theme.accent, Theme.accentHover, () => {
      if (gameState.attendantClaimCooldownRemainingMs > 0) {
        refreshCooldownLabel();
        return;
      }
      onConfirmed();
    });

    const refreshCooldownLabel = () => {
      const remainingMs = gameState.attendantClaimCooldownRemainingMs;
      if (remainingMs > 0) {
        btn.setEnabled(false);
        btn.setLabel(`Available in ${Math.ceil(remainingMs / 1000)}s`);
      } else {
        btn.setEnabled(true);
        btn.setLabel(readyLabel);
      }
    };
    refreshCooldownLabel();

    const ticker = this.time.addEvent({ delay: 250, loop: true, callback: refreshCooldownLabel });
    const baseDestroy = btn.destroy;
    btn.destroy = () => {
      ticker.remove(false);
      baseDestroy();
    };

    return btn;
  }

  /**
   * Task #37: calls POST /claim-bonus FIRST - the server resolves the
   * cooldown check and the GC multiplier atomically and authoritatively
   * (see server/src/routes/economy.ts; it never trusts a client-picked
   * multiplier) - THEN plays the shuffle-cup mini-game (#28) reconciled to
   * whatever the server already decided (`forcedMultiplier` - see
   * ShuffleCupReveal.ts). The grant has already happened by the time the
   * animation runs; the animation is purely presentational. A COOLDOWN
   * response (createAttendantClaimButton's pre-check is optimistic/local
   * only) skips the animation entirely and just surfaces the real
   * remaining time.
   */
  private async runAttendantClaimShuffle() {
    let result: Awaited<ReturnType<typeof api.claimBonus>>;
    try {
      result = await api.claimBonus();
    } catch (err) {
      this.panelOpen = false;
      this.updateHud();
      if (err instanceof ApiError && err.code === "COOLDOWN") {
        const remainingMs = typeof err.body === "object" && err.body && "remainingMs" in err.body
          ? Number((err.body as { remainingMs: unknown }).remainingMs)
          : 0;
        this.showToast(`Try again in ${Math.ceil(remainingMs / 1000)}s.`, Theme.textDanger);
      } else if (err instanceof ApiError) {
        this.showToast(err.message, Theme.textDanger);
      } else if (err instanceof NetworkError) {
        this.showToast(err.message, Theme.textDanger);
      } else {
        this.showToast("Something went wrong - try again.", Theme.textDanger);
      }
      return;
    }

    const panel = makePanel(this, 400, 300, 420, 260, 200).setScrollFactor(0);
    const title = this.add
      .text(400, 195, "🪙 Chip Attendant's Shuffle", {
        fontSize: "17px",
        color: Theme.textGold,
        fontStyle: "bold"
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    const handle = createShuffleCupReveal(
      this,
      400,
      302,
      GC_MULTIPLIER_BASE,
      () => {
        handle.destroy();
        panel.destroy();
        title.destroy();
        gameState.hydrateFromServer(result.user);
        this.runTripleChanceOffer(result.granted.gcAmount).then((outcome) => {
          this.showClaimResultFromServer(result.granted.gcAmount, result.granted.scAmount, outcome);
        });
      },
      result.granted.gcMultiplier
    );
    handle.container.setScrollFactor(0).setDepth(201);
    handle.start();
  }

  /**
   * #46: offers the "Triple Chance" bonus round on the attendant claim's GC
   * leg, right after the shuffle-cup reveal finishes and before showing the
   * claim result panel. See ui/TripleChanceOffer.ts for the full
   * offer/play/chain mechanic.
   *
   * #48: passes `onBalanceChange` so the corner HUD (`this.hudText`)
   * refreshes after each round of the chain resolves, not just once the
   * whole sequence ends - gameState itself was always correct at every
   * step (hydrateFromServer runs inside TripleChanceOffer.ts's playRound
   * regardless), this was purely the visible counter lagging behind it.
   */
  private runTripleChanceOffer(startingAmount: number): Promise<TripleChanceOutcome> {
    return new Promise((resolve) => {
      offerTripleChance(this, 400, 300, startingAmount, resolve, () => this.updateHud());
    });
  }

  /** Shows the result panel for a successful (server-confirmed) attendant claim - `tripleChance` (#46) reflects whether/how the GC leg changed after the bonus round, if the player played it. */
  private showClaimResultFromServer(gcGained: number, scGained: number, tripleChance?: TripleChanceOutcome) {
    this.updateHud();
    let gcMessage = `+${gcGained} Gold Coins!`;
    if (tripleChance?.played) {
      gcMessage =
        tripleChance.finalAmount > 0
          ? `Tripled to +${tripleChance.finalAmount} Gold Coins!`
          : `Lost the ${gcGained} Gold Coins to Triple Chance!`;
    }
    this.showResultPanel(
      gcMessage,
      scGained > 0 ? `+${scGained} Stake Coin${scGained === 1 ? "" : "s"}!` : undefined
    );
  }

  private showResultPanel(message: string, subMessage?: string) {
    const panel = makePanel(this, 400, 300, 420, 220, 200).setScrollFactor(0);

    const title = this.add
      .text(400, subMessage ? 245 : 255, message, {
        fontSize: "22px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    const subtitle = subMessage
      ? this.add
          .text(400, 270, subMessage, {
            fontSize: "14px",
            color: Theme.textGold,
            fontStyle: "bold"
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(201)
      : null;

    const balance = this.add
      .text(400, subMessage ? 296 : 288, `GC: ${gameState.goldCoins}   |   SC: ${gameState.stakeCoins}`, {
        fontSize: "14px",
        color: Theme.textMuted
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    const cleanup = () => {
      panel.destroy();
      title.destroy();
      subtitle?.destroy();
      balance.destroy();
      againBtn.destroy();
      doneBtn.destroy();
    };

    // Claim again right from here - no need to close and re-open the panel.
    // Same cooldown-aware button as the initial confirm panel.
    const againBtn = this.createAttendantClaimButton(340, 340, 140, 44, "Claim Again", () => {
      cleanup();
      this.runAttendantClaimShuffle();
    });
    againBtn.container.setScrollFactor(0).setDepth(201);

    const doneBtn = makeButton(this, 470, 340, 100, 44, "Done", Theme.neutral, Theme.neutralHover, () => {
      cleanup();
      this.panelOpen = false;
      this.updateHud();
    });
    doneBtn.container.setScrollFactor(0).setDepth(201);
  }

  private updateHud() {
    this.hudText.setText(`🪙 ${gameState.goldCoins}   💰 ${gameState.stakeCoins}`);
  }

  /** Turns a /skins/buy or /skins/equip failure into a short user-facing toast message. */
  private describeSkinError(err: unknown, action: string): string {
    if (err instanceof ApiError) {
      switch (err.code) {
        case "INSUFFICIENT_GC":
          return "Not enough Gold Coins.";
        case "ALREADY_OWNED":
          return "You already own that.";
        case "NOT_FOUND":
          return "That skin doesn't exist - try again.";
        default:
          return err.message;
      }
    }
    if (err instanceof NetworkError) return err.message;
    return `Couldn't ${action} - try again.`;
  }

  private activeToast?: Phaser.GameObjects.Text;

  /**
   * Brief fading confirmation/error message, positioned above the skin
   * shop panel but generic enough for any overworld panel flow (also used
   * by the attendant claim's rare cooldown-race fallback, #29).
   */
  private showToast(message: string, color: string) {
    this.activeToast?.destroy();
    const toast = this.add
      .text(400, 145, message, {
        fontSize: "13px",
        color,
        fontStyle: "bold",
        backgroundColor: CHIP_BG,
        padding: { x: 10, y: 5 }
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(210)
      .setAlpha(0);
    this.activeToast = toast;

    this.tweens.add({
      targets: toast,
      alpha: 1,
      duration: 120,
      onComplete: () => {
        this.time.delayedCall(900, () => {
          this.tweens.add({
            targets: toast,
            alpha: 0,
            duration: 300,
            onComplete: () => {
              if (this.activeToast === toast) this.activeToast = undefined;
              toast.destroy();
            }
          });
        });
      }
    });
  }

  /**
   * Shared panel for both the Skin Attendant ("shop" - buy skins you don't
   * own) and the Clothes corner button ("wardrobe" - equip a skin you do
   * own). Paginated since the catalog is bigger than fits on one screen.
   */
  private openSkinPanel(mode: "shop" | "wardrobe") {
    this.panelOpen = true;
    let page = 0;
    const itemsPerPage = 4;
    let elements: Phaser.GameObjects.GameObject[] = [];

    // Catalog comes from the skin shop backend (economy/skinShop.ts), not
    // GameState directly - owned/equipped state still comes from GameState
    // since that's the player's live profile data, not catalog data.
    const getItems = (): readonly SkinDef[] =>
      mode === "shop"
        ? listSkins().filter((s) => !gameState.ownsSkin(s.id))
        : listSkins().filter((s) => gameState.ownsSkin(s.id));

    const cleanup = () => {
      elements.forEach((e) => e.destroy());
      elements = [];
    };

    const render = () => {
      cleanup();
      const items = getItems();
      const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
      page = Phaser.Math.Clamp(page, 0, totalPages - 1);
      const pageItems = items.slice(page * itemsPerPage, page * itemsPerPage + itemsPerPage);

      const panel = makePanel(this, 400, 300, 460, 440, 200).setScrollFactor(0);
      elements.push(panel);

      const title = this.add
        .text(400, 105, mode === "shop" ? "🧥 Skin Attendant" : "👕 Wardrobe", {
          fontSize: "20px",
          color: Theme.textGold,
          fontStyle: "bold"
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(title);

      const sub = this.add
        .text(
          400,
          130,
          mode === "shop" ? `You have ${gameState.goldCoins} GC` : "Pick a look to wear",
          { fontSize: "13px", color: Theme.textMuted }
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(sub);

      if (pageItems.length === 0) {
        const empty = this.add
          .text(
            400,
            280,
            mode === "shop"
              ? "You own every skin!"
              : "Nothing owned yet.\nVisit the Skin Attendant to buy one.",
            { fontSize: "14px", color: Theme.textMuted, align: "center" }
          )
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(201);
        elements.push(empty);
      }

      pageItems.forEach((def, i) => {
        const y = 165 + i * 58;
        const row = makeInset(this, 400, y, 400, 48, 10);
        row.setScrollFactor(0).setDepth(200);
        elements.push(row);

        const isEquipped = mode === "wardrobe" && gameState.currentSkin === def.id;

        // Small preview of the skin's idle-down pose, so you can see what
        // you're buying/wearing before committing
        const preview = this.add
          .image(219, y, def.textureKey, 1)
          .setOrigin(0.5)
          .setScale(1.4)
          .setScrollFactor(0)
          .setDepth(201);
        elements.push(preview);

        const nameLabel = this.add
          .text(252, y, `${def.name}${isEquipped ? " (worn)" : ""}`, {
            fontSize: "14px",
            color: isEquipped ? Theme.textAccent : Theme.textPrimary,
            fontStyle: isEquipped ? "bold" : "normal"
          })
          .setOrigin(0, 0.5)
          .setScrollFactor(0)
          .setDepth(201);
        elements.push(nameLabel);

        if (mode === "shop") {
          const priceLabel = this.add
            .text(370, y, `${def.price} GC`, { fontSize: "13px", color: Theme.textMuted })
            .setOrigin(0, 0.5)
            .setScrollFactor(0)
            .setDepth(201);
          elements.push(priceLabel);

          const canAfford = gameState.goldCoins >= def.price;
          const buyBtn = makeButton(
            this,
            540,
            y,
            90,
            36,
            "Buy",
            canAfford ? Theme.accent : Theme.neutral,
            canAfford ? Theme.accentHover : Theme.neutral,
            () => {
              // Task #37: POST /skins/buy - GC-only, server-authoritative.
              // The canAfford/ownership checks above are optimistic UI only;
              // the server re-checks both (INSUFFICIENT_GC/ALREADY_OWNED)
              // and is the one that actually decides. A purchase now also
              // equips server-side (economy/skinShop.ts's purchaseSkin, per
              // product decision: buying a skin means wearing it) - so
              // `res.user.equippedSkin` is already the new skin here, and
              // the player sprite needs the same texture/body/scale update
              // the "Wear" button below applies, not just a balance refresh.
              buyBtn.setEnabled(false);
              api
                .buySkin(def.id)
                .then((res) => {
                  gameState.hydrateFromServer(res.user);
                  this.player.setTexture(def.textureKey, this.player.frame.name);
                  this.applyPlayerBody();
                  this.applyPlayerScale();
                  this.updateHud();
                  this.showToast(`✓ Bought & wearing ${def.name}!`, Theme.textAccent);
                  render();
                })
                .catch((err) => {
                  this.showToast(this.describeSkinError(err, `buy ${def.name}`), Theme.textDanger);
                  render();
                });
            }
          );
          if (!canAfford) buyBtn.setEnabled(false);
          buyBtn.container.setScrollFactor(0).setDepth(201);
          elements.push(buyBtn.container);
        } else {
          const wearBtn = makeButton(
            this,
            540,
            y,
            90,
            36,
            isEquipped ? "Worn" : "Wear",
            isEquipped ? Theme.neutral : Theme.accent,
            isEquipped ? Theme.neutral : Theme.accentHover,
            () => {
              // Task #37: POST /skins/equip - server-authoritative; only
              // touch the player's texture/body once the server confirms.
              wearBtn.setEnabled(false);
              api
                .equipSkin(def.id)
                .then((res) => {
                  gameState.hydrateFromServer(res.user);
                  this.player.setTexture(def.textureKey, this.player.frame.name);
                  // Re-tune the collision body and on-screen scale for
                  // whichever rig this skin uses (16x16 Kenney vs 21x32
                  // legacy) - see applyPlayerBody's/applyPlayerScale's comments.
                  this.applyPlayerBody();
                  this.applyPlayerScale();
                  render();
                })
                .catch((err) => {
                  this.showToast(this.describeSkinError(err, `wear ${def.name}`), Theme.textDanger);
                  render();
                });
            }
          );
          if (isEquipped) wearBtn.setEnabled(false);
          wearBtn.container.setScrollFactor(0).setDepth(201);
          elements.push(wearBtn.container);
        }
      });

      if (totalPages > 1) {
        const pageLabel = this.add
          .text(400, 435, `Page ${page + 1} / ${totalPages}`, {
            fontSize: "12px",
            color: Theme.textMuted
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(201);
        elements.push(pageLabel);

        if (page > 0) {
          const prevBtn = makeButton(
            this,
            290,
            435,
            90,
            34,
            "◀ Prev",
            Theme.neutral,
            Theme.neutralHover,
            () => {
              page--;
              render();
            }
          );
          prevBtn.container.setScrollFactor(0).setDepth(201);
          elements.push(prevBtn.container);
        }
        if (page < totalPages - 1) {
          const nextBtn = makeButton(
            this,
            510,
            435,
            90,
            34,
            "Next ▶",
            Theme.neutral,
            Theme.neutralHover,
            () => {
              page++;
              render();
            }
          );
          nextBtn.container.setScrollFactor(0).setDepth(201);
          elements.push(nextBtn.container);
        }
      }

      const closeBtn = makeButton(this, 400, 490, 140, 40, "Close", Theme.danger, Theme.dangerHover, () => {
        cleanup();
        this.panelOpen = false;
        this.updateHud();
      });
      closeBtn.container.setScrollFactor(0).setDepth(201);
      elements.push(closeBtn.container);
    };

    render();
  }

  private buildFloor() {
    for (let x = 0; x < MAP_COLS; x++) {
      for (let y = 0; y < MAP_ROWS; y++) {
        const inRug = x > 16 && x < 64 && y > 10 && y < 46;
        let key = "floor_tan";
        if (inRug) {
          // Task #41: reverted from the #23 Kenney plaza-path tiles back to
          // the original Jephed pack's literal red/blue casino carpet.
          key = (x + y) % 5 === 0 ? "carpet_blue" : "carpet_red";
        }
        this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, key);
      }
    }
  }

  /**
   * Social-hub dressing (task #23, STYLE_GUIDE.md direction note 4: "nature
   * woven into a social hub, not wilderness"). Every piece here is purely
   * decorative (no collider registered) so placement only has to dodge
   * GAME_STATIONS/NPC/attendant sprites and their name labels visually - it
   * can't break interaction radii.
   *
   * Task #41 note: "plant" reverted to the original 48x64 Jephed image (see
   * BootScene.ts preload) so its setScale(2) - added in #23 to make the
   * small 16x16 Kenney tree tile read as a canopy - was removed here to
   * match; leaving it would have rendered the restored Jephed plant at
   * 96x128, badly oversized. tree_accent/lamp_post/bench_prop/market_stall/
   * hedge are untouched Kenney pieces, out of #41's explicit scope (floor/
   * wall/ground tiles + furniture textures only) - flagged separately as a
   * possible bright-prop-on-dark-floor mismatch rather than reverted here.
   */
  private buildDecorations() {
    // Plants - back to the original Jephed art/scale (no setScale - see
    // note above), same spots as before (still clear of "games"' Baccarat
    // cabinet at (10,8), see prior nudge-from-(8,8) note).
    const treeSpots: Array<[number, number]> = [
      [4, 9],
      [8, 48],
      [68, 6],
      [28, 46],
      [52, 46]
    ];
    for (const [col, row] of treeSpots) {
      this.add.image(col * TILE, row * TILE, "plant").setOrigin(0.5);
    }
    // One autumn-toned tree for a bit of the pack's color variety, tucked
    // beside the existing top-right tree cluster. Kenney-sourced, out of
    // #41's scope - see buildDecorations()'s doc comment.
    this.add.image(70 * TILE, 6 * TILE, "tree_accent").setOrigin(0.5).setScale(2);

    // Lamp posts flanking the main north-south path down to the exit door
    // (40,51) - well clear of Plinko (52,36) and Video Poker (67,48).
    this.add.image(36 * TILE, 44 * TILE, "lamp_post").setOrigin(0.5, 1).setScale(1.75);
    this.add.image(44 * TILE, 44 * TILE, "lamp_post").setOrigin(0.5, 1).setScale(1.75);

    // Benches flanking the Chip Attendant (40,28) - a small "town square"
    // gathering nook, 3+ tiles from the NPC's own interaction radius.
    this.add.image(37 * TILE, 31 * TILE, "bench_prop").setOrigin(0.5).setScale(1.5);
    this.add.image(43 * TILE, 31 * TILE, "bench_prop").setOrigin(0.5).setScale(1.5);

    // Market stall beside the Skin Attendant (40,18) - reinforces the
    // "market stall" social-hub read from STYLE_GUIDE direction note 4.
    this.add.image(35 * TILE, 17 * TILE, "market_stall").setOrigin(0.5).setScale(1.5);

    // Low hedges as garden-patch accents near a couple of the tree spots.
    this.add.image(4 * TILE, 12 * TILE, "hedge").setOrigin(0.5).setScale(1.5);
    this.add.image(66 * TILE, 8 * TILE, "hedge").setOrigin(0.5).setScale(1.5);
  }

  private buildWalls() {
    const walls = this.physics.add.staticGroup();
    for (let x = 0; x < MAP_COLS; x++) {
      walls.create(x * TILE + TILE / 2, TILE / 2, "wall");
      walls.create(x * TILE + TILE / 2, (MAP_ROWS - 1) * TILE + TILE / 2, "wall");
    }
    for (let y = 0; y < MAP_ROWS; y++) {
      walls.create(TILE / 2, y * TILE + TILE / 2, "wall");
      walls.create((MAP_COLS - 1) * TILE + TILE / 2, y * TILE + TILE / 2, "wall");
    }
    this.physics.add.collider(this.player, walls);
  }
}
