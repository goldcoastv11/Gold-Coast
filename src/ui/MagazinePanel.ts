import Phaser from "phaser";
import { Tokens } from "./DesignTokens";
import { makeButton, makePanel, makeText } from "./uiHelpers";
import { liveCenterX } from "./Layout";
import { playSfx } from "./SoundManager";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import type { MagazineResponse, MagazineRoomEntry } from "../api/types";
import { buildFloorTiles, buildFurnitureImages, buildWallImages } from "../roomRenderer";
import { fitRoomScale, wrapIndex } from "./magazineGeometry";
import { isolateFixedUi } from "./sceneCameraSplit";

/**
 * The Magazine (roadmap/magazine) - "a Magazine button that shows 5
 * players' rooms" (founder ask; usernames are shown on purpose, whose room
 * it is is part of the appeal). Read-only: this file never calls a
 * buy/place/remove endpoint - there is nothing here for a player to change,
 * only to look at.
 *
 * STRUCTURE follows ChallengesPanel.ts: one exported `open*` function, a
 * closure holding the panel's own state, a `render()` that destroys and
 * rebuilds everything from that state, a small host interface for the one
 * thing only the scene can do (the modal flag). STYLING is entirely
 * DesignTokens.ts, matching every other converted panel.
 *
 * DRAWING reuses ../roomRenderer.ts's buildFloorTiles/buildWallImages/
 * buildFurnitureImages - the exact same tile grid RoomScene.ts draws for
 * the player's OWN room - scaled down to fit a small "well" via a plain
 * Phaser Container (see fitRoomScale in ./magazineGeometry.ts), rather
 * than a second definition of what a room looks like.
 *
 * DAILY ROTATION lives entirely server-side (server/src/economy/
 * magazine.ts) - this panel just renders whatever GET /magazine returns
 * for "today" and lets the player step through it with Prev/Next
 * (wrapping at either end, see wrapIndex).
 */

export interface MagazinePanelHost {
  /** The scene the panel draws into. */
  readonly scene: Phaser.Scene;
  /** Raises/lowers the host's modal flag (real side effects on the host - see OverworldScene). */
  setPanelOpen(open: boolean): void;
}

// --- Geometry. Panel spans y 126-474, same budget as ChallengesPanel/
// QuickplayPanel - every element sits inside 130-470 (uiHelpers.ts's
// SAFE_ZONE_TOP/BOTTOM). The panel's center X (`cx` below) is computed
// inside openMagazinePanel from the live canvas width, not a fixed module
// const - main.ts can widen the canvas well past 800 on a wide mobile-
// landscape phone (see its own scale-config comment), and a fixed cx=400
// would leave this panel left-of-true-center there. ---
const PANEL_W = 664;
const PANEL_H = 348;
const DEPTH_PANEL = 200;
const DEPTH_CONTENT = 201;

/** Budget the scaled room is fit into (see fitRoomScale) - the room's own 800x608 aspect ratio means the actual rendered size ends up height-constrained here, narrower than WELL_MAX_W. */
const WELL_MAX_W = 460;
const WELL_MAX_H = 230;
const WELL_CY = 304;

function describeMagazineError(err: unknown): string {
  if (err instanceof NetworkError) return err.message;
  if (err instanceof ApiError) return err.message;
  return "Couldn't load today's rooms - try again.";
}

