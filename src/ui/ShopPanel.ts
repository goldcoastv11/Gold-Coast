import Phaser from "phaser";
import { gameState } from "../GameState";
import { listSkins, SkinDef } from "../economy/skinShop";
import { ItemDef, ItemCategory, listItemsByCategory } from "../itemCatalog";
import { Theme } from "./Theme";
import { makeButton, makePanel, makeInset } from "./uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { track, EVENTS } from "../api/track";
import { playSfx } from "./SoundManager";

/**
 * The overworld's three shop/wardrobe panels - the category picker, the
 * accessory/pet panel, and the skin panel - lifted verbatim out of
 * OverworldScene.ts, which had grown to ~2,400 lines doing the casino
 * floor, the tutorial, the Coin Kiosk, the shuffle mini-game AND both of
 * these panels at once.
 *
 * This is a pure move: every coordinate, string, sound, tween, network call
 * and analytics event below is byte-for-byte what OverworldScene used to
 * run, so the panels look and behave exactly as they did before. Anything
 * that looked like a bug while moving was deliberately left as-is and
 * flagged in the pull request instead of fixed here - mixing a refactor
 * with fixes is what turns a "safe" cleanup into a regression.
 *
 * Everything the panels need from the scene that isn't the scene itself
 * (the panel-open flag, the HUD, the toast, the player sprite's skin, the
 * equipped accessory/pet visuals) comes in through ShopPanelHost below, so
 * this module never reaches back into OverworldScene's privates.
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
  /** Repaints the host's coin/ticket HUD after a balance change. */
  updateHud(): void;
  /** Brief fading confirmation/error message above the panel. */
  showToast(message: string, color: string): void;
  /** Re-reads gameState.equippedAccessory and updates the worn badge. */
  applyEquippedAccessory(): void;
  /** Re-reads gameState.equippedPet and updates the follower sprite. */
  applyEquippedPet(): void;
  /**
   * Points the player sprite at a newly bought/equipped skin's texture and
   * re-tunes its collision body + on-screen scale for whichever rig that
   * skin uses (16x16 Kenney vs 21x32 legacy). Both skin-panel call sites
   * ran the identical three lines, so they travel together as one host
   * call rather than three.
   */
  applyPlayerSkin(textureKey: string): void;
}

/** Turns a /skins/buy or /skins/equip failure into a short user-facing toast message. */
function describeSkinError(err: unknown, action: string): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "INSUFFICIENT_TICKETS":
        return "Not enough Tickets.";
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

/**
 * Small category picker shown before either openSkinPanel() or
 * openItemPanel() - both the Item Shop station and the Clothes corner
 * button now open this first, instead of jumping straight to skins.
 * Deliberately a separate entry step rather than folding a tab row into
 * openSkinPanel() itself: that panel's layout is already tightly packed
 * into the mobile-crop-safe zone (see its own SAFE_ZONE_TOP/BOTTOM-driven
 * Y coordinates) and is live in production - this keeps it (and its
 * skin-purchase flow) completely untouched, at the cost of one extra tap
 * to pick a category.
 */
