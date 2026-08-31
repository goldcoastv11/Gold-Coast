import Phaser from "phaser";
import { gameState } from "../GameState";
import { FURNITURE_CATALOG, FURNITURE_SLOTS, FurniturePieceDef, FurnitureSlotId, getFurnitureSlotDef } from "../furnitureCatalog";
import { Theme } from "./Theme";
import { makeButton, makePanel, makeInset } from "./uiHelpers";
import { liveCenterX } from "./Layout";
import { isolateFixedUi } from "./sceneCameraSplit";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { track, EVENTS } from "../api/track";
import { playSfx } from "./SoundManager";

/**
 * The Player Room's furniture panel (roadmap/room-furniture) - a
 * slot-position picker fronting a shared piece list, the furniture
 * equivalent of RoomPanel.ts's slot->piece two-level shape but adapted for
 * a genuinely different data model (see furnitureCatalog.ts's header):
 *
 *   - Buying a piece does NOT place it - a "Buy" tap only debits GC and
 *     adds it to inventory (economy/furniture.ts's purchaseFurniture never
 *     equips). Placing is always its own explicit "Place"/"Move here" tap.
 *   - Any piece can go in any slot (no per-slot catalogue the way
 *     RoomPanel.ts's listPiecesBySlot gives WALLPAPER/FLOORING), so the
 *     piece list shown here is the same five pieces regardless of which
 *     slot was tapped.
 *   - A slot can be genuinely EMPTY, and "Remove" is a real, separate
 *     action - RoomPanel.ts has no equivalent since neither of its slots
 *     can ever be empty.
 */

export interface FurniturePanelHost {
  readonly scene: Phaser.Scene;
  setPanelOpen(open: boolean): void;
  updateHud(): void;
  showToast(message: string, color: string): void;
  /** Re-reads gameState.placedFurniture and repaints the four furniture slot images. */
  applyFurniture(): void;
}

function describeFurnitureError(err: unknown, action: string): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "INSUFFICIENT_GC":
        return "Not enough Gold Coins.";
      case "ALREADY_OWNED":
        return "You already own that.";
      case "NOT_FOUND":
        return "That piece doesn't exist - try again.";
      case "NOT_OWNED":
        return "Buy it first.";
      case "SLOT_NOT_FOUND":
        return "That spot doesn't exist - try again.";
      default:
        return err.message;
    }
  }
  if (err instanceof NetworkError) return err.message;
  return `Couldn't ${action} - try again.`;
}

