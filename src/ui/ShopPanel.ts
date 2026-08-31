import Phaser from "phaser";
import { gameState } from "../GameState";
import {
  DEFAULT_BODY_PIECE_ID,
  WARDROBE_SLOTS,
  WardrobePieceDef,
  WardrobeSlot,
  getPiece,
  getSlotDef,
  listPiecesBySlot
} from "../wardrobeCatalog";
import { LPC_RIG, idleFrame } from "../characterRig";
import { ItemDef, ItemCategory, listItemsByCategory } from "../itemCatalog";
import { Theme } from "./Theme";
import { makeButton, makePanel, makeInset } from "./uiHelpers";
import { liveCenterX } from "./Layout";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { track, EVENTS } from "../api/track";
import { playSfx } from "./SoundManager";

/**
 * The overworld's shop/wardrobe panels - the category picker, the
 * accessory/pet panel, and the layered-wardrobe slot picker and piece
 * panel. These were lifted out of OverworldScene.ts, which had grown to
 * ~2,400 lines doing the casino floor, the tutorial, the Coin Kiosk, the
 * shuffle mini-game AND all of these panels at once.
 *
 * The wardrobe panels replaced a single "skin panel" that sold 17 complete
 * characters. Buying a look is now buying one LAYER of it - so where there
 * was one flat list there is now a slot picker (which layer?) fronting a
 * per-slot list (which piece?). The accessory/pet panel is untouched by
 * that change and keeps its original geometry, which the wardrobe panel
 * then copies so the whole shop still feels like one thing.
 *
 * Everything the panels need from the scene that isn't the scene itself
 * (the panel-open flag, the HUD, the toast, the player's layered
 * character, the equipped accessory/pet visuals) comes in through
 * ShopPanelHost below, so this module never reaches back into
 * OverworldScene's privates.
 */

export type ShopMode = "shop" | "wardrobe";

/**
 * What the shop panels need from whoever is hosting them. OverworldScene
 * implements this by delegating to the same private methods these calls
 * used to be - see its `shopPanelHost` getter.
 */
export interface ShopPanelHost {
  /** The scene the panels draw into. */
  readonly scene: Phaser.Scene;
  /**
   * Raises/lowers the host's modal flag. On the host this is a setter with
   * real side effects (clearing a tutorial highlight, hiding the mobile
   * touch controls), which is exactly why it stays the host's job.
   */
  setPanelOpen(open: boolean): void;
  /** Repaints the host's coin HUD after a balance change. */
  updateHud(): void;
  /** Brief fading confirmation/error message above the panel. */
  showToast(message: string, color: string): void;
  /** Re-reads gameState.equippedAccessory and updates the worn badge. */
  applyEquippedAccessory(): void;
  /** Re-reads gameState.equippedPet and updates the follower sprite. */
  applyEquippedPet(): void;
  /**
   * Rebuilds the player's layered character from gameState.equippedWardrobe
   * and re-tunes its collision body + on-screen scale.
   *
   * Replaces the old `applyPlayerSkin(textureKey)`: a character is no
   * longer one texture the panel can hand over, it's a whole stack the host
   * assembles - so the panel says "what I changed is now in gameState, go
   * look" rather than passing a texture key it would have to guess the
   * layering for.
   */
  applyPlayerWardrobe(): void;
}

/** Turns a shop buy/equip failure into a short user-facing toast message. */
function describeShopError(err: unknown, action: string): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "INSUFFICIENT_GC":
        return "Not enough Gold Coins.";
      case "ALREADY_OWNED":
        return "You already own that.";
      case "NOT_FOUND":
        return "That item doesn't exist - try again.";
      case "SLOT_NOT_OPTIONAL":
        return "You can't take that off.";
      default:
        return err.message;
    }
  }
  if (err instanceof NetworkError) return err.message;
  return `Couldn't ${action} - try again.`;
}

