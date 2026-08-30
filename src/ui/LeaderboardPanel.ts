import Phaser from "phaser";
import { Tokens } from "./DesignTokens";
import { makeButton, makePanel, makeInset, makeDivider, makeText } from "./uiHelpers";
import { playSfx } from "./SoundManager";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import type { LeaderboardBoard, LeaderboardEntry, LeaderboardResponse } from "../api/types";
import { formatNumber } from "./challengeDisplay";
import { createCharacterPortrait } from "./characterPortrait";
import { clampScroll } from "./quickplayGrid";
import {
  leaderboardContentHeight,
  leaderboardRowY,
  leaderboardFooterDividerY,
  leaderboardFooterRowY
} from "./leaderboardGeometry";

/**
 * The GC-earned leaderboard: "a small button that shows the Daily, Weekly,
 * and all time leaderboard for GC earned" (founder ask), each row now also
 * showing "the person's current character next to their name" (founder
 * ask, roadmap/lbchar).
 *
 * STRUCTURE follows ChallengesPanel.ts/QuickplayPanel.ts - one exported
 * `open*` function, a closure holding the panel's own state, a `render()`
 * that destroys and rebuilds every element from that state, a host
 * interface for the one thing only the scene can do.
 *
 * "EARNED" (server/src/economy/leaderboard.ts): every real GC gain - game
 * wins (all 14 games, plus Triple Chance's own PAYOUT_GC), challenge
 * rewards, level rewards (including the level-up minigame's bonus), and
 * Coin Kiosk claims. NOT a package purchase, the signup bonus, or net
 * profit - see that file's header comment for the exact list and why.
 *
 * USERNAMES ARE SHOWN - explicit founder call ("they accepted that
 * usernames become publicly visible").
 *
 * PORTRAITS reuse ui/LayeredCharacter.ts's own layering/degradation rules
 * via the small ui/characterPortrait.ts helper (one static standing frame,
 * built from the `wardrobe` the server now attaches to every listed row -
 * see server/src/economy/leaderboard.ts's LeaderboardEntry.wardrobe doc
 * comment) rather than a second, forked copy of that logic. An
 * all-default wardrobe still draws the free default body (never an
 * invisible portrait), and a piece whose art hasn't loaded is silently
 * skipped for that one layer - exactly LayeredCharacter's existing
 * contract, unchanged here.
 *
 * SCROLLING: portraits made every row taller (see leaderboardGeometry.ts's
 * ROW_STEP), too tall for all 10 top rows to fit the fixed y=[130,470]
 * panel budget any more - so the row list is now a real touch-drag
 * scrollable region (same pattern as QuickplayPanel.ts's card grid: a
 * Container holding the rows, clipped by a GeometryMask, dragged by
 * pointerdown/move/up against `scrollY`, clamped by quickplayGrid.ts's own
 * `clampScroll` - reused rather than forked, since "how far can this
 * scroll before it runs past its content" doesn't care whether the content
 * is a grid or a list). Switching tabs resets the scroll position, since
 * each tab is its own list.
 *
 * STYLING comes entirely from DesignTokens.ts, same "Stake" direction and
 * y=[130,470] safe-zone budget as ChallengesPanel.ts - see that file's doc
 * comment.
 */

/** What this panel needs from whoever hosts it. */
export interface LeaderboardPanelHost {
  /** The scene the panel draws into. */
  readonly scene: Phaser.Scene;
  /** Raises/lowers the host's modal flag (real side effects on the host - see OverworldScene). Cleared on close even if the panel never finished loading, so a load failure can never leave the player permanently frozen. */
  setPanelOpen(open: boolean): void;
}

type TabKey = "daily" | "weekly" | "allTime";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "allTime", label: "All Time" }
];

// --- Geometry. Panel spans y 126-474; every element sits inside 130-470 -
// same budget and CX/PANEL_W/COL_L/COL_R as ChallengesPanel.ts/
// QuickplayPanel.ts so the three panels' content columns line up. ---
const CX = 400;
const PANEL_W = 664;
const PANEL_H = 348;
const COL_L = CX - PANEL_W / 2 + Tokens.space.xl;
const COL_R = CX + PANEL_W / 2 - Tokens.space.xl;
const ROW_W = 624;

// Column x's, in the SAME absolute space the static header (RANK/PLAYER
// labels) is drawn in. The scrollable row list below draws at the LOCAL
// equivalents (see LOCAL_* below) since its content container is anchored
// at (COL_L, VIEW_TOP) - see openLeaderboardPanel's `listContainer`.
const RANK_X = COL_L + Tokens.space.sm;
const PORTRAIT_X = COL_L + 40;
const NAME_X = COL_L + 68;

