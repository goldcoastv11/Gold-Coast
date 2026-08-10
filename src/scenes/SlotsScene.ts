import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, makeInset, makeBetControl, popIn, BetControl, UIButton } from "../ui/uiHelpers";

/**
 * Paytable, tuned generously for early playtesting - this is intentionally
 * a high payout rate to test whether the core loop is fun. Tighten weights
 * and payouts before this ever touches real money.
 *
 * weight: relative chance this symbol lands on a reel (higher = more common)
 * pay3x / pay2x: payout multiplier of the bet for 3-of-a-kind / 2-of-a-kind
 */
interface SymbolDef {
  key: string;
  emoji: string;
  weight: number;
  pay3x: number;
  pay2x: number;
}

const SYMBOLS: SymbolDef[] = [
  { key: "cherry", emoji: "🍒", weight: 35, pay3x: 2, pay2x: 0.6 },
  { key: "lemon", emoji: "🍋", weight: 28, pay3x: 4, pay2x: 1 },
  { key: "bell", emoji: "🔔", weight: 20, pay3x: 20, pay2x: 2.4 },
  { key: "diamond", emoji: "💎", weight: 12, pay3x: 80, pay2x: 6 },
  { key: "seven", emoji: "7️⃣", weight: 5, pay3x: 400, pay2x: 30 }
];

const TOTAL_WEIGHT = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);

function pickWeightedSymbol(): SymbolDef {
  let roll = Phaser.Math.Between(1, TOTAL_WEIGHT);
  for (const s of SYMBOLS) {
    if (roll <= s.weight) return s;
    roll -= s.weight;
  }
  return SYMBOLS[0];
}

export class SlotsScene extends Phaser.Scene {
  private reelTexts: Phaser.GameObjects.Text[] = [];
  private balanceText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private spinning = false;
  private spinTimer?: Phaser.Time.TimerEvent;
  private spinButton?: UIButton;
  private betControl?: BetControl;
  private currentBet = 0;

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

  private spin() {
    if (this.spinning) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins!").setColor(Theme.textDanger);
      return;
    }

    this.currentBet = gameState.betAmount;
    this.spinning = true;
    this.spinButton?.setEnabled(false);
    this.betControl?.setEnabled(false);
    gameState.goldCoins -= this.currentBet;
    this.updateBalance();
    this.messageText.setText("Spinning...").setColor(Theme.textMuted);

    let ticks = 0;
    this.spinTimer = this.time.addEvent({
      delay: 80,
      repeat: 14,
      callback: () => {
        const allActive = this.reelTexts.every((t) => t && t.active);
        if (!allActive) {
          this.spinTimer?.remove(false);
          return;
        }

        this.reelTexts.forEach((t) => t.setText(pickWeightedSymbol().emoji));
        ticks++;
        if (ticks >= 14) {
          this.resolveSpin();
        }
      }
    });
  }

  private resolveSpin() {
    const results = [pickWeightedSymbol(), pickWeightedSymbol(), pickWeightedSymbol()];
    results.forEach((sym, i) => this.reelTexts[i].setText(sym.emoji));

    // Count occurrences of each symbol among the 3 reels
    const counts = new Map<string, number>();
    results.forEach((s) => counts.set(s.key, (counts.get(s.key) ?? 0) + 1));

    let payout = 0;
    let winLabel = "";

    for (const [key, count] of counts.entries()) {
      const def = SYMBOLS.find((s) => s.key === key)!;
      if (count === 3) {
        payout = Math.round(this.currentBet * def.pay3x);
        winLabel = `3x ${def.emoji} — JACKPOT!`;
      } else if (count === 2 && payout === 0) {
        payout = Math.round(this.currentBet * def.pay2x);
        winLabel = `2x ${def.emoji}`;
      }
    }

    if (payout > 0) {
      gameState.goldCoins += payout;
      this.messageText.setText(`${winLabel}  +${payout} GC`).setColor(Theme.textAccent);
      popIn(this, this.messageText);
    } else {
      this.messageText.setText("No match, try again").setColor(Theme.textMuted);
    }

    this.updateBalance();
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