/**
 * Small category picker shown before any of the browsing panels - both the
 * Item Shop station and the Clothes corner button open this first.
 *
 * Deliberately a separate entry step rather than a tab row inside each
 * panel: those panels are already tightly packed into the mobile-crop-safe
 * zone (see their SAFE_ZONE_TOP/BOTTOM-driven Y coordinates), so a tab
 * strip would have to come out of the rows themselves. One extra tap is
 * the cheaper trade.
 */
export function openShopCategoryMenu(host: ShopPanelHost, mode: ShopMode) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");

  // Live canvas center, not a literal 400 - see ui/Layout.ts. This panel is
  // a standalone screen-fixed modal (no game-shell sidebar to leave room
  // for), so it belongs on the true live center, unlike the 800-wide game
  // shell's own design-space centering.
  const cx = liveCenterX(scene);

  let elements: Phaser.GameObjects.GameObject[] = [];
  const cleanup = () => {
    elements.forEach((e) => e.destroy());
    elements = [];
  };

  const panel = makePanel(scene, cx, 260, 320, 220, 200).setScrollFactor(0);
  elements.push(panel);
  const title = scene.add
    .text(cx, 190, mode === "shop" ? "🧥 Item Shop" : "👕 Wardrobe", {
      fontSize: "20px",
      color: Theme.textGold,
      fontStyle: "bold"
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(201);
  elements.push(title);
  const sub = scene.add
    .text(cx, 214, "What would you like to browse?", { fontSize: "12px", color: Theme.textMuted })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(201);
  elements.push(sub);

  const goTo = (openNext: () => void) => {
    cleanup();
    openNext();
  };

  // Accessories/Pets removed from here (founder direction, 2026-08-30):
  // that catalog (src/itemCatalog.ts) is the older cosmetics system the
  // layered wardrobe replaced - emoji badges and companion pets, no longer
  // sold or wearable through this menu. Backend/routes/catalog are
  // untouched (additive-only precedent, see CLAUDE.md) - openItemPanel
  // below still exists and still works, it's just no longer reachable from
  // here. A player who already equipped one keeps wearing it (see
  // OverworldScene's applyEquippedAccessory/applyEquippedPet, still called
  // unconditionally on scene create - this menu removal doesn't touch
  // that), they just have no in-game way to take it off any more.
  const buttons: Array<[string, () => void]> = [
    ["👕 Clothing", () => openWardrobeSlotMenu(host, mode)]
  ];
  buttons.forEach(([label, openNext], i) => {
    const btn = makeButton(scene, cx, 250 + i * 50, 260, 42, label, Theme.accent, Theme.accentHover, () =>
      goTo(openNext)
    );
    btn.container.setScrollFactor(0).setDepth(201);
    elements.push(btn.container);
  });

  const closeBtn = makeButton(scene, cx, 400, 140, 38, "Close", Theme.danger, Theme.dangerHover, () => {
    cleanup();
    host.setPanelOpen(false);
    host.updateHud();
  });
  closeBtn.container.setScrollFactor(0).setDepth(201);
  elements.push(closeBtn.container);
}

/**
 * Accessory/Pet browsing panel - structurally mirrors openWardrobePanel()
 * below (same paginated shop/wardrobe shape) but is a fully independent
 * function reading ITEM_CATALOG, so nothing here can regress the live,
 * already-shipped accessory/pet purchase flow. The preview is the drawn
 * accessory texture or a small character-sheet thumbnail rather than a
 * layered character render, since neither is a wardrobe layer.
 */
export function openItemPanel(host: ShopPanelHost, category: ItemCategory, mode: ShopMode) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");
  let page = 0;
  const itemsPerPage = 4;
  let elements: Phaser.GameObjects.GameObject[] = [];

  // Live canvas center, not a literal 400 - see openShopCategoryMenu's own
  // comment above and ui/Layout.ts. Every row position below is expressed
  // as an offset from this so the whole panel (background, rows, buttons)
  // stays aligned as one block when it isn't 400.
  const cx = liveCenterX(scene);

  const getItems = (): ItemDef[] =>
    mode === "shop"
      ? listItemsByCategory(category).filter((i) => !gameState.ownsItem(i.id))
      : listItemsByCategory(category).filter((i) => gameState.ownsItem(i.id));

  const currentlyEquipped = () => (category === "ACCESSORY" ? gameState.equippedAccessory : gameState.equippedPet);

  const cleanup = () => {
    elements.forEach((e) => e.destroy());
    elements = [];
  };

  const applyEquipped = () => {
    if (category === "ACCESSORY") host.applyEquippedAccessory();
    else host.applyEquippedPet();
  };

  const label = category === "ACCESSORY" ? "Accessories" : "Pets";
  const emoji = category === "ACCESSORY" ? "🎩" : "🐾";

  const render = () => {
    cleanup();
    const items = getItems();
    const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
    page = Phaser.Math.Clamp(page, 0, totalPages - 1);
    const pageItems = items.slice(page * itemsPerPage, page * itemsPerPage + itemsPerPage);

    const panel = makePanel(scene, cx, 300, 460, 440, 200).setScrollFactor(0);
    elements.push(panel);

    const title = scene.add
      .text(cx, 140, `${emoji} ${mode === "shop" ? `${label} Shop` : label}`, {
        fontSize: "20px",
        color: Theme.textGold,
        fontStyle: "bold"
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    elements.push(title);

    const sub = scene.add
      .text(
        cx,
        162,
        mode === "shop" ? `You have ${gameState.goldCoins} Gold Coins` : `Pick a ${label.slice(0, -1).toLowerCase()} to wear`,
        { fontSize: "13px", color: Theme.textMuted }
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    elements.push(sub);

    if (pageItems.length === 0) {
      const empty = scene.add
        .text(
          cx,
          280,
          mode === "shop" ? `You own every ${label.toLowerCase()} item!` : `Nothing owned yet.\nVisit the ${label} Shop to buy one.`,
          { fontSize: "14px", color: Theme.textMuted, align: "center" }
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(empty);
    }

    pageItems.forEach((def, i) => {
      const y = 165 + i * 58;
      const row = makeInset(scene, cx, y, 400, 48, 10);
      row.setScrollFactor(0).setDepth(200);
      elements.push(row);

      const isEquipped = mode === "wardrobe" && currentlyEquipped() === def.id;

      // Preview: the real drawn accessory texture (see
      // BootScene.ts's createAccessoryTextures) scaled up so it's legible
      // in the row, or a small character-sheet thumbnail (frame 1) for pets.
      // Row-relative offsets from `cx` (was 219/252/370/540 relative to the
      // literal 400) - see this function's own `cx` comment above.
      const preview =
        def.category === "ACCESSORY"
          ? scene.add.image(cx - 181, y, def.textureKey ?? "acc_bow").setScale(2.2)
          : scene.add.image(cx - 181, y, def.textureKey ?? "npc2_sheet", 1).setScale(1.6);
      preview.setScrollFactor(0).setDepth(201);
      elements.push(preview);

      const nameLabel = scene.add
        .text(cx - 148, y, `${def.name}${isEquipped ? " (worn)" : ""}`, {
          fontSize: "14px",
          color: isEquipped ? Theme.textAccent : Theme.textPrimary,
          fontStyle: isEquipped ? "bold" : "normal"
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(nameLabel);

      if (mode === "shop") {
        const priceLabel = scene.add
          .text(cx - 30, y, `${def.price} Gold Coins`, { fontSize: "13px", color: Theme.textMuted })
          .setOrigin(0, 0.5)
          .setScrollFactor(0)
          .setDepth(201);
        elements.push(priceLabel);

        const canAfford = gameState.goldCoins >= def.price;
        const buyBtn = makeButton(
          scene,
          cx + 140,
          y,
          90,
          42,
          "Buy",
          canAfford ? Theme.accent : Theme.neutral,
          canAfford ? Theme.accentHover : Theme.neutral,
          () => {
            // Same "a purchase also equips it" product decision the
            // wardrobe makes (see economy/itemShop.ts's purchaseItem doc comment).
            buyBtn.setEnabled(false);
            api
              .buyItem(def.id)
              .then((res) => {
                // Retention Leg 1: what players spend their Gold Coins on -
                // catalog id and price only, both already-public catalog
                // facts. Fired on the server's confirmed success, never
                // on the optimistic click.
                track(EVENTS.ITEM_PURCHASED, { itemId: def.id, price: def.price });
                gameState.hydrateFromServer(res.user);
                applyEquipped();
                host.updateHud();
                host.showToast(`✓ Bought & wearing ${def.name}!`, Theme.textAccent);
                playSfx(scene, "confirm");
                render();
              })
              .catch((err) => {
                host.showToast(describeShopError(err, `buy ${def.name}`), Theme.textDanger);
                playSfx(scene, "error");
                render();
              });
          }
        );
        if (!canAfford) buyBtn.setEnabled(false);
        buyBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(buyBtn.container);
      } else if (isEquipped) {
        // "wearing nothing" is a valid state for accessories/pets (as it
        // is for every wardrobe slot but BODY) - the currently-worn
        // row gets an active "Take Off" button instead of a disabled
        // "Worn" one.
        const takeOffBtn = makeButton(scene, 540, y, 90, 42, "Take Off", Theme.danger, Theme.dangerHover, () => {
          takeOffBtn.setEnabled(false);
          api
            .unequipItem(category)
            .then((res) => {
              gameState.hydrateFromServer(res.user);
              applyEquipped();
              render();
            })
            .catch((err) => {
              host.showToast(describeShopError(err, `take off ${def.name}`), Theme.textDanger);
              render();
            });
        });
        takeOffBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(takeOffBtn.container);
      } else {
        const wearBtn = makeButton(scene, 540, y, 90, 42, "Wear", Theme.accent, Theme.accentHover, () => {
          wearBtn.setEnabled(false);
          api
            .equipItem(def.id)
            .then((res) => {
              // Retention Leg 1: equipping is the "do players care about
              // the cosmetics they bought" signal - a bought-and-never-
              // worn item is a very different product answer to a
              // bought-and-worn one.
              track(EVENTS.ITEM_EQUIPPED, { itemId: def.id });
              gameState.hydrateFromServer(res.user);
              applyEquipped();
              render();
            })
            .catch((err) => {
              host.showToast(describeShopError(err, `wear ${def.name}`), Theme.textDanger);
              render();
            });
        });
        wearBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(wearBtn.container);
      }
    });

    if (totalPages > 1) {
      const pageLabel = scene.add
        .text(cx, 405, `Page ${page + 1} / ${totalPages}`, { fontSize: "12px", color: Theme.textMuted })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(pageLabel);

      if (page > 0) {
        const prevBtn = makeButton(scene, cx - 110, 405, 90, 34, "◀ Prev", Theme.neutral, Theme.neutralHover, () => {
          page--;
          render();
        });
        prevBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(prevBtn.container);
      }
      if (page < totalPages - 1) {
        const nextBtn = makeButton(scene, cx + 110, 405, 90, 34, "Next ▶", Theme.neutral, Theme.neutralHover, () => {
          page++;
          render();
        });
        nextBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(nextBtn.container);
      }
    }

    const closeBtn = makeButton(scene, cx, 450, 140, 40, "Close", Theme.danger, Theme.dangerHover, () => {
      cleanup();
      host.setPanelOpen(false);
      host.updateHud();
    });
    closeBtn.container.setScrollFactor(0).setDepth(201);
    elements.push(closeBtn.container);
  };

  render();
}


/**
 * Slot picker - the entry point to the layered wardrobe, shown after
 * choosing "Clothing" from the category menu.
 *
 * This step exists because a character is now a stack rather than a single
 * look: there is no one list of "outfits" to show any more, so the player
 * first says which layer they're shopping for. Six slots in two columns fit
 * one panel with no pagination, which keeps the extra tap cheap.
 *
 * Each button shows what's currently worn in that slot, so the picker
 * doubles as a summary of the whole outfit - the closest thing the wardrobe
 * has to "here is your character".
 */
export function openWardrobeSlotMenu(host: ShopPanelHost, mode: ShopMode) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");

  // Live canvas center, not a literal 400 - see openShopCategoryMenu's own
  // comment above and ui/Layout.ts.
  const cx = liveCenterX(scene);

  let elements: Phaser.GameObjects.GameObject[] = [];
  const cleanup = () => {
    elements.forEach((e) => e.destroy());
    elements = [];
  };

  const panel = makePanel(scene, cx, 300, 460, 400, 200).setScrollFactor(0);
  elements.push(panel);

  const title = scene.add
    .text(cx, 145, mode === "shop" ? "🧥 Clothing Shop" : "👕 Wardrobe", {
      fontSize: "20px",
      color: Theme.textGold,
      fontStyle: "bold"
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(201);
  elements.push(title);

  const sub = scene.add
    .text(
      cx,
      168,
      mode === "shop" ? `You have ${gameState.goldCoins} Gold Coins` : "Pick a layer to change",
      { fontSize: "13px", color: Theme.textMuted }
    )
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(201);
  elements.push(sub);

  // Two columns of three. WARDROBE_SLOTS is already in draw order (body
  // first, hat last), which also reads as a sensible dressing order.
  WARDROBE_SLOTS.forEach((slotDef, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = cx + (col === 0 ? -105 : 105);
    const y = 215 + row * 62;

    const wornId = gameState.wornInSlot(slotDef.slot);
    const worn = wornId ? getPieceName(wornId) : "Nothing";

    const btn = makeButton(
      scene,
      x,
      y,
      190,
      50,
      `${slotDef.name}\n${worn}`,
      Theme.accent,
      Theme.accentHover,
      () => {
        cleanup();
        openWardrobePanel(host, slotDef.slot, mode);
      }
    );
    btn.container.setScrollFactor(0).setDepth(201);
    elements.push(btn.container);
  });

  const closeBtn = makeButton(scene, cx, 450, 140, 40, "Close", Theme.danger, Theme.dangerHover, () => {
    cleanup();
    host.setPanelOpen(false);
    host.updateHud();
  });
  closeBtn.container.setScrollFactor(0).setDepth(201);
  elements.push(closeBtn.container);
}

/** Display name for a piece id, falling back to the raw id for a piece pulled from the catalogue after someone equipped it. */
function getPieceName(id: string): string {
  return getPiece(id)?.name ?? id;
}

/**
 * One slot's pieces - buy them ("shop") or wear ones you already own
 * ("wardrobe"). Structurally the same paginated panel as openItemPanel
 * above, and it deliberately keeps that panel's exact geometry (row
 * spacing, button positions, the mobile-crop-safe y=[130,470] zone) so
 * the whole shop still feels like one thing.
 *
 * Two things differ from the accessory/pet panel, both consequences of
 * layering:
 *
 *  - The preview is a real two-layer render - the default body with this
 *    piece drawn on top - rather than a single sprite. A shirt on its own
 *    is an unreadable floating shape; on a body it's a shirt. This is the
 *    same "stack of layers" the overworld draws, at panel scale.
 *  - "Take Off" appears for every slot except BODY, whose slot definition
 *    is `optional: false`. The server refuses to unequip it too - this is
 *    the UI half of the same never-invisible-player rule.
 */
export function openWardrobePanel(host: ShopPanelHost, slot: WardrobeSlot, mode: ShopMode) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");
  let page = 0;
  const itemsPerPage = 4;
  let elements: Phaser.GameObjects.GameObject[] = [];

  // Live canvas center, not a literal 400 - see openShopCategoryMenu's own
  // comment above and ui/Layout.ts. Every row position below is expressed
  // as an offset from this so the whole panel stays aligned as one block.
  const cx = liveCenterX(scene);

  const slotDef = getSlotDef(slot);
  const slotName = slotDef?.name ?? slot;

  const getItems = (): WardrobePieceDef[] =>
    mode === "shop"
      ? listPiecesBySlot(slot).filter((p) => !gameState.ownsWardrobePiece(p.id))
      : listPiecesBySlot(slot).filter((p) => gameState.ownsWardrobePiece(p.id));

  const cleanup = () => {
    elements.forEach((e) => e.destroy());
    elements = [];
  };

  /**
   * Draws the piece the way it will actually look: the default body with
   * this piece layered over it, at the LPC down-facing standing frame.
   *
   * Degrades the same way the overworld does - a layer whose texture is
   * missing is skipped rather than drawn as Phaser's missing-texture
   * checkerboard, so a piece with no art yet previews as a plain body
   * instead of a broken image.
   */
  const addPreview = (piece: WardrobePieceDef, x: number, y: number) => {
    const standingFrame = idleFrame(LPC_RIG, "down");
    const keys = piece.slot === "BODY" ? [piece.id] : [DEFAULT_BODY_PIECE_ID, piece.id];

    for (const key of keys) {
      if (!scene.textures.exists(key) || scene.textures.get(key).key === "__MISSING") continue;
      const sprite = scene.add
        .image(x, y, key, standingFrame)
        .setOrigin(0.5)
        .setScale(0.62)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(sprite);
    }
  };

  const render = () => {
    cleanup();
    const items = getItems();
    const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
    page = Phaser.Math.Clamp(page, 0, totalPages - 1);
    const pageItems = items.slice(page * itemsPerPage, page * itemsPerPage + itemsPerPage);

    const panel = makePanel(scene, cx, 300, 460, 440, 200).setScrollFactor(0);
    elements.push(panel);

    const title = scene.add
      .text(cx, 140, `${mode === "shop" ? "🧥" : "👕"} ${slotName}`, {
        fontSize: "20px",
        color: Theme.textGold,
        fontStyle: "bold"
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    elements.push(title);

    const sub = scene.add
      .text(
        cx,
        162,
        mode === "shop" ? `You have ${gameState.goldCoins} Gold Coins` : `Pick a ${slotName.toLowerCase()} to wear`,
        { fontSize: "13px", color: Theme.textMuted }
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    elements.push(sub);

    if (pageItems.length === 0) {
      const empty = scene.add
        .text(
          cx,
          280,
          mode === "shop"
            ? `You own every ${slotName.toLowerCase()} option!`
            : `Nothing owned yet.\nVisit the Item Shop to buy some.`,
          { fontSize: "14px", color: Theme.textMuted, align: "center" }
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(empty);
    }

    pageItems.forEach((def, i) => {
      const y = 165 + i * 58;
      const row = makeInset(scene, cx, y, 400, 48, 10);
      row.setScrollFactor(0).setDepth(200);
      elements.push(row);

      const isWorn = mode === "wardrobe" && gameState.wornInSlot(slot) === def.id;

      addPreview(def, cx - 181, y);

      const nameLabel = scene.add
        .text(cx - 148, y, `${def.name}${isWorn ? " (worn)" : ""}`, {
          fontSize: "14px",
          color: isWorn ? Theme.textAccent : Theme.textPrimary,
          fontStyle: isWorn ? "bold" : "normal"
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(nameLabel);

      if (mode === "shop") {
        const priceLabel = scene.add
          .text(cx - 30, y, `${def.price} Gold Coins`, { fontSize: "13px", color: Theme.textMuted })
          .setOrigin(0, 0.5)
          .setScrollFactor(0)
          .setDepth(201);
        elements.push(priceLabel);

        const canAfford = gameState.goldCoins >= def.price;
        const buyBtn = makeButton(
          scene,
          cx + 140,
          y,
          90,
          42,
          "Buy",
          canAfford ? Theme.accent : Theme.neutral,
          canAfford ? Theme.accentHover : Theme.neutral,
          () => {
            // POST /wardrobe/buy - GC-only, server-authoritative. The
            // affordability/ownership checks above are optimistic UI only;
            // the server re-checks both and is the one that decides. A
            // purchase also wears the piece server-side (see
            // economy/wardrobe.ts), so the player's character has to be
            // rebuilt here, not just the balance refreshed.
            buyBtn.setEnabled(false);
            api
              .buyWardrobePiece(def.id)
              .then((res) => {
                // Retention Leg 1: what players spend Gold Coins on - catalog
                // id, slot and price, all already-public catalog facts.
                // Fired on the server's confirmed success, never on the
                // optimistic click.
                track(EVENTS.WARDROBE_PURCHASED, {
                  pieceId: def.id,
                  slot: def.slot,
                  price: def.price
                });
                gameState.hydrateFromServer(res.user);
                host.applyPlayerWardrobe();
                host.updateHud();
                host.showToast(`✓ Bought & wearing ${def.name}!`, Theme.textAccent);
                playSfx(scene, "confirm");
                render();
                // Onboarding tutorial's Item Shop hands-on step listens for
                // this - a harmless no-op emit when no tutorial is running.
                scene.events.emit("tutorial:wardrobePurchased");
              })
              .catch((err) => {
                host.showToast(describeShopError(err, `buy ${def.name}`), Theme.textDanger);
                playSfx(scene, "error");
                render();
              });
          }
        );
        if (!canAfford) buyBtn.setEnabled(false);
        buyBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(buyBtn.container);
      } else if (isWorn && slotDef?.optional) {
        // "Wearing nothing" is valid for every slot but BODY, so the worn
        // row gets an active "Take Off" rather than a disabled "Worn".
        const takeOffBtn = makeButton(scene, cx + 140, y, 90, 42, "Take Off", Theme.danger, Theme.dangerHover, () => {
          takeOffBtn.setEnabled(false);
          api
            .unequipWardrobeSlot(slot)
            .then((res) => {
              gameState.hydrateFromServer(res.user);
              host.applyPlayerWardrobe();
              render();
            })
            .catch((err) => {
              host.showToast(describeShopError(err, `take off ${def.name}`), Theme.textDanger);
              render();
            });
        });
        takeOffBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(takeOffBtn.container);
      } else {
        const wearBtn = makeButton(
          scene,
          cx + 140,
          y,
          90,
          42,
          isWorn ? "Worn" : "Wear",
          isWorn ? Theme.neutral : Theme.accent,
          isWorn ? Theme.neutral : Theme.accentHover,
          () => {
            wearBtn.setEnabled(false);
            api
              .equipWardrobePiece(def.id)
              .then((res) => {
                track(EVENTS.ITEM_EQUIPPED, { pieceId: def.id, slot: def.slot });
                gameState.hydrateFromServer(res.user);
                host.applyPlayerWardrobe();
                render();
              })
              .catch((err) => {
                host.showToast(describeShopError(err, `wear ${def.name}`), Theme.textDanger);
                render();
              });
          }
        );
        if (isWorn) wearBtn.setEnabled(false);
        wearBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(wearBtn.container);
      }
    });

    if (totalPages > 1) {
      const pageLabel = scene.add
        .text(cx, 405, `Page ${page + 1} / ${totalPages}`, {
          fontSize: "12px",
          color: Theme.textMuted
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(pageLabel);

      if (page > 0) {
        const prevBtn = makeButton(scene, cx - 110, 405, 90, 34, "◀ Prev", Theme.neutral, Theme.neutralHover, () => {
          page--;
          render();
        });
        prevBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(prevBtn.container);
      }
      if (page < totalPages - 1) {
        const nextBtn = makeButton(scene, cx + 110, 405, 90, 34, "Next ▶", Theme.neutral, Theme.neutralHover, () => {
          page++;
          render();
        });
        nextBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(nextBtn.container);
      }
    }

    // "Back" rather than "Close": this panel is now one level deep (the
    // slot picker fronts it), so the natural exit is up a level.
    const backBtn = makeButton(scene, cx, 450, 140, 40, "Back", Theme.neutral, Theme.neutralHover, () => {
      cleanup();
      openWardrobeSlotMenu(host, mode);
    });
    backBtn.container.setScrollFactor(0).setDepth(201);
    elements.push(backBtn.container);
  };

  render();
}
