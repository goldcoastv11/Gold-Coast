import Phaser from "phaser";
import { gameState } from "../GameState";
import { Tokens } from "./DesignTokens";
import { makeButton, makePanel, makeInset, makeDivider, makeText, UIButton } from "./uiHelpers";
import { showClaimCelebration, showLevelUpCelebration } from "./ClaimCelebration";
import { playSfx } from "./SoundManager";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { track, EVENTS } from "../api/track";
import { launchLevelUpMinigame } from "../levelUpMinigameLauncher";
import type { ChallengeBoardResponse, ChallengeView, ProgressionResponse } from "../api/types";
import {
  claimableCount,
  cosmeticName,
  formatNextLevelReward,
  formatNextUnlock,
  formatNumber,
  formatResetIn,
  formatReward,
  isClaimable,
  milestoneLevels,
  progressFraction,
  sortForDisplay,
  xpBarFraction
} from "./challengeDisplay";

/**
 * The challenges + XP + levels panel: the front end for a system that has
 * been live server-side with no way for a player to see it.
 *
 * STRUCTURE follows ShopPanel.ts deliberately - one exported `open*`
 * function, a closure holding the panel's own state, a `render()` that
 * destroys and rebuilds every element from that state, a host interface for
 * the handful of things only the scene can do. Nothing here reaches back
 * into OverworldScene's privates and nothing here is a class.
 *
 * STYLING comes entirely from DesignTokens.ts (the dark "Stake" direction) -
 * no hardcoded colours and no hand-picked gaps. Every Y coordinate below
 * sits inside the measured mobile-crop-safe band y=[130,470] (see
 * uiHelpers.ts's SAFE_ZONE_TOP/BOTTOM); this game is landscape-mobile-first
 * and anything outside that band is simply not on screen for a real phone.
 *
 * THE ONE PLACE THE ACCENT IS SPENT: DesignTokens direction note 2 says one
 * accent, used sparingly, for the primary action and the win state. On this
 * screen those are the same thing - "there is a reward sitting here
 * unclaimed" - so the accent carries exactly that meaning and nothing else:
 * the CLAIM button, the tinted row behind it, the count on its tab, and the
 * XP bar's fill. A challenge in progress, a claimed one, and every label are
 * all surface and text tokens.
 *
 * ECONOMY (repo-root CLAUDE.md): challenge and level rewards are GOLD
 * COINS plus XP - the only currency there is now (TICKETS is retired; the
 * ledger no longer credits it at all). The copy below says "Gold Coins" in
 * full for the same reason the game shell's bet label does.
 */

/** What this panel needs from whoever hosts it - a structural subset of ShopPanelHost. */
export interface ChallengesPanelHost {
  /** The scene the panel draws into. */
  readonly scene: Phaser.Scene;
  /** Raises/lowers the host's modal flag (real side effects on the host - see OverworldScene). */
  setPanelOpen(open: boolean): void;
  /** Repaints the host's coin/level HUD after a balance or level change. */
  updateHud(): void;
  /** Brief fading confirmation/error message above the panel. */
  showToast(message: string, color: string): void;
}

type TabKey = "daily" | "weekly" | "achievements";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "achievements", label: "Achievements" }
];

// --- Geometry. Panel spans y 126-474; every element sits inside 130-470. ---
const CX = 400;
const PANEL_W = 664;
const PANEL_H = 348;
/** Left/right edges of the panel's single content column. */
const COL_L = CX - PANEL_W / 2 + Tokens.space.xl;
const COL_R = CX + PANEL_W / 2 - Tokens.space.xl;
/** Inner padding from the content column to text sitting inside a well. */
const WELL_PAD = Tokens.space.md;

const ROWS_PER_PAGE = 4;
const ROW_H = 34;
const ROW_W = 624;
const ROW_Y0 = 300;
const ROW_STEP = 38;

