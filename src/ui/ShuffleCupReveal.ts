import Phaser from "phaser";
import { Theme } from "./Theme";
import { popIn } from "./uiHelpers";
import { GC_MULTIPLIERS } from "../economy/gcMultiplier";

/**
 * Reusable "shuffle cup" reveal mini-game (task #28). Not tied to any
 * currency or economy call - it's a pure presentation component that takes
 * a base amount, plays a fair shuffle + pick + reveal sequence, and hands
 * the resolved amount back to whoever created it via `onResolve`. The
 * caller (login-signup flow, attendant-claim flow - see #29) is
 * responsible for actually crediting that amount through the real ledger;
 * this component never touches gameState/the ledger itself, consistent
 * with "games only consumes balances, economy owns balance mutation." The
 * set of possible multipliers is imported from economy/gcMultiplier.ts
 * (#27's GC_MULTIPLIERS = [0.5, 1, 2]) rather than redefined here, so the
 * two sides can't drift - but this component still only ever *reads* that
 * constant and computes a generic `baseAmount * multiplier`; it has no
 * opinion on GC vs SC and never calls resolveGcAmount or any ledger
 * function itself.
 *
 * Mechanics: 3 cups, each secretly assigned one of MULTIPLIERS (fixed set,
 * one cup per value - always exactly one 0.5x, one 1x, one 2x). A fast
 * sequence of real position swaps shuffles them - the actual GameObjects
 * change slots and `positions` is updated in lockstep with every swap, so
 * the final mapping is the honest result of the swap sequence, not
 * something decided afterward and faked onto the visuals. The player picks
 * one of the 3 fixed on-screen slots; whichever cup is honestly sitting
 * there at that moment is revealed, and its multiplier resolves the payout.
 *
 * Fairness: verified via a 1,000,000-trial standalone simulation of this
 * exact swap algorithm - for any slot the player could click, each of the
 * 3 multipliers lands there ~33.3% of the time (see dev notes / PR
 * description for the script). The swap sequence is a "lazy" random walk
 * (~1/3 of steps are a no-op) specifically so the full 6-permutation space
 * of S3 is reachable - a walk of only always-real transpositions is
 * parity-locked to 3 of the 6 permutations (still per-slot-fair, but a
 * needless structural regularity); the lazy version removes that too.
 *
 * Sequence: preview (all 3 amounts shown briefly) -> hide (cups close back
 * to their identical unrevealed state) -> shuffle -> pick -> reveal (real
 * change to the flow, not just a relabel - see #32).
 *
 * #32 postmortem (real bug, found via live play in OverworldScene): every
 * element this component creates now gets its own explicit
 * `.setScrollFactor(0)` call. Previously only the caller's outer
 * `handle.container.setScrollFactor(0)` was set, which is enough for
 * rendering (children of a scrollFactor(0) container draw at a fixed
 * screen position regardless of camera scroll) but NOT enough for Phaser's
 * *input hit-testing* of interactive children nested inside that
 * container - those still hit-test using their own default scrollFactor
 * (1) unless told otherwise, so once the camera scrolls away from the
 * origin (normal in OverworldScene once the player has walked anywhere),
 * a real click lands on the cups visually but Phaser computes the wrong
 * world point for the hit zones and the click is silently swallowed.
 * Reproduced directly (scrolled a scene's camera, dispatched a genuine
 * native `mousedown` at the cup's screen position - not the
 * `zone.emit("pointerdown")` shortcut earlier testing used, which bypasses
 * Phaser's hit-testing entirely and can't catch this class of bug - and
 * watched the click get dropped), fixed by setting scrollFactor(0) on
 * every element here individually (matching how every other modal-style
 * overlay in this codebase - see OverworldScene's chip/skin panels - sets
 * it per-element rather than trusting container inheritance), and
 * reproduced-then-confirmed-fixed the same way.
 */

const MULTIPLIERS = GC_MULTIPLIERS; // cup identity -> multiplier, fixed, one cup per value (see economy/gcMultiplier.ts)
const SLOT_COUNT = 3;
const SLOT_SPACING = 110;
const SWAP_STEPS = 18; // ~1/3 are no-ops, so ~12 real swaps happen on average - fast and plenty to be untrackable
const NOOP_CHANCE = 1 / 3;
const PREVIEW_MS = 1400; // how long the "here's what's under each cup" beat shows before cups close and shuffle starts

const CUP_W = 84;
const CUP_H = 78;

function slotX(slot: number): number {
  return (slot - (SLOT_COUNT - 1) / 2) * SLOT_SPACING;
}