const LOCAL_RANK_X = RANK_X - COL_L;
const LOCAL_PORTRAIT_X = PORTRAIT_X - COL_L;
const LOCAL_NAME_X = NAME_X - COL_L;
const LOCAL_EARNED_X = COL_R - COL_L; // == ROW_W

/** Row highlight background height - a little short of ROW_STEP so consecutive rows keep a hairline gap. */
const ROW_BG_H = 30;

/**
 * Portrait display scale. The LPC frame is 64px tall but the character's
 * own art only fills y~15-62 of it (~47px, see characterRig.ts's LPC_RIG
 * comment) - 0.55 lands that visible height at ~26px, a comfortable fit
 * inside one ROW_STEP-tall row without dominating the name/earned text
 * next to it.
 */
const PORTRAIT_SCALE = 0.55;

/** Scrollable viewport - the region the row-list mask clips to and drag/tap input is read from. Below it, the footer Close button gets its own untouched strip of the safe zone (same margin QuickplayPanel.ts's VIEW_BOTTOM->452 leaves). */
const VIEW_TOP = 214;
const VIEW_BOTTOM = 434;
const VIEW_H = VIEW_BOTTOM - VIEW_TOP;

/** Mouse-wheel step, in content px per wheel "line" - desktop-only convenience alongside touch drag (see quickplayGrid.ts's identical constant). */
const WHEEL_STEP = 0.6;

const DEPTH_PANEL = 200;
const DEPTH_CONTENT = 201;

function inViewport(y: number): boolean {
  return y >= VIEW_TOP && y <= VIEW_BOTTOM;
}

/** Turns a load failure into a short, honest, user-facing message. */
function describeLoadError(err: unknown): string {
  if (err instanceof NetworkError) return err.message;
  if (err instanceof ApiError) return err.message;
  return "Couldn't load the leaderboard - try again.";
}

/**
 * Opens the panel. Fetches all three boards up front (one request, see
 * api.getLeaderboard) rather than per-tab, since GET /leaderboard already
 * returns daily+weekly+allTime together - switching tabs is then instant,
 * no re-fetch, no flash of a loading state.
 */
