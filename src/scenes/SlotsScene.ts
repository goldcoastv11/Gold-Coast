import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Tokens } from "../ui/DesignTokens";
import {
  makeGameShell,
  makeText,
  makeDivider,
  formatBalance,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  GAME_SHELL_DISPLAY_CENTER_Y,
  makeInset,
  popIn,
  drawCabinetFrame,
  BetControl,
  UIButton
} from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { track, EVENTS } from "../api/track";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";

/**
 * Symbol display metadata + the emoji reel. The paytable itself (weights,
 * pay3x/pay2x) is resolved server-side now (#36, see
 * server/src/games/slots.ts) - this map is display-only, keyed by the same
 * symbol `key` the server returns so the client never has to guess which
 * emoji a server-picked symbol corresponds to.
 */
const SYMBOL_EMOJI: Record<string, string> = {
  cherry: "🍒",
  lemon: "🍋",
  bell: "🔔",
  diamond: "💎",
  seven: "7️⃣"
};
const SYMBOL_KEYS = Object.keys(SYMBOL_EMOJI);

function randomEmoji(): string {
  return SYMBOL_EMOJI[SYMBOL_KEYS[Phaser.Math.Between(0, SYMBOL_KEYS.length - 1)]];
}

/**
 * SLOTS, on the Stake-style direction (see ui/DesignTokens.ts).
 *
 * This screen had the most chrome to unwind: a gold-trimmed cabinet with a
 * second inner gold border, nine gold marquee bulbs, a gold payline and an
 * orange lever knob with a dark outline around it. The cabinet is now the
 * same flat raised surface every other converted game sits on, and the trim
 * is simply gone (direction note 3 - a board is defined by where its surface
 * ends, not by a frame drawn around it).
 *
 * The machine's IDENTITY is kept, though, because it is what makes this
 * screen a slot machine rather than a third grid game: the marquee chase
 * still runs, the payline still crosses all three reels with its inward
 * arrows, and the lever still yanks on every spin. All three are simply
 * re-toned to muted text-grey, so they read as quiet machine detail instead
 * of competing with the accent. The one accent left on the board is the
 * winning-cell ring, which is the win state (direction note 2).
 *
 * This also fixed a real layout bug: the paytable caption used to sit at
 * y=560, well below SAFE_ZONE_BOTTOM (470), i.e. cropped on a real phone.
 * Every element now sits inside the 130-470 band.
 */
const DX = GAME_SHELL_DISPLAY_CENTER_X;
const CABINET_CY = GAME_SHELL_DISPLAY_CENTER_Y - 8;
const CELL_SIZE = 110;
const CELL_GAP = Tokens.space.xl;
/** 3 cells + 2 gaps + side padding - lands on the same ~410px width the rest of the family uses. */
const CABINET_W = CELL_SIZE * 3 + CELL_GAP * 2 + Tokens.space.huge;
const CABINET_H = 280;
const CABINET_TOP = CABINET_CY - CABINET_H / 2;
const CABINET_BOTTOM = CABINET_CY + CABINET_H / 2;
const CABINET_LEFT = DX - CABINET_W / 2 + Tokens.space.xxl;
const CABINET_RIGHT = DX + CABINET_W / 2 - Tokens.space.xxl;

const REEL_Y = 256;
const MARQUEE_Y = CABINET_TOP + Tokens.space.xl;
const DIVIDER_Y = 356;
const CAPTION_Y = 384;

const MARQUEE_LIGHT_COUNT = 9;
const MARQUEE_LIGHT_RADIUS = 3;
/** Dim state for an unlit bulb in the chase - see startMarqueeLights(). */
const MARQUEE_DIM_ALPHA = 0.2;
const PAYLINE_ALPHA = 0.5;
const PAYLINE_OVERHANG = Tokens.space.md;
const PAYLINE_ARROW_H = 7;
const LEVER_KNOB_RADIUS = 8;
const LEVER_TRACK_W = 4;
const WIN_RING_RADIUS = 62;
/** ms between each reel's staggered stop - see resolveSpin(). The token exists for exactly this: a rhythm the player watches, not a transition. */
const REEL_REVEAL_DELAY = Tokens.motion.duration.stagger;