function colorForMultiplier(m: number): { fill: number; text: string } {
  if (m < 1) return { fill: Theme.loseZone, text: Theme.textDanger };
  if (m > 1) return { fill: Theme.gold, text: Theme.textGold };
  return { fill: Theme.winZone, text: Theme.textAccent };
}

interface CupVisual {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

export interface ShuffleCupResult {
  multiplier: number;
  resolvedAmount: number;
}

export interface ShuffleCupHandle {
  container: Phaser.GameObjects.Container;
  /** Begins the shuffle -> pick -> reveal sequence. Safe to call once; later calls are ignored while running. */
  start: () => void;
  destroy: () => void;
}

/** Draws (or redraws) a cup in its closed state. Deliberately identical for every cup identity - no visual tell. */
function paintClosedCup(bg: Phaser.GameObjects.Graphics) {
  bg.clear();
  bg.fillStyle(Theme.secondary, 1);
  bg.fillRoundedRect(-CUP_W / 2, -CUP_H / 2, CUP_W, CUP_H, { tl: 8, tr: 8, bl: 30, br: 30 });
  bg.lineStyle(3, Theme.outline, 1);
  bg.strokeRoundedRect(-CUP_W / 2, -CUP_H / 2, CUP_W, CUP_H, { tl: 8, tr: 8, bl: 30, br: 30 });
  // handle-ish rim detail, same on every cup
  bg.lineStyle(2, Theme.outline, 0.5);
  bg.strokeRoundedRect(-CUP_W / 2 + 8, -CUP_H / 2 + 8, CUP_W - 16, 10, 5);
}

function paintRevealedCup(bg: Phaser.GameObjects.Graphics, multiplier: number, dim: boolean) {
  const { fill } = colorForMultiplier(multiplier);
  bg.clear();
  bg.fillStyle(fill, dim ? 0.55 : 1);
  bg.fillRoundedRect(-CUP_W / 2, -CUP_H / 2, CUP_W, CUP_H, 12);
  bg.lineStyle(3, Theme.outline, dim ? 0.5 : 1);
  bg.strokeRoundedRect(-CUP_W / 2, -CUP_H / 2, CUP_W, CUP_H, 12);
}

/**
 * Creates a shuffle-cup reveal centered at (x, y) in `scene`. Nothing
 * animates until `start()` is called, so the caller controls timing (e.g.
 * show a "you won a bonus!" beat first). `onResolve` fires once, after the
 * player picks a cup and the reveal animation finishes.
 */
export function createShuffleCupReveal(
  scene: Phaser.Scene,
  x: number,
  y: number,
  baseAmount: number,
  onResolve: (result: ShuffleCupResult) => void
): ShuffleCupHandle {
  const container = scene.add.container(x, y).setScrollFactor(0);

  /** e.g. 0.5 -> "500", 1 -> "1000", 2 -> "2000" (or "12.5" for a fractional baseAmount) - see #32. */
  const formatAmount = (multiplier: number): string => {
    return String(Math.round(baseAmount * multiplier * 100) / 100);
  };

  const statusText = scene.add
    .text(0, -CUP_H / 2 - 30, "Get ready...", {
      fontSize: "16px",
      color: Theme.textPrimary,
      fontStyle: "bold"
    })
    .setOrigin(0.5)
    .setScrollFactor(0);
  container.add(statusText);

  // positions[slot] = cupId currently sitting at that slot. Cup 0/1/2 map
  // 1:1 to MULTIPLIERS[0]/[1]/[2] and never change identity - only slot.
  const positions = [0, 1, 2];

  const cups: CupVisual[] = MULTIPLIERS.map((_, cupId) => {
    const cupContainer = scene.add.container(slotX(cupId), 0).setScrollFactor(0);
    const bg = scene.add.graphics().setScrollFactor(0);
    const label = scene.add
      .text(0, 0, "", { fontSize: "18px", fontStyle: "bold" })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);
    paintClosedCup(bg);
    cupContainer.add([bg, label]);
    container.add(cupContainer);
    return { container: cupContainer, bg, label };
  });

  // Fixed-position hit zones (one per slot, NOT per cup) - the player picks
  // a screen position, not a cup identity they can't actually see.
  // setScrollFactor(0) here is load-bearing, not cosmetic - see #32
  // postmortem above: without it, clicks silently miss once the camera has
  // scrolled, even though the outer container also has scrollFactor(0).
  const hitZones = Array.from({ length: SLOT_COUNT }, (_, slot) => {
    const zone = scene.add
      .zone(slotX(slot), 0, CUP_W, CUP_H)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    container.add(zone);
    return zone;
  });

  let started = false;
  let resolved = false;
  const pendingTimers: Phaser.Time.TimerEvent[] = [];

