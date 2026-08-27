import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import {
  makeGameShell,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  makeInset,
  popIn,
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

// Reel cabinet layout - shared by create()'s cabinet/payline drawing and the
// reel-cell positions below, so the frame always fits exactly around the 3
// cells regardless of future tuning.
const REEL_Y = 230;
const CELL_SIZE = 110;
const CELL_GAP = 20;
const CABINET_W = CELL_SIZE * 3 + CELL_GAP * 2 + 40; // 3 cells + 2 gaps + side padding
const CABINET_H = CELL_SIZE + 70; // room above/below the cells for the marquee lights and breathing room
const MARQUEE_LIGHT_COUNT = 9;
const REEL_REVEAL_DELAY = 280; // ms between each reel's staggered stop - see resolveSpin()

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
    this.cameras.main.setBackgroundColor(Theme.bgDark);

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
    this.messageText.setText("Press SPIN to play").setColor(Theme.textMuted);

    // Arcade-cabinet frame behind the reels - gold trim, marquee chase
    // lights, and a pull lever, so this reads as a real slot machine instead
    // of 3 bare inset squares floating on the display area.
    this.drawCabinet(GAME_SHELL_DISPLAY_CENTER_X, REEL_Y);
    this.startMarqueeLights();

    // Reel cells - centered in the shell's right-side display area, same
    // relative layout the old center-panel version used. Insets are drawn
    // first (so the payline below renders over them, and the reel symbols
    // render over the payline).
    const startX = GAME_SHELL_DISPLAY_CENTER_X - CELL_SIZE - CELL_GAP;
    const cellXs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const x = startX + i * (CELL_SIZE + CELL_GAP);
      cellXs.push(x);
      makeInset(this, x, REEL_Y, CELL_SIZE, CELL_SIZE, 14);
    }

    this.drawPayline(startX, REEL_Y);

    for (const x of cellXs) {
      const t = this.add.text(x, REEL_Y, "❔", { fontSize: "52px" }).setOrigin(0.5);
      this.reelTexts.push(t);
    }

    this.add
      .text(GAME_SHELL_DISPLAY_CENTER_X, 560, "3-of-a-kind pays big • 2-of-a-kind pays too", {
        fontSize: "11px",
        color: Theme.textMuted
      })
      .setOrigin(0.5);

    this.updateBalance();
  }

  /** Rounded gold-trimmed cabinet body behind the 3 reel insets - drawn at depth -1 so every reel/payline/light element (all default depth 0) always renders in front of it regardless of creation order. Also lays out (but doesn't animate) the marquee light positions and the lever track/knob. */
  private drawCabinet(cx: number, cy: number) {
    const g = this.add.graphics().setDepth(-1);
    g.fillStyle(Theme.outline, 1);
    g.fillRoundedRect(cx - CABINET_W / 2, cy - CABINET_H / 2, CABINET_W, CABINET_H, 20);
    g.lineStyle(5, Theme.gold, 1);
    g.strokeRoundedRect(cx - CABINET_W / 2, cy - CABINET_H / 2, CABINET_W, CABINET_H, 20);
    g.lineStyle(2, Theme.panelBorder, 1);
    g.strokeRoundedRect(cx - CABINET_W / 2 + 8, cy - CABINET_H / 2 + 8, CABINET_W - 16, CABINET_H - 16, 14);

    // Marquee chase lights along the top edge - see startMarqueeLights() for the blink pattern.
    const lightSpan = CABINET_W - 50;
    const lightY = cy - CABINET_H / 2;
    for (let i = 0; i < MARQUEE_LIGHT_COUNT; i++) {
      const x = cx - lightSpan / 2 + (lightSpan / (MARQUEE_LIGHT_COUNT - 1)) * i;
      this.cabinetLights.push(this.add.circle(x, lightY, 4, Theme.gold));
    }

    // Pull lever - a small vertical track tucked into the cabinet's own
    // right-edge gutter (between the rightmost reel cell and the cabinet's
    // outer border), NOT bolted on beyond the cabinet body, with a knob
    // that yanks down and springs back up on spin (see pullLever()). Sized
    // to fit that gutter with margin on both sides - a first version placed
    // this 20px beyond the cabinet's right edge instead, which put the
    // knob's own radius 8px past the canvas's actual right edge (800) on
    // every platform, not just mobile; there's no documented safe-zone
    // constant for X the way SAFE_ZONE_TOP/BOTTOM covers Y, but every other
    // game empirically keeps its rightmost real content at/under ~x=775
    // (Roulette's GREEN button, Baccarat's TIE button, etc.), which this
    // now respects too (cabinet's own outer edge lands at 775).
    const leverX = cx + CABINET_W / 2 - 10;
    this.leverTop = cy - CABINET_H / 2 + 24;
    this.leverBottom = cy + CABINET_H / 2 - 24;
    this.add.rectangle(leverX, (this.leverTop + this.leverBottom) / 2, 4, this.leverBottom - this.leverTop, Theme.panelBorder);
    this.leverKnob = this.add.circle(leverX, this.leverTop, 8, Theme.accent).setStrokeStyle(2, Theme.outline);
  }

  /** Thin gold payline crossing the middle of all 3 cells, with small inward-pointing arrow markers at each end - the classic "this row pays" indicator. */
  private drawPayline(startX: number, y: number) {
    const left = startX - CELL_SIZE / 2 - 10;
    const right = startX + 2 * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2 + 10;
    const line = this.add.graphics();
    line.lineStyle(3, Theme.gold, 0.55);
    line.beginPath();
    line.moveTo(left, y);
    line.lineTo(right, y);
    line.strokePath();
    line.fillStyle(Theme.gold, 0.8);
    line.fillTriangle(left, y - 7, left, y + 7, left + 10, y);
    line.fillTriangle(right, y - 7, right, y + 7, right - 10, y);
  }

  /** Classic marquee "chase" blink - cycles which third of the lights is lit every tick. */
  private startMarqueeLights() {
    let offset = 0;
    this.marqueeTimer = this.time.addEvent({
      delay: 150,
      loop: true,
      callback: () => {
        offset = (offset + 1) % 3;
        this.cabinetLights.forEach((dot, i) => dot.setAlpha((i + offset) % 3 === 0 ? 1 : 0.25));
      }
    });
  }

  /** Yanks the lever knob down and springs it back up - purely cosmetic, fired alongside the SPIN button press. */
  private pullLever() {
    if (!this.leverKnob) return;
    this.tweens.chain({
      targets: this.leverKnob,
      tweens: [
        { y: this.leverBottom, duration: 180, ease: "Quad.In" },
        { y: this.leverTop, duration: 260, ease: "Back.Out", delay: 80 }
      ]
    });
  }

  /** Pulsing gold ring on each reel cell that landed on the winning symbol - reels.indexOf-style lookup against winKey, not just "the first winCount cells", since a 2-of-3 win can land in any 2 of the 3 positions. */
  private highlightWinningCells(indices: number[]) {
    for (const i of indices) {
      const t = this.reelTexts[i];
      if (!t) continue;
      const ring = this.add.circle(t.x, t.y, 62).setStrokeStyle(4, Theme.gold, 1);
      this.tweens.add({
        targets: ring,
        scale: { from: 0.9, to: 1.08 },
        alpha: { from: 1, to: 0.3 },
        yoyo: true,
        repeat: 3,
        duration: 260,
        onComplete: () => ring.destroy()
      });
    }
  }

  /** #36: the reel result and paytable are resolved server-side (POST /games/slots/play) - the spinning-reels animation here is purely cosmetic while the request is in flight. */
  private spin() {
    if (this.spinning) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    const bet = gameState.betAmount;
    this.spinning = true;
    this.spinButton?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Spinning...").setColor(Theme.textMuted);
    playSfx(this, "reelSpin");
    this.pullLever();

    this.spinTimer = this.time.addEvent({
      delay: 80,
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
   * Reveals the 3 reels one at a time (280ms apart) instead of snapping all
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
      this.messageText.setText(`${label}  +${payout} Tickets`).setColor(Theme.textAccent);
      popIn(this, this.messageText);
      this.highlightWinningCells(reels.reduce<number[]>((acc, key, i) => (key === winKey ? [...acc, i] : acc), []));
      showWinCelebration(this, payout);
    } else {
      this.messageText.setText("No match, try again").setColor(Theme.textMuted);
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
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Theme.textDanger);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Theme.textDanger);
    }

    this.spinning = false;
    this.spinButton?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(`🪙 ${gameState.goldCoins}   🎟️ ${gameState.tickets}`);
  }
}
