import Phaser from "phaser";
import { gameState } from "../GameState";
import { DEFAULT_BODY_PIECE_ID } from "../wardrobeCatalog";
import { LayeredCharacter } from "../ui/LayeredCharacter";
import { bodyBox, idleFrame, resolveRig } from "../characterRig";
import { Theme } from "../ui/Theme";
import { makeButton, makeTextChip, TextChip } from "../ui/uiHelpers";
import { openRoomSlotMenu, RoomPanelHost } from "../ui/RoomPanel";
import { openFurnitureMenu, FurniturePanelHost } from "../ui/FurniturePanel";
import { FurnitureSlotId } from "../furnitureCatalog";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { playSfx, playMusic } from "../ui/SoundManager";
import { createTouchControls, isTouchDevice, TouchControlsHandle } from "../ui/TouchControls";

/**
 * The Player Room (roadmap/player-room-v2) - a private space reached by
 * exiting the casino floor (see OverworldScene.ts's exit door), decorated
 * with GC-bought wallpaper and flooring (src/roomCatalog.ts,
 * src/ui/RoomPanel.ts).
 *
 * ## Scope of this slice
 *
 * Wallpaper + flooring (player-room-v2), plus furniture (roadmap/
 * room-furniture) placed into four fixed positions - see
 * furnitureCatalog.ts's header on why furniture is a genuinely different
 * shape from wallpaper/flooring, not just a third slot bolted onto the
 * same pattern. Furniture is purely decorative (no physics body - see
 * buildFurniture's own comment on why collision was skipped deliberately),
 * rendered via the same "repaint the texture, don't rebuild the object"
 * pattern applyRoomDecor already uses for the walls/floor.
 *
 * ## The design point this room exists to serve
 *
 * A completely bare room reads as "unfinished software" if there's nothing
 * to compare it to; it reads as "fillable" once the player has ALREADY
 * changed something about it once (a wall color, a floor) and can see more
 * options still sitting there unbought. That's why this slice ships
 * wallpaper+flooring rather than just the walkable room with no shopping
 * at all - "empty but decoratable" is the actual feature, not a stepping
 * stone to it.
 *
 * ## What's deliberately simpler than OverworldScene here
 *
 * No ambient NPCs, no onboarding tutorial, no accessory/pet rendering, no
 * general Interactable list - this scene has exactly one interactive thing
 * (the door back to the casino), so it's handled directly. The player's
 * body + wardrobe layers still render via the same LayeredCharacter class
 * OverworldScene uses, so a player looks identical in both places.
 *
 * ## Why this doesn't `implements RoomPanelHost` directly
 *
 * Same reason OverworldScene builds a plain `shopPanelHost` object literal
 * rather than implementing ShopPanelHost on itself: `Phaser.Scene` already
 * owns a property named `scene` (the ScenePlugin, e.g. `this.scene.start(...)`),
 * which collides with RoomPanelHost's own `scene: Phaser.Scene` field. The
 * `roomPanelHost` getter below sidesteps that by handing RoomPanel.ts a
 * fresh object (`scene: this`) instead of `this` itself.
 */

const TILE = 16;
const ROOM_COLS = 50;
const ROOM_ROWS = 38;
const PLAYER_SPEED = 160;
const INTERACT_RADIUS = 56;

// Same mobile size boost OverworldScene applies to its character - see that
// file's own comment on why this is scoped to the sprite, not a camera zoom.
const MOBILE_CHAR_SCALE_BOOST = 1.5;

const DOOR_COL = 25;
const DOOR_ROW = 33;
const SPAWN_COL = 25;
const SPAWN_ROW = 28;

/**
 * World pixel position for each furniture slot (roadmap/room-furniture) -
 * the "stable data, not array order" identity furnitureCatalog.ts's header
 * calls for. Four sensible spots, picked to stay clear of the spawn(25,28)
 * -to-door(25,33) walking corridor (a straight vertical line around
 * x=400): two against the side walls at mid-height, one in the top-left
 * corner, one off to the side of the door rather than in front of it.
 * Furniture is purely decorative (see buildFurniture) so nothing here
 * needs to double as a walkable-clearance box, but keeping these off the
 * corridor still matters for how the room READS - a piece the player has
 * to walk through would look broken even without a collider.
 */