export function openShopCategoryMenu(host: ShopPanelHost, mode: ShopMode) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");

  let elements: Phaser.GameObjects.GameObject[] = [];
  const cleanup = () => {
    elements.forEach((e) => e.destroy());
    elements = [];
  };

  const panel = makePanel(scene, 400, 260, 320, 220, 200).setScrollFactor(0);
  elements.push(panel);
  const title = scene.add
    .text(400, 190, mode === "shop" ? "🧥 Item Shop" : "👕 Wardrobe", {
      fontSize: "20px",
      color: Theme.textGold,
      fontStyle: "bold"
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(201);
  elements.push(title);
  const sub = scene.add
    .text(400, 214, "What would you like to browse?", { fontSize: "12px", color: Theme.textMuted })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(201);
  elements.push(sub);

  const goTo = (openNext: () => void) => {
    cleanup();
    openNext();
  };

  const buttons: Array<[string, () => void]> = [
    ["👕 Skins", () => openSkinPanel(host, mode)],
    ["🎩 Accessories", () => openItemPanel(host, "ACCESSORY", mode)],
    ["🐾 Pets", () => openItemPanel(host, "PET", mode)]
  ];
  buttons.forEach(([label, openNext], i) => {
    const btn = makeButton(scene, 400, 250 + i * 50, 260, 42, label, Theme.accent, Theme.accentHover, () =>
      goTo(openNext)
    );
    btn.container.setScrollFactor(0).setDepth(201);
    elements.push(btn.container);
  });

  const closeBtn = makeButton(scene, 400, 400, 140, 38, "Close", Theme.danger, Theme.dangerHover, () => {
    cleanup();
    host.setPanelOpen(false);
    host.updateHud();
  });
  closeBtn.container.setScrollFactor(0).setDepth(201);
  elements.push(closeBtn.container);
}

/**
 * Accessory/Pet browsing panel - structurally mirrors openSkinPanel()
 * below (same paginated shop/wardrobe shape) but is a fully independent
 * function reading ITEM_CATALOG instead of SKIN_CATALOG, so nothing here
 * can regress the live, already-shipped skin-purchase flow. Two real
 * differences from skins: the preview is an emoji (ACCESSORY) or a small
 * character-sheet thumbnail (PET) instead of a real skin portrait, and
 * "wearing nothing" is a valid state - the currently-equipped item's row
 * gets a "Take Off" button instead of a disabled "Worn" one.
 */
export function openItemPanel(host: ShopPanelHost, category: ItemCategory, mode: ShopMode) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");
  let page = 0;
  const itemsPerPage = 4;
  let elements: Phaser.GameObjects.GameObject[] = [];

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

    const panel = makePanel(scene, 400, 300, 460, 440, 200).setScrollFactor(0);
    elements.push(panel);

    const title = scene.add
      .text(400, 140, `${emoji} ${mode === "shop" ? `${label} Shop` : label}`, {
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
        400,
        162,
        mode === "shop" ? `You have ${gameState.tickets} Tickets` : `Pick a ${label.slice(0, -1).toLowerCase()} to wear`,
        { fontSize: "13px", color: Theme.textMuted }
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    elements.push(sub);

    if (pageItems.length === 0) {
      const empty = scene.add
        .text(
          400,
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
      const row = makeInset(scene, 400, y, 400, 48, 10);
      row.setScrollFactor(0).setDepth(200);
      elements.push(row);

      const isEquipped = mode === "wardrobe" && currentlyEquipped() === def.id;

      // Preview: the real drawn accessory texture (see
      // BootScene.ts's createAccessoryTextures) scaled up so it's legible
      // in the row, or a small character-sheet thumbnail (frame 1, same
      // convention openSkinPanel's own preview uses) for pets.
      const preview =
        def.category === "ACCESSORY"
          ? scene.add.image(219, y, def.textureKey ?? "acc_bow").setScale(2.2)
          : scene.add.image(219, y, def.textureKey ?? "npc2_sheet", 1).setScale(1.6);
      preview.setScrollFactor(0).setDepth(201);
      elements.push(preview);

      const nameLabel = scene.add
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
        const priceLabel = scene.add
          .text(370, y, `${def.price} Tickets`, { fontSize: "13px", color: Theme.textMuted })
          .setOrigin(0, 0.5)
          .setScrollFactor(0)
          .setDepth(201);
        elements.push(priceLabel);

        const canAfford = gameState.tickets >= def.price;
        const buyBtn = makeButton(
          scene,
          540,
          y,
          90,
          42,
          "Buy",
          canAfford ? Theme.accent : Theme.neutral,
          canAfford ? Theme.accentHover : Theme.neutral,
          () => {
            // Same "a purchase also equips it" product decision as
            // skins (see economy/itemShop.ts's purchaseItem doc comment).
            buyBtn.setEnabled(false);
            api
              .buyItem(def.id)
              .then((res) => {
                // Retention Leg 1: what players spend their TICKETS on -
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
                host.showToast(describeSkinError(err, `buy ${def.name}`), Theme.textDanger);
                playSfx(scene, "error");
                render();
              });
          }
        );
        if (!canAfford) buyBtn.setEnabled(false);
        buyBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(buyBtn.container);
      } else if (isEquipped) {
        // "wearing nothing" is a valid state for accessories/pets (unlike
        // skins, which always fall back to "player") - the currently-worn
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
              host.showToast(describeSkinError(err, `take off ${def.name}`), Theme.textDanger);
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
              host.showToast(describeSkinError(err, `wear ${def.name}`), Theme.textDanger);
              render();
            });
        });
        wearBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(wearBtn.container);
      }
    });

    if (totalPages > 1) {
      const pageLabel = scene.add
        .text(400, 405, `Page ${page + 1} / ${totalPages}`, { fontSize: "12px", color: Theme.textMuted })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(pageLabel);

      if (page > 0) {
        const prevBtn = makeButton(scene, 290, 405, 90, 34, "◀ Prev", Theme.neutral, Theme.neutralHover, () => {
          page--;
          render();
        });
        prevBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(prevBtn.container);
      }
      if (page < totalPages - 1) {
        const nextBtn = makeButton(scene, 510, 405, 90, 34, "Next ▶", Theme.neutral, Theme.neutralHover, () => {
          page++;
          render();
        });
        nextBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(nextBtn.container);
      }
    }

    const closeBtn = makeButton(scene, 400, 450, 140, 40, "Close", Theme.danger, Theme.dangerHover, () => {
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
 * Shared panel for both the Skin Attendant ("shop" - buy skins you don't
 * own) and the Clothes corner button ("wardrobe" - equip a skin you do
 * own). Paginated since the catalog is bigger than fits on one screen.
 */
export function openSkinPanel(host: ShopPanelHost, mode: ShopMode) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");
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

    const panel = makePanel(scene, 400, 300, 460, 440, 200).setScrollFactor(0);
    elements.push(panel);

    const title = scene.add
      .text(400, 140, mode === "shop" ? "🧥 Item Shop" : "👕 Wardrobe", {
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
        400,
        162,
        mode === "shop" ? `You have ${gameState.tickets} Tickets` : "Pick a look to wear",
        { fontSize: "13px", color: Theme.textMuted }
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    elements.push(sub);

    if (pageItems.length === 0) {
      const empty = scene.add
        .text(
          400,
          280,
          mode === "shop"
            ? "You own every skin!"
            : "Nothing owned yet.\nVisit the Item Shop to buy one.",
          { fontSize: "14px", color: Theme.textMuted, align: "center" }
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(empty);
    }

    pageItems.forEach((def, i) => {
      const y = 165 + i * 58;
      const row = makeInset(scene, 400, y, 400, 48, 10);
      row.setScrollFactor(0).setDepth(200);
      elements.push(row);

      const isEquipped = mode === "wardrobe" && gameState.currentSkin === def.id;

      // Small preview of the skin's idle-down pose, so you can see what
      // you're buying/wearing before committing
      const preview = scene.add
        .image(219, y, def.textureKey, 1)
        .setOrigin(0.5)
        .setScale(1.4)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(preview);

      const nameLabel = scene.add
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
        const priceLabel = scene.add
          .text(370, y, `${def.price} Tickets`, { fontSize: "13px", color: Theme.textMuted })
          .setOrigin(0, 0.5)
          .setScrollFactor(0)
          .setDepth(201);
        elements.push(priceLabel);

        const canAfford = gameState.tickets >= def.price;
        const buyBtn = makeButton(
          scene,
          540,
          y,
          90,
          42,
          "Buy",
          canAfford ? Theme.accent : Theme.neutral,
          canAfford ? Theme.accentHover : Theme.neutral,
          () => {
            // Task #37: POST /skins/buy - TICKETS-only, server-authoritative.
            // The canAfford/ownership checks above are optimistic UI only;
            // the server re-checks both (INSUFFICIENT_TICKETS/ALREADY_OWNED)
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
                // Retention Leg 1 - same rationale as the Item Shop's
                // buy handler above.
                track(EVENTS.SKIN_PURCHASED, { skinId: def.id, price: def.price });
                gameState.hydrateFromServer(res.user);
                host.applyPlayerSkin(def.textureKey);
                host.updateHud();
                host.showToast(`✓ Bought & wearing ${def.name}!`, Theme.textAccent);
                playSfx(scene, "confirm");
                render();
                // Onboarding tutorial's Skin Attendant hands-on step
                // (see startOnboardingTutorial) listens for this -
                // harmless no-op emit when the tutorial isn't running.
                scene.events.emit("tutorial:skinPurchased");
              })
              .catch((err) => {
                host.showToast(describeSkinError(err, `buy ${def.name}`), Theme.textDanger);
                playSfx(scene, "error");
                render();
              });
          }
        );
        if (!canAfford) buyBtn.setEnabled(false);
        buyBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(buyBtn.container);
      } else {
        const wearBtn = makeButton(
          scene,
          540,
          y,
          90,
          42,
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
                // Retention Leg 1 - same rationale as the item "Wear"
                // handler above.
                track(EVENTS.ITEM_EQUIPPED, { skinId: def.id });
                gameState.hydrateFromServer(res.user);
                // Re-tune the collision body and on-screen scale for
                // whichever rig this skin uses (16x16 Kenney vs 21x32
                // legacy) - see applyPlayerBody's/applyPlayerScale's comments.
                host.applyPlayerSkin(def.textureKey);
                render();
              })
              .catch((err) => {
                host.showToast(describeSkinError(err, `wear ${def.name}`), Theme.textDanger);
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
      // Y=405 (was 435) - see closeBtn's comment below, this row and
      // Close both had to move up together to fit the mobile-crop-safe
      // zone (y<=470) with Close still below this row.
      const pageLabel = scene.add
        .text(400, 405, `Page ${page + 1} / ${totalPages}`, {
          fontSize: "12px",
          color: Theme.textMuted
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(pageLabel);

      if (page > 0) {
        const prevBtn = makeButton(
          scene,
          290,
          405,
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
          scene,
          510,
          405,
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

    // Y=450, not the original 490 - keeps this button's full height
    // inside the measured mobile-crop-safe zone y=[130,470] (see
    // uiHelpers.ts's SAFE_ZONE_TOP/BOTTOM).
    const closeBtn = makeButton(scene, 400, 450, 140, 40, "Close", Theme.danger, Theme.dangerHover, () => {
      cleanup();
      host.setPanelOpen(false);
      host.updateHud();
    });
    closeBtn.container.setScrollFactor(0).setDepth(201);
    elements.push(closeBtn.container);
  };

  render();
}
