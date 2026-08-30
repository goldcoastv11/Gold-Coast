import Phaser from "phaser";
import { gameState } from "../GameState";
import { DEFAULT_BODY_PIECE_ID } from "../wardrobeCatalog";
import { LayeredCharacter } from "../ui/LayeredCharacter";
import {
  KENNEY_RIG,
  accessoryScale,
  accessoryY,
  bodyBox,
  firstWalkFrame,
  idleFrame,
  petScale,
  petTrailOffset,
  resolveRig
} from "../characterRig";
import { ITEM_CATALOG, ItemCategory, getItem, walkAnimPrefixForTexture } from "../itemCatalog";
import { GC_MULTIPLIER_BASE } from "../economy/gcMultiplier";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeTextChip, TextChip, UIButton } from "../ui/uiHelpers";
import {
  openShopCategoryMenu,
  openItemPanel,
  openWardrobeSlotMenu,
  ShopPanelHost
} from "../ui/ShopPanel";
import { openChallengesPanel, ChallengesPanelHost } from "../ui/ChallengesPanel";
import { claimableCount } from "../ui/challengeDisplay";
import { openQuickplayPanel, QuickplayPanelHost } from "../ui/QuickplayPanel";
import { openLeaderboardPanel, LeaderboardPanelHost } from "../ui/LeaderboardPanel";
import { uniqueGames } from "../ui/quickplayGrid";
import { createShuffleCupReveal } from "../ui/ShuffleCupReveal";
import { offerTripleChance, TripleChanceOutcome } from "../ui/TripleChanceOffer";
import { offerCoinKiosk } from "../ui/CoinKioskOffer";
import {
  runOnboardingTutorial,
  TutorialStep,
  showHighlightRing,
  showInstruction,
  HighlightHandle,
  InstructionHandle
} from "../ui/TutorialGuide";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { track, EVENTS } from "../api/track";
import { launchLevelUpMinigame } from "../levelUpMinigameLauncher";
import type { PendingLevelMinigame } from "../api/types";
import { playSfx, playMusic } from "../ui/SoundManager";
import { createTouchControls, isTouchDevice, TouchControlsHandle } from "../ui/TouchControls";

const TILE = 16; // real tileset is 16x16 pixels per tile
const MAP_COLS = 80;
const MAP_ROWS = 56;
const PLAYER_SPEED = 160;
const INTERACT_PADDING = 16; // extra reach beyond a station's own footprint
/** The corner "Challenges" button's own w/h - shared by its makeButton() call and refreshChallengeBadge()'s ring sizing so the two can't drift apart. */
const CHALLENGES_BTN_W = 130;
const CHALLENGES_BTN_H = 40;

// Mobile-only size boost (user: "everything needs to be bigger on mobile") -
// scoped to individual sprites (player, ambient NPCs, game cabinets/
// furniture), deliberately NOT a camera zoom - see the camera setup
// below for why: an earlier pass already found that zooming the camera
// also scales/shifts every screen-fixed UI element (HUD, joystick,
// buttons) off their correct positions, since Phaser zoom isn't blocked
// by scrollFactor(0) the way scroll/pan is.
//
// Went 1.25/1.25 -> character-only 2.5 ("double the size") -> 1.5 ("too
// big") -> reset to 1 (no boost) for both -> character-only 1.5 ("50%
// bigger"). Furniture stays at 1 (native) - only characters were asked
// for this time.
const MOBILE_CHAR_SCALE_BOOST = 1.5;
const MOBILE_FURNITURE_SCALE_BOOST = 1;

// Ambient bystander patrol tuning (see addAmbientNpc/updateAmbientNpcs) - a
// lazy background stroll, deliberately much slower than the player
// (~1/6th PLAYER_SPEED) so it reads as flavor rather than a race.
const AMBIENT_NPC_SPEED = 28;
// How close (px) to a waypoint counts as "arrived" - loose enough that a
// low speed + fixed 60fps step can't overshoot and oscillate forever.
const AMBIENT_NPC_ARRIVE_DIST = 4;
// Random dwell range (ms) at each waypoint before reversing direction.
const AMBIENT_NPC_PAUSE_MIN_MS = 1000;
const AMBIENT_NPC_PAUSE_MAX_MS = 2000;
// Ambient bystanders are back on the spare Kenney NPC sheets
// (npc2/npc3/npc4 - already loaded, already animated).
//
// They used to be dressed in real Item Shop skins, per an earlier user
// direction, on the premise that seeing bystanders wear buyable outfits
// advertised the shop. That premise died with the skins themselves: the
// shop no longer sells whole characters, so there is no "outfit a
// bystander is wearing" a player could go and buy. Dressing them from the
// layered wardrobe instead was considered and rejected for now - it would
// mean giving every bystander its own six-layer stack to keep in sync,
// which is real per-frame cost for pure background flavour. The Kenney
// sheets they were on before are still loaded and cost nothing.
//
// These frames are now derived from KENNEY_RIG rather than hardcoded (the
// old table was a hand-copy of the legacy skin rig's row-major layout),
// so they can't drift from the rig the sheets actually use.
const AMBIENT_IDLE_FRAME_FOR_DIR: Record<"left" | "down" | "up" | "right", number> = {
  down: firstWalkFrame(KENNEY_RIG, "down"),
  left: firstWalkFrame(KENNEY_RIG, "left"),
  right: firstWalkFrame(KENNEY_RIG, "right"),
  up: firstWalkFrame(KENNEY_RIG, "up")
};
const AMBIENT_DIR_FOR_IDLE_FRAME: Record<number, "left" | "down" | "up" | "right"> = {
  [AMBIENT_IDLE_FRAME_FOR_DIR.down]: "down",
  [AMBIENT_IDLE_FRAME_FOR_DIR.left]: "left",
  [AMBIENT_IDLE_FRAME_FOR_DIR.right]: "right",
  [AMBIENT_IDLE_FRAME_FOR_DIR.up]: "up"
};

/** One ambient bystander's simple two-point back-and-forth patrol state. See addAmbientNpc/updateAmbientNpcs. */
interface AmbientNpc {
  sprite: Phaser.Physics.Arcade.Sprite;
  /** Walk-anim key prefix, e.g. "npc2" for `npc2_walk_left` etc. - derived from the sheet key. */
  animPrefix: string;
  waypoints: [Phaser.Math.Vector2, Phaser.Math.Vector2];
  targetIndex: 0 | 1;
  /** scene.time timestamp (ms) until which this NPC stays idle/paused; 0 means "not paused, keep moving". */
  pausedUntil: number;
  lastDir: "left" | "down" | "up" | "right";
}

// Per-station/zone floating labels (registerStation/addZoneSign - many on
// screen at once) still draw their own CSS-style backgroundColor rather
// than a Theme.ts Graphics fill, so they need a string hex constant here
// instead of Theme's numeric ones.
//
// This was a warm-cream chip (matching the old "Bright Social-Hub" theme's
// Theme.panel) left un-migrated when Theme.ts moved to the dark "Arcade
// Nights" palette - a real bug, not a stylistic leftover: the label text
// itself is Theme.textPrimary (near-white), so white-on-near-white-chip
// was reading as "game names you can't see." Now matches the current dark
// Theme.panel instead, same ~80% opacity.
//
// The HUD/prompt-bubble/toast (a separate polish pass) moved off this
// flat-rect approach entirely onto ui/uiHelpers.ts's makeTextChip, which
// gets the same dark fill but with the rounded corners + outline the rest
// of the chrome system uses - Text's own backgroundColor can't do either.
// Per-station labels stay on this simpler path for now (out of that pass's
// scope).
const CHIP_BG_SOFT = "#1a2138cc"; // Theme.panel, ~80% opaque - per-station labels (many on screen at once)

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
 *
 * Exported (along with GAME_STATIONS below) so ui/QuickplayPanel.ts's
 * caller here can hand it the deduplicated game list without that module
 * needing its own second list - see openQuickplayPanel() below.
 */