/** Where a challenge row's progress bar lives, and where its action sits. */
const BAR_L = 400;
const BAR_R = 610;
const BAR_H = 8;
const ACTION_CX = 662;
const ACTION_W = 84;
const ACTION_H = 28;

const DEPTH_PANEL = 200;
const DEPTH_CONTENT = 201;

/**
 * Draws a token-styled progress bar: a recessed track with an accent fill.
 * Returns the Graphics so the caller can register it for cleanup. A zero
 * fraction still draws the track, which is what makes "0 / 10" read as
 * "started, nothing done" rather than as a missing element.
 */
function drawBar(
  scene: Phaser.Scene,
  left: number,
  right: number,
  y: number,
  fraction: number,
  fill: number
): Phaser.GameObjects.Graphics {
  const w = right - left;
  const radius = BAR_H / 2;
  const g = scene.add.graphics();
  g.fillStyle(Tokens.color.surfaceRaised, 1);
  g.fillRoundedRect(left, y - BAR_H / 2, w, BAR_H, radius);
  const filled = Math.max(0, Math.min(1, fraction)) * w;
  // Below one full radius a rounded rect degrades into a lopsided blob, so
  // a sliver of progress is drawn as a dot of exactly the bar's height.
  if (filled > 0) {
    g.fillStyle(fill, 1);
    g.fillRoundedRect(left, y - BAR_H / 2, Math.max(filled, BAR_H), BAR_H, radius);
  }
  return g;
}

/** Turns a claim failure into a short, honest, user-facing toast message. */
function describeClaimError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "ALREADY_CLAIMED":
        return "Already claimed.";
      case "NOT_COMPLETE":
        return "Not finished yet.";
      case "NOT_FOUND":
        return "That challenge is no longer available.";
      case "UNAVAILABLE":
        return "Challenges are unavailable right now.";
      default:
        return err.message;
    }
  }
  if (err instanceof NetworkError) return err.message;
  return "Couldn't claim that - try again.";
}

/**
 * Opens the panel. Fetches the board and the level state together, then
 * renders; a failure shows a retry rather than an empty panel, and an
 * environment without the progression migration applied (`available: false`)
 * says so plainly instead of showing fourteen zeroed-out rows.
 */