export class SlotsScene extends Phaser.Scene {
  private reelTexts: Phaser.GameObjects.Text[] = [];
  private balanceText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private spinning = false;
  private spinTimer?: Phaser.Time.TimerEvent;
  private spinButton?: UIButton;
  private betControl?: BetControl;
  private shell!: GameShellHandle;

  // Cabinet "juice" - see drawCabinet()/startMarqueeLights()/pullLever().
  private cabinetLights: Phaser.GameObjects.Arc[] = [];
  private marqueeTimer?: Phaser.Time.TimerEvent;
  private leverKnob?: Phaser.GameObjects.Arc;
  private leverTop = 0;
  private leverBottom = 0;

  constructor() {
    super("SlotsScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "wackyWaiting");
    this.spinning = false;
    this.spinTimer = undefined;
    this.reelTexts = [];
    this.cabinetLights = [];
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.spinTimer) {
        this.spinTimer.remove(false);
        this.spinTimer = undefined;
      }
      if (this.marqueeTimer) {
        this.marqueeTimer.remove(false);
        this.marqueeTimer = undefined;
      }
    });

    // Stake-style shell: left sidebar (title/balance/bet/message/Spin/Walk
    // Away) + open right-side display area for the reels - see
    // ui/uiHelpers.ts's makeGameShell doc comment.
    this.shell = makeGameShell(this, "GOLD SLOTS", "SPIN", {
      onStart: () => this.spin(),
      onCashOut: () => {},
      onWalkAway: () => fadeToScene(this, "OverworldScene")
    });
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.spinButton = this.shell.startBtn;
    this.betControl = this.shell.betControl;
    this.messageText.setText("Press SPIN to play").setColor(Tokens.text.muted);

    // Flat cabinet body behind the reels, plus the machine detail that keeps
    // this reading as a slot machine rather than 3 bare squares: marquee
    // chase, payline, pull lever.
    this.drawCabinet(DX, CABINET_CY);
    this.startMarqueeLights();

    // Reel cells - centered in the shell's right-side display area. Insets
    // are drawn first (so the payline below renders over them, and the reel
    // symbols render over the payline).
    const startX = DX - CELL_SIZE - CELL_GAP;
    const cellXs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const x = startX + i * (CELL_SIZE + CELL_GAP);
      cellXs.push(x);
      makeInset(this, x, REEL_Y, CELL_SIZE, CELL_SIZE, Tokens.radius.md);
    }

    this.drawPayline(startX, REEL_Y);

    for (const x of cellXs) {
      const t = makeText(this, x, REEL_Y, "❔", {
        size: Tokens.type.glyph.xl,
        align: "center",
        originX: 0.5,
        originY: 0.5
      });
      this.reelTexts.push(t);
    }

    makeDivider(this, CABINET_LEFT, DIVIDER_Y, CABINET_RIGHT);

    makeText(this, DX, CAPTION_Y, "3 OF A KIND PAYS BIG  ·  2 OF A KIND PAYS TOO", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5
    });

    this.updateBalance();
  }

  /**
   * Flat cabinet body behind the 3 reel insets - the same raised surface
   * every other converted board uses, with no trim and no inner border. Also
   * lays out (but doesn't animate) the marquee light positions and the lever
   * track/knob.
   */
  private drawCabinet(cx: number, cy: number) {
    drawCabinetFrame(this, cx, cy, CABINET_W, CABINET_H);

    // Marquee chase lights along the top - see startMarqueeLights() for the
    // blink pattern. Muted text-grey rather than gold: the chase is machine
    // detail, not a signal, so it should never compete with the accent.
    const lightSpan = CABINET_W - Tokens.space.huge;
    for (let i = 0; i < MARQUEE_LIGHT_COUNT; i++) {
      const x = cx - lightSpan / 2 + (lightSpan / (MARQUEE_LIGHT_COUNT - 1)) * i;
      this.cabinetLights.push(
        this.add.circle(x, MARQUEE_Y, MARQUEE_LIGHT_RADIUS, Tokens.color.textMuted)
      );
    }

    // Pull lever - a small vertical track tucked into the cabinet's own
    // right-edge gutter (between the rightmost reel cell and the cabinet's
    // outer edge), NOT bolted on beyond the cabinet body, with a knob that
    // yanks down and springs back up on spin (see pullLever()). Sized to fit
    // that gutter with margin on both sides - a first version placed this
    // 20px beyond the cabinet's right edge instead, which put the knob's own
    // radius 8px past the canvas's actual right edge (800) on every platform,
    // not just mobile; there's no documented safe-zone constant for X the way
    // SAFE_ZONE_TOP/BOTTOM covers Y, but every other game empirically keeps
    // its rightmost real content at/under ~x=775 (Roulette's GREEN button,
    // Baccarat's TIE button, etc.), which this now respects too (cabinet's
    // own outer edge lands at 775).
    const leverX = cx + CABINET_W / 2 - Tokens.space.md;
    this.leverTop = CABINET_TOP + Tokens.space.xxl;
    this.leverBottom = CABINET_BOTTOM - Tokens.space.xxl;
    this.add.rectangle(
      leverX,
      (this.leverTop + this.leverBottom) / 2,
      LEVER_TRACK_W,
      this.leverBottom - this.leverTop,
      Tokens.color.surfaceHover
    );
    this.leverKnob = this.add.circle(
      leverX,
      this.leverTop,
      LEVER_KNOB_RADIUS,
      Tokens.color.textMuted
    );
  }

  /** Thin payline crossing the middle of all 3 cells, with small inward-pointing arrow markers at each end - the classic "this row pays" indicator, now in muted grey rather than gold. */
  private drawPayline(startX: number, y: number) {
    const left = startX - CELL_SIZE / 2 - PAYLINE_OVERHANG;
    const right = startX + 2 * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2 + PAYLINE_OVERHANG;
    const line = this.add.graphics();
    line.lineStyle(1, Tokens.color.textMuted, PAYLINE_ALPHA);
    line.beginPath();
    line.moveTo(left, y);
    line.lineTo(right, y);
    line.strokePath();
    line.fillStyle(Tokens.color.textMuted, 1);
    line.fillTriangle(left, y - PAYLINE_ARROW_H, left, y + PAYLINE_ARROW_H, left + Tokens.space.sm, y);
    line.fillTriangle(right, y - PAYLINE_ARROW_H, right, y + PAYLINE_ARROW_H, right - Tokens.space.sm, y);
  }

  /** Classic marquee "chase" blink - cycles which third of the lights is lit every tick. */
  private startMarqueeLights() {
    let offset = 0;
    this.marqueeTimer = this.time.addEvent({
      delay: Tokens.motion.duration.base,
      loop: true,
      callback: () => {
        offset = (offset + 1) % 3;
        this.cabinetLights.forEach((dot, i) =>
          dot.setAlpha((i + offset) % 3 === 0 ? 1 : MARQUEE_DIM_ALPHA)
        );
      }
    });
  }

  /** Yanks the lever knob down and springs it back up - purely cosmetic, fired alongside the SPIN button press. */
  private pullLever() {
    if (!this.leverKnob) return;
    this.tweens.chain({
      targets: this.leverKnob,
      tweens: [
        // Down accelerates (a yank is physics, so it keeps its ease-IN),
        // back up settles on the token emphasis ease.
        { y: this.leverBottom, duration: Tokens.motion.duration.base, ease: "Quad.In" },
        {
          y: this.leverTop,
          duration: Tokens.motion.duration.slow,
          ease: Tokens.motion.ease.emphasis,
          delay: Tokens.motion.duration.instant
        }
      ]
    });
  }

  /**
   * Pulsing ring on each reel cell that landed on the winning symbol -
   * reels.indexOf-style lookup against winKey, not just "the first winCount
   * cells", since a 2-of-3 win can land in any 2 of the 3 positions.
   *
   * This is the ONE accent-coloured thing on the board (direction note 2):
   * it marks the win state, which is exactly what the accent is for.
   */
  private highlightWinningCells(indices: number[]) {
    for (const i of indices) {
      const t = this.reelTexts[i];
      if (!t) continue;
      const ring = this.add
        .circle(t.x, t.y, WIN_RING_RADIUS)
        .setStrokeStyle(2, Tokens.color.accent, 1);
      this.tweens.add({
        targets: ring,
        scale: { from: 0.9, to: 1.08 },
        alpha: { from: 1, to: 0.3 },
        yoyo: true,
        repeat: 3,
        duration: Tokens.motion.duration.slow,
        onComplete: () => ring.destroy()
      });
    }
  }

  /** #36: the reel result and paytable are resolved server-side (POST /games/slots/play) - the spinning-reels animation here is purely cosmetic while the request is in flight. */
  private spin() {
    if (this.spinning) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
      return;
    }

    const bet = gameState.betAmount;
    this.spinning = true;
    this.spinButton?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Spinning...").setColor(Tokens.text.muted);
    playSfx(this, "reelSpin");
    this.pullLever();

    this.spinTimer = this.time.addEvent({
      delay: Tokens.motion.duration.instant,
      loop: true,
      callback: () => {
        const allActive = this.reelTexts.every((t) => t && t.active);
        if (!allActive) {
          this.spinTimer?.remove(false);
          return;
        }
        this.reelTexts.forEach((t) => t.setText(randomEmoji()));
      }
    });

    api
      .playSlots(bet, "GC")
      .then((res) => this.resolveSpin(res, bet))
      .catch((err) => this.handleSpinError(err));
  }

  /**
   * Reveals the 3 reels one at a time (REEL_REVEAL_DELAY apart) instead of snapping all
   * 3 at once - each stop gets its own `reelStop` sfx + pop, a classic
   * slot-machine "clunk clunk clunk" instead of one instant flat reveal.
   * The win/lose message, payout, and highlight only appear after the last
   * reel lands.
   */
  private resolveSpin(res: Awaited<ReturnType<typeof api.playSlots>>, bet: number) {
    this.spinTimer?.remove(false);

    gameState.hydrateFromServer(res.user);

    const { reels, payout, winKey, winCount } = res.result;

    // Retention Leg 1 (see src/api/track.ts) - recorded here, off the
    // server's settled result, NOT after the staggered reel reveal below:
    // the round is already resolved and the balance already moved by this
    // point, so a player who backs out mid-animation still counts as
    // having played it. betAmount is Gold Coins; payout is Tickets.
    track(EVENTS.GAME_ROUND_PLAYED, {
      game: "slots",
      betAmount: bet,
      outcome: payout > 0 ? "win" : "loss",
      payout
    });
    let step = 0;
    this.spinTimer = this.time.addEvent({
      delay: REEL_REVEAL_DELAY,
      repeat: reels.length - 1,
      callback: () => {
        const key = reels[step];
        this.reelTexts[step].setText(SYMBOL_EMOJI[key] ?? "❔");
        popIn(this, this.reelTexts[step]);
        playSfx(this, "reelStop");
        step++;

        if (step >= reels.length) {
          this.spinTimer = undefined;
          this.finishSpin(reels, payout, winKey, winCount);
        }
      }
    });
  }

  private finishSpin(
    reels: string[],
    payout: number,
    winKey: string | null,
    winCount: 2 | 3 | null
  ) {
    if (payout > 0 && winKey) {
      const label = winCount === 3 ? `3x ${SYMBOL_EMOJI[winKey]} — JACKPOT!` : `2x ${SYMBOL_EMOJI[winKey]}`;
      this.messageText.setText(`${label}  +${payout} Tickets`).setColor(Tokens.text.accent);
      popIn(this, this.messageText);
      this.highlightWinningCells(reels.reduce<number[]>((acc, key, i) => (key === winKey ? [...acc, i] : acc), []));
      showWinCelebration(this, payout);
    } else {
      this.messageText.setText("No match, try again").setColor(Tokens.text.muted);
      playSfx(this, "lose");
    }

    this.updateBalance();
    this.spinning = false;
    this.spinButton?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private handleSpinError(err: unknown) {
    this.spinTimer?.remove(false);
    this.spinTimer = undefined;

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Gold Coins!").setColor(Tokens.text.negative);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
    }

    this.spinning = false;
    this.spinButton?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins, gameState.tickets));
  }
}