export function openMagazinePanel(host: MagazinePanelHost) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");

  // See the "Geometry" block above for why this is computed here instead of
  // as a module const.
  const cx = liveCenterX(scene);

  let elements: Phaser.GameObjects.GameObject[] = [];
  let status: "loading" | "ready" | "empty" | "error" = "loading";
  let errorMessage = "";
  let data: MagazineResponse | null = null;
  let index = 0;
  /** True once the panel has been torn down, so an in-flight GET /magazine can't draw into a dead scene. */
  let closed = false;

  const cleanup = () => {
    elements.forEach((e) => e.destroy());
    elements = [];
  };

  const close = () => {
    closed = true;
    cleanup();
    host.setPanelOpen(false);
  };

  // A scene swap mid-fetch (the player walks out, a game starts) must not
  // let a stale .then() draw into a torn-down scene - same guard every
  // other async panel in this codebase uses (see ChallengesPanel.ts).
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    closed = true;
  });

  const add = <T extends Phaser.GameObjects.GameObject>(obj: T, depth = DEPTH_CONTENT): T => {
    (obj as unknown as { setScrollFactor: (v: number) => void }).setScrollFactor(0);
    (obj as unknown as { setDepth: (v: number) => void }).setDepth(depth);
    // Screen-fixed - see ui/sceneCameraSplit.ts's header.
    isolateFixedUi(scene, obj);
    elements.push(obj);
    return obj;
  };

  const renderShell = (subtitle: string) => {
    add(makePanel(scene, cx, 300, PANEL_W, PANEL_H, DEPTH_PANEL), DEPTH_PANEL);
    add(
      makeText(scene, cx - PANEL_W / 2 + Tokens.space.xl, 144, "📖 MAGAZINE", {
        size: Tokens.type.size.lg,
        weight: Tokens.type.weight.semibold,
        color: Tokens.text.secondary,
        tracking: Tokens.type.tracking.caps
      })
    );
    if (subtitle) {
      add(
        makeText(scene, cx + PANEL_W / 2 - Tokens.space.xl, 144, subtitle, {
          size: Tokens.type.size.sm,
          color: Tokens.text.muted,
          align: "right",
          originX: 1
        })
      );
    }
  };

  const addCloseButton = () => {
    const closeBtn = makeButton(
      scene,
      cx,
      452,
      140,
      32,
      "Close",
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      close,
      Tokens.text.secondary,
      Tokens.radius.sm
    );
    add(closeBtn.container);
  };

  const renderMessage = (message: string, retry: boolean) => {
    cleanup();
    renderShell("");
    add(
      makeText(scene, cx, 280, message, {
        size: Tokens.type.size.md,
        color: Tokens.text.secondary,
        align: "center",
        originX: 0.5,
        wordWrapWidth: PANEL_W - Tokens.space.huge * 2
      })
    );
    if (retry) {
      const retryBtn = makeButton(
        scene,
        cx,
        336,
        160,
        32,
        "Try Again",
        Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        load,
        Tokens.text.primary,
        Tokens.radius.sm
      );
      add(retryBtn.container);
    }
    addCloseButton();
  };

  /** Draws one room, scaled to fit the well, inside a plain Container - see this file's header on why this reuses roomRenderer.ts rather than a second art pipeline. Read-only: nothing drawn here is interactive. */
  const drawRoom = (entry: MagazineRoomEntry, w: number, h: number, scale: number) => {
    const originX = cx - w / 2;
    const originY = WELL_CY - h / 2;

    const frame = scene.add.graphics();
    frame.fillStyle(Tokens.color.inset, 1);
    frame.fillRoundedRect(originX - 4, originY - 4, w + 8, h + 8, Tokens.radius.md);
    add(frame);

    const container = scene.add.container(originX, originY).setScale(scale);
    const floorTiles = buildFloorTiles(scene, entry.flooringId);
    const wallImages = buildWallImages(scene, entry.wallpaperId);
    const furnitureImages = Object.values(buildFurnitureImages(scene, entry.furniture)).filter(
      (img): img is Phaser.GameObjects.Image => img !== undefined
    );
    container.add([...floorTiles, ...wallImages, ...furnitureImages]);
    add(container, DEPTH_CONTENT + 1);
  };

  const renderReady = () => {
    if (!data || data.rooms.length === 0) return;
    cleanup();
    renderShell(`Today - ${data.dateKey}`);

    const entry = data.rooms[index];
    const { scale, w, h } = fitRoomScale(WELL_MAX_W, WELL_MAX_H);

    add(
      makeText(scene, cx, 164, entry.username, {
        size: Tokens.type.size.xxl,
        weight: Tokens.type.weight.semibold,
        color: Tokens.text.primary,
        align: "center",
        originX: 0.5
      })
    );

    drawRoom(entry, w, h, scale);

    if (data.rooms.length > 1) {
      const wellLeft = cx - w / 2;
      const wellRight = cx + w / 2;

      const prevBtn = makeButton(
        scene,
        wellLeft - 40,
        WELL_CY,
        56,
        40,
        "◀",
        Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        () => {
          index = wrapIndex(index - 1, data!.rooms.length);
          renderReady();
        },
        Tokens.text.primary,
        Tokens.radius.sm
      );
      add(prevBtn.container);

      const nextBtn = makeButton(
        scene,
        wellRight + 40,
        WELL_CY,
        56,
        40,
        "▶",
        Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        () => {
          index = wrapIndex(index + 1, data!.rooms.length);
          renderReady();
        },
        Tokens.text.primary,
        Tokens.radius.sm
      );
      add(nextBtn.container);

      add(
        makeText(scene, cx, WELL_CY + h / 2 + 18, `${index + 1} / ${data.rooms.length}`, {
          size: Tokens.type.size.sm,
          color: Tokens.text.muted,
          align: "center",
          originX: 0.5
        })
      );
    }

    addCloseButton();
  };

  const render = () => {
    if (closed) return;
    if (status === "loading") {
      renderMessage("Loading today's rooms...", false);
      return;
    }
    if (status === "error") {
      renderMessage(errorMessage, true);
      return;
    }
    if (status === "empty") {
      renderMessage("No decorated rooms yet - check back once someone's decorated theirs.", false);
      return;
    }
    renderReady();
  };

  const load = () => {
    status = "loading";
    render();
    api
      .getMagazine()
      .then((res) => {
        if (closed) return;
        data = res;
        index = 0;
        status = res.rooms.length > 0 ? "ready" : "empty";
        render();
      })
      .catch((err) => {
        if (closed) return;
        errorMessage = describeMagazineError(err);
        status = "error";
        render();
      });
  };

  load();
}
