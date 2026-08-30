import Phaser from "phaser";
import { gameState } from "../GameState";
import { ROOM_SLOTS, RoomPieceDef, RoomSlot, getSlotDef, listPiecesBySlot } from "../roomCatalog";
import { Theme } from "./Theme";
import { makeButton, makePanel, makeInset } from "./uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { track, EVENTS } from "../api/track";
import { playSfx } from "./SoundManager";

/**
 * The Player Room's decorate panel - a slot picker (Wallpaper/Flooring)
 * fronting a per-slot piece list, same two-level shape as
 * ShopPanel.ts's wardrobe picker, scaled down for a two-slot, six-piece
 * catalogue.
 *
 * Deliberately ONE list per slot rather than ShopPanel's separate
 * shop/wardrobe modes: with only 2-3 pieces per slot there's no pagination
 * pressure, and a player deciding between "buy the one I don't have" and
 * "switch back to one I do" is naturally the same screen at this size -
 * splitting it into two modes would just be an extra tap for no benefit.
 *
 * Swatches are flat colour chips (`piece.placeholderColor`), not a live
 * render of the actual tile - the real texture is tiny (16x16) and reads
 * better at room scale than shrunk into a UI thumbnail; the swatch is only
 * here to distinguish rows at a glance.
 */

export interface RoomPanelHost {
  readonly scene: Phaser.Scene;
  setPanelOpen(open: boolean): void;
  updateHud(): void;
  showToast(message: string, color: string): void;
  /** Re-reads gameState.equippedRoom and repaints the wallpaper/flooring tiles. */
  applyRoomDecor(): void;
}

function describeRoomError(err: unknown, action: string): string {
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
      default:
        return err.message;
    }
  }
  if (err instanceof NetworkError) return err.message;
  return `Couldn't ${action} - try again.`;
}

const SLOT_EMOJI: Record<RoomSlot, string> = {
  WALLPAPER: "🖼️",
  FLOORING: "🧱"
};

/** Top-level entry point - the Room's "🎨 Decorate" button opens this. */
export function openRoomSlotMenu(host: RoomPanelHost) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");

  const elements: Phaser.GameObjects.GameObject[] = [];
  const cleanup = () => elements.forEach((e) => e.destroy());

  const panel = makePanel(scene, 400, 300, 380, 260, 200).setScrollFactor(0);
  elements.push(panel);

  const title = scene.add
    .text(400, 210, "🎨 Decorate", { fontSize: "20px", color: Theme.textGold, fontStyle: "bold" })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(201);
  elements.push(title);

  ROOM_SLOTS.forEach((slotDef, i) => {
    const y = 260 + i * 60;
    const btn = makeButton(
      scene,
      400,
      y,
      280,
      48,
      `${SLOT_EMOJI[slotDef.slot]} ${slotDef.name}`,
      Theme.neutral,
      Theme.neutralHover,
      () => {
        cleanup();
        openRoomPiecePanel(host, slotDef.slot);
      }
    );
    btn.container.setScrollFactor(0).setDepth(201);
    elements.push(btn.container);
  });

  const closeBtn = makeButton(scene, 400, 260 + ROOM_SLOTS.length * 60 + 4, 140, 40, "Close", Theme.neutral, Theme.neutralHover, () => {
    cleanup();
    host.setPanelOpen(false);
  });
  closeBtn.container.setScrollFactor(0).setDepth(201);
  elements.push(closeBtn.container);
}