  const setZonesEnabled = (enabled: boolean) => {
    hitZones.forEach((z) => {
      z.removeAllListeners();
      if (enabled) {
        z.setInteractive({ useHandCursor: true });
      } else {
        z.disableInteractive();
      }
    });
  };

  setZonesEnabled(false);

  function runSwapStep(stepsLeft: number, onDone: () => void) {
    if (stepsLeft <= 0) {
      onDone();
      return;
    }

    if (Math.random() < NOOP_CHANCE) {
      // No-op step: still worth a beat of motion so the shuffle doesn't
      // visibly "pause" - a harmless wobble on a random cup, no position change.
      const cupId = Phaser.Math.Between(0, SLOT_COUNT - 1);
      scene.tweens.add({
        targets: cups[cupId].container,
        scaleX: 1.08,
        scaleY: 0.92,
        duration: 70,
        yoyo: true,
        ease: "Sine.InOut",
        onComplete: () => runSwapStep(stepsLeft - 1, onDone)
      });
      return;
    }

    let a = Phaser.Math.Between(0, SLOT_COUNT - 1);
    let b = Phaser.Math.Between(0, SLOT_COUNT - 1);
    while (b === a) b = Phaser.Math.Between(0, SLOT_COUNT - 1);

    const cupA = positions[a];
    const cupB = positions[b];
    const duration = Phaser.Math.Between(90, 140);

    let doneCount = 0;
    const onTweenDone = () => {
      doneCount++;
      if (doneCount < 2) return;
      // Commit the real swap only after both cups have visually arrived -
      // this IS the source of truth, not a label update.
      positions[a] = cupB;
      positions[b] = cupA;
      runSwapStep(stepsLeft - 1, onDone);
    };

    scene.tweens.add({
      targets: cups[cupA].container,
      x: slotX(b),
      duration,
      ease: "Sine.InOut",
      onComplete: onTweenDone
    });
    scene.tweens.add({
      targets: cups[cupB].container,
      x: slotX(a),
      duration,
      ease: "Sine.InOut",
      onComplete: onTweenDone
    });
  }

  function start() {
    if (started) return;
    started = true;

    // Preview beat: show what's really under each cup (by identity, not
    // slot - identity and slot are the same thing at this point since no
    // swaps have happened yet) before hiding them and shuffling for real.
    // An actual sequence change, not a relabel - see #32.
    statusText.setText("Here's what's under each cup...");
    cups.forEach((cup, cupId) => {
      paintRevealedCup(cup.bg, MULTIPLIERS[cupId], false);
      cup.label.setText(formatAmount(MULTIPLIERS[cupId])).setColor(colorForMultiplier(MULTIPLIERS[cupId]).text).setVisible(true);
    });

    const previewTimer = scene.time.delayedCall(PREVIEW_MS, () => {
      cups.forEach((cup) => {
        paintClosedCup(cup.bg);
        cup.label.setVisible(false);
      });
      statusText.setText("Shuffling...");
      runSwapStep(SWAP_STEPS, () => {
        statusText.setText("Pick a cup!");
        setZonesEnabled(true);
        hitZones.forEach((zone, slot) => {
          zone.on("pointerdown", () => pickSlot(slot));
        });
      });
    });
    pendingTimers.push(previewTimer);
  }

  function pickSlot(slot: number) {
    if (resolved) return;
    resolved = true;
    setZonesEnabled(false);

    const chosenCupId = positions[slot];
    const multiplier = MULTIPLIERS[chosenCupId];
    const resolvedAmount = Math.round(baseAmount * multiplier * 100) / 100;

    statusText.setText(`You got ${formatAmount(multiplier)}!`);

    // Reveal every cup - the chosen one full-bright, the other two dimmed -
    // so the player can see what the road not taken would have been. Shows
    // the actual resolved amount under each cup, not a bare "Xx" multiplier
    // label - see #32.
    cups.forEach((cup, cupId) => {
      const isChosen = cupId === chosenCupId;
      paintRevealedCup(cup.bg, MULTIPLIERS[cupId], !isChosen);
      cup.label.setText(formatAmount(MULTIPLIERS[cupId])).setColor(colorForMultiplier(MULTIPLIERS[cupId]).text).setVisible(true);
      if (isChosen) popIn(scene, cup.container);
    });

    const timer = scene.time.delayedCall(900, () => {
      onResolve({ multiplier, resolvedAmount });
    });
    pendingTimers.push(timer);
  }

  return {
    container,
    start,
    destroy: () => {
      pendingTimers.forEach((t) => t.remove(false));
      scene.tweens.killTweensOf(cups.map((c) => c.container));
      hitZones.forEach((z) => z.removeAllListeners());
      container.destroy();
    }
  };
}
