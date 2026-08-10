import Phaser from "phaser";
import { gameState, SKIN_CATALOG, SkinDef } from "../GameState";
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

    // Slots - lined along the right wall, any of them opens the same game
    for (const [col, row] of [
      [74, 8],
      [74, 18],
      [74, 28],
      [74, 38],
      [74, 48]
    ] as Array<[number, number]>) {
      this.addFurnitureStation(
        col,
        row,
        "slot_machine",
        0.7,
        0.5,
        0.15,
        0.45,
        "Slots",
        "Press E to play Slots",
        "SlotsScene"
      );
    }

    // Blackjack tables - left side, spread top and bottom
    for (const [col, row] of [
      [16, 14],
      [16, 42]
    ] as Array<[number, number]>) {
      this.addFurnitureStation(
        col,
        row,
        "blackjack_table",
        0.8,
        0.4,
        0.1,
        0.55,
        "Blackjack",
        "Press E to play Blackjack",
        "BlackjackScene"
      );
    }

    // Roulette tables - right-center, spread top and bottom
    for (const [col, row] of [
      [60, 14],
      [60, 42]
    ] as Array<[number, number]>) {
      this.addFurnitureStation(
        col,
        row,
        "roulette_table",
        0.8,
        0.5,
        0.1,
        0.4,
        "Roulette",
        "Press E to play Roulette",
        "RouletteScene"
      );
    }

    // Coin Flip machines - far left and far right of the middle band
    for (const [col, row] of [
      [20, 28],
      [60, 28]
    ] as Array<[number, number]>) {
      this.addFurnitureStation(
        col,
        row,
        "coinflip_machine",
        0.7,
        0.5,
        0.15,
        0.45,
        "Coin Flip",
        "Press E to play Coin Flip",
        "CoinFlipScene"
      );
    }

    // Dragon Tower pedestals - top-center, either side of the middle
    for (const [col, row] of [
      [36, 10],
      [44, 10]
    ] as Array<[number, number]>) {
      this.addFurnitureStation(
        col,
        row,
        "dragon_pedestal",
        0.75,
        0.5,
        0.125,
        0.4,
        "Dragon Tower",
        "Press E to play Dragon Tower",
        "DragonTowerScene"
      );
    }

    // Mines cabinets - upper-left open gap
    this.addFurnitureStation(
      28,
      20,
      "mines_machine",
      0.7,
      0.5,
      0.15,
      0.45,
      "Mines",
      "Press E to play Mines",
      "MinesScene"
    );

    // Dice tables - upper-right open gap
    this.addFurnitureStation(
      52,
      20,
      "dice_table",
      0.7,
      0.5,
      0.15,
      0.45,
      "Dice",
      "Press E to play Dice",
      "DiceScene"
    );

    // Limbo cabinets - lower-left open gap
    this.addFurnitureStation(
      28,
      36,
      "limbo_machine",
      0.7,
      0.5,
      0.15,
      0.45,
      "Limbo",
      "Press E to play Limbo",
      "LimboScene"
    );

    // Plinko board - lower-right open gap
    this.addFurnitureStation(
      52,
      36,
      "plinko_board",
      0.75,
      0.4,
      0.125,
      0.55,
      "Plinko",
      "Press E to play Plinko",
      "PlinkoScene"
    );

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
    return SKIN_CATALOG.find((s) => s.id === id) ?? SKIN_CATALOG[0];
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

    const getItems = (): SkinDef[] =>
      mode === "shop"
        ? SKIN_CATALOG.filter((s) => !gameState.ownsSkin(s.id))
        : SKIN_CATALOG.filter((s) => gameState.ownsSkin(s.id));

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
              if (gameState.purchaseSkin(def.id)) {
                this.updateHud();
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
    this.add.image(8 * TILE, 8 * TILE, "plant").setOrigin(0.5);
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
