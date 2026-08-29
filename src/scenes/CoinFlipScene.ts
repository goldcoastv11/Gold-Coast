import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Tokens } from "../ui/DesignTokens";
import {
  makeButton,
  makeText,
  makeTextChip,
  makeDivider,
  makeGameShell,
  formatBalance,
  GameShellHandle,
  GAME_SHELL_DISPLAY_CENTER_X,
  GAME_SHELL_DISPLAY_CENTER_Y,
  popIn,
  drawCabinetFrame,
  BetControl,
  TextChip,
  UIButton
} from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { track, EVENTS } from "../api/track";
import type { CoinSide } from "../api/types";
import { showWinCelebration } from "../ui/WinCelebration";
import { playSfx, playMusic } from "../ui/SoundManager";

/**
 * COIN FLIP, on the Stake-style direction (see ui/DesignTokens.ts).
 *
 * Layout follows Limbo's: micro-label above the hero object, one hairline,
 * then the controls. The coin itself is the only artwork on the screen, so
 * everything else stays out of its way.
 *
 * On the one-accent rule (direction note 2): HEADS and TAILS are two halves
 * of a SINGLE action (this game has no separate "bet" press - picking a
 * side IS placing the bet), which is why both carry the accent and the
 * shell's own start button stays hidden. That is one accent doing one job,
 * not two competing ones.
 */
const BOARD_CX = GAME_SHELL_DISPLAY_CENTER_X;
const BOARD_CY = GAME_SHELL_DISPLAY_CENTER_Y;
const BOARD_W = 410;
const BOARD_H = 300;
const BOARD_LEFT = BOARD_CX - BOARD_W / 2 + Tokens.space.xxl;
const BOARD_RIGHT = BOARD_CX + BOARD_W / 2 - Tokens.space.xxl;

const HERO_LABEL_Y = 210;
const COIN_Y = 264;
const DIVIDER_Y = 330;
const SECTION_LABEL_Y = 350;
const SIDE_BTN_Y = 392;
const SIDE_BTN_H = 44;
const SIDE_BTN_W = (BOARD_RIGHT - BOARD_LEFT - Tokens.space.sm) / 2;
/**
 * Tutorial hint sits just ABOVE the board rather than the old y=30, which
 * was outside the mobile-landscape safe zone entirely (see uiHelpers.ts's
 * SAFE_ZONE_TOP) and so could be cropped off on a real phone.
 */
const TUTORIAL_HINT_Y = 134;

export class CoinFlipScene extends Phaser.Scene {
  private coinText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private headsBtn?: UIButton;
  private tailsBtn?: UIButton;
  private walkAwayBtn?: UIButton;
  private flipping = false;
  private flipTimer?: Phaser.Time.TimerEvent;
  private flipTween?: Phaser.Tweens.Tween;
  private betControl?: BetControl;
  private shell!: GameShellHandle;
  /** Onboarding tutorial's "Play a Game" hands-on step - see gameState.tutorialAwaitingGamePlay's doc comment and OverworldScene.runHandsOnGameStep. */
  private tutorialHint?: TextChip;

  constructor() {
    super("CoinFlipScene");
  }