export interface FurnitureStationDef {
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
export const GAME_STATIONS: FurnitureStationDef[] = [
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
  /**
   * The player's BODY layer - the physics sprite that actually moves,
   * collides and is followed by the camera. Everything else the player is
   * wearing is drawn over it by `layeredCharacter` below.
   */
  private player!: Phaser.Physics.Arcade.Sprite;
  /**
   * The worn wardrobe layers stacked on `player` (see
   * ui/LayeredCharacter.ts). Rebuilt on spawn and after any shop change;
   * synced to the body's position and frame every frame from a POST_UPDATE
   * listener registered in create() - see that listener's own comment for
   * why POST_UPDATE specifically (not a call inside update()/
   * handleMovement()) is what keeps the clothes from trailing the body.
   */
  private layeredCharacter?: LayeredCharacter;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private touchControls?: TouchControlsHandle;
  private promptText!: TextChip;
  private hudText!: TextChip;
  private _panelOpen = false;
  private _tutorialAllowMovement = false;
  private interactables: Interactable[] = [];
  private activeInteractable: Interactable | null = null;
  /** Purely decorative background characters on simple back-and-forth patrols - see addAmbientNpc/updateAmbientNpcs. */
  private ambientNpcs: AmbientNpc[] = [];

  /** Floating emoji badge worn above the head - see applyEquippedAccessory(). Undefined whenever gameState.equippedAccessory is null. */
  private accessoryBadge?: Phaser.GameObjects.Image;
  /** Small companion sprite that follows the player - see applyEquippedPet()/updatePetFollow(). Undefined whenever gameState.equippedPet is null. */
  private petSprite?: Phaser.GameObjects.Sprite;
  /** The pet's own facing, tracked separately from the player's lastDir since the pet lags behind and can be moving in a different direction than the player at any given moment. */
  private petLastDir: "down" | "left" | "right" | "up" = "down";

  /** The corner "Challenges" button - replaces the old walk-up Challenge Board station, see its creation comment in create(). */
  private challengesButton!: UIButton;
  /** The Challenges button's pulsing "something's ready" ring (same showHighlightRing helper as the Level-Up kiosk/tutorial, screenFixed since this is a fixed UI button) - undefined when nothing is claimable. Same "persist across other panels" reasoning as levelUpHighlight below - it's cleared explicitly by refreshChallengeBadge(), not by panelOpen's setter. */
  private challengesButtonHighlight?: HighlightHandle;

  /** The Level-Up station's own cabinet sprite, so refreshLevelUpStation() knows where to draw/clear its "one is waiting" ring. */
  private levelUpStationSprite?: Phaser.Physics.Arcade.Sprite;
  /** The Level-Up station's pulsing highlight ring (see ui/TutorialGuide.ts's showHighlightRing, the same ring the onboarding tutorial uses), shown exactly while a minigame is owed - undefined when none is. Deliberately its own field, not activeTutorialHighlight below: that one is auto-cleared the instant any real panel opens (see panelOpen's setter), which would hide this ring the moment the player opened, say, the Item Shop - this station's ring has to persist across other panels until the minigame is actually played. */
  private levelUpHighlight?: HighlightHandle;
  /** Local cache of GET /progression's pendingLevelMinigame, refreshed by refreshLevelUpStation() - read by the station's own interact handler so pressing E doesn't need a second round trip on top of the one refreshLevelUpStation() already made. */
  private pendingLevelUpMinigame: PendingLevelMinigame = null;

  /** The onboarding tutorial's currently-showing "go do this for real" highlight ring + instruction bubble, if any - see runHandsOnStep/clearTutorialHighlight. */
  private activeTutorialHighlight?: HighlightHandle;
  private activeTutorialInstruction?: InstructionHandle;

  private get panelOpen(): boolean {
    return this._panelOpen;
  }

  /**
   * A false->true transition means some REAL modal/panel/flow is opening
   * (kiosk claim confirm, Item Shop, etc.) - if a tutorial hands-on
   * step's highlight ring + instruction bubble happen to still be showing
   * at that moment, clear them right here, centrally, rather than needing
   * every single real-panel call site to remember to do it themselves
   * (confirmed via live testing: they were staying visible on top of the
   * real panel the whole time you were, say, buying a shirt - genuinely
   * confusing/cluttered, not just a cosmetic nit). This mirrors the same
   * "fix it once at the boundary, not at every one of 18 call sites"
   * approach used for the scene-data retention bug - see create()'s doc
   * comment on `shouldStartTutorial`.
   */
  private set panelOpen(value: boolean) {
    if (value && !this._panelOpen) {
      this.clearTutorialHighlight();
    }
    this._panelOpen = value;
    this.updateTouchControlsVisibility();
  }

  private get tutorialAllowMovement(): boolean {
    return this._tutorialAllowMovement;
  }

  /**
   * Override that lets handleMovement() run even while panelOpen is true -
   * used ONLY by the onboarding tutorial's "try WASD now" step (see
   * startOnboardingTutorial). panelOpen itself stays true for the tutorial's
   * entire duration so handleProximity()/handleInteraction() never run -
   * see update()'s doc comment for why that matters.
   */
  private set tutorialAllowMovement(value: boolean) {
    this._tutorialAllowMovement = value;
    this.updateTouchControlsVisibility();
  }

  /**
   * The touch joystick/interact button (mobile only, see
   * ui/TouchControls.ts) should be visible exactly when real movement is
   * possible - normally that's "no panel is open", but the tutorial's
   * movement step is a real, deliberate exception (tutorialAllowMovement)
   * where panelOpen stays true (blocking station interaction) while
   * movement itself is unlocked. The previous version only ever checked
   * `!panelOpen`, so the joystick/interact button stayed hidden through
   * that entire step even though keyboard WASD worked fine - reported
   * live as the tutorial's own "try moving now" step giving mobile players
   * no way to actually do it, only becoming reachable once the whole
   * tutorial ended. Centralized here (called from both setters below)
   * rather than duplicated at every place either flag changes.
   */
  private updateTouchControlsVisibility() {
    this.touchControls?.setVisible(!this.panelOpen || this.tutorialAllowMovement);
  }

  /** Destroys the tutorial's current highlight ring + instruction bubble, if any - safe to call even when neither exists. */
  private clearTutorialHighlight() {
    this.activeTutorialHighlight?.destroy();
    this.activeTutorialInstruction?.destroy();
    this.activeTutorialHighlight = undefined;
    this.activeTutorialInstruction = undefined;
  }

  constructor() {
    super("OverworldScene");
  }

  create(data?: OverworldSceneData) {
    // Phaser reuses the SCENE INSTANCE across start/stop cycles - create()
    // re-runs but class-field initialisers do not, so any state left set when
    // this scene was last stopped is still set now. panelOpen gates movement
    // in update(), and a panel that never got to run its own close handler
    // (because something faded to another scene while it was open - the
    // level-up minigame launching mid-claim is exactly this) leaves it stuck
    // true. The result is a player who can never move again: a permanent
    // softlock, reported from real play.
    //
    // Resetting here fixes the whole class of bug rather than that one path -
    // re-entering the overworld ALWAYS starts unblocked, whatever happened
    // before. Both flags are set through their setters so the touch controls
    // are re-shown too.
    this.panelOpen = false;
    this.tutorialAllowMovement = false;

    fadeInOnCreate(this);
    playMusic(this, "alphaDance"); // lobby background loop - see ui/SoundManager.ts

    // Capture, then IMMEDIATELY clear, whatever data this scene was
    // started with - Phaser's Systems.start(data) only overwrites
    // settings.data `if (data)` is truthy, so any later `scene.start(
    // "OverworldScene")` call with no data (every game scene's exit/walk-
    // away button does exactly this) would otherwise silently keep seeing
    // THIS SAME data forever, re-triggering the tutorial every time the
    // player returned from a game - confirmed directly in Phaser's own
    // source (Systems.js). Clearing it here means only a genuine fresh
    // `{startTutorial: true}` passed to THIS exact start() call counts.
    const shouldStartTutorial = data?.startTutorial === true;
    this.sys.settings.data = {};

    // Same "Phaser reuses this scene instance across every re-entry" issue
    // as settings.data above, for a different field: ambientNpcs is a class
    // field (`= []` in its declaration), which only runs ONCE, in the
    // constructor - NOT on every create() call. Without resetting it here,
    // every return trip from a game re-ran buildDecorations()'s 3
    // addAmbientNpc() calls and PUSHED 3 more entries onto the same array,
    // leaving the previous 3 in there wrapping sprites this scene had
    // already destroyed on the way out. updateAmbientNpcs() (called every
    // frame, unconditionally, from the very top of update()) then called
    // .setVelocity() on those stale entries - a destroyed Arcade sprite's
    // body is null, so that throws, every single frame, forever, which
    // halts Phaser's whole game loop (same class of bug as the earlier
    // invalid-camera-ease-string hang) - the exact "screen goes white and
    // you can't click anything" symptom reported after finishing a game
    // and returning to the Overworld. Clearing the array here, before
    // buildDecorations() re-populates it, is the fix - mirrors clearing
    // settings.data above for exactly the same underlying reason.
    this.ambientNpcs = [];

    this.buildFloor();
    this.buildDecorations();

    // Player - spawn back where they were before entering a game, if known;
    // otherwise start near the bottom entrance/exit
    const spawn = gameState.lastPlayerPosition ?? { x: 40 * TILE, y: 46 * TILE };
    // The player sprite is now the BODY layer of a layered character - the
    // physics body that moves and collides - with the rest of the wardrobe
    // drawn over it by LayeredCharacter (see ui/LayeredCharacter.ts).
    // Spawning it on the equipped body (falling back to the free default)
    // rather than on a "skin" texture is what makes an invisible player
    // impossible here: `equippedWardrobe.BODY` is always populated, both
    // from the server and from GameState's own default.
    const bodyTexture = gameState.wornInSlot("BODY") ?? DEFAULT_BODY_PIECE_ID;
    this.player = this.physics.add.sprite(spawn.x, spawn.y, bodyTexture, idleFrame(resolveRig(bodyTexture), "down"));
    this.player.setCollideWorldBounds(true);
    this.player.setDamping(true);
    this.player.setDrag(0.85);
    this.layeredCharacter = new LayeredCharacter(this, this.player);

    // Sync the worn layers from POST_UPDATE, not from inside update()/
    // handleMovement(). Arcade Physics only writes its computed movement
    // into the body's game object (this.player.x/y) during its own
    // POST_UPDATE handler (Body.postUpdate, bound by the physics plugin to
    // the scene's POST_UPDATE event) - which runs AFTER the scene's own
    // update() method returns. A sync() called from inside update() (the
    // original bug) therefore always read the PREVIOUS frame's position:
    // the classic one-frame lag, visible as clothes trailing the body.
    // Registering our own listener on POST_UPDATE - guaranteed to run after
    // the physics plugin's, since Arcade Physics binds its POST_UPDATE
    // handler during the plugin's boot, before this scene's create() ever
    // runs, and Phaser's EventEmitter calls listeners in registration order
    // - reads the position Arcade Physics wrote for THIS frame, so the
    // layers can never be stale. This is tied to Phaser's own lifecycle
    // rather than to call order inside our code, so it can't regress by a
    // future reshuffle of update()/handleMovement().
    //
    // (A "true" structural fix - making the overlays real display-list
    // children of a single transform, so there's no copy to get stale at
    // all - would mean moving the physics body off `this.player` onto a
    // wrapping Container, since Phaser Sprites can't parent other Sprites.
    // That touches every collider, the camera follow target, and the body
    // sizing/scale helpers below across this whole scene file - too large
    // a blast radius for this bug, so this listener is the deliberate
    // choice here.)
    const syncLayeredCharacter = () => this.layeredCharacter?.sync();
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, syncLayeredCharacter);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, syncLayeredCharacter);
    });

    this.applyPlayerWardrobe();
    this.accessoryBadge = undefined;
    this.petSprite = undefined;
    this.petLastDir = "down";
    this.applyEquippedAccessory();
    this.applyEquippedPet();

    // Coin Kiosk furniture, in the center of the floor - per user
    // direction, a TV/screen-on-a-stand (BootScene.ts's createCoinKiosk
    // Texture, already drawn at the right cabinet scale) rather than the
    // "chip person" Kenney character sprite this used to be. No setScale
    // needed (unlike the old character sprite) since the texture is
    // already native cabinet size, same as every other game's furniture.
    const npc = this.physics.add.staticSprite(40 * TILE, 28 * TILE, "coin_kiosk");
    if (isTouchDevice()) npc.setScale(MOBILE_FURNITURE_SCALE_BOOST);
    // Static bodies don't auto-resync to a post-creation setScale (see the
    // refreshBody() calls in addFurnitureStation/registerReservedStation
    // below) - refreshBody() itself is still correct to call even with no
    // setScale this time, since it's what makes the collider match the
    // new texture's actual (different) footprint in the first place.
    npc.refreshBody();
    this.physics.add.collider(this.player, npc);
    // Coin Kiosk (was "Chip Attendant" + the separate standalone "Ad
    // Kiosk" station elsewhere - the two are now one station: watch a
    // simulated ad, then the same shuffle-cup mini-game the Chip Attendant
    // always used reveals your Gold Coins. See openCoinKiosk()/
    // ui/CoinKioskOffer.ts and economy/attendantClaim.ts's doc comment for
    // the full history.
    this.registerStation(npc, "Coin Kiosk", "Press E to visit the Coin Kiosk", () =>
      this.openCoinKiosk()
    );

    // Exit - bottom-middle wall, leads to the player's own Room
    // (roadmap/player-room-v2, founder direction: "when you exit the
    // casino have it go to your Room"). Used to lead to the title screen
    // (StartMenuScene) - that's still reachable via the 401/logout path,
    // it's just no longer what this specific door does. Position is saved
    // first so RoomScene's own door back drops the player at exactly this
    // spot on return, with no bookkeeping needed on that side - see
    // RoomScene.ts's create().
    const exitDoor = this.physics.add.staticSprite(40 * TILE, 51 * TILE, "exit_door");
    this.physics.add.collider(this.player, exitDoor);
    this.registerStation(exitDoor, "Exit", "Press E to go to your Room", () => {
      gameState.lastPlayerPosition = { x: this.player.x, y: this.player.y };
      this.savePositionRemote(this.player.x, this.player.y);
      fadeToScene(this, "RoomScene");
    });

    // Item Shop - buy new looks for your character, a piece at a time (see
    // ui/ShopPanel.ts). Was the "Skin Attendant" back when this sold 17
    // whole characters; the station and its position are unchanged, only
    // what it sells. Per user direction it's a booth/counter (BootScene's
    // createItemShopTexture, same cabinet scale as every other station)
    // rather than a person character. No setScale needed (unlike the old
    // character sprite it once was) since the texture is already native
    // cabinet size, same as the Coin Kiosk above.
    const itemShopBooth = this.physics.add.staticSprite(40 * TILE, 18 * TILE, "item_shop_booth");
    if (isTouchDevice()) itemShopBooth.setScale(MOBILE_FURNITURE_SCALE_BOOST);
    itemShopBooth.refreshBody();
    this.physics.add.collider(this.player, itemShopBooth);
    this.registerStation(
      itemShopBooth,
      "Item Shop",
      "Press E to browse the Item Shop",
      () => this.openShopCategoryMenu("shop")
    );

    // Challenge Board station removed (founder direction, from real play:
    // "add a button so you don't have to walk there" / "take out the kiosk
    // on the game flow") - replaced by the "🏆 Challenges" corner button in
    // create() above, which opens the same openChallengesPanel() panel and
    // carries the "N ready!" glow that used to be this station's badge (see
    // refreshChallengeBadge() below). BootScene's "challenge_board" texture
    // is left generated-but-unused, same precedent as adRewards.ts's
    // retired Ad Kiosk route - not worth touching for a pure cleanup with
    // no functional benefit.

    // Level-Up station - the walk-up cabinet for the "stop the marker"
    // level-up minigame (see levelUpMinigameLauncher.ts and
    // LevelUpMinigameScene.ts). Founder direction, from real play: "I want
    // it to be its own kiosk that has a ring around it (similar to the
    // tutorial) when it is activated" - it used to fire automatically out of
    // the Challenges panel (see openChallengesPanel's removed calls); this
    // station replaces that with a real thing to walk up to.
    //
    // Wired exactly like the Item Shop above: a static cabinet-scale
    // sprite, a collider, and a registerStation walk-up handler. Placed at
    // (67,38) - the standalone "Ad Kiosk" station's old
    // spot (that station was retired and consolidated into the Coin Kiosk
    // above), already verified clear of Hi-Lo (67,28) and Video Poker
    // (67,48), both 10 tiles/160px away - well beyond any station's own
    // ~40-48px interaction radius.
    const levelUpKiosk = this.physics.add.staticSprite(67 * TILE, 38 * TILE, "levelup_kiosk");
    if (isTouchDevice()) levelUpKiosk.setScale(MOBILE_FURNITURE_SCALE_BOOST);
    levelUpKiosk.refreshBody();
    this.physics.add.collider(this.player, levelUpKiosk);
    this.levelUpStationSprite = levelUpKiosk;
    this.registerStation(
      levelUpKiosk,
      "Level-Up",
      "Press E to play your Level-Up game",
      () => this.openLevelUpKiosk()
    );
    // Checks pending state right now, on scene entry - not only after a
    // claim - so a player who levelled up and reloaded (or just walked back
    // in from a game) sees the ring without having to open Challenges first.
    // See this method's own doc comment for the login-time gap this closes.
    this.refreshLevelUpStation();

    // Ambient bystanders - purely decorative "social hub" flavor. Back on
    // the three spare Kenney NPC sheets (see AMBIENT_IDLE_FRAME_FOR_DIR's
    // comment for why they moved off the Item Shop skins they briefly
    // wore). No registerStation call - these aren't interactable, just
    // people milling around the plaza. Patrol waypoints stay a couple tiles
    // clear of every nearby GAME_STATIONS/decoration collider so the
    // back-and-forth walk never clips through furniture - see
    // updateAmbientNpcs for the movement.
    const ambientIdle = AMBIENT_IDLE_FRAME_FOR_DIR.down;
    this.addAmbientNpc(40, 31, "npc2_sheet", ambientIdle, [37, 31], [43, 31]); // patrols between the two benches (37,31)/(43,31), by the Coin Kiosk
    this.addAmbientNpc(35, 20, "npc3_sheet", ambientIdle, [33, 20], [37, 20]); // short local patrol near the market stall (35,17)/Item Shop
    this.addAmbientNpc(37, 47, "npc4_sheet", ambientIdle, [37, 44], [37, 49]); // strolls the lamp-post path toward the exit

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

    // Mobile: virtual joystick + interact button (see ui/TouchControls.ts).
    // Only on an actual touch device - desktop keeps keyboard-only, no
    // controls cluttering the screen. handleMovement()/handleInteraction()
    // below OR this in alongside the keyboard state.
    if (isTouchDevice()) {
      this.touchControls = createTouchControls(this, () => {
        // Same gate handleInteraction() applies to the keyboard path -
        // "no exception" per its doc comment above (update()'s panelOpen
        // block). Without this, the interact button - a screen-fixed
        // circle in the bottom-right that most panels don't visually
        // cover - could re-trigger a station's onInteract() while another
        // modal is already open, exactly the "two async UI flows
        // colliding" bug class that guard exists to prevent.
        if (this.panelOpen) return;
        if (!this.activeInteractable) return;
        playSfx(this, "select");
        this.activeInteractable.onInteract();
      });
    }

    // UI (fixed to camera) - rounded warm-cream chips (makeTextChip), matching
    // the rest of the chrome system's panel/inset outline treatment instead
    // of Text's flat rectangular backgroundColor. See CHIP_BG_SOFT's comment
    // above for why the per-station labels stay on the simpler path.
    // Y=435, not the original 550 - main.ts's Scale.ENVELOP-on-mobile crops
    // the canvas to fill a wide phone screen, so nothing needed on-screen
    // can sit below y=470 any more (see uiHelpers.ts's SAFE_ZONE_BOTTOM).
    this.promptText = makeTextChip(this, 400, 435, "", {
      fontSize: "16px",
      color: Theme.textPrimary
    });
    this.promptText.container.setScrollFactor(0).setDepth(100).setVisible(false);

    // Coin/level balance readout - screen-fixed, NOT anchored to the
    // player's head in world space any more (see Samsung bug fix below).
    // Was previously repositioned every frame in update() to float above
    // the player sprite; on Samsung phones (very wide in mobile landscape,
    // see main.ts's Scale.ENVELOP note) that pushed it above the measured
    // safe band and it got cropped off-screen, so players couldn't see
    // their own GC balance. Pinned at a static spot inside y=[130,470]
    // instead, same fix pattern as the "Clothes" button below.
    this.hudText = makeTextChip(this, 85, 155, "", { fontSize: "13px", color: Theme.textGold }, {
      paddingX: 8,
      paddingY: 4
    });
    this.hudText.container.setScrollFactor(0).setDepth(150);

    // "Clothes" corner button - always available, opens the wardrobe
    // (change any layer you already own). Y=155, not the original 30 -
    // main.ts's Scale.ENVELOP-on-mobile crops the canvas to fill a wide
    // phone screen, so nothing needed on-screen can sit outside the
    // measured safe zone y=[130,470] any more (see uiHelpers.ts's
    // SAFE_ZONE_TOP/BOTTOM).
    makeButton(this, 730, 155, 130, 40, "👕 Clothes", Theme.neutral, Theme.neutralHover, () =>
      this.openShopCategoryMenu("wardrobe")
    ).container.setScrollFactor(0).setDepth(150);

    // "Challenges" corner button - replaces the old walk-up Challenge Board
    // station (removed below) so a player doesn't have to cross the floor
    // to check/claim. Glows via the same pulsing ring the Level-Up kiosk
    // and the tutorial use (ui/TutorialGuide.ts's showHighlightRing,
    // screenFixed:true here since this is a fixed UI button, not a world
    // sprite) whenever something is ready to claim - see
    // refreshChallengeBadge() below, which also runs once right here so
    // it's correct on walking in, not only after a claim.
    this.challengesButton = makeButton(
      this,
      730,
      205,
      CHALLENGES_BTN_W,
      CHALLENGES_BTN_H,
      "🏆 Challenges",
      Theme.neutral,
      Theme.neutralHover,
      () => this.openChallengesPanel()
    );
    this.challengesButton.container.setScrollFactor(0).setDepth(150);
    this.refreshChallengeBadge();

    // "Quickplay" corner button - founder ask: "a button that changes the
    // layout of the games to one like Stake" (a grid of cards instead of
    // walking the floor). Stacked under Clothes/Challenges at the same
    // x=730, same w/h, one more step down the safe band (y=130-470) - see
    // those two buttons' own comments for why this column exists at all.
    makeButton(this, 730, 255, 130, 40, "🎮 Quickplay", Theme.neutral, Theme.neutralHover, () =>
      this.openQuickplayPanel()
    ).container.setScrollFactor(0).setDepth(150);

    // "Leaderboard" corner button - founder ask: "a small button that shows
    // the Daily, Weekly, and all time leaderboard for GC earned". One more
    // step down the same corner column at x=730 (see Clothes/Challenges/
    // Quickplay above), y=305 - still well inside the safe band (y=[130,470]).
    makeButton(this, 730, 305, 130, 40, "🏅 Leaderboard", Theme.neutral, Theme.neutralHover, () =>
      this.openLeaderboardPanel()
    ).container.setScrollFactor(0).setDepth(150);

    this.updateHud();

    // Onboarding tutorial - runs last, after every station/camera/HUD
    // setup above so its world coordinates (Coin Kiosk/Coin Flip/Item Shop)
    // are all valid. Two entry points:
    // - A brand-new signup (see OverworldSceneData's doc comment) starts
    //   the whole thing from the top.
    // - Returning from a tutorial-triggered Coin Flip round (see
    //   gameState.tutorialResumeAtItemShop's doc comment - identifier
    //   name predates the Item Shop rename, still means the same thing)
    //   resumes directly at the Item Shop hands-on step, skipping
    //   everything before it - the player already completed the Welcome/
    //   movement/Coin Kiosk/Play a Game steps in a PREVIOUS OverworldScene
    //   instance that no longer exists (this one's a fresh scene, entered
    //   via a real scene transition out of and back from CoinFlipScene).
    if (gameState.tutorialResumeAtItemShop) {
      gameState.tutorialResumeAtItemShop = false;
      this.runHandsOnItemShopStep();
    } else if (shouldStartTutorial) {
      this.startOnboardingTutorial();
    }
  }

  /**
   * Guided tour (ui/TutorialGuide.ts) - a mascot "voice box" explains the
   * shuffle-cup bonus the player just received and introduces the
   * character + movement (the two purely informational steps, run through
   * TutorialGuide's own Next-button sequencer), then hands off to three
   * "go do it for real" steps (runHandsOn*Step below) - the player
   * actually walks to and interacts with the Coin Kiosk, a real game
   * (Coin Flip), and the Item Shop, each step only advancing once the
   * corresponding real action genuinely completes, not on a click. World
   * coordinates match each station's real placement above (NPC at 40,28 /
   * Coin Flip at 20,28 / Item Shop at 40,18, all in tiles) - if those
   * ever move, update runHandsOn*Step's pan targets to match.
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
        // Every other informational step keeps movement locked, but THIS
        // step's whole point is inviting the player to move - locking it
        // here would mean pressing WASD as instructed does nothing, which
        // reads as the tutorial being frozen (confirmed via live testing).
        // See update()'s doc comment for why this unlocks movement
        // specifically (tutorialAllowMovement) without touching panelOpen.
        allowMovement: true
      }
    ];

    // panelOpen stays true through both informational steps - see
    // update()'s doc comment (blocks real station interaction/proximity
    // throughout, no exception). Clearing activeInteractable/hiding
    // promptText once here, up front, covers the case where the player
    // happened to be standing near a station right as the tutorial
    // started - it can't need re-clearing mid-sequence since
    // handleProximity() never runs again until a hands-on step explicitly
    // re-enables it.
    this.panelOpen = true;
    this.activeInteractable = null;
    this.promptText.container.setVisible(false);

    runOnboardingTutorial(this, steps, {
      onLockMovement: (locked) => {
        this.tutorialAllowMovement = !locked;
      },
      onComplete: () => {
        this.tutorialAllowMovement = false;
        this.runHandsOnCoinKioskStep();
      }
    });
  }

  /** Ends the tutorial (whether finished normally or skipped from any hands-on step): unblocks real interaction and resumes normal camera-follow. Idempotent - safe to call even if already unblocked. */
  private finishOnboardingTutorial() {
    this.panelOpen = false;
    this.tutorialAllowMovement = false;
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
  }

  /**
   * Pans to `x, y`, resumes camera-follow (so the player can see
   * themselves walk toward the target - safe now that the earlier tutorial
   * hang is confirmed fixed at its actual root cause, an invalid ease
   * string, not camera-follow itself), shows a highlight ring + a
   * no-Next-button instruction bubble (tracked as activeTutorialHighlight/
   * activeTutorialInstruction - see clearTutorialHighlight() and
   * panelOpen's setter, which auto-clears them the instant a real panel
   * opens), and fully unblocks real interaction (`panelOpen = false`) so
   * the player can genuinely walk up and interact with the real station.
   * `onSkip` and the real completion signal are both the caller's
   * responsibility - this just handles the shared pan/highlight/
   * instruction choreography.
   */
  private runHandsOnStep(x: number, y: number, radius: number, title: string, text: string, onSkip: () => void): void {
    // Deliberately NOT resuming camera-follow here (a previous version
    // did, "so the player can see themselves walk toward the target") -
    // confirmed via live testing that it backfired: the camera had JUST
    // finished panning to the highlighted station, but the player hadn't
    // actually moved there yet, so resuming follow immediately yanked the
    // camera back toward the player's real (still-unmoved) position -
    // "pans to the next item, then quickly cuts back to the old position."
    // Camera stays parked at the highlighted target for the whole step;
    // only finishOnboardingTutorial() (once the whole tutorial ends)
    // resumes real follow.
    this.activeTutorialHighlight = showHighlightRing(this, x, y, radius);
    this.activeTutorialInstruction = showInstruction(this, title, text, onSkip);
    this.panelOpen = false;
  }

  private runHandsOnCoinKioskStep() {
    this.cameras.main.stopFollow();
    this.cameras.main.pan(40 * TILE, 28 * TILE, 700, "Sine.easeInOut", true, (_cam, progress) => {
      if (progress !== 1) return;

      const onClaimed = () => {
        this.clearTutorialHighlight();
        this.runHandsOnGameStep();
      };
      this.runHandsOnStep(
        40 * TILE,
        28 * TILE,
        40,
        "Coin Kiosk",
        "Walk up to the Coin Kiosk and press E to watch an ad and claim your free Gold Coins!",
        // Skip means "skip THIS step" (per user direction), not "end the
        // whole tutorial" - moves straight to the next hands-on step.
        () => {
          this.events.off("tutorial:kioskClaimed", onClaimed);
          this.clearTutorialHighlight();
          this.runHandsOnGameStep();
        }
      );
      this.events.once("tutorial:kioskClaimed", onClaimed);
    });
  }

  private runHandsOnGameStep() {
    this.cameras.main.stopFollow();
    // CoinFlip (20,28), not Dice - per user direction. Either of the two
    // CoinFlip stations would do (20,28)/(60,28) - picked the one on the
    // same row as the Coin Kiosk (40,28) for a shorter, more coherent
    // tutorial walking path.
    this.cameras.main.pan(20 * TILE, 28 * TILE, 700, "Sine.easeInOut", true, (_cam, progress) => {
      if (progress !== 1) return;

      this.runHandsOnStep(
        20 * TILE,
        28 * TILE,
        60,
        "Play a Game",
        "Walk up to Coin Flip and press E, then place a bet to play!",
        // Skip means "skip THIS step" (per user direction), not "end the
        // whole tutorial" - moves straight to the Skin Attendant step.
        () => {
          gameState.tutorialAwaitingGamePlay = false;
          this.clearTutorialHighlight();
          this.runHandsOnItemShopStep();
        }
      );
      // No completion event to listen for here on the success path -
      // entering CoinFlipScene tears this whole scene down (the real,
      // unmodified goToGame() flow), which destroys the highlight/
      // instruction along with everything else in this scene
      // automatically (and panelOpen's setter has already cleared them
      // the moment the real interaction opened CoinFlipScene's own UI,
      // same as every other real panel). CoinFlipScene itself picks up
      // this flag on its own create() and continues the tutorial from
      // there - see its doc comments and gameState.tutorialAwaitingGamePlay's.
      gameState.tutorialAwaitingGamePlay = true;
    });
  }

  private runHandsOnItemShopStep() {
    this.cameras.main.stopFollow();
    this.cameras.main.pan(40 * TILE, 18 * TILE, 700, "Sine.easeInOut", true, (_cam, progress) => {
      if (progress !== 1) return;

      const onPurchased = () => {
        this.clearTutorialHighlight();
        this.finishOnboardingTutorial();
      };
      this.runHandsOnStep(
        40 * TILE,
        18 * TILE,
        40,
        "Item Shop",
        "Walk up to the Item Shop and press E, then buy something to wear!",
        // Skip means "skip THIS step" (per user direction) - this is the
        // LAST step though, so "move to the next one" has nowhere left to
        // go and is the same as finishing.
        () => {
          this.events.off("tutorial:wardrobePurchased", onPurchased);
          this.clearTutorialHighlight();
          this.finishOnboardingTutorial();
        }
      );
      this.events.once("tutorial:wardrobePurchased", onPurchased);
    });
  }

  /**
   * `panelOpen` blocks handleProximity()/handleInteraction() unconditionally
   * whenever it's true, with no exception - this matters for the onboarding
   * tutorial's "try WASD now" step specifically. That step previously
   * unlocked the whole panelOpen gate (movement AND proximity/interaction
   * together) so the player could test movement - but that also meant
   * handleInteraction() ran, so walking near a real station (Chip
   * Attendant/Skin Attendant/Ad Kiosk) and pressing E could trigger that
   * station's own real, independent modal/API flow while the tutorial's
   * own dialogue was simultaneously still open - two unrelated async UI
   * systems colliding, the likely actual cause of a full browser-tab hang
   * reported in testing (an earlier live-camera-follow theory was tried
   * and ruled out - didn't fix it). `tutorialAllowMovement` lets movement
   * specifically bypass this gate without reopening that whole class of
   * bug - proximity/interaction/HUD stay blocked no matter what.
   */
  update() {
    this.updateAmbientNpcs();

    if (this.panelOpen) {
      if (this.tutorialAllowMovement) {
        this.handleMovement();
      } else {
        this.player.setVelocity(0, 0);
      }
      return;
    }

    this.handleMovement();
    this.handleProximity();
    this.handleInteraction();

    // The accessory sprite is part of the character, not the screen chrome
    // - it stays anchored to the player's head in world space (moves/scrolls
    // with them, like the player sprite itself) so it visually reads as
    // "worn". Anchored to where the head actually IS (the rig's
    // headTopFrac), not to the top edge of the frame. Identical pixels for
    // the legacy rigs, which all declare 0 headroom - but an LPC frame has
    // ~12px of empty space above the head, so the old frame-top assumption
    // would float the hat clear of the character.
    // (The coin/level balance HUD used to also be repositioned here, right
    // above the accessory - it's a screen-fixed corner readout now, see its
    // creation comment in create() for why.)
    this.accessoryBadge?.setPosition(
      this.player.x,
      accessoryY(this.playerRig, this.player.y, this.player.displayHeight)
    );
    this.updatePetFollow();
  }

  private lastDir: "down" | "left" | "right" | "up" = "down";

  private handleMovement() {
    const t = this.touchControls?.state;
    const left = this.cursors.left?.isDown || this.wasd.A.isDown || t?.left;
    const right = this.cursors.right?.isDown || this.wasd.D.isDown || t?.right;
    const up = this.cursors.up?.isDown || this.wasd.W.isDown || t?.up;
    const down = this.cursors.down?.isDown || this.wasd.S.isDown || t?.down;

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
      // Animations are keyed off the BODY piece - the base sprite is the
      // only layer that plays one. Every other layer mirrors this sprite's
      // frame index in the POST_UPDATE listener registered in create() -
      // see that listener's comment for why it's not synced right here.
      this.player.play(`${this.player.texture.key}_walk_${this.lastDir}`, true);
    } else {
      this.player.stop();
      this.player.setFrame(this.idleFrameForDir(this.lastDir));
    }
  }

  /**
   * The rig the player's current body is drawn on.
   *
   * This scene used to guess the rig from the sprite's frame height
   * (`height <= 16`) in three separate places, which worked only while
   * exactly one rig was <= 16px tall. src/characterRig.ts replaced that
   * guess with an explicit per-sheet declaration precisely so a fourth rig
   * (LPC's 64x64, which the wardrobe uses) could land without silently
   * mislabelling one of the others - the failure mode being a character
   * that moonwalks or faces the wrong way rather than an error.
   *
   * That file's own header called this migration out as the remaining work
   * and listed the replacement for each call site; the layered wardrobe is
   * what finally needed it, since an LPC-bodied player really would have
   * been sized and posed as a 32px-tall legacy frame under the old guess.
   */
  private get playerRig() {
    return resolveRig(this.player.texture.key, this.player.height);
  }

  /** The idle/standing frame for a direction, read off the player's declared rig. Replaces the old `height <= 16` branch. */
  private idleFrameForDir(dir: "down" | "left" | "right" | "up"): number {
    return idleFrame(this.playerRig, dir);
  }

  /**
   * Sizes/positions the player's physics body as a small "feet" footprint
   * rather than the full sprite, from the rig's own declared fractions
   * (see characterRig.ts's bodyBox). Every rig states its own footprint, so
   * this no longer has to assume a character fills its frame - an LPC
   * character stands in the middle of a 64x64 frame with real empty space
   * around it, which the old shared 21x32-derived fractions would have got
   * badly wrong.
   */
  private applyPlayerBody() {
    const box = bodyBox(this.playerRig);
    this.player.setSize(box.width, box.height);
    this.player.setOffset(box.offsetX, box.offsetY);
  }

  /**
   * Scales the player so every rig lands at roughly the same on-screen
   * height regardless of its native resolution - the rig's declared
   * `displayScale`, times the mobile size boost on touch devices.
   *
   * Was a `height <= 16 ? 2 : 1` branch, which is exactly the two values
   * KENNEY_RIG/FLAT_RIG (2) and LEGACY_SKIN_RIG (1) now declare for
   * themselves, so this is like-for-like for those - and correct, rather
   * than accidental, for the LPC rig the wardrobe introduced.
   */
  private applyPlayerScale() {
    const base = this.playerRig.displayScale;
    this.player.setScale(isTouchDevice() ? base * MOBILE_CHAR_SCALE_BOOST : base);
  }

  /**
   * Rebuilds the player's layered character from gameState.equippedWardrobe
   * and re-tunes the body/scale for whatever rig the new body uses.
   *
   * The one entry point for "what the player looks like changed" - called
   * on spawn and from the shop panel after any buy/equip/unequip, so those
   * two paths can't drift apart.
   */
  private applyPlayerWardrobe() {
    this.layeredCharacter?.apply(gameState.equippedWardrobe);
    this.applyPlayerBody();
    this.applyPlayerScale();
    // One extra sync right after rebuilding the stack, so a freshly-equipped
    // piece doesn't sit at (0,0) for the instant before the next
    // POST_UPDATE tick (see create()'s POST_UPDATE listener, which handles
    // every ongoing per-frame sync). Harmless to call twice in one frame -
    // sync() is a pure copy from the base sprite's current state.
    this.layeredCharacter?.sync();
  }

  /**
   * (Re)creates or destroys the accessory badge worn above the head to
   * match gameState.equippedAccessory - call once on create() (spawn) and
   * again after any buy/equip/unequip in the Item Shop panel. Renders one
   * of BootScene.ts's procedurally-drawn accessory textures (real pixel art
   * in this project's own palette), NOT the catalog's `emoji` field - an
   * emoji-only first version read as "floating near the HUD, not on the
   * person" (reported live), see itemCatalog.ts's doc comment for why a
   * sourced pack wasn't used either. Scaled to match the player's own
   * current scale (applyPlayerScale()'s result) so it stays proportional
   * to the character on mobile's extra size boost too, not just desktop.
   */
  private applyEquippedAccessory() {
    this.accessoryBadge?.destroy();
    this.accessoryBadge = undefined;

    const id = gameState.equippedAccessory;
    if (!id) return;
    const item = getItem(id);
    if (!item?.textureKey) return;

    // Both the anchor and the scale come off the rig now: a rig with real
    // headroom in its frame (LPC) needs the badge dropped to the actual
    // head, and a rig with a wider head in frame space needs it scaled up
    // to match, or the hat perches on top like a party favour instead of
    // being worn. Legacy rigs declare 0 headroom and a 1x multiplier, so
    // this is pixel-identical for them.
    this.accessoryBadge = this.add
      .image(
        this.player.x,
        accessoryY(this.playerRig, this.player.y, this.player.displayHeight),
        item.textureKey
      )
      .setOrigin(0.5)
      .setScale(accessoryScale(this.playerRig, this.player.scaleX))
      .setDepth(91); // just above hudText's own 90
  }

  /**
   * (Re)creates or destroys the small companion sprite to match
   * gameState.equippedPet - same call sites as applyEquippedAccessory().
   * "Easier version to test" per user direction: reuses an already-loaded
   * spare Kenney NPC sheet (see itemCatalog.ts's doc comment) at a smaller
   * scale than the player, rather than sourcing new creature art.
   */
  private applyEquippedPet() {
    this.petSprite?.destroy();
    this.petSprite = undefined;

    const id = gameState.equippedPet;
    if (!id) return;
    const item = getItem(id);
    if (!item?.textureKey) return;

    // Spawns right behind the player (petTrailTarget() computes the same
    // "behind current facing" point updatePetFollow() lerps toward every
    // frame) rather than at the player's exact position, so it doesn't pop
    // in already overlapping the player on the very first frame.
    const spawn = this.petTrailTarget();
    // Plain sprite, NOT physics.add.sprite - updatePetFollow() below moves
    // it by lerping x/y directly every frame, no velocity/collision needed,
    // so there's no reason to pay for (or have to disable) an Arcade
    // Physics body it would never actually use.
    // Scale comes off the pet sheet's own rig rather than a hardcoded 1.4 -
    // which is exactly what petScale(KENNEY_RIG) returns (2 * 0.7), so this
    // is like-for-like today and stays correct if a pet ever ships on a
    // different rig.
    this.petSprite = this.add
      .sprite(spawn.x, spawn.y, item.textureKey, 1)
      .setScale(petScale(resolveRig(item.textureKey)))
      .setDepth(5);
  }

  /** World point just behind the player's current facing direction - both applyEquippedPet()'s spawn point and updatePetFollow()'s per-frame target. */
  private petTrailTarget(): { x: number; y: number } {
    // Was a flat 26px. petTrailOffset() returns exactly 26 for both the
    // rigs the player has ever used, and scales the trail proportionally
    // for a taller one (an LPC body) instead of leaving the pet walking
    // through the player's shins.
    const offset = petTrailOffset(this.playerRig);
    const dx = { left: 1, right: -1, up: 0, down: 0 }[this.lastDir];
    const dy = { left: 0, right: 0, up: 1, down: -1 }[this.lastDir];
    return { x: this.player.x + dx * offset, y: this.player.y + dy * offset };
  }

  /**
   * Lerps the pet toward a trailing point behind the player every frame,
   * switching its walk animation on/off (and facing) based on how far it
   * still has to go - the same "moving vs idle" split handleMovement() does
   * for the player itself, just driven by distance-to-target instead of
   * real input.
   */
  private updatePetFollow() {
    if (!this.petSprite) return;
    const target = this.petTrailTarget();
    const dx = target.x - this.petSprite.x;
    const dy = target.y - this.petSprite.y;
    const dist = Math.hypot(dx, dy);

    const CATCH_UP_LERP = 0.08;
    const MOVING_THRESHOLD = 4; // px - below this, treat the pet as "arrived" and idle instead of endlessly micro-stepping
    if (dist > MOVING_THRESHOLD) {
      this.petSprite.x += dx * CATCH_UP_LERP;
      this.petSprite.y += dy * CATCH_UP_LERP;
      this.petLastDir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
      const prefix = walkAnimPrefixForTexture(this.petSprite.texture.key);
      this.petSprite.play(`${prefix}_walk_${this.petLastDir}`, true);
    } else {
      this.petSprite.stop();
      // Read off the pet sheet's own declared rig instead of the inlined
      // copy of the Kenney idle-frame formula this used to carry. Same
      // frame for today's pets; correct rather than coincidental if a pet
      // ever ships on another rig.
      this.petSprite.setFrame(idleFrame(resolveRig(this.petSprite.texture.key), this.petLastDir));
    }
  }

  /**
   * A purely decorative background character - not registered as an
   * Interactable (no "Press E" prompt/name label), just visual "social hub"
   * flavor that ambles along a fixed, predetermined two-point patrol (see
   * updateAmbientNpcs). `sheetKey` is a loaded character spritesheet -
   * currently one of the spare Kenney NPC sheets (see the call sites and
   * AMBIENT_IDLE_FRAME_FOR_DIR's comment). Dynamic body
   * (physics.add.sprite, not staticSprite) since it actually moves -
   * refreshBody() is a no-op here (dynamic bodies auto-resync every frame)
   * but kept for the same refreshBody() pattern the Coin Kiosk furniture
   * above uses. Still collides with the player so it reads as a person,
   * not a background decal.
   *
   * `spawnFrame` is the first frame of a direction's walk cycle (see
   * AMBIENT_IDLE_FRAME_FOR_DIR above). Used both as the spawn-time static
   * frame and to seed which way the NPC is initially "facing" before its
   * first patrol leg.
   *
   * waypointA/waypointB are [col, row] tile coordinates - the two ends of
   * the back-and-forth walk. The NPC starts idle at (col, row) (not
   * necessarily either waypoint) and heads for waypointA first.
   */
  private addAmbientNpc(
    col: number,
    row: number,
    sheetKey: string,
    spawnFrame: number,
    waypointA: [number, number],
    waypointB: [number, number]
  ) {
    const npc = this.physics.add.sprite(col * TILE, row * TILE, sheetKey, spawnFrame);
    // Scaled off the sheet's own rig, exactly like the player - these are
    // 16x16 Kenney frames, which render at half height without it.
    const base = resolveRig(sheetKey).displayScale;
    npc.setScale(isTouchDevice() ? base * MOBILE_CHAR_SCALE_BOOST : base);
    npc.refreshBody();
    this.physics.add.collider(this.player, npc);

    this.ambientNpcs.push({
      sprite: npc,
      // Anim keys are built from the sheet's prefix ("npc2"), not its full
      // texture key ("npc2_sheet") - see BootScene's createWalkAnims calls.
      animPrefix: walkAnimPrefixForTexture(sheetKey),
      waypoints: [
        new Phaser.Math.Vector2(waypointA[0] * TILE, waypointA[1] * TILE),
        new Phaser.Math.Vector2(waypointB[0] * TILE, waypointB[1] * TILE)
      ],
      targetIndex: 0,
      // Stagger the initial departure a little so all 3 don't start/stop in lockstep.
      pausedUntil: this.time.now + Phaser.Math.Between(0, AMBIENT_NPC_PAUSE_MAX_MS),
      lastDir: AMBIENT_DIR_FOR_IDLE_FRAME[spawnFrame] ?? "down"
    });
  }

  /**
   * Moves every ambient bystander one step along its fixed two-point patrol
   * (see addAmbientNpc/AmbientNpc) - simple constant-velocity walk toward
   * the current target waypoint, no pathfinding/obstacle-avoidance (the
   * waypoints themselves were picked to stay clear of walls/furniture/
   * stations). On arrival it stops, faces the direction it was walking,
   * pauses briefly, then reverses toward the other waypoint. Runs every
   * frame regardless of panelOpen so background flavor doesn't visibly
   * freeze just because a shop/tutorial panel happens to be open.
   */
  private updateAmbientNpcs() {
    const now = this.time.now;

    for (const npc of this.ambientNpcs) {
      if (npc.pausedUntil > 0) {
        if (now < npc.pausedUntil) continue;
        npc.pausedUntil = 0;
        npc.targetIndex = npc.targetIndex === 0 ? 1 : 0;
      }

      const target = npc.waypoints[npc.targetIndex];
      const dx = target.x - npc.sprite.x;
      const dy = target.y - npc.sprite.y;

      if (Math.hypot(dx, dy) <= AMBIENT_NPC_ARRIVE_DIST) {
        npc.sprite.setVelocity(0, 0);
        npc.sprite.stop();
        npc.sprite.setFrame(AMBIENT_IDLE_FRAME_FOR_DIR[npc.lastDir]);
        npc.pausedUntil = now + Phaser.Math.Between(AMBIENT_NPC_PAUSE_MIN_MS, AMBIENT_NPC_PAUSE_MAX_MS);
        continue;
      }

      // Waypoint pairs only ever differ along one axis, but pick the
      // dominant axis the same way handleMovement() does in case that ever changes.
      npc.lastDir =
        Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";

      const velocity = new Phaser.Math.Vector2(dx, dy).normalize().scale(AMBIENT_NPC_SPEED);
      npc.sprite.setVelocity(velocity.x, velocity.y);
      npc.sprite.play(`${npc.animPrefix}_walk_${npc.lastDir}`, true);
    }
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
      this.promptText.setText(this.activeInteractable.prompt);
      this.promptText.container.setVisible(true);
    } else {
      this.promptText.container.setVisible(false);
    }
  }

  private handleInteraction() {
    if (!Phaser.Input.Keyboard.JustDown(this.interactKey)) return;
    if (!this.activeInteractable) return;
    // Every walkable-up-to station (Coin Kiosk, Item Shop, all 14 game
    // cabinets, the exit door) funnels through here, so this one hook
    // covers "the arcade floor" getting a sound on every E-press.
    playSfx(this, "select");
    this.activeInteractable.onInteract();
  }

  /**
   * Registers a walkable-up-to station: wires its interaction radius to its
   * own on-screen size (so big furniture like the blackjack table doesn't
   * require standing on its exact center), and adds a floating name label
   * above it so players can tell what it is before walking over.
   *
   * Returns that label so a caller can update it later if it ever needs to
   * (e.g. appending a status badge once an async fetch comes back, the way
   * the now-removed walk-up Challenge Board station used to). Every current
   * call site ignores the return value.
   */
  private registerStation(
    sprite: Phaser.Physics.Arcade.Sprite,
    label: string,
    prompt: string,
    onInteract: () => void
  ): Phaser.GameObjects.Text {
    const radius = Math.max(sprite.displayWidth, sprite.displayHeight) / 2 + INTERACT_PADDING;

    this.interactables.push({ sprite, prompt, radius, onInteract });

    return this.add
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
    // setScale() BEFORE setSize()/setOffset() - sprite.width/height are the
    // texture's native (unscaled) dimensions in Phaser, so the size/offset
    // fractions below stay correct regardless of scale; refreshBody() at
    // the end is what picks up the current scale to size the collider to
    // match the now-bigger visual footprint (same mechanism already
    // documented on the Coin Kiosk's own staticSprite above).
    if (isTouchDevice()) sprite.setScale(MOBILE_FURNITURE_SCALE_BOOST);
    sprite.setSize(sprite.width * sizeFracW, sprite.height * sizeFracH);
    sprite.setOffset(sprite.width * offsetFracX, sprite.height * offsetFracY);
    sprite.refreshBody();
    this.physics.add.collider(this.player, sprite);
    this.registerStation(sprite, label, prompt, () => this.goToGame(sceneKey));
  }

  /** Remembers where the player was standing, then hands off to a game scene. */
  private goToGame(sceneKey: string) {
    // Retention Leg 1: the single chokepoint every one of the 14 game
    // cabinets funnels through (see addFurnitureStation), so one call site
    // covers "which games do players actually walk into" for all of them -
    // including the ones they open and immediately leave, which no
    // ledger/round row would ever show.
    track(EVENTS.GAME_OPENED, { game: sceneKey });
    gameState.lastPlayerPosition = { x: this.player.x, y: this.player.y };
    this.savePositionRemote(this.player.x, this.player.y);
    fadeToScene(this, sceneKey);
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

  /**
   * The Level-Up station's walk-up handler. Reads the local
   * pendingLevelUpMinigame cache (kept fresh by refreshLevelUpStation(),
   * called on scene entry and on Challenges panel close) rather than making
   * its own round trip - same "trust the cache, resync on the real action's
   * own response" shape as openCoinKiosk()'s cooldown check below. If
   * nothing is owed (the common case - the ring is what tells a player
   * whether it's worth walking over at all), this is just a toast, not an
   * error.
   */
  private openLevelUpKiosk() {
    if (!this.pendingLevelUpMinigame) {
      this.showToast("Nothing to play here right now - level up to unlock it!", Theme.textMuted);
      return;
    }
    launchLevelUpMinigame(this, this.pendingLevelUpMinigame);
  }

  /**
   * The Coin Kiosk's offer/simulated-ad/shuffle-cup/result flow (formerly
   * "Chip Attendant" + the separate standalone "Ad Kiosk" - see
   * registerStation's comment above and economy/attendantClaim.ts's doc
   * comment for the full history). Checked here, before ever showing the
   * ad offer, rather than inside the offer/countdown UI: no point making
   * the player sit through a whole simulated ad only to be told to wait -
   * see ui/CoinKioskOffer.ts for the ad-watch UI itself, which does no
   * claiming/cooldown-checking of its own.
   */
  private openCoinKiosk() {
    const remainingMs = gameState.attendantClaimCooldownRemainingMs;
    if (remainingMs > 0) {
      this.showToast(`Coin Kiosk available in ${Math.ceil(remainingMs / 1000)}s.`, Theme.textDanger);
      return;
    }
    this.panelOpen = true;
    playSfx(this, "open");
    offerCoinKiosk(
      this,
      400,
      300,
      () => this.runAttendantClaimShuffle(),
      () => {
        this.panelOpen = false;
      }
    );
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

    // Retention Leg 1: the ad-gated free Gold Coins claim - the main
    // "reason to come back tomorrow" mechanic, so its uptake is the single
    // most decision-relevant number on this whole roadmap leg. Recorded
    // here, after the server has already granted (the animation below is
    // purely presentational), so it counts real grants only - a claim that
    // hit COOLDOWN returned above and is never counted.
    track(EVENTS.KIOSK_CLAIM, { gcAmount: result.granted.gcAmount });

    const panel = makePanel(this, 400, 300, 420, 260, 200).setScrollFactor(0);
    const title = this.add
      .text(400, 195, "🪙 Coin Kiosk's Shuffle", {
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
          this.showClaimResultFromServer(result.granted.gcAmount, outcome);
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

  /** Shows the result panel for a successful (server-confirmed) Coin Kiosk claim - `tripleChance` (#46) reflects whether/how the GC leg changed after the bonus round, if the player played it. GC-only now (see economy/attendantClaim.ts's doc comment) - no SC sub-message any more. */
  private showClaimResultFromServer(gcGained: number, tripleChance?: TripleChanceOutcome) {
    this.updateHud();
    playSfx(this, "chipLay");
    let gcMessage = `+${gcGained} Gold Coins!`;
    if (tripleChance?.played) {
      gcMessage =
        tripleChance.finalAmount > 0
          ? `Tripled to +${tripleChance.finalAmount} Gold Coins!`
          : `Lost the ${gcGained} Gold Coins to Triple Chance!`;
    }
    this.showResultPanel(gcMessage);
  }

  private showResultPanel(message: string) {
    const panel = makePanel(this, 400, 300, 420, 220, 200).setScrollFactor(0);

    const title = this.add
      .text(400, 255, message, {
        fontSize: "22px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    const balance = this.add
      .text(400, 288, `🪙 Gold Coins: ${gameState.goldCoins}`, {
        fontSize: "14px",
        color: Theme.textMuted
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    const cleanup = () => {
      panel.destroy();
      title.destroy();
      balance.destroy();
      againBtn.destroy();
      doneBtn.destroy();
    };

    // Claim again right from here - no need to close and re-open the panel.
    // Same cooldown-aware button as the very first claim, and same ad-gate
    // (watch another ad, then the shuffle cups run again) - the ad-watch is
    // the gate every claim goes through now, not just the first.
    const againBtn = this.createAttendantClaimButton(340, 340, 140, 44, "Claim Again", () => {
      cleanup();
      this.panelOpen = true;
      offerCoinKiosk(
        this,
        400,
        300,
        () => this.runAttendantClaimShuffle(),
        () => {
          this.panelOpen = false;
        }
      );
    });
    againBtn.container.setScrollFactor(0).setDepth(201);

    const doneBtn = makeButton(this, 470, 340, 100, 44, "Done", Theme.neutral, Theme.neutralHover, () => {
      cleanup();
      this.panelOpen = false;
      this.updateHud();
      // Onboarding tutorial's Coin Kiosk hands-on step (see
      // startOnboardingTutorial) listens for this - a harmless no-op emit
      // when the tutorial isn't running. Fired HERE, at the true end of
      // the whole claim flow (ad watch -> shuffle-cup reveal -> Triple
      // Chance offer -> this result panel -> Done), not at the raw
      // API-success point - that earlier version advanced the tutorial to
      // the next step while the shuffle/Triple Chance/result UI was still
      // visibly playing out on screen, stacking a second tutorial panel on
      // top of the first (confirmed via live testing). showResultPanel is
      // only ever reached from this one flow, so this is a safe,
      // unambiguous "truly done" signal - "Claim Again" above restarts the
      // whole sequence instead of reaching here, which is correct (the
      // tutorial step is already satisfied by the first claim; choosing to
      // claim again is optional and shouldn't block advancing further if
      // they then hit Done).
      this.events.emit("tutorial:kioskClaimed");
    });
    doneBtn.container.setScrollFactor(0).setDepth(201);
  }

  private updateHud() {
    // Level rides along with the balance: it's the "visible prestige
    // number" half of what a level is for (see server/src/progression/
    // levels.ts), and it arrives on every authenticated response already,
    // so showing it here costs no extra request.
    //
    // GC-only economy (2026-08-29, TICKETS retired - see repo-root
    // CLAUDE.md): this used to also print `🎟️ ${gameState.tickets}` next to
    // the coin count. That balance is retired and permanently 0 now, so it
    // was dropped rather than kept as a second, always-zero figure.
    this.hudText.setText(`🪙 ${gameState.goldCoins}   ⭐ Lv ${gameState.playerLevel}`);
  }

  /**
   * Lights up the corner "Challenges" button's pulsing ring when the player
   * has completed challenges they haven't claimed - the replacement for the
   * old walk-up Challenge Board station's "N ready!" text badge (founder
   * direction: "have it glow/blink when you won a challenge so it is clear
   * a player has a reward ready").
   *
   * Called once from create() (screenFixed showHighlightRing around the
   * button, same helper/shape as the Level-Up kiosk's ring) so it's correct
   * on walking into the overworld, not only after a claim, and again
   * whenever the Challenges panel closes (openChallengesPanel's
   * setPanelOpen override) so claiming everything while the panel is open
   * clears the glow right away instead of waiting for the next scene entry.
   * Fire-and-forget and silent on failure - a button that simply doesn't
   * light up is a far better outcome than an error toast on entering the
   * overworld, and the panel itself re-reads the board (and reports its own
   * failures) the moment anyone opens it.
   */
  private refreshChallengeBadge() {
    const button = this.challengesButton;
    if (!button) return;
    api
      .getChallenges()
      .then((board) => {
        // The scene can be torn down (a game entered, the title screen)
        // while this is in flight; a destroyed container has no `scene`.
        if (!button.container.scene) return;
        if (!board.available) return;
        const ready = claimableCount(board.daily, board.weekly, board.achievements);
        if (ready > 0) {
          if (!this.challengesButtonHighlight) {
            // Half-diagonal of the button's own w/h (130x40, see its
            // makeButton() call) rather than the Level-Up kiosk's simpler
            // max(w,h)/2 - that button is near-square, but a circle sized
            // off this one's much wider rectangle would either swallow
            // neighbouring UI or clip the button's corners.
            const radius = Math.sqrt((CHALLENGES_BTN_W / 2) ** 2 + (CHALLENGES_BTN_H / 2) ** 2) + 6;
            this.challengesButtonHighlight = showHighlightRing(
              this,
              button.container.x,
              button.container.y,
              radius,
              true
            );
          }
        } else {
          this.challengesButtonHighlight?.destroy();
          this.challengesButtonHighlight = undefined;
        }
      })
      .catch(() => {
        // Silent by design - see this method's doc comment.
      });
  }

  /**
   * Checks whether the Level-Up minigame is currently owed and updates the
   * station's ring to match - shown while one is pending, cleared once it
   * isn't. Same "check on scene entry" shape as refreshChallengeBadge()
   * above: called once from create() (so it's correct on walking in, not
   * only after a claim) and again whenever the Challenges panel closes (so
   * a level-up claimed mid-session, without ever leaving the overworld,
   * still lights the ring up promptly rather than waiting for the next real
   * scene transition).
   *
   * This is also what closes the actual known gap the founder flagged:
   * previously nothing called GET /progression on plain login/reload, so a
   * player who levelled up and reloaded without opening Challenges never
   * saw anything owed to them. This station's ring is driven by exactly
   * that same GET /progression call, made unconditionally on every scene
   * entry - so that player now sees the ring the moment they're back on the
   * floor, no Challenges panel required.
   *
   * Fire-and-forget and silent on failure, same reasoning as
   * refreshChallengeBadge(): a station that simply doesn't light up is a
   * far better failure mode than an error toast on entering the overworld.
   */
  private refreshLevelUpStation() {
    const sprite = this.levelUpStationSprite;
    if (!sprite) return;
    api
      .getProgression()
      .then((progression) => {
        // The scene can be torn down (a game entered, the title screen)
        // while this is in flight; a destroyed sprite has no `scene`.
        if (!sprite.scene) return;
        this.pendingLevelUpMinigame = progression.pendingLevelMinigame ?? null;
        if (this.pendingLevelUpMinigame) {
          if (!this.levelUpHighlight) {
            const radius = Math.max(sprite.displayWidth, sprite.displayHeight) / 2 + 6;
            this.levelUpHighlight = showHighlightRing(this, sprite.x, sprite.y, radius);
          }
        } else {
          this.levelUpHighlight?.destroy();
          this.levelUpHighlight = undefined;
        }
      })
      .catch(() => {
        // Silent by design - see this method's doc comment.
      });
  }

  private activeToast?: TextChip;

  /**
   * Brief fading confirmation/error message, positioned above the shop
   * panel but generic enough for any overworld panel flow (also used
   * by the attendant claim's rare cooldown-race fallback, #29). Uses the
   * same rounded warm-cream chip (makeTextChip) as the HUD/prompt bubble,
   * rather than a flat CSS-rect Text background, so toast notifications
   * match the rest of the chrome system's panel/outline treatment.
   */
  private showToast(message: string, color: string) {
    this.activeToast?.destroy();
    const toast = makeTextChip(
      this,
      400,
      145,
      message,
      { fontSize: "13px", color, fontStyle: "bold" },
      { paddingX: 10, paddingY: 5 }
    );
    toast.container.setScrollFactor(0).setDepth(210).setAlpha(0);
    this.activeToast = toast;

    this.tweens.add({
      targets: toast.container,
      alpha: 1,
      duration: 120,
      onComplete: () => {
        this.time.delayedCall(900, () => {
          this.tweens.add({
            targets: toast.container,
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
   * The wardrobe panels, the accessory/pet panel and the category picker
   * that fronts them all live in ui/ShopPanel.ts - they were ~580 lines of
   * this file and are the same kind of thing as each other, not the same
   * kind of thing as the casino floor, the tutorial or the Coin Kiosk that
   * surround them here.
   *
   * These wrappers stay so the existing call sites (the Item Shop station,
   * the Clothes corner button, and the tutorial) keep reading the way they
   * always did.
   */
  private openShopCategoryMenu(mode: "shop" | "wardrobe") {
    openShopCategoryMenu(this.shopPanelHost, mode);
  }

  private openItemPanel(category: ItemCategory, mode: "shop" | "wardrobe") {
    openItemPanel(this.shopPanelHost, category, mode);
  }

  private openWardrobeSlotMenu(mode: "shop" | "wardrobe") {
    openWardrobeSlotMenu(this.shopPanelHost, mode);
  }

  /**
   * Everything ui/ShopPanel.ts needs back from this scene. Each member is a
   * straight hand-off to the private method the panel code used to call
   * directly when it lived here - no new behaviour, just a named seam.
   */
  private get shopPanelHost(): ShopPanelHost {
    return {
      scene: this,
      setPanelOpen: (open) => {
        this.panelOpen = open;
      },
      updateHud: () => this.updateHud(),
      showToast: (message, color) => this.showToast(message, color),
      applyEquippedAccessory: () => this.applyEquippedAccessory(),
      applyEquippedPet: () => this.applyEquippedPet(),
      applyPlayerWardrobe: () => this.applyPlayerWardrobe()
    };
  }

  /**
   * The Challenge Board station's handler - the same shape as the Item
   * Shop's openShopCategoryMenu() wrapper above: the panel itself lives in
   * ui/ChallengesPanel.ts, this is just the named seam.
   *
   * Re-reads the station badge on close, so claiming everything while the
   * panel is open leaves the floor label correct instead of still
   * advertising rewards that are already banked. Also re-checks the
   * Level-Up station's ring on close for the same reason: a claim made
   * while the panel is open can cross a level boundary, and the ring should
   * light up right away rather than waiting for the player to next leave
   * and re-enter the overworld.
   */
  private openChallengesPanel() {
    openChallengesPanel({
      ...this.challengesPanelHost,
      setPanelOpen: (open) => {
        this.panelOpen = open;
        if (!open) {
          this.refreshChallengeBadge();
          this.refreshLevelUpStation();
        }
      }
    });
  }

  /** Everything ui/ChallengesPanel.ts needs back from this scene - a subset of shopPanelHost's members. */
  private get challengesPanelHost(): ChallengesPanelHost {
    return {
      scene: this,
      setPanelOpen: (open) => {
        this.panelOpen = open;
      },
      updateHud: () => this.updateHud(),
      showToast: (message, color) => this.showToast(message, color)
    };
  }

  /**
   * The Quickplay corner button's handler - same shape as the Item Shop's
   * openShopCategoryMenu() wrapper above: the panel itself lives in
   * ui/QuickplayPanel.ts, this is just the named seam. Passes it
   * GAME_STATIONS deduplicated to one card per game (uniqueGames, in
   * ui/quickplayGrid.ts) rather than letting that module import
   * GAME_STATIONS itself - see QuickplayPanel.ts's doc comment on why
   * (keeps this the only scenes/ <-> ui/ import edge in either direction).
   */
  private openQuickplayPanel() {
    openQuickplayPanel(this.quickplayPanelHost, uniqueGames(GAME_STATIONS));
  }

  /** Everything ui/QuickplayPanel.ts needs back from this scene. */
  private get quickplayPanelHost(): QuickplayPanelHost {
    return {
      scene: this,
      setPanelOpen: (open) => {
        this.panelOpen = open;
      },
      goToGame: (sceneKey) => this.goToGame(sceneKey)
    };
  }

  /**
   * The Leaderboard corner button's handler - same shape as the
   * Quickplay/Challenges wrappers above: the panel itself lives in
   * ui/LeaderboardPanel.ts, this is just the named seam.
   */
  private openLeaderboardPanel() {
    openLeaderboardPanel(this.leaderboardPanelHost);
  }

  /** Everything ui/LeaderboardPanel.ts needs back from this scene. */
  private get leaderboardPanelHost(): LeaderboardPanelHost {
    return {
      scene: this,
      setPanelOpen: (open) => {
        this.panelOpen = open;
      }
    };
  }

  private buildFloor() {
    for (let x = 0; x < MAP_COLS; x++) {
      for (let y = 0; y < MAP_ROWS; y++) {
        const inRug = x > 16 && x < 64 && y > 10 && y < 46;
        // "floor_tan"/"carpet_blue" are procedurally-drawn dark tiles (see
        // BootScene.ts). Per user direction ("I need the floor to be
        // quieter so the games pop"), the rug is now a single uniform fill
        // - it used to alternate with a 1-in-5 floor_tan accent tile in a
        // visible diagonal stripe, which (combined with carpet_blue's own
        // per-tile pattern - see that texture's doc comment) added up to
        // more visual noise competing with the now-white game cabinets for
        // attention than an intentional accent. One flat, quiet fill lets
        // the furniture be the thing your eye lands on.
        //
        // Detail pass: the plaza (NOT the rug - that stays one uniform fill
        // per the direction above) now mixes in a second paving slab,
        // `floor_tan_b`, so the 16px stamp doesn't repeat identically 4480
        // times. Thin and deterministic: a cheap integer hash of the tile
        // coordinates, roughly 1 tile in 7, so the variation reads as
        // natural stonework rather than a pattern, and the same tile always
        // gets the same slab across scene reloads. Both slabs share their
        // edge joints, so this cannot produce a visible seam.
        const key = inRug
          ? "carpet_blue"
          : (x * 7 + y * 13 + ((x * y) % 5)) % 7 === 0
            ? "floor_tan_b"
            : "floor_tan";
        this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, key);
      }
    }
  }

  /**
   * Social-hub dressing (STYLE_GUIDE.md direction note 4: "nature woven
   * into a social hub, not wilderness"). Every piece here is purely
   * decorative (no collider registered) so placement only has to dodge
   * GAME_STATIONS/NPC/attendant sprites and their name labels visually - it
   * can't break interaction radii.
   *
   * "plant" is a procedurally-drawn "Arcade Nights" texture (see
   * BootScene.ts's createPlantTexture) at the same 48x64 footprint the old
   * Jephed plant.png used, so placement/origin/scale below is unchanged.
   * tree_accent/lamp_post/bench_prop/market_stall/hedge are the existing
   * bright Kenney "RPG Urban Pack" pieces - that pack has no dark-arcade
   * equivalent to swap onto (same gap BootScene.ts's floor/wall/carpet
   * tiles had), so instead of leaving them jarringly bright against the new
   * dark floor, they're tinted down via `setTint()` right here at placement
   * - a dark navy-slate tint for most of them, and a warm amber tint on the
   * lamp posts specifically so they read as "lit at night" rather than just
   * dimmed, matching the Dave & Buster's-at-night direction.
   */
  private buildDecorations() {
    // Plants, same spots as before (still clear of "games"' Baccarat
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
    // beside the existing top-right tree cluster.
    this.add.image(70 * TILE, 6 * TILE, "tree_accent").setOrigin(0.5).setScale(2).setTint(0x4a5578);

    // Lamp posts flanking the main north-south path down to the exit door
    // (40,51) - well clear of Plinko (52,36) and Video Poker (67,48). Amber
    // tint so they read as glowing at night rather than just dimmed.
    this.add.image(36 * TILE, 44 * TILE, "lamp_post").setOrigin(0.5, 1).setScale(1.75).setTint(0xffb347);
    this.add.image(44 * TILE, 44 * TILE, "lamp_post").setOrigin(0.5, 1).setScale(1.75).setTint(0xffb347);

    // Benches flanking the Coin Kiosk (40,28) - a small "town square"
    // gathering nook, 3+ tiles from the station's own interaction radius.
    this.add.image(37 * TILE, 31 * TILE, "bench_prop").setOrigin(0.5).setScale(1.5).setTint(0x4a5578);
    this.add.image(43 * TILE, 31 * TILE, "bench_prop").setOrigin(0.5).setScale(1.5).setTint(0x4a5578);

    // Market stall beside the Item Shop (40,18) - reinforces the "market
    // stall" social-hub read.
    this.add.image(35 * TILE, 17 * TILE, "market_stall").setOrigin(0.5).setScale(1.5).setTint(0x4a5578);

    // Low hedges as garden-patch accents near a couple of the tree spots.
    this.add.image(4 * TILE, 12 * TILE, "hedge").setOrigin(0.5).setScale(1.5).setTint(0x4a5578);
    this.add.image(66 * TILE, 8 * TILE, "hedge").setOrigin(0.5).setScale(1.5).setTint(0x4a5578);
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
