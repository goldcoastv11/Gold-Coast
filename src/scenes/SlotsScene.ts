import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";

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

export class SlotsScene extends Phaser.Scene {
  private reelTexts: Phaser.GameObjects.Text[] = [];
  private balanceText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private spinning = false;
  private spinTimer?: Phaser.Time.TimerEvent;
  private spinButton?: UIButton;
  private betControl?: BetControl;

  constructor() {
    super("SlotsScene");
  }

  create() {
    this.spinning = false;
    this.spinTimer = undefined;
    this.reelTexts = [];
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.spinTimer) {
        this.spinTimer.remove(false);
        this.spinTimer = undefined;
      }
    });

    makePanel(this, 400, 300, 520, 480);

    this.add
      .text(400, 90, "GOLD SLOTS", {
        fontSize: "30px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    // Balance pill
    makeInset(this, 400, 130, 380, 34, 17);
    this.balanceText = this.add
      .text(400, 130, "", { fontSize: "14px", color: Theme.textPrimary })
      .setOrigin(0.5);

    // Reel cells
    const reelY = 230;
    const cellSize = 110;
    const gap = 20;
    const startX = 400 - cellSize - gap;
    for (let i = 0; i < 3; i++) {
      const x = startX + i * (cellSize + gap);
      makeInset(this, x, reelY, cellSize, cellSize, 14);
      const t = this.add.text(x, reelY, "❔", { fontSize: "52px" }).setOrigin(0.5);
      this.reelTexts.push(t);
    }

    this.messageText = this.add
      .text(400, 320, "Press SPIN to play", { fontSize: "16px", color: Theme.textMuted })
      .setOrigin(0.5);

    this.spinButton = makeButton(
      this,
      400,
      400,
      220,
      56,
      "SPIN",
      Theme.accent,
      Theme.accentHover,
      () => this.spin()
    );

    makeButton(this, 400, 465, 220, 40, "WALK AWAY", Theme.neutral, Theme.neutralHover, () =>
      this.scene.start("OverworldScene")
    );

    this.betControl = makeBetControl(this, 400, 505, () => {});

    this.add
      .text(400, 560, "3-of-a-kind pays big • 2-of-a-kind pays too", {
        fontSize: "11px",
        color: Theme.textMuted
      })
      .setOrigin(0.5);

    this.updateBalance();
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
      .then((res) => this.resolveSpin(res))
      .catch((err) => this.handleSpinError(err));
  }

  private resolveSpin(res: Awaited<ReturnType<typeof api.playSlots>>) {
    this.spinTimer?.remove(false);
    this.spinTimer = undefined;

    gameState.hydrateFromServer(res.user);

    const { reels, payout, winKey, winCount } = res.result;
    reels.forEach((key, i) => this.reelTexts[i].setText(SYMBOL_EMOJI[key] ?? "❔"));

    if (payout > 0 && winKey) {
      const label = winCount === 3 ? `3x ${SYMBOL_EMOJI[winKey]} — JACKPOT!` : `2x ${SYMBOL_EMOJI[winKey]}`;
      this.messageText.setText(`${label}  +${payout} GC`).setColor(Theme.textAccent);
      popIn(this, this.messageText);
    } else {
      this.messageText.setText("No match, try again").setColor(Theme.textMuted);
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
    this.balanceText.setText(
      `Gold Coins: ${gameState.goldCoins}      Stake Coins: ${gameState.stakeCoins}`
    );
  }
}