  create() {
    fadeInOnCreate(this);
    playMusic(this, "cheerfulAnnoyance");
    this.flipping = false;
    this.flipTimer = undefined;
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.flipTimer) {
        this.flipTimer.remove(false);
        this.flipTimer = undefined;
      }
      this.tweens.killTweensOf(this.coinText);
    });

    this.shell = makeGameShell(this, "COIN FLIP", "FLIP", {
      onStart: () => {},
      onCashOut: () => {},
      onWalkAway: () => this.leaveGame()
    });
    this.shell.startBtn.container.setVisible(false);
    this.shell.startBtn.setEnabled(false);
    this.balanceText = this.shell.balanceText;
    this.messageText = this.shell.messageText;
    this.betControl = this.shell.betControl;
    this.walkAwayBtn = this.shell.walkAwayBtn;
    // The shell's readout line carries the round's key parameter, the same
    // way Limbo puts its target there. "Pays 2x" used to sit at y=516 -
    // below the safe zone, i.e. croppable on a phone.
    this.shell.multiplierText.setText("Pays 2.00x");
    this.messageText.setText("Pick a side to flip.").setColor(Tokens.text.muted);

    drawCabinetFrame(this, BOARD_CX, BOARD_CY, BOARD_W, BOARD_H);

    // --- Hero coin ------------------------------------------------------
    makeText(this, BOARD_CX, HERO_LABEL_Y, "COIN", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5
    });
    this.coinText = makeText(this, BOARD_CX, COIN_Y, "🪙", {
      size: Tokens.type.glyph.hero,
      align: "center",
      originX: 0.5
    });

    makeDivider(this, BOARD_LEFT, DIVIDER_Y, BOARD_RIGHT);

    // --- Side picker ----------------------------------------------------
    makeText(this, BOARD_LEFT, SECTION_LABEL_Y, "PICK A SIDE", {
      size: Tokens.type.size.xs,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps
    });

    this.headsBtn = makeButton(
      this,
      BOARD_LEFT + SIDE_BTN_W / 2,
      SIDE_BTN_Y,
      SIDE_BTN_W,
      SIDE_BTN_H,
      "HEADS",
      Tokens.color.accent,
      Tokens.color.accentHover,
      () => this.flip("heads"),
      Tokens.text.onAccent,
      Tokens.radius.md
    );
    this.tailsBtn = makeButton(
      this,
      BOARD_RIGHT - SIDE_BTN_W / 2,
      SIDE_BTN_Y,
      SIDE_BTN_W,
      SIDE_BTN_H,
      "TAILS",
      Tokens.color.accent,
      Tokens.color.accentHover,
      () => this.flip("tails"),
      Tokens.text.onAccent,
      Tokens.radius.md
    );

    // Onboarding tutorial's "Play a Game" hands-on step - per user
    // direction, WALK AWAY needs to be unclickable here: it exits back to
    // the Overworld WITHOUT setting tutorialResumeAtItemShop (by
    // design - leaving without playing shouldn't count as "played"), so
    // using it mid-tutorial silently dropped the player out of the
    // tutorial with no Skin Attendant step ever appearing. Disabling it
    // for this one step forces a real round to be played (or the
    // Overworld instruction bubble's own Skip button, before ever walking
    // in) instead of a dead end.
    if (gameState.tutorialAwaitingGamePlay) {
      this.walkAwayBtn.setEnabled(false);
    }

    // Onboarding tutorial's "Play a Game" hands-on step (see
    // gameState.tutorialAwaitingGamePlay's doc comment) - the player
    // walked up and pressed E for real (this is a completely ordinary
    // entry into CoinFlipScene, no tutorial-specific transition logic
    // involved). Per user direction, the ring itself only belongs out in
    // the Overworld pointing at the station (see
    // OverworldScene.runHandsOnGameStep) - once the real game screen is
    // actually open, no ring overlays the real HEADS/TAILS buttons, just
    // this small hint banner. Still waits for one real round to resolve
    // (see resolveFlip()) before returning to the Overworld to resume the
    // tutorial.
    if (gameState.tutorialAwaitingGamePlay) {
      this.tutorialHint = makeTextChip(
        this,
        BOARD_CX,
        TUTORIAL_HINT_Y,
        "Tutorial: pick Heads or Tails to flip",
        {
          fontSize: Tokens.type.size.md,
          fontStyle: Tokens.type.weight.semibold,
          color: Tokens.text.primary
        }
      );
      this.tutorialHint.container.setDepth(600);
    }

    this.updateBalance();
  }

  /**
   * Leaving without ever flipping shouldn't leave a stale flag behind - a
   * LATER, unrelated visit to Coin Flip would otherwise incorrectly show
   * the tutorial highlight again. See resolveFlip() for the normal
   * (played-a-real-round) path that also clears this.
   */
  private leaveGame() {
    gameState.tutorialAwaitingGamePlay = false;
    fadeToScene(this, "OverworldScene");
  }

  /** #36: the coin's real outcome is resolved server-side (POST /games/coinflip/play) - the flip animation here is purely cosmetic while the request is in flight. */
  private flip(guess: CoinSide) {
    if (this.flipping) return;

    if (gameState.goldCoins < gameState.betAmount) {
      this.messageText.setText("Not enough Gold Coins.").setColor(Tokens.text.negative);
      return;
    }

    // Onboarding tutorial's "Play a Game" hands-on step - the hint banner's
    // whole job is showing the player what to do. The instant they actually
    // click Heads/Tails for real, that job is done - clear it here, not in
    // resolveFlip(). tutorialAwaitingGamePlay itself (which gates the
    // tutorial STEP actually advancing - flag clear, resume-at-Skin-
    // Attendant flag, the delayed scene transition) deliberately still
    // waits for resolveFlip(), since that's about the real round genuinely
    // completing, not just a click being made.
    this.tutorialHint?.destroy();
    this.tutorialHint = undefined;

    const bet = gameState.betAmount;
    this.flipping = true;
    this.headsBtn?.setEnabled(false);
    this.tailsBtn?.setEnabled(false);
    this.betControl?.setEnabled(false);
    this.messageText.setText("Flipping...").setColor(Tokens.text.muted);

    let ticks = 0;
    this.flipTimer = this.time.addEvent({
      delay: Tokens.motion.duration.instant,
      loop: true,
      callback: () => {
        if (this.coinText.active) {
          this.coinText.setText(ticks % 2 === 0 ? "🪙" : "🟡");
        }
        ticks++;
      }
    });
    // Squash the coin's horizontal scale toward 0 and back, repeating - a
    // cheap "tumbling edge-on" spin effect layered on top of the emoji
    // swap above, instead of the coin just sitting still while its face
    // flickers.
    this.flipTween = this.tweens.add({
      targets: this.coinText,
      scaleX: 0.15,
      duration: Tokens.motion.duration.instant,
      yoyo: true,
      repeat: -1,
      ease: Tokens.motion.ease.inOut
    });

    api
      .playCoinFlip(bet, "GC", guess)
      .then((res) => this.resolveFlip(res, bet))
      .catch((err) => this.handleFlipError(err));
  }

  /** `bet` is threaded through purely so the round can be tracked with its stake - the play response doesn't echo it back. */
  private resolveFlip(res: Awaited<ReturnType<typeof api.playCoinFlip>>, bet: number) {
    this.flipTimer?.remove(false);
    this.flipTimer = undefined;
    this.flipTween?.stop();
    this.flipTween = undefined;

    gameState.hydrateFromServer(res.user);
    this.coinText.setText("🪙").setScale(1);

    const { result, won, payout } = res.result;

    // Retention Leg 1 (see src/api/track.ts). Recorded from the SERVER's
    // resolved result, not the local animation, and only once a round has
    // actually settled - so the numbers here always match what the ledger
    // did. betAmount is Gold Coins (the play currency, spent on every bet);
    // payout is Tickets (the win currency) - the two are separate ledgers,
    // so they are never summed into one "net" figure here.
    track(EVENTS.GAME_ROUND_PLAYED, {
      game: "coinflip",
      betAmount: bet,
      outcome: won ? "win" : "loss",
      payout
    });

    if (won) {
      this.messageText
        .setText(`${result.toUpperCase()} - you win ${payout} Tickets.`)
        .setColor(Tokens.text.accent);
      popIn(this, this.coinText);
      showWinCelebration(this, payout);
    } else {
      this.messageText.setText(`${result.toUpperCase()} - no win this round.`).setColor(Tokens.text.secondary);
      playSfx(this, "lose");
    }

    this.updateBalance();
    this.flipping = false;
    this.headsBtn?.setEnabled(true);
    this.tailsBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);

    // Onboarding tutorial's "Play a Game" hands-on step - a real round
    // (win OR lose, either counts as "played") just resolved for real, so
    // the tutorial's task here is done. Let the player see this result for
    // a beat, then send them back to the Overworld to resume at the Skin
    // Attendant step - see gameState.tutorialResumeAtItemShop's doc
    // comment and OverworldScene.create()'s resume check.
    if (gameState.tutorialAwaitingGamePlay) {
      gameState.tutorialAwaitingGamePlay = false;
      gameState.tutorialResumeAtItemShop = true;
      // Re-disable right away (already re-enabled above, matching the
      // normal non-tutorial flow) so a second flip can't slip in during
      // the delay below and race the scene transition.
      this.headsBtn?.setEnabled(false);
      this.tailsBtn?.setEnabled(false);
      this.betControl?.setEnabled(false);
      this.time.delayedCall(Tokens.motion.duration.dwell, () => {
        fadeToScene(this, "OverworldScene");
      });
    }
  }

  private handleFlipError(err: unknown) {
    this.flipTimer?.remove(false);
    this.flipTimer = undefined;
    this.flipTween?.stop();
    this.flipTween = undefined;
    this.coinText.setText("🪙").setScale(1);

    if (err instanceof ApiError && err.code === "INSUFFICIENT_BALANCE") {
      this.messageText.setText("Not enough Gold Coins.").setColor(Tokens.text.negative);
    } else if (err instanceof NetworkError) {
      this.messageText.setText(err.message).setColor(Tokens.text.negative);
    } else {
      this.messageText.setText("Something went wrong - please try again.").setColor(Tokens.text.negative);
    }

    this.flipping = false;
    this.headsBtn?.setEnabled(true);
    this.tailsBtn?.setEnabled(true);
    this.betControl?.setEnabled(true);
  }

  private updateBalance() {
    this.balanceText.setText(formatBalance(gameState.goldCoins, gameState.tickets));
  }
}