/** Top-level entry point - the Room's "🪑 Furniture" button opens this. Lists the four slots and what's (if anything) in each. */
export function openFurnitureMenu(host: FurniturePanelHost) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");

  // X from the live canvas, not a literal 400 - main.ts can widen the
  // canvas well past 800 on a wide mobile-landscape phone (see its own
  // scale-config comment), and a fixed 400 would leave this panel
  // left-of-true-center there.
  const cx = liveCenterX(scene);

  const elements: Phaser.GameObjects.GameObject[] = [];
  const cleanup = () => elements.forEach((e) => e.destroy());

  const panelHeight = 100 + FURNITURE_SLOTS.length * 60 + 60;
  const panel = makePanel(scene, cx, 300, 420, panelHeight, 200).setScrollFactor(0);
  elements.push(panel);

  const panelTop = 300 - panelHeight / 2;

  const title = scene.add
    .text(cx, panelTop + 30, "🪑 Furniture", { fontSize: "20px", color: Theme.textGold, fontStyle: "bold" })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(201);
  elements.push(title);

  const sub = scene.add
    .text(cx, panelTop + 52, "Tap a spot to fill, move or clear it", {
      fontSize: "12px",
      color: Theme.textMuted
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(201);
  elements.push(sub);

  FURNITURE_SLOTS.forEach((slotDef, i) => {
    const y = panelTop + 88 + i * 60;
    const pieceId = gameState.furniturePieceInSlot(slotDef.id);
    const pieceName = pieceId ? FURNITURE_CATALOG.find((p) => p.id === pieceId)?.name ?? pieceId : null;

    const btn = makeButton(
      scene,
      cx,
      y,
      340,
      48,
      pieceName ? `${slotDef.name} — ${pieceName}` : `${slotDef.name} — Empty`,
      pieceName ? Theme.accent : Theme.neutral,
      pieceName ? Theme.accentHover : Theme.neutralHover,
      () => {
        cleanup();
        openFurniturePiecePanel(host, slotDef.id);
      }
    );
    btn.container.setScrollFactor(0).setDepth(201);
    elements.push(btn.container);
  });

  const closeBtn = makeButton(
    scene,
    cx,
    panelTop + 88 + FURNITURE_SLOTS.length * 60 + 4,
    140,
    40,
    "Close",
    Theme.neutral,
    Theme.neutralHover,
    () => {
      cleanup();
      host.setPanelOpen(false);
    }
  );
  closeBtn.container.setScrollFactor(0).setDepth(201);
  elements.push(closeBtn.container);
  // Screen-fixed - see ui/sceneCameraSplit.ts's header.
  isolateFixedUi(scene, elements);
}

/** One slot's piece list - buy an unowned piece (inventory only, does not place), place/move an owned one here, or remove the slot's current occupant. */
export function openFurniturePiecePanel(host: FurniturePanelHost, slot: FurnitureSlotId) {
  const scene = host.scene;
  playSfx(scene, "open");
  // X from the live canvas, not a literal 400 - see openFurnitureMenu's own
  // comment above.
  const cx = liveCenterX(scene);
  let elements: Phaser.GameObjects.GameObject[] = [];

  const slotName = getFurnitureSlotDef(slot)?.name ?? slot;
  const pieces = FURNITURE_CATALOG;

  const cleanup = () => {
    elements.forEach((e) => e.destroy());
    elements = [];
  };

  const render = () => {
    cleanup();

    const occupantId = gameState.furniturePieceInSlot(slot);
    const panelHeight = 60 + pieces.length * 58 + (occupantId ? 106 : 60);
    const panel = makePanel(scene, cx, 300, 460, panelHeight, 200).setScrollFactor(0);
    elements.push(panel);

    const panelTop = 300 - panelHeight / 2;

    const title = scene.add
      .text(cx, panelTop + 30, `🪑 ${slotName}`, {
        fontSize: "20px",
        color: Theme.textGold,
        fontStyle: "bold"
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    elements.push(title);

    const sub = scene.add
      .text(cx, panelTop + 52, `You have ${gameState.goldCoins} Gold Coins`, {
        fontSize: "13px",
        color: Theme.textMuted
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    elements.push(sub);

    // Row-relative x's below (swatch/name/price/buy-place) were literal
    // absolute positions (219/245/540) derived from the panel's old fixed
    // center 400 (panel left edge 400-230=170, so e.g. 219=170+49) - now
    // offset from the live `cx` the same way instead (see RoomPanel.ts's
    // identical comment - this is the same layout, adapted for furniture).
    const rowLeft = cx - 230;
    pieces.forEach((def: FurniturePieceDef, i: number) => {
      const y = panelTop + 78 + i * 58;
      const row = makeInset(scene, cx, y, 400, 48, 10);
      row.setScrollFactor(0).setDepth(200);
      elements.push(row);

      const swatch = scene.add.rectangle(rowLeft + 49, y, 28, 28, def.placeholderColor).setScrollFactor(0).setDepth(201);
      swatch.setStrokeStyle(1, Theme.outline, 0.4);
      elements.push(swatch);

      const owned = gameState.ownsFurniturePiece(def.id);
      const placedSlot = gameState.furnitureSlotOf(def.id);
      const placedHere = placedSlot === slot;

      const nameLabel = scene.add
        .text(rowLeft + 75, y, `${def.name}${placedHere ? " (here)" : ""}`, {
          fontSize: "14px",
          color: placedHere ? Theme.textAccent : Theme.textPrimary,
          fontStyle: placedHere ? "bold" : "normal"
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(nameLabel);

      if (!owned) {
        const priceLabel = scene.add
          .text(rowLeft + 75, y + 16, `${def.price} Gold Coins`, { fontSize: "12px", color: Theme.textMuted })
          .setOrigin(0, 0.5)
          .setScrollFactor(0)
          .setDepth(201);
        elements.push(priceLabel);

        const canAfford = gameState.goldCoins >= def.price;
        const buyBtn = makeButton(
          scene,
          rowLeft + 370,
          y,
          90,
          42,
          "Buy",
          canAfford ? Theme.accent : Theme.neutral,
          canAfford ? Theme.accentHover : Theme.neutral,
          () => {
            buyBtn.setEnabled(false);
            api
              .buyFurniturePiece(def.id)
              .then((res) => {
                track(EVENTS.FURNITURE_PURCHASED, { pieceId: def.id, price: def.price });
                gameState.hydrateFromServer(res.user);
                host.updateHud();
                host.showToast(`✓ Bought ${def.name} - now place it!`, Theme.textAccent);
                playSfx(scene, "confirm");
                render();
              })
              .catch((err) => {
                host.showToast(describeFurnitureError(err, `buy ${def.name}`), Theme.textDanger);
                playSfx(scene, "error");
                render();
              });
          }
        );
        if (!canAfford) buyBtn.setEnabled(false);
        buyBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(buyBtn.container);
      } else {
        const label = placedHere ? "Here" : placedSlot ? "Move here" : "Place";
        const placeBtn = makeButton(
          scene,
          rowLeft + 370,
          y,
          90,
          42,
          label,
          placedHere ? Theme.neutral : Theme.accent,
          placedHere ? Theme.neutral : Theme.accentHover,
          () => {
            placeBtn.setEnabled(false);
            api
              .placeFurniturePiece(def.id, slot)
              .then((res) => {
                track(EVENTS.FURNITURE_PLACED, { pieceId: def.id, slot });
                gameState.hydrateFromServer(res.user);
                host.applyFurniture();
                render();
              })
              .catch((err) => {
                host.showToast(describeFurnitureError(err, `place ${def.name}`), Theme.textDanger);
                render();
              });
          }
        );
        if (placedHere) placeBtn.setEnabled(false);
        placeBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(placeBtn.container);
      }
    });

    if (occupantId) {
      const removeBtn = makeButton(
        scene,
        cx,
        panelTop + 78 + pieces.length * 58 + 24,
        280,
        42,
        "Remove from this spot",
        Theme.danger,
        Theme.dangerHover,
        () => {
          removeBtn.setEnabled(false);
          api
            .removeFurniturePiece(slot)
            .then((res) => {
              track(EVENTS.FURNITURE_PLACED, { slot });
              gameState.hydrateFromServer(res.user);
              host.applyFurniture();
              render();
            })
            .catch((err) => {
              host.showToast(describeFurnitureError(err, "remove that"), Theme.textDanger);
              render();
            });
        }
      );
      removeBtn.container.setScrollFactor(0).setDepth(201);
      elements.push(removeBtn.container);
    }

    const backBtn = makeButton(
      scene,
      cx,
      panelTop + 78 + pieces.length * 58 + (occupantId ? 74 : 20),
      140,
      40,
      "Back",
      Theme.neutral,
      Theme.neutralHover,
      () => {
        cleanup();
        openFurnitureMenu(host);
      }
    );
    backBtn.container.setScrollFactor(0).setDepth(201);
    elements.push(backBtn.container);
    // Screen-fixed - see ui/sceneCameraSplit.ts's header.
    isolateFixedUi(scene, elements);
  };

  render();
}
