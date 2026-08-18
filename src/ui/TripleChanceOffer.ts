import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "./Theme";
import { makeButton, makePanel } from "./uiHelpers";
import { createShuffleCupReveal } from "./ShuffleCupReveal";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";

/**
 * "Triple Chance" bonus round (#46) - offered after every shuffle-cup GC
 * win (signup bonus in LoginScene, attendant claim in OverworldScene; the
 * only two call sites per spec, not the future real purchase flow). Shared
 * here rather than duplicated per-scene since both need the exact same
 * offer -> play -> chain-or-stop flow.
 *
 * Mechanic (server-authoritative, POST /games/triplechance/play - see
 * server/src/games/triplechance.ts): a single 1-in-3 pick, resolved
 * server-side before any animation runs. Win pays exactly 3x the amount at
 * stake; lose forfeits it entirely (0x). Reuses ShuffleCupReveal exactly as
 * the GC-multiplier reveal does - forced-outcome mode, so the client only
 * ever displays what the server already resolved, never decides anything
 * itself. Passes its own `[0, 0, 3]` display set (see ShuffleCupReveal's
 * `possibleMultipliers` doc comment) since Triple Chance's outcome set
 * isn't a GC-multiplier reveal - showing the OTHER two (non-chosen) cups as
 * 0.5x/1x (the default GC_MULTIPLIERS set) would be actively misleading,
 * those were never real possible outcomes of this round.
 *
 * Repeatable/chainable by design: a win re-offers Triple Chance on the new
 * (tripled) amount; the player can stop and keep their winnings at any
 * point, or a loss ends the chain at 0. GC only - never touches SC, the
 * server route doesn't even accept a currency param.
 */

const TRIPLE_CHANCE_DISPLAY_SET = [0, 0, 3] as const;
const PANEL_W = 440;
const PANEL_H = 240;

export interface TripleChanceOutcome {
  /** Final GC amount held once this Triple Chance detour ends - unchanged `startingAmount` if declined without playing, 0 if the chain ended in a loss, or the compounded amount if the player won and then chose to stop. */
  finalAmount: number;
  /** Whether the player played at least one round (false only if they declined immediately without ever risking anything). */
  played: boolean;
}

/**
 * Offers "Try Triple Chance?" on `startingAmount` GC, centered at (x, y) in
 * `scene`. Fires `onComplete` exactly once, after the player has either
 * declined or the win/chain streak has ended (a loss, or a win they chose
 * not to chain further). Never throws - request failures are surfaced
 * in-place and the offer is simply shown again, same amount, nothing lost
 * (a failed request never partially wagers - the server's transaction is
 * all-or-nothing).
 *
 * `onBalanceChange` (optional): fires once per resolved round, right after
 * `gameState.hydrateFromServer()` in `playRound` - i.e. exactly when the
 * player's real GC balance actually changed server-side. This module never
 * touches a scene's own HUD/balance display itself (same "games only
 * consumes balances" separation as ShuffleCupReveal), so a caller with a
 * persistent on-screen balance (OverworldScene's corner HUD) should pass a
 * callback that refreshes it - otherwise that display stays frozen at its
 * pre-offer value through the whole interactive offer/play/chain sequence
 * even though gameState itself is already correct at every step. Callers
 * without a persistent balance display mid-flow (LoginScene, at this point
 * in its own sequence) can simply omit it.
 */
export function offerTripleChance(
  scene: Phaser.Scene,
  x: number,
  y: number,
  startingAmount: number,
  onComplete: (outcome: TripleChanceOutcome) => void,
  onBalanceChange?: () => void
): void {
  showOffer(scene, x, y, startingAmount, false, undefined, onComplete, onBalanceChange);
}