const FURNITURE_SLOT_POSITIONS: Record<FurnitureSlotId, { x: number; y: number }> = {
  WALL_LEFT: { x: 6 * TILE, y: 19 * TILE },
  WALL_RIGHT: { x: 44 * TILE, y: 19 * TILE },
  CORNER: { x: 6 * TILE, y: 6 * TILE },
  BY_DOOR: { x: 39 * TILE, y: 30 * TILE }
};

export class RoomScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private layeredCharacter?: LayeredCharacter;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private touchControls?: TouchControlsHandle;
  private promptText!: TextChip;
  private balanceText!: TextChip;
  private door!: Phaser.Physics.Arcade.Sprite;
  private lastDir: "down" | "left" | "right" | "up" = "down";
  private _panelOpen = false;

  private floorTiles: Phaser.GameObjects.Image[] = [];
  private wallSprites: Phaser.Physics.Arcade.Sprite[] = [];
  /** One image per furniture slot, always present (created once, hidden when empty) - see buildFurniture. */
  private furnitureSprites: Partial<Record<FurnitureSlotId, Phaser.GameObjects.Image>> = {};

  constructor() {
    super("RoomScene");
  }

  create() {
    fadeInOnCreate(this);
    // Same lobby loop the casino floor uses - playMusic() is a no-op if
    // it's already the current track (see SoundManager.ts), so walking
    // between the Room and the casino floor doesn't restart the music.
    playMusic(this, "alphaDance");

    this.floorTiles = [];
    this.wallSprites = [];
    this.furnitureSprites = {};
    this._panelOpen = false;

    this.buildFloor();
    this.buildWalls();
    this.buildFurniture();

    const spawnX = SPAWN_COL * TILE;
    const spawnY = SPAWN_ROW * TILE;
    const bodyTexture = gameState.wornInSlot("BODY") ?? DEFAULT_BODY_PIECE_ID;
    this.player = this.physics.add.sprite(
      spawnX,
      spawnY,
      bodyTexture,
      idleFrame(resolveRig(bodyTexture), "down")
    );
    this.player.setCollideWorldBounds(true);
    this.player.setDamping(true);
    this.player.setDrag(0.85);
    this.layeredCharacter = new LayeredCharacter(this, this.player);

    // Same POST_UPDATE sync as OverworldScene - see that scene's create()
    // for the full explanation of why this can't run from inside update().
    const syncLayeredCharacter = () => this.layeredCharacter?.sync();
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, syncLayeredCharacter);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, syncLayeredCharacter);
    });

    this.applyPlayerWardrobe();
    this.physics.add.collider(this.player, this.wallSprites);

    // The door back to the casino floor. No lastPlayerPosition bookkeeping
    // here (unlike OverworldScene's game cabinets) - the casino-floor spot
    // to return to was already captured the moment the player walked
    // through ITS exit door into this scene, so there's nothing new to
    // remember on the way back.
    this.door = this.physics.add.staticSprite(DOOR_COL * TILE, DOOR_ROW * TILE, "exit_door");
    this.physics.add.collider(this.player, this.door);

    this.cameras.main.setBounds(0, 0, ROOM_COLS * TILE, ROOM_ROWS * TILE);
    this.physics.world.setBounds(0, 0, ROOM_COLS * TILE, ROOM_ROWS * TILE);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as Record<string, Phaser.Input.Keyboard.Key>;
    this.interactKey = this.input.keyboard!.addKey("E");

    if (isTouchDevice()) {
      this.touchControls = createTouchControls(this, () => {
        if (this._panelOpen) return;
        if (!this.nearDoor()) return;
        playSfx(this, "select");
        this.goToCasino();
      });
    }

    // Fixed chrome, laid out inside the mobile safe zone (y=[130,470] - see
    // uiHelpers.ts's SAFE_ZONE_TOP/BOTTOM), same coordinates OverworldScene
    // uses for its own corner button/prompt so the two scenes' chrome lines
    // up when you walk between them.
    this.balanceText = makeTextChip(this, 70, 155, "", { fontSize: "13px", color: Theme.textGold });
    this.balanceText.container.setScrollFactor(0).setDepth(90);
    this.updateHud();

    makeButton(this, 730, 155, 130, 40, "🎨 Decorate", Theme.neutral, Theme.neutralHover, () =>
      this.openDecoratePanel()
    ).container.setScrollFactor(0).setDepth(150);

    // Second chrome button, stacked directly under Decorate - still inside
    // the mobile safe zone (y=[130,470]). A separate button rather than a
    // third row inside openRoomSlotMenu: furniture's picker (RoomPanel.ts
    // ui/FurniturePanel.ts) is a slot-position grid, not a per-category
    // piece list, different enough to be its own entry point.
    makeButton(this, 730, 200, 130, 40, "🪑 Furniture", Theme.neutral, Theme.neutralHover, () =>
      this.openFurniturePanel()
    ).container.setScrollFactor(0).setDepth(150);

    this.promptText = makeTextChip(this, 400, 435, "Press E to return to the casino", {
      fontSize: "16px",
      color: Theme.textPrimary
    });
    this.promptText.container.setScrollFactor(0).setDepth(100).setVisible(false);
  }

  update() {
    if (this._panelOpen) {
      this.player.setVelocity(0, 0);
      return;
    }

    this.handleMovement();

    const near = this.nearDoor();
    this.promptText.container.setVisible(near);
    if (near && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      playSfx(this, "select");
      this.goToCasino();
    }
  }

  private nearDoor(): boolean {
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.door.x, this.door.y);
    return dist < INTERACT_RADIUS;
  }

  private goToCasino() {
    fadeToScene(this, "OverworldScene");
  }

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
      if (Math.abs(vel.x) > Math.abs(vel.y)) {
        this.lastDir = vel.x < 0 ? "left" : "right";
      } else {
        this.lastDir = vel.y < 0 ? "up" : "down";
      }
      this.player.play(`${this.player.texture.key}_walk_${this.lastDir}`, true);
    } else {
      this.player.stop();
      this.player.setFrame(idleFrame(resolveRig(this.player.texture.key, this.player.height), this.lastDir));
    }
  }

  private applyPlayerWardrobe() {
    this.layeredCharacter?.apply(gameState.equippedWardrobe);
    const rig = resolveRig(this.player.texture.key, this.player.height);
    const box = bodyBox(rig);
    this.player.setSize(box.width, box.height);
    this.player.setOffset(box.offsetX, box.offsetY);
    this.player.setScale(isTouchDevice() ? rig.displayScale * MOBILE_CHAR_SCALE_BOOST : rig.displayScale);
    this.layeredCharacter?.sync();
  }

  private buildFloor() {
    const key = gameState.roomPieceInSlot("FLOORING");
    for (let x = 0; x < ROOM_COLS; x++) {
      for (let y = 0; y < ROOM_ROWS; y++) {
        this.floorTiles.push(this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, key));
      }
    }
  }

  private buildWalls() {
    const key = gameState.roomPieceInSlot("WALLPAPER");
    const walls = this.physics.add.staticGroup();
    for (let x = 0; x < ROOM_COLS; x++) {
      this.wallSprites.push(walls.create(x * TILE + TILE / 2, TILE / 2, key));
      this.wallSprites.push(walls.create(x * TILE + TILE / 2, (ROOM_ROWS - 1) * TILE + TILE / 2, key));
    }
    for (let y = 0; y < ROOM_ROWS; y++) {
      this.wallSprites.push(walls.create(TILE / 2, y * TILE + TILE / 2, key));
      this.wallSprites.push(walls.create((ROOM_COLS - 1) * TILE + TILE / 2, y * TILE + TILE / 2, key));
    }
  }

  /**
   * One image per FURNITURE_SLOT_POSITIONS entry, created once (hidden if
   * the slot is empty) and repainted in place by applyFurniture - same
   * "build the object graph once, only swap textures/visibility later"
   * shape buildFloor/buildWalls already use, so buy/place/remove never
   * needs a destroy/rebuild.
   *
   * No physics body: these are purely decorative, not solid. All four
   * slot positions were picked to sit off the spawn-to-door walking
   * corridor (see FURNITURE_SLOT_POSITIONS's own comment), so there's
   * nothing here a collider would actually be protecting the player from -
   * adding one would only be extra bookkeeping (staticGroup membership,
   * refreshBody() on every place/remove) for a piece the player was never
   * going to walk into in the first place.
   */
  private buildFurniture() {
    for (const slotDef of Object.keys(FURNITURE_SLOT_POSITIONS) as FurnitureSlotId[]) {
      const { x, y } = FURNITURE_SLOT_POSITIONS[slotDef];
      const pieceId = gameState.furniturePieceInSlot(slotDef);
      const image = this.add.image(x, y, pieceId ?? "furniture_armchair").setOrigin(0.5, 0.9);
      image.setVisible(pieceId !== null);
      this.furnitureSprites[slotDef] = image;
    }
  }

  private updateHud() {
    this.balanceText.setText(`🪙 ${gameState.goldCoins}`);
  }

  private openDecoratePanel() {
    playSfx(this, "click");
    openRoomSlotMenu(this.roomPanelHost);
  }

  private openFurniturePanel() {
    playSfx(this, "click");
    openFurnitureMenu(this.furniturePanelHost);
  }

  /**
   * Everything ui/RoomPanel.ts needs back from this scene - same "named
   * seam" shape as OverworldScene's shopPanelHost getter. See this class's
   * own doc comment for why this is a fresh object literal rather than
   * `implements RoomPanelHost` on the scene itself.
   */
  private get roomPanelHost(): RoomPanelHost {
    return {
      scene: this,
      setPanelOpen: (open) => {
        this._panelOpen = open;
        this.touchControls?.setVisible(!open);
      },
      updateHud: () => this.updateHud(),
      showToast: (message, color) => this.showToast(message, color),
      applyRoomDecor: () => this.applyRoomDecor()
    };
  }

  /** Same seam as roomPanelHost above, for ui/FurniturePanel.ts. */
  private get furniturePanelHost(): FurniturePanelHost {
    return {
      scene: this,
      setPanelOpen: (open) => {
        this._panelOpen = open;
        this.touchControls?.setVisible(!open);
      },
      updateHud: () => this.updateHud(),
      showToast: (message, color) => this.showToast(message, color),
      applyFurniture: () => this.applyFurniture()
    };
  }

  /**
   * Brief fading confirmation/error toast - same treatment as
   * OverworldScene's showToast (makeTextChip, fade in/hold/fade out).
   */
  private showToast(message: string, color: string) {
    const toast = makeTextChip(
      this,
      400,
      145,
      message,
      { fontSize: "13px", color, fontStyle: "bold" },
      { paddingX: 10, paddingY: 5 }
    );
    toast.container.setScrollFactor(0).setDepth(210).setAlpha(0);

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
            onComplete: () => toast.destroy()
          });
        });
      }
    });
  }

  /** Repaints every floor/wall tile's texture from the current gameState.equippedRoom - no destroy/rebuild needed since the tile grid's shape never changes, only which texture each tile shows. */
  private applyRoomDecor() {
    const floorKey = gameState.roomPieceInSlot("FLOORING");
    const wallKey = gameState.roomPieceInSlot("WALLPAPER");
    this.floorTiles.forEach((t) => t.setTexture(floorKey));
    this.wallSprites.forEach((w) => w.setTexture(wallKey));
  }

  /** Repaints every furniture slot's image from the current gameState.placedFurniture - same "swap texture/visibility in place" pattern as applyRoomDecor, called after a buy/place/remove. */
  private applyFurniture() {
    for (const slotDef of Object.keys(FURNITURE_SLOT_POSITIONS) as FurnitureSlotId[]) {
      const image = this.furnitureSprites[slotDef];
      if (!image) continue;
      const pieceId = gameState.furniturePieceInSlot(slotDef);
      if (pieceId) {
        image.setTexture(pieceId).setVisible(true);
      } else {
        image.setVisible(false);
      }
    }
  }
}
