import Phaser from "phaser";
import { Tokens } from "./DesignTokens";
import { makeButton, makePanel, makeInset, makeDivider, makeText } from "./uiHelpers";
import { playSfx } from "./SoundManager";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import type { LeaderboardBoard, LeaderboardEntry, LeaderboardResponse } from "../api/types";
import { formatNumber } from "./challengeDisplay";

/**
 * The GC-earned leaderboard: "a small button that shows the Daily, Weekly,
 * and all time leaderboard for GC earned" (founder ask).
 *
 * STRUCTURE follows ChallengesPanel.ts/QuickplayPanel.ts - one exported
 * `open*` function, a closure holding the panel's own state, a `render()`
 * that destroys and rebuilds every element from that state, a host
 * interface for the one thing only the scene can do. Unlike
 * ChallengesPanel.ts, there is no pagination/scrolling here: the server
 * caps each board's `top` list at 10 rows (see server/src/economy/
 * leaderboard.ts's TOP_N), which fits the panel without either.
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

const RANK_X = COL_L + Tokens.space.sm;
const NAME_X = COL_L + 50;

// Sized so the worst case - a full 10-row top list PLUS a pinned "your
// rank" footer row below it - still clears the Close button at y=452
// (same y every other panel here uses) with room to spare inside the
// y=[130,470] safe zone. See the footer math in render() below, which
// derives its own y from `board.top.length * ROW_STEP` rather than a
// second hardcoded constant, so the two can't drift out of sync.
const ROW_H = 16;
const ROW_STEP = 18;
const LIST_Y0 = 216;

const DEPTH_PANEL = 200;
const DEPTH_CONTENT = 201;

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

  const cleanup = () => {
    elements.forEach((e) => e.destroy());
    elements = [];
  };

  const close = () => {
    closed = true;
    cleanup();
    host.setPanelOpen(false);
  };

  // A scene swap mid-request (the player walks out, a game starts) destroys
  // everything below out from under any pending .then() - same guard
  // ChallengesPanel.ts/QuickplayPanel.ts use.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    closed = true;
  });

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
  // One ranked row
  // ------------------------------------------------------------------

  /** `highlight` marks the caller's own row inside the top list - same muted-positive tint ChallengesPanel.ts uses for "this one is about you", not a signal about winning/losing. */
  const renderRow = (entry: LeaderboardEntry, y: number, highlight: boolean) => {
    if (highlight) {
      const bg = scene.add.graphics();
      bg.fillStyle(Tokens.color.positiveMuted, 1);
      bg.fillRoundedRect(CX - ROW_W / 2, y - ROW_H / 2, ROW_W, ROW_H, Tokens.radius.sm);
      add(bg, DEPTH_PANEL);
    }

    add(
      makeText(scene, RANK_X, y, `${entry.rank}.`, {
        size: Tokens.type.size.sm,
        weight: Tokens.type.weight.semibold,
        color: entry.rank <= 3 ? Tokens.text.accent : Tokens.text.muted,
        originY: 0.5
      })
    );
    add(
      makeText(scene, NAME_X, y, entry.username, {
        size: Tokens.type.size.md,
        weight: highlight ? Tokens.type.weight.semibold : Tokens.type.weight.regular,
        color: Tokens.text.primary,
        originY: 0.5,
        wordWrapWidth: 380
      })
    );
    add(
      makeText(scene, COL_R, y, `${formatNumber(entry.earnedGc)} Gold Coins`, {
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
      board.top.forEach((entry, i) => {
        renderRow(entry, LIST_Y0 + i * ROW_STEP, board.me !== null && entry.userId === board.me!.userId);
      });

      // --- "Where do I stand" - most of the motivation for a leaderboard.
      // Only shown when it adds information: outside the top list (a
      // separate pinned row below a divider) or genuinely not on it yet
      // (a plain note, not an error). ---
      const footerY = LIST_Y0 + board.top.length * ROW_STEP + Tokens.space.sm;
      if (board.me && !meInTop) {
        add(makeDivider(scene, COL_L, footerY, COL_R));
        renderRow(board.me, footerY + Tokens.space.sm + ROW_H / 2, true);
      } else if (!board.me) {
        add(makeDivider(scene, COL_L, footerY, COL_R));
        add(
          makeText(scene, CX, footerY + Tokens.space.sm + ROW_H / 2, "You haven't earned any Gold Coins in this window yet.", {
            size: Tokens.type.size.sm,
            color: Tokens.text.muted,
            align: "center",
            originX: 0.5,
            originY: 0.5,
            wordWrapWidth: ROW_W - Tokens.space.xxl * 2
          })
        );
      }
    }

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