function showOffer(
  scene: Phaser.Scene,
  x: number,
  y: number,
  amount: number,
  alreadyPlayed: boolean,
  errorMessage: string | undefined,
  onComplete: (outcome: TripleChanceOutcome) => void,
  onBalanceChange?: () => void
) {
  const panel = makePanel(scene, x, y, PANEL_W, PANEL_H, 400).setScrollFactor(0);
  const title = scene.add
    .text(x, y - 80, alreadyPlayed ? "🎲 Try Triple Chance Again?" : "🎲 Try Triple Chance?", {
      fontSize: "18px",
      color: Theme.textGold,
      fontStyle: "bold"
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(401);
  const sub = scene.add
    .text(x, y - 44, `Risk your ${amount} GC for a 1-in-3 shot at ${amount * 3} GC - lose it all otherwise.`, {
      fontSize: "12px",
      color: Theme.textMuted,
      align: "center",
      wordWrap: { width: PANEL_W - 60 }
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(401);
  const errorText = errorMessage
    ? scene.add
        .text(x, y - 14, errorMessage, { fontSize: "11px", color: Theme.textDanger, align: "center", wordWrap: { width: PANEL_W - 60 } })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(401)
    : null;

  const cleanup = () => {
    panel.destroy();
    title.destroy();
    sub.destroy();
    errorText?.destroy();
    yesBtn.destroy();
    noBtn.destroy();
  };

  const yesBtn = makeButton(scene, x - 100, y + 40, 170, 46, "Try It", Theme.accent, Theme.accentHover, () => {
    cleanup();
    playRound(scene, x, y, amount, alreadyPlayed, onComplete, onBalanceChange);
  });
  yesBtn.container.setScrollFactor(0).setDepth(401);

  const noBtn = makeButton(
    scene,
    x + 100,
    y + 40,
    170,
    46,
    "Keep Winnings",
    Theme.neutral,
    Theme.neutralHover,
    () => {
      cleanup();
      onComplete({ finalAmount: amount, played: alreadyPlayed });
    }
  );
  noBtn.container.setScrollFactor(0).setDepth(401);
}

function playRound(
  scene: Phaser.Scene,
  x: number,
  y: number,
  amount: number,
  alreadyPlayed: boolean,
  onComplete: (outcome: TripleChanceOutcome) => void,
  onBalanceChange?: () => void
) {
  const statusPanel = makePanel(scene, x, y, PANEL_W, PANEL_H, 400).setScrollFactor(0);
  const statusTitle = scene.add
    .text(x, y - 80, "🎲 Triple Chance", { fontSize: "18px", color: Theme.textGold, fontStyle: "bold" })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(401);

  api
    .playTripleChance(amount)
    .then((res) => {
      gameState.hydrateFromServer(res.user);
      // #48: the player's real GC balance just changed server-side - let a
      // caller with a persistent on-screen balance (OverworldScene's corner
      // HUD) refresh it now, instead of only once the whole offer/play/
      // chain sequence eventually completes. See offerTripleChance's doc
      // comment above.
      onBalanceChange?.();

      const handle = createShuffleCupReveal(
        scene,
        x,
        y + 15,
        amount,
        () => {
          handle.destroy();
          statusPanel.destroy();
          statusTitle.destroy();
          if (res.result.won) {
            showOffer(scene, x, y, res.result.payout, true, undefined, onComplete, onBalanceChange);
          } else {
            onComplete({ finalAmount: 0, played: true });
          }
        },
        res.result.multiplier,
        TRIPLE_CHANCE_DISPLAY_SET
      );
      handle.container.setScrollFactor(0).setDepth(401);
      handle.start();
    })
    .catch((err) => {
      statusPanel.destroy();
      statusTitle.destroy();
      const message =
        err instanceof ApiError || err instanceof NetworkError
          ? err.message
          : "Something went wrong - please try again.";
      // Re-show the SAME offer, same amount - a failed request never
      // partially wagers (the server's transaction is all-or-nothing), so
      // nothing was lost and the player can just retry from here.
      showOffer(scene, x, y, amount, alreadyPlayed, message, onComplete, onBalanceChange);
    });
}