/** One slot's piece list - buy an unowned piece (which also applies it) or apply an already-owned one. */
export function openRoomPiecePanel(host: RoomPanelHost, slot: RoomSlot) {
  const scene = host.scene;
  playSfx(scene, "open");
  let elements: Phaser.GameObjects.GameObject[] = [];

  const slotDef = getSlotDef(slot);
  const slotName = slotDef?.name ?? slot;
  const pieces = listPiecesBySlot(slot);

  const cleanup = () => {
    elements.forEach((e) => e.destroy());
    elements = [];
  };

  const render = () => {
    cleanup();

    const panel = makePanel(scene, 400, 300, 460, 60 + pieces.length * 58 + 60, 200).setScrollFactor(0);
    elements.push(panel);

    const panelTop = 300 - (60 + pieces.length * 58 + 60) / 2;

    const title = scene.add
      .text(400, panelTop + 30, `${SLOT_EMOJI[slot]} ${slotName}`, {
        fontSize: "20px",
        color: Theme.textGold,
        fontStyle: "bold"
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    elements.push(title);

    const sub = scene.add
      .text(400, panelTop + 52, `You have ${gameState.goldCoins} Gold Coins`, {
        fontSize: "13px",
        color: Theme.textMuted
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
    elements.push(sub);

    pieces.forEach((def: RoomPieceDef, i: number) => {
      const y = panelTop + 78 + i * 58;
      const row = makeInset(scene, 400, y, 400, 48, 10);
      row.setScrollFactor(0).setDepth(200);
      elements.push(row);

      const swatch = scene.add.rectangle(219, y, 28, 28, def.placeholderColor).setScrollFactor(0).setDepth(201);
      swatch.setStrokeStyle(1, Theme.outline, 0.4);
      elements.push(swatch);

      const owned = gameState.ownsRoomPiece(def.id);
      const applied = gameState.roomPieceInSlot(slot) === def.id;

      const nameLabel = scene.add
        .text(245, y, `${def.name}${applied ? " (applied)" : ""}`, {
          fontSize: "14px",
          color: applied ? Theme.textAccent : Theme.textPrimary,
          fontStyle: applied ? "bold" : "normal"
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(201);
      elements.push(nameLabel);

      if (!owned) {
        const priceLabel = scene.add
          .text(245, y + 16, `${def.price} Gold Coins`, { fontSize: "12px", color: Theme.textMuted })
          .setOrigin(0, 0.5)
          .setScrollFactor(0)
          .setDepth(201);
        elements.push(priceLabel);

        const canAfford = gameState.goldCoins >= def.price;
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
            buyBtn.setEnabled(false);
            api
              .buyRoomPiece(def.id)
              .then((res) => {
                track(EVENTS.ROOM_DECOR_PURCHASED, { pieceId: def.id, slot: def.slot, price: def.price });
                gameState.hydrateFromServer(res.user);
                host.applyRoomDecor();
                host.updateHud();
                host.showToast(`✓ Bought & applied ${def.name}!`, Theme.textAccent);
                playSfx(scene, "confirm");
                render();
              })
              .catch((err) => {
                host.showToast(describeRoomError(err, `buy ${def.name}`), Theme.textDanger);
                playSfx(scene, "error");
                render();
              });
          }
        );
        if (!canAfford) buyBtn.setEnabled(false);
        buyBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(buyBtn.container);
      } else {
        const applyBtn = makeButton(
          scene,
          540,
          y,
          90,
          42,
          applied ? "Applied" : "Apply",
          applied ? Theme.neutral : Theme.accent,
          applied ? Theme.neutral : Theme.accentHover,
          () => {
            applyBtn.setEnabled(false);
            api
              .equipRoomPiece(def.id)
              .then((res) => {
                gameState.hydrateFromServer(res.user);
                host.applyRoomDecor();
                render();
              })
              .catch((err) => {
                host.showToast(describeRoomError(err, `apply ${def.name}`), Theme.textDanger);
                render();
              });
          }
        );
        if (applied) applyBtn.setEnabled(false);
        applyBtn.container.setScrollFactor(0).setDepth(201);
        elements.push(applyBtn.container);
      }
    });

    const backBtn = makeButton(
      scene,
      400,
      panelTop + 78 + pieces.length * 58 + 20,
      140,
      40,
      "Back",
      Theme.neutral,
      Theme.neutralHover,
      () => {
        cleanup();
        openRoomSlotMenu(host);
      }
    );
    backBtn.container.setScrollFactor(0).setDepth(201);
    elements.push(backBtn.container);
  };

  render();
}
