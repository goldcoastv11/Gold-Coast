import Phaser from "phaser";
import { gameState } from "../GameState";
import { listSkins, SkinDef } from "../economy/skinShop";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset } from "../ui/uiHelpers";

const TILE = 16; // real tileset is 16x16 pixels per tile
const MAP_COLS = 80;
const MAP_ROWS = 56;
const PLAYER_SPEED = 160;
const INTERACT_PADDING = 16; // extra reach beyond a station's own footprint

interface Interactable {
  sprite: Phaser.Physics.Arcade.Sprite;
  prompt: string;
  radius: number;
  onInteract: () => void;
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

  create() {
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
    this.player.setSize(14, 10);
    this.player.setOffset(3.5, 20);

    // NPC - the "chip person", now in the center of the floor
    const npc = this.physics.add.staticSprite(40 * TILE, 28 * TILE, "npc_sheet", 1);
    this.physics.add.collider(this.player, npc);
    this.registerStation(npc, "Chip Attendant", "Press E to talk to the Chip Attendant", () =>
      this.openChipPanel()
    );

    // Exit - bottom-middle wall, sends you back to the title screen
    const exitDoor = this.physics.add.staticSprite(40 * TILE, 51 * TILE, "exit_door");
    this.physics.add.collider(this.player, exitDoor);
    this.registerStation(exitDoor, "Exit", "Press E to exit to the title screen", () => {
      gameState.lastPlayerPosition = { x: this.player.x, y: this.player.y };
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
        color: "#ffffff",
        backgroundColor: "#000000cc",
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
        backgroundColor: "#000000cc",
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
      // middle frame (index 1) of the current direction's row is the idle pose
      const rowMap = { down: 0, left: 1, right: 2, up: 3 } as const;
      this.player.setFrame(rowMap[this.lastDir] * 3 + 1);
    }
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
        color: "#ffffff",
        backgroundColor: "#000000aa",
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
    this.scene.start(sceneKey);
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
        backgroundColor: "#000000aa",
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
      .text(400, 288, "Claim 1000 Gold Coins?", {
        fontSize: "14px",
        color: Theme.textMuted
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    const yesBtn = makeButton(this, 340, 335, 120, 46, "Yes", Theme.accent, Theme.accentHover, () => {
      cleanup();
      const amount = gameState.claimBonus();
      this.showResultPanel(`+${amount} Gold Coins!`);
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
      .text(400, 288, `GC: ${gameState.goldCoins}   |   SC: ${gameState.stakeCoins}`, {
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

    // Claim again right from here - no need to close and re-open the panel
    const againBtn = makeButton(
      this,
      340,
      340,
      140,
      44,
      "Claim Again",
      Theme.accent,
      Theme.accentHover,
      () => {
        cleanup();
        const amount = gameState.claimBonus();
        this.updateHud();
        this.showResultPanel(`+${amount} Gold Coins!`);
      }
    );
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

  private activeSkinToast?: Phaser.GameObjects.Text;

  /**
   * Brief fading confirmation/error message for skin shop actions, so a
   * purchase's owned/unowned state change is visibly confirmed rather than
   * just silently updating the list.
   */
  private showSkinToast(message: string, color: string) {
    this.activeSkinToast?.destroy();
    const toast = this.add
      .text(400, 145, message, {
        fontSize: "13px",
        color,
        fontStyle: "bold",
        backgroundColor: "#000000cc",
        padding: { x: 10, y: 5 }
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(210)
      .setAlpha(0);
    this.activeSkinToast = toast;

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
              if (this.activeSkinToast === toast) this.activeSkinToast = undefined;
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
              // GC-only purchase - gameState.purchaseSkin() routes through
              // economy/skinShop.ts's purchaseSkin(), which debits GC via
              // the ledger and never touches SC. The canAfford/ownership
              // checks above already prevent the failure cases, so a false
              // return here would mean a race (e.g. GC spent elsewhere
              // while this panel was open) - surfaced rather than silent.
              if (gameState.purchaseSkin(def.id)) {
                this.updateHud();
                this.showSkinToast(`✓ Bought ${def.name}!`, Theme.textAccent);
                render();
              } else {
                this.showSkinToast(`Couldn't buy ${def.name} - try again.`, Theme.textDanger);
                render();
              }
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
              gameState.currentSkin = def.id;
              this.player.setTexture(def.textureKey, this.player.frame.name);
              render();
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
          // simple alternating rug pattern for visual interest
          key = (x + y) % 5 === 0 ? "carpet_blue" : "carpet_red";
        }
        this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, key);
      }
    }
  }

  private buildDecorations() {
    // A few plants scattered around for atmosphere, placed in open gaps
    // between the station layout
    // Nudged from (8,8) to clear "games"' incoming Baccarat cabinet at
    // (10,8) - the two 48x64 sprites were only 2 tiles apart and would
    // have visually clipped into each other (no collider/interactable
    // conflict, just overlapping art).
    this.add.image(4 * TILE, 9 * TILE, "plant").setOrigin(0.5);
    this.add.image(8 * TILE, 48 * TILE, "plant").setOrigin(0.5);
    this.add.image(68 * TILE, 6 * TILE, "plant").setOrigin(0.5);
    this.add.image(28 * TILE, 46 * TILE, "plant").setOrigin(0.5);
    this.add.image(52 * TILE, 46 * TILE, "plant").setOrigin(0.5);
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