export function openChallengesPanel(host: ChallengesPanelHost) {
  const scene = host.scene;
  host.setPanelOpen(true);
  playSfx(scene, "open");

  let elements: Phaser.GameObjects.GameObject[] = [];
  let board: ChallengeBoardResponse | null = null;
  let progression: ProgressionResponse | null = null;
  let status: "loading" | "ready" | "error" | "unavailable" = "loading";
  let errorMessage = "";
  let tab: TabKey = "daily";
  let page = 0;
  /**
   * DOUBLE-FIRE GUARD. The server is idempotent (a second claim comes back
   * 409 ALREADY_CLAIMED and pays nothing), but a player who taps twice must
   * not see a reward followed by an error. So while a claim is in flight
   * every claim button on screen is disabled and this flag rejects any
   * handler that still fires. It is cleared on BOTH the success and the
   * failure path, so a failed claim can never leave the UI dead.
   */
  let claimInFlight = false;
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
    host.updateHud();
  };

  // A scene swap mid-request (the player walks out, a game starts) destroys
  // everything below out from under any pending .then() - same class of bug
  // as OverworldScene's stale-ambient-NPC crash. One listener covers every
  // async continuation in this closure.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    closed = true;
  });

  const groupFor = (key: TabKey): ChallengeView[] => {
    if (!board) return [];
    return key === "daily" ? board.daily : key === "weekly" ? board.weekly : board.achievements;
  };

  const add = <T extends Phaser.GameObjects.GameObject>(obj: T, depth = DEPTH_CONTENT): T => {
    (obj as unknown as { setScrollFactor: (v: number) => void }).setScrollFactor(0);
    (obj as unknown as { setDepth: (v: number) => void }).setDepth(depth);
    elements.push(obj);
    return obj;
  };

  // ------------------------------------------------------------------
  // Loading / failure / unavailable states
  // ------------------------------------------------------------------

  const renderShell = () => {
    add(makePanel(scene, CX, 300, PANEL_W, PANEL_H, DEPTH_PANEL), DEPTH_PANEL);
    add(
      makeText(scene, COL_L, 144, "CHALLENGES", {
        size: Tokens.type.size.lg,
        weight: Tokens.type.weight.semibold,
        color: Tokens.text.secondary,
        tracking: Tokens.type.tracking.caps
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
        ACTION_H + Tokens.space.xs,
        "Try Again",
        Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        () => {
          load();
        },
        Tokens.text.primary,
        Tokens.radius.sm
      );
      add(retryBtn.container);
    }
    const closeBtn = makeButton(
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
    );
    add(closeBtn.container);
  };

  // ------------------------------------------------------------------
  // The level / XP header
  // ------------------------------------------------------------------

  const renderLevelStrip = (p: ProgressionResponse) => {
    add(makeInset(scene, CX, 190, ROW_W, 76, Tokens.radius.md));

    add(
      makeText(scene, COL_L + WELL_PAD, 170, `LEVEL ${p.level}`, {
        size: Tokens.type.size.xxl,
        weight: Tokens.type.weight.bold,
        color: Tokens.text.primary,
        tracking: Tokens.type.tracking.label
      })
    );

    // The XP bar's fill is the accent for the same reason a CLAIM button is:
    // it is the "you are getting somewhere" signal, not decoration.
    add(drawBar(scene, 200, 560, 166, xpBarFraction(p), Tokens.color.accent));
    add(
      makeText(scene, 200, 186, formatXpLine(p), {
        size: Tokens.type.size.xs,
        color: Tokens.text.muted
      })
    );

    const nextLevel = formatNextLevelReward(p);
    add(
      makeText(scene, COL_R - WELL_PAD, 164, nextLevel ?? `Max level (${p.maxLevel}) reached`, {
        size: Tokens.type.size.sm,
        color: Tokens.text.secondary,
        align: "right",
        originX: 1
      })
    );

    const nextUnlock = formatNextUnlock(p);
    add(
      makeText(scene, COL_R - WELL_PAD, 186, nextUnlock ?? "Every cosmetic unlocked", {
        size: Tokens.type.size.sm,
        color: Tokens.text.muted,
        align: "right",
        originX: 1
      })
    );

    // Milestone rail: one dot per cosmetic-granting level, filled once
    // reached. Gives the level number something to aim at rather than
    // leaving "levels unlock cosmetics" as an unevidenced claim.
    add(
      makeText(scene, COL_L + WELL_PAD, 208, "UNLOCKS", {
        size: Tokens.type.size.xs,
        color: Tokens.text.muted,
        tracking: Tokens.type.tracking.caps
      })
    );
    const milestones = milestoneLevels(p.cosmeticUnlocks);
    if (milestones.length > 0) {
      const railL = 210;
      const railR = COL_R - WELL_PAD;
      const step = milestones.length > 1 ? (railR - railL) / (milestones.length - 1) : 0;
      const dots = scene.add.graphics();
      milestones.forEach((level, i) => {
        const x = railL + i * step;
        const reached = p.level >= level;
        dots.fillStyle(reached ? Tokens.color.accent : Tokens.color.surfaceRaised, 1);
        dots.fillCircle(x, 208, 5);
        add(
          makeText(scene, x, 221, String(level), {
            size: Tokens.type.size.xs,
            color: reached ? Tokens.text.secondary : Tokens.text.muted,
            align: "center",
            originX: 0.5
          })
        );
      });
      add(dots);
    }
  };

  const formatXpLine = (p: ProgressionResponse): string => {
    if (p.atMaxLevel) return `${formatNumber(p.xp)} XP · max level`;
    return `${formatNumber(p.xpIntoLevel)} / ${formatNumber(p.xpForNextLevel)} XP to Level ${p.level + 1}`;
  };

  // ------------------------------------------------------------------
  // One challenge row
  // ------------------------------------------------------------------

  const renderRow = (c: ChallengeView, y: number, claimButtons: UIButton[]) => {
    const claimable = isClaimable(c);

    if (claimable) {
      // A claimable row is tinted with the muted positive surface rather
      // than the saturated accent: the accent stays on the button, and the
      // row still reads as part of one dark list (direction note 2).
      const bg = scene.add.graphics();
      bg.fillStyle(Tokens.color.positiveMuted, 1);
      bg.fillRoundedRect(CX - ROW_W / 2, y - ROW_H / 2, ROW_W, ROW_H, Tokens.radius.sm);
      add(bg, DEPTH_PANEL);
    } else {
      add(makeInset(scene, CX, y, ROW_W, ROW_H, Tokens.radius.sm), DEPTH_PANEL);
    }

    add(
      makeText(scene, COL_L + WELL_PAD, y - 9, c.name, {
        size: Tokens.type.size.md,
        weight: Tokens.type.weight.semibold,
        color: c.claimed ? Tokens.text.muted : Tokens.text.primary
      })
    );
    add(
      makeText(scene, COL_L + WELL_PAD, y + 9, c.description, {
        size: Tokens.type.size.xs,
        color: Tokens.text.muted
      })
    );

    add(
      makeText(scene, BAR_L, y - 9, formatReward(c), {
        size: Tokens.type.size.xs,
        color: claimable ? Tokens.text.accent : Tokens.text.secondary
      })
    );
    add(
      makeText(scene, BAR_R, y - 9, `${formatNumber(c.progress)} / ${formatNumber(c.target)}`, {
        size: Tokens.type.size.xs,
        color: Tokens.text.muted,
        align: "right",
        originX: 1
      })
    );
    add(
      drawBar(
        scene,
        BAR_L,
        BAR_R,
        y + 8,
        progressFraction(c),
        // A claimed bar goes quiet: it is history, not an outstanding reward.
        c.claimed ? Tokens.color.surfaceHover : Tokens.color.accent
      )
    );

    if (claimable) {
      const btn = makeButton(
        scene,
        ACTION_CX,
        y,
        ACTION_W,
        ACTION_H,
        "CLAIM",
        Tokens.color.accent,
        Tokens.color.accentHover,
        () => claim(c, btn, claimButtons),
        Tokens.text.onAccent,
        Tokens.radius.sm
      );
      claimButtons.push(btn);
      add(btn.container);
    } else if (c.claimed) {
      add(
        makeText(scene, ACTION_CX, y, "Claimed", {
          size: Tokens.type.size.xs,
          color: Tokens.text.muted,
          align: "center",
          originX: 0.5
        })
      );
    }
    // An in-progress row deliberately gets nothing in the action column -
    // whitespace is what makes the claimable rows jump out of the list.
  };

  // ------------------------------------------------------------------
  // Claiming
  // ------------------------------------------------------------------

  const claim = (c: ChallengeView, btn: UIButton, claimButtons: UIButton[]) => {
    if (claimInFlight) return;
    claimInFlight = true;
    // Disable EVERY claim button, not just the pressed one: two different
    // rewards claimed in the same instant would race each other's board
    // refresh and show the player a stale list.
    claimButtons.forEach((b) => b.setEnabled(false));
    btn.setLabel("…");

    api
      .claimChallenge(c.id)
      .then((res) => {
        if (closed) return;
        track(EVENTS.CHALLENGE_CLAIMED, {
          challengeId: c.id,
          period: c.period,
          rewardGc: res.claimed.rewardGc,
          rewardXp: res.claimed.rewardXp
        });

        gameState.hydrateFromServer(res.user);
        host.updateHud();

        // Latch the row locally from the server's confirmed outcome rather
        // than re-fetching the whole board: the claim response is already
        // authoritative about this one challenge, and a second round trip
        // is a second thing that can fail after the money has moved.
        c.claimed = true;
        c.complete = true;
        c.progress = c.target;

        if (progression) {
          progression = { ...progression, ...res.progression };
        }

        claimInFlight = false;
        render();

        showClaimCelebration(scene, res.claimed.rewardGc, res.claimed.rewardXp);

        // A claim can cross a level boundary, which owes the player the
        // level-up minigame. This supersedes the level-up banner below when
        // one is owed - the minigame shows the new level itself, and this
        // fades the scene out, cancelling the delayed banner. A no-op when
        // nothing is pending, so the banner still plays as before.
        launchLevelUpMinigame(scene, res.pendingLevelMinigame);

        if (res.levelsGained.length > 0) {
          // Levelling up mid-session must be visible. Held back until the
          // claim celebration has had its moment so the two don't collide.
          scene.time.delayedCall(Tokens.motion.duration.dwell, () => {
            if (closed) return;
            showLevelUpCelebration(
              scene,
              res.levelsGained.map((g) => ({
                level: g.level,
                rewardGc: g.rewardGc,
                cosmeticName: g.cosmeticItemId ? cosmeticName(g.cosmeticItemId) : null
              }))
            );
          });
          // A level-up changes what the next level pays and can grant a
          // cosmetic, neither of which the claim response carries. Refresh
          // the header quietly - the claim itself already succeeded, so a
          // failure here is not the player's problem and must not toast.
          api
            .getProgression()
            .then((fresh) => {
              if (closed) return;
              progression = fresh;
              render();
            })
            .catch(() => {
              // Deliberately silent - the header simply stays as it is.
            });
        }
      })
      .catch((err) => {
        if (closed) return;
        claimInFlight = false;
        host.showToast(describeClaimError(err), Tokens.text.negative);
        playSfx(scene, "error");

        if (err instanceof ApiError && (err.code === "ALREADY_CLAIMED" || err.code === "NOT_COMPLETE")) {
          // The client's picture of this challenge is wrong, not the
          // server's - re-read the board rather than re-rendering a stale
          // row the player will just tap again.
          load();
          return;
        }
        // Everything else (offline, timeout, a 500) leaves the reward
        // genuinely unclaimed and still claimable: re-render so the button
        // comes back enabled. A failed claim never leaves a dead button.
        render();
      });
  };

  // ------------------------------------------------------------------
  // Full render
  // ------------------------------------------------------------------

  const render = () => {
    if (closed) return;

    if (status === "loading") {
      renderMessageState("Loading your challenges…", false);
      return;
    }
    if (status === "unavailable") {
      renderMessageState("Challenges aren't available right now. Try again later.", false);
      return;
    }
    if (status === "error") {
      renderMessageState(errorMessage, true);
      return;
    }
    if (!board || !progression) return;

    cleanup();
    renderShell();

    add(
      makeText(scene, COL_R, 144, `${formatNumber(gameState.goldCoins)} Gold Coins`, {
        size: Tokens.type.size.lg,
        weight: Tokens.type.weight.medium,
        color: Tokens.text.primary,
        align: "right",
        originX: 1
      })
    );

    renderLevelStrip(progression);

    // --- Tabs. The claimable count rides on the tab label so a reward
    // waiting in a group you are not looking at is still visible. ---
    const tabW = 140;
    TABS.forEach((t, i) => {
      const group = groupFor(t.key);
      const ready = claimableCount(group);
      const selected = t.key === tab;
      const label = ready > 0 ? `${t.label} (${ready})` : t.label;
      const btn = makeButton(
        scene,
        CX + (i - 1) * (tabW + Tokens.space.sm),
        250,
        tabW,
        28,
        label,
        selected ? Tokens.color.surfaceHover : Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        () => {
          if (claimInFlight) return;
          tab = t.key;
          page = 0;
          render();
        },
        ready > 0 ? Tokens.text.accent : selected ? Tokens.text.primary : Tokens.text.secondary,
        Tokens.radius.xs
      );
      add(btn.container);
    });

    // --- Meta line: which page, and when this group resets. ---
    const items = sortForDisplay(groupFor(tab));
    const totalPages = Math.max(1, Math.ceil(items.length / ROWS_PER_PAGE));
    page = Phaser.Math.Clamp(page, 0, totalPages - 1);
    const pageItems = items.slice(page * ROWS_PER_PAGE, page * ROWS_PER_PAGE + ROWS_PER_PAGE);

    if (totalPages > 1) {
      add(
        makeText(scene, COL_L, 276, `Page ${page + 1} / ${totalPages}`, {
          size: Tokens.type.size.xs,
          color: Tokens.text.muted
        })
      );
    }
    // Every challenge in a group shares one period, so the first row's
    // expiry is the group's. Lifetime achievements have none.
    const resetLine = items.length > 0 ? formatResetIn(items[0].periodEndsAt) : null;
    add(
      makeText(scene, COL_R, 276, resetLine ?? "Achievements never expire", {
        size: Tokens.type.size.xs,
        color: Tokens.text.muted,
        align: "right",
        originX: 1
      })
    );
    add(makeDivider(scene, COL_L, 286, COL_R));

    // --- Rows ---
    const claimButtons: UIButton[] = [];
    if (pageItems.length === 0) {
      add(
        makeText(scene, CX, ROW_Y0 + ROW_STEP, "Nothing here yet - go play a round.", {
          size: Tokens.type.size.md,
          color: Tokens.text.muted,
          align: "center",
          originX: 0.5
        })
      );
    }
    pageItems.forEach((c, i) => renderRow(c, ROW_Y0 + i * ROW_STEP, claimButtons));
    // A claim that lands while a render is in flight would otherwise come
    // back to freshly-enabled buttons.
    if (claimInFlight) claimButtons.forEach((b) => b.setEnabled(false));

    // --- Footer ---
    if (totalPages > 1) {
      if (page > 0) {
        const prev = makeButton(
          scene,
          250,
          452,
          84,
          32,
          "◀ Prev",
          Tokens.color.surfaceRaised,
          Tokens.color.surfaceHover,
          () => {
            page -= 1;
            render();
          },
          Tokens.text.secondary,
          Tokens.radius.sm
        );
        add(prev.container);
      }
      if (page < totalPages - 1) {
        const next = makeButton(
          scene,
          550,
          452,
          84,
          32,
          "Next ▶",
          Tokens.color.surfaceRaised,
          Tokens.color.surfaceHover,
          () => {
            page += 1;
            render();
          },
          Tokens.text.secondary,
          Tokens.radius.sm
        );
        add(next.container);
      }
    }

    const closeBtn = makeButton(
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
    );
    add(closeBtn.container);
  };

  // ------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------

  const load = () => {
    status = "loading";
    render();
    Promise.all([api.getChallenges(), api.getProgression()])
      .then(([nextBoard, nextProgression]) => {
        if (closed) return;
        board = nextBoard;
        progression = nextProgression;
        claimInFlight = false;

        // Resumption: a player who closed the tab mid-minigame still owes it.
        // Opening Challenges takes them straight into it rather than showing
        // a board with nothing claimable yet.
        if (nextProgression.pendingLevelMinigame) {
          launchLevelUpMinigame(scene, nextProgression.pendingLevelMinigame);
          return;
        }
        if (!nextBoard.available) {
          status = "unavailable";
          render();
          return;
        }
        status = "ready";
        // Open on whichever group actually has something waiting - the
        // reward a player came back for should not be one tap away behind
        // a tab they have no reason to press.
        const firstReady = TABS.find((t) => claimableCount(groupFor(t.key)) > 0);
        tab = firstReady ? firstReady.key : "daily";
        page = 0;
        render();
      })
      .catch((err) => {
        if (closed) return;
        claimInFlight = false;
        status = "error";
        errorMessage =
          err instanceof NetworkError
            ? err.message
            : err instanceof ApiError
              ? err.message
              : "Couldn't load your challenges - try again.";
        render();
      });
  };

  load();
}