export function openLeaderboardPanel(host: LeaderboardPanelHost) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");

  let elements: Phaser.GameObjects.GameObject[] = [];
  let data: LeaderboardResponse | null = null;
  let status: "loading" | "ready" | "error" = "loading";
  let errorMessage = "";
  let tab: TabKey = "daily";
  /** True once the panel has been torn down, so an in-flight response can't draw into a dead scene. */
  let closed = false;

  // --- Scroll state for the row list. `listContainer`/`maskShape` are
  // created once here (not per-render, unlike `elements`) and just have
  // their CHILDREN rebuilt on every render() call - see the "ready" branch
  // below. `contentH` is updated there too, so the drag handlers (bound
  // once, below) always clamp against the currently-rendered tab's real
  // content height. ---
  let scrollY = 0;
  let contentH = 0;
  const listContainer = scene.add.container(COL_L, VIEW_TOP).setScrollFactor(0).setDepth(DEPTH_CONTENT);
  const maskShape = scene.make.graphics(undefined, false).setScrollFactor(0);
  maskShape.fillStyle(0xffffff, 1);
  maskShape.fillRect(COL_L, VIEW_TOP, ROW_W, VIEW_H);
  listContainer.setMask(maskShape.createGeometryMask());

  let dragging = false;
  let dragStartPointerY = 0;
  let dragStartScroll = 0;

  const applyScroll = () => {
    listContainer.y = VIEW_TOP - scrollY;
  };

  const cleanup = () => {
    elements.forEach((e) => e.destroy());
    elements = [];
  };

  const detachInput = () => {
    scene.input.off("pointerdown", onPointerDown);
    scene.input.off("pointermove", onPointerMove);
    scene.input.off("pointerup", onPointerUp);
    scene.input.off("pointerupoutside", onPointerUp);
    scene.input.off("wheel", onWheel);
  };

  const close = () => {
    closed = true;
    detachInput();
    cleanup();
    listContainer.destroy();
    maskShape.destroy();
    host.setPanelOpen(false);
  };

  // A scene swap mid-request (the player walks out, a game starts) destroys
  // everything below out from under any pending .then() - same guard
  // ChallengesPanel.ts/QuickplayPanel.ts use.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    closed = true;
    detachInput();
  });

  const onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (closed || !inViewport(pointer.y)) return;
    dragging = true;
    dragStartPointerY = pointer.y;
    dragStartScroll = scrollY;
  };

  const onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (closed || !dragging) return;
    const delta = pointer.y - dragStartPointerY;
    scrollY = clampScroll(dragStartScroll - delta, contentH, VIEW_H);
    applyScroll();
  };

  const onPointerUp = () => {
    dragging = false;
  };

  const onWheel = (pointer: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
    if (closed || !inViewport(pointer.y)) return;
    scrollY = clampScroll(scrollY + dy * WHEEL_STEP, contentH, VIEW_H);
    applyScroll();
  };

  scene.input.on("pointerdown", onPointerDown);
  scene.input.on("pointermove", onPointerMove);
  scene.input.on("pointerup", onPointerUp);
  scene.input.on("pointerupoutside", onPointerUp);
  scene.input.on("wheel", onWheel);

  const add = <T extends Phaser.GameObjects.GameObject>(obj: T, depth = DEPTH_CONTENT): T => {
    (obj as unknown as { setScrollFactor: (v: number) => void }).setScrollFactor(0);
    (obj as unknown as { setDepth: (v: number) => void }).setDepth(depth);
    elements.push(obj);
    return obj;
  };

  const boardFor = (key: TabKey): LeaderboardBoard | null => {
    if (!data) return null;
    return key === "daily" ? data.daily : key === "weekly" ? data.weekly : data.allTime;
  };

  // ------------------------------------------------------------------
  // Shell + loading / failure states
  // ------------------------------------------------------------------

  const renderShell = () => {
    add(makePanel(scene, CX, 300, PANEL_W, PANEL_H, DEPTH_PANEL), DEPTH_PANEL);
    add(
      makeText(scene, COL_L, 144, "LEADERBOARD", {
        size: Tokens.type.size.lg,
        weight: Tokens.type.weight.semibold,
        color: Tokens.text.secondary,
        tracking: Tokens.type.tracking.caps
      })
    );
    add(
      makeText(scene, COL_R, 144, "Gold Coins earned", {
        size: Tokens.type.size.sm,
        color: Tokens.text.muted,
        align: "right",
        originX: 1
      })
    );
  };

  const renderMessageState = (message: string, retry: boolean) => {
    cleanup();
    listContainer.removeAll(true);
    renderShell();
    add(
      makeText(scene, CX, 290, message, {
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
        CX,
        350,
        160,
        32,
        "Try Again",
        Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        () => load(),
        Tokens.text.primary,
        Tokens.radius.sm
      );
      add(retryBtn.container);
    }
    add(
      makeButton(
        scene,
        CX,
        430,
        140,
        32,
        "Close",
        Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        close,
        Tokens.text.secondary,
        Tokens.radius.sm
      ).container
    );
  };

  // ------------------------------------------------------------------
  // One ranked row - LOCAL coordinates (relative to listContainer), pushed
  // into `into` rather than drawn via `add()`, since the whole row list is
  // reparented into the scrollable/masked listContainer, not the flat
  // `elements` cleanup list. See this file's header on why portraits reuse
  // ui/characterPortrait.ts rather than a second layering implementation.
  // ------------------------------------------------------------------

  /** `highlight` marks the caller's own row inside the top list - same muted-positive tint ChallengesPanel.ts uses for "this one is about you", not a signal about winning/losing. */
  const buildRow = (
    entry: LeaderboardEntry,
    localY: number,
    highlight: boolean,
    into: Phaser.GameObjects.GameObject[]
  ) => {
    if (highlight) {
      const bg = scene.add.graphics();
      bg.fillStyle(Tokens.color.positiveMuted, 1);
      bg.fillRoundedRect(0, localY - ROW_BG_H / 2, ROW_W, ROW_BG_H, Tokens.radius.sm);
      into.push(bg);
    }

    into.push(
      makeText(scene, LOCAL_RANK_X, localY, `${entry.rank}.`, {
        size: Tokens.type.size.sm,
        weight: Tokens.type.weight.semibold,
        color: entry.rank <= 3 ? Tokens.text.accent : Tokens.text.muted,
        originY: 0.5
      })
    );

    // Portrait: one static standing frame built from whatever the server
    // says this player has equipped - degrades exactly like every other
    // LayeredCharacter render (all-default wardrobe still draws a body, a
    // missing piece's art draws nothing for that layer). See
    // ui/characterPortrait.ts.
    const portrait = createCharacterPortrait(scene, entry.wardrobe, LOCAL_PORTRAIT_X, localY, PORTRAIT_SCALE);
    into.push(...portrait.displayObjects);

    into.push(
      makeText(scene, LOCAL_NAME_X, localY, entry.username, {
        size: Tokens.type.size.md,
        weight: highlight ? Tokens.type.weight.semibold : Tokens.type.weight.regular,
        color: Tokens.text.primary,
        originY: 0.5,
        wordWrapWidth: 320
      })
    );
    into.push(
      makeText(scene, LOCAL_EARNED_X, localY, `${formatNumber(entry.earnedGc)} Gold Coins`, {
        size: Tokens.type.size.sm,
        color: highlight ? Tokens.text.accent : Tokens.text.secondary,
        align: "right",
        originX: 1,
        originY: 0.5
      })
    );
  };

  // ------------------------------------------------------------------
  // Full render
  // ------------------------------------------------------------------

  const render = () => {
    if (closed) return;

    if (status === "loading") {
      renderMessageState("Loading the leaderboard…", false);
      return;
    }
    if (status === "error") {
      renderMessageState(errorMessage, true);
      return;
    }
    const board = boardFor(tab);
    if (!board) return;

    cleanup();
    listContainer.removeAll(true);
    renderShell();

    // --- Tabs ---
    const tabW = 140;
    TABS.forEach((t, i) => {
      const selected = t.key === tab;
      const btn = makeButton(
        scene,
        CX + (i - 1) * (tabW + Tokens.space.sm),
        180,
        tabW,
        28,
        t.label,
        selected ? Tokens.color.surfaceHover : Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        () => {
          tab = t.key;
          scrollY = 0; // each tab is its own list - start back at the top
          render();
        },
        selected ? Tokens.text.primary : Tokens.text.secondary,
        Tokens.radius.xs
      );
      add(btn.container);
    });

    add(makeDivider(scene, COL_L, 200, COL_R));
    add(
      makeText(scene, RANK_X, 207, "RANK", {
        size: Tokens.type.size.xs,
        color: Tokens.text.muted,
        tracking: Tokens.type.tracking.caps
      })
    );
    add(
      makeText(scene, NAME_X, 207, "PLAYER", {
        size: Tokens.type.size.xs,
        color: Tokens.text.muted,
        tracking: Tokens.type.tracking.caps
      })
    );

    // --- Rows. Empty is a deliberate, labeled state, not a blank panel -
    // with ~5 real players most boards will genuinely be short. ---
    if (board.top.length === 0) {
      contentH = 0;
      add(makeInset(scene, CX, 300, ROW_W, 100, Tokens.radius.md));
      add(
        makeText(scene, CX, 300, "Nobody's earned any Gold Coins in this window yet.", {
          size: Tokens.type.size.md,
          color: Tokens.text.muted,
          align: "center",
          originX: 0.5,
          originY: 0.5,
          wordWrapWidth: ROW_W - Tokens.space.xxl * 2
        })
      );
    } else {
      const meInTop = board.me ? board.top.some((e) => e.userId === board.me!.userId) : false;
      const rowObjects: Phaser.GameObjects.GameObject[] = [];

      board.top.forEach((entry, i) => {
        buildRow(
          entry,
          leaderboardRowY(i),
          board.me !== null && entry.userId === board.me!.userId,
          rowObjects
        );
      });

      // --- "Where do I stand" - most of the motivation for a leaderboard.
      // Only shown when it adds information: outside the top list (a
      // separate pinned row below a divider) or genuinely not on it yet
      // (a plain note, not an error). Scrolls with the rest of the list
      // now rather than sitting at a fixed y - see this file's header on
      // why the list scrolls at all. ---
      let hasFooter = false;
      if (board.me && !meInTop) {
        hasFooter = true;
        rowObjects.push(makeDivider(scene, 0, leaderboardFooterDividerY(board.top.length), ROW_W));
        buildRow(board.me, leaderboardFooterRowY(board.top.length), true, rowObjects);
      } else if (!board.me) {
        hasFooter = true;
        rowObjects.push(makeDivider(scene, 0, leaderboardFooterDividerY(board.top.length), ROW_W));
        rowObjects.push(
          makeText(
            scene,
            ROW_W / 2,
            leaderboardFooterRowY(board.top.length),
            "You haven't earned any Gold Coins in this window yet.",
            {
              size: Tokens.type.size.sm,
              color: Tokens.text.muted,
              align: "center",
              originX: 0.5,
              originY: 0.5,
              wordWrapWidth: ROW_W - Tokens.space.xxl * 2
            }
          )
        );
      }

      listContainer.add(rowObjects);
      contentH = leaderboardContentHeight(board.top.length, hasFooter);
    }

    scrollY = clampScroll(scrollY, contentH, VIEW_H);
    applyScroll();

    add(
      makeButton(
        scene,
        CX,
        452,
        140,
        32,
        "Close",
        Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        close,
        Tokens.text.secondary,
        Tokens.radius.sm
      ).container
    );
  };

  // ------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------

  const load = () => {
    status = "loading";
    render();
    api
      .getLeaderboard()
      .then((res) => {
        if (closed) return;
        data = res;
        status = "ready";
        tab = "daily";
        scrollY = 0;
        render();
      })
      .catch((err) => {
        if (closed) return;
        status = "error";
        errorMessage = describeLoadError(err);
        render();
      });
  };

  load();
}
