import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Tokens } from "../ui/DesignTokens";
import { makeButton, makeText, makePanel, popIn, UIButton } from "../ui/uiHelpers";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import { playSfx } from "../ui/SoundManager";
import { track, EVENTS } from "../api/track";
import { sweepPosition } from "../levelUpMinigameSweep";

/**
 * LEVEL-UP MINIGAME - "stop the marker". Founder direction: "every level
 * up, have a game appear that is a skill based minigame that gives the
 * player GC", format chosen as a timing game (a marker sweeps a bar, tap to
 * stop it, accuracy decides the Gold Coin reward).
 *
 * This is a dedicated, full-screen SCENE (not a panel drawn into whatever
 * scene is active) - reached via `launchLevelUpMinigame()`
 * (../levelUpMinigameLauncher.ts), which fades the calling scene out and
 * this one in with `scene: { returnScene, level }` data, and returns the
 * same way once resolved. See that module's header for the two call sites
 * that need to invoke it and why neither is wired up yet (it lives in
 * ui/ChallengesPanel.ts, which this change deliberately does not touch).
 *
 * TRUST BOUNDARY - read this before touching the network calls below:
 * this scene NEVER sends an accuracy or elapsed-time number to the server.
 * `POST /minigame/levelup/stop` takes only the sessionId. Every number this
 * screen displays as a RESULT (accuracy, Gold Coins, the marker's true
 * resting position) comes back from that response, computed server-side
 * from the server's own clock against the session's own `startedAt` row -
 * see server/src/progression/levelMinigameSession.ts's header for the full
 * writeup. The marker this scene animates WHILE the player is playing is
 * cosmetic only: it's this file's own copy of the same sweep formula
 * (../levelUpMinigameSweep.ts), driven by `Date.now()` against the
 * server-issued `startedAt` wall-clock timestamp, so it lines up closely
 * with what the server will actually score - but "closely" is the honest
 * word. Two things it cannot fully close: (1) ordinary network latency
 * between the player's tap and the request landing shifts the SCORED
 * instant slightly later than the tap the player felt, which can cost a
 * hair of accuracy on a great-looking stop; (2) this formula is keyed off
 * the PLAYER'S OWN clock (`Date.now()`) versus the server's `startedAt`
 * wall-clock string, so a player whose system clock is skewed sees a
 * marker that visually drifts out of phase with what the server is really
 * timing - purely cosmetic (it cannot inflate the real, server-computed
 * result; it can only make the visual feel less "fair" to that one
 * player). Neither gap gives a way to fabricate a better-than-real result;
 * both are disclosed here and in the PR rather than silently shipped.
 *
 * Respects the mobile safe zone (uiHelpers.ts's SAFE_ZONE_TOP/BOTTOM,
 * 130-470) - every element below sits inside that band. Landscape
 * mobile-first, touch and mouse both drive the one STOP button.
 */

const CX = 400;
const CY = 300;
const PANEL_W = 520;
const PANEL_H = 300; // spans y 150-450, inside the 130-470 safe zone.

const TRACK_L = CX - 190;
const TRACK_R = CX + 190;
const TRACK_Y = 284;
const TRACK_H = 26;

/** The marker's on-screen size - a tall thin bar, deliberately taller than the track so it visibly crosses it. */
const MARKER_W = 6;
const MARKER_H = 44;

/** How close (as a fraction of the reward curve's accuracy=1..0 range) counts as each result tier's flavour text/sound - purely cosmetic labels; the actual Gold Coin figure always comes from the server. */
const TIER_PERFECT = 0.92;
const TIER_GREAT = 0.72;
const TIER_GOOD = 0.4;

type Phase = "loading" | "sweeping" | "scoring" | "result" | "error";

export class LevelUpMinigameScene extends Phaser.Scene {
  private returnSceneKey = "OverworldScene";
  private anchorLevel: number | null = null;

  private closed = false;
  private phase: Phase = "loading";
  private session: { sessionId: string; level: number; sweepPeriodMs: number; startedAtMs: number } | null = null;
  private frozenPosition = 0;

  private levelText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private resultText!: Phaser.GameObjects.Text;
  private rewardText!: Phaser.GameObjects.Text;
  private marker!: Phaser.GameObjects.Rectangle;

  private stopBtn?: UIButton;
  private continueBtn?: UIButton;
  private retryBtn?: UIButton;

  constructor() {
    super("LevelUpMinigameScene");
  }

  init(data: { returnScene?: string; level?: number }) {
    this.returnSceneKey = data?.returnScene ?? "OverworldScene";
    this.anchorLevel = data?.level ?? null;
  }

  create() {
    fadeInOnCreate(this);
    this.closed = false;
    this.phase = "loading";
    this.session = null;
    this.frozenPosition = 0;
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.closed = true;
      this.tweens.killTweensOf(this);
    });

    this.buildStaticUi();
    this.beginSession();
  }

  update() {
    if (this.phase !== "sweeping" || !this.session) return;
    const elapsedMs = Math.max(0, Date.now() - this.session.startedAtMs);
    const position = sweepPosition(elapsedMs, this.session.sweepPeriodMs);
    this.setMarkerPosition(position);
  }

  // ------------------------------------------------------------------
  // Layout
  // ------------------------------------------------------------------

  private buildStaticUi() {
    makePanel(this, CX, CY, PANEL_W, PANEL_H, 0);

    makeText(this, CX, 176, "LEVEL UP", {
      size: Tokens.type.size.sm,
      color: Tokens.text.muted,
      tracking: Tokens.type.tracking.caps,
      align: "center",
      originX: 0.5
    });

    this.levelText = makeText(
      this,
      CX,
      206,
      this.anchorLevel != null ? `LEVEL ${this.anchorLevel}` : "LEVEL UP",
      {
        size: Tokens.type.size.xxxl,
        weight: Tokens.type.weight.bold,
        color: Tokens.text.accent,
        align: "center",
        originX: 0.5
      }
    );

    this.messageText = makeText(this, CX, 236, "Loading…", {
      size: Tokens.type.size.md,
      color: Tokens.text.secondary,
      align: "center",
      originX: 0.5,
      wordWrapWidth: PANEL_W - Tokens.space.huge * 2
    });

    this.drawTrack();

    // Marker - hidden until a session actually loads, so nothing appears to
    // move before there is a real sweep to follow.
    this.marker = this.add
      .rectangle(TRACK_L, TRACK_Y, MARKER_W, MARKER_H, Tokens.color.accent, 1)
      .setVisible(false);

    this.resultText = makeText(this, CX, 330, "", {
      size: Tokens.type.size.lg,
      color: Tokens.text.secondary,
      align: "center",
      originX: 0.5
    });
    this.rewardText = makeText(this, CX, 360, "", {
      size: Tokens.type.size.xxl,
      weight: Tokens.type.weight.bold,
      color: Tokens.text.accent,
      align: "center",
      originX: 0.5
    });

    this.stopBtn = makeButton(
      this,
      CX,
      414,
      240,
      52,
      "STOP",
      Tokens.color.accent,
      Tokens.color.accentHover,
      () => this.onStopPressed(),
      Tokens.text.onAccent,
      Tokens.radius.md
    );
    this.stopBtn.setEnabled(false);

    // Desktop convenience - the primary interaction stays the button (a big
    // touch target works on both), this is purely an accelerator.
    this.input.keyboard?.on("keydown-SPACE", () => this.onStopPressed());
  }

  /** The static track background - a "hotter" (closer to accent) band toward dead centre, cooler toward the edges. Purely a visual cue; the actual reward curve is server-side (levelMinigame.ts). */
  private drawTrack() {
    const g = this.add.graphics();
    const top = TRACK_Y - TRACK_H / 2;
    const w = TRACK_R - TRACK_L;

    g.fillStyle(Tokens.color.inset, 1);
    g.fillRoundedRect(TRACK_L, top, w, TRACK_H, TRACK_H / 2);

    // Nested bands, widest (cool) to narrowest (hot), each centred on the
    // track's own centre.
    const bands: Array<{ frac: number; color: number }> = [
      { frac: 0.86, color: Tokens.color.surfaceRaised },
      { frac: 0.6, color: Tokens.color.surfaceHover },
      { frac: 0.32, color: Tokens.color.positiveMuted },
      { frac: 0.12, color: Tokens.color.accent }
    ];
    for (const band of bands) {
      const bw = w * band.frac;
      g.fillStyle(band.color, 1);
      g.fillRoundedRect(CX - bw / 2, top, bw, TRACK_H, TRACK_H / 2);
    }

    // Dead-centre hairline, the exact target.
    g.fillStyle(Tokens.color.bg, 1);
    g.fillRect(CX - 1, top - 4, 2, TRACK_H + 8);
  }

  private setMarkerPosition(position: number) {
    const clamped = Math.max(-1, Math.min(1, position));
    const x = TRACK_L + ((clamped + 1) / 2) * (TRACK_R - TRACK_L);
    this.marker.setX(x);
  }

  // ------------------------------------------------------------------
  // Session lifecycle
  // ------------------------------------------------------------------

  private beginSession() {
    this.phase = "loading";
    api
      .startLevelMinigame()
      .then((res) => {
        if (this.closed) return;
        const session = {
          sessionId: res.session.sessionId,
          level: res.session.level,
          sweepPeriodMs: res.session.sweepPeriodMs,
          startedAtMs: Date.parse(res.session.startedAt)
        };
        this.session = session;
        this.levelText.setText(`LEVEL ${session.level}`);
        this.messageText
          .setText("Tap STOP as the marker crosses the centre. Closer pays more Gold Coins.")
          .setColor(Tokens.text.secondary);
        this.marker.setVisible(true);
        this.stopBtn?.setEnabled(true);
        this.phase = "sweeping";
      })
      .catch((err) => this.handleStartError(err));
  }

  private handleStartError(err: unknown) {
    if (this.closed) return;
    // Nothing owed (a stale/forged trigger, or another tab already claimed
    // it) - there is genuinely nothing to show, so leave quietly rather
    // than displaying an "error" for a state that isn't one.
    if (err instanceof ApiError && err.code === "NONE_PENDING") {
      this.leave();
      return;
    }
    this.phase = "error";
    const message =
      err instanceof NetworkError
        ? err.message
        : err instanceof ApiError
          ? err.message
          : "Couldn't start the level-up round.";
    this.messageText.setText(message).setColor(Tokens.text.negative);
    playSfx(this, "error");
    this.showErrorActions(() => this.beginSession());
  }

  private onStopPressed() {
    if (this.phase !== "sweeping" || !this.session) return;
    this.phase = "scoring";
    this.stopBtn?.setEnabled(false);
    playSfx(this, "click");

    // Freeze the marker at what the player just saw - it gets corrected to
    // the server's real result below once the response lands (see this
    // file's header on why the two can differ by a hair).
    const elapsedMs = Math.max(0, Date.now() - this.session.startedAtMs);
    this.frozenPosition = sweepPosition(elapsedMs, this.session.sweepPeriodMs);
    this.setMarkerPosition(this.frozenPosition);

    this.messageText.setText("Scoring…").setColor(Tokens.text.secondary);

    api
      .stopLevelMinigame(this.session.sessionId)
      .then((res) => this.showResult(res))
      .catch((err) => this.handleStopError(err));
  }

  private showResult(res: Awaited<ReturnType<typeof api.stopLevelMinigame>>) {
    if (this.closed) return;
    this.phase = "result";

    gameState.hydrateFromServer(res.user);
    track(EVENTS.LEVEL_MINIGAME_COMPLETED, {
      level: res.result.level,
      accuracy: res.result.accuracy,
      rewardGc: res.result.rewardGc
    });

    // Snap-correct the marker to the server's real, scored position - a
    // short honest tween rather than pretending the frozen guess was exact.
    const targetX = TRACK_L + ((Math.max(-1, Math.min(1, res.result.position)) + 1) / 2) * (TRACK_R - TRACK_L);
    this.tweens.add({
      targets: this.marker,
      x: targetX,
      duration: Tokens.motion.duration.base,
      ease: Tokens.motion.ease.out
    });

    const accuracy = res.result.accuracy;
    const tierLabel =
      accuracy >= TIER_PERFECT
        ? "Perfect stop!"
        : accuracy >= TIER_GREAT
          ? "Great timing!"
          : accuracy >= TIER_GOOD
            ? "Nice stop."
            : "Level-up bonus.";

    this.resultText
      .setText(`${tierLabel}  ·  ${Math.round(accuracy * 100)}% accuracy`)
      .setColor(accuracy >= TIER_GOOD ? Tokens.text.primary : Tokens.text.secondary);
    this.rewardText.setText(`+${res.result.rewardGc.toLocaleString("en-US")} Gold Coins`);
    popIn(this, this.rewardText);

    if (accuracy >= TIER_PERFECT) {
      playSfx(this, "bigWin");
    }
    playSfx(this, "confirm");

    this.messageText.setText("").setColor(Tokens.text.secondary);
    this.stopBtn?.container.setVisible(false);
    this.showContinueButton();
  }

  private handleStopError(err: unknown) {
    if (this.closed) return;

    if (err instanceof ApiError && err.code === "ALREADY_CLAIMED") {
      // Another tab (or an earlier retry that actually landed) already
      // scored this session - it is NOT re-scoreable, and nothing further
      // was credited by this request. Say so plainly and let the player
      // leave; there is nothing left to retry.
      this.phase = "result";
      this.messageText.setText("Already claimed - this round was already scored.").setColor(Tokens.text.secondary);
      this.showContinueButton();
      return;
    }

    this.phase = "error";
    const message =
      err instanceof NetworkError
        ? err.message
        : err instanceof ApiError
          ? err.message
          : "Couldn't submit that stop - try again.";
    this.messageText.setText(message).setColor(Tokens.text.negative);
    playSfx(this, "error");
    // The session is still PENDING server-side (nothing was credited) - a
    // retry re-sends the exact same sessionId and is safe to repeat.
    this.showErrorActions(() => {
      this.phase = "sweeping";
      this.messageText
        .setText("Tap STOP as the marker crosses the centre. Closer pays more Gold Coins.")
        .setColor(Tokens.text.secondary);
      this.stopBtn?.container.setVisible(true);
      this.stopBtn?.setEnabled(true);
    });
  }

  // ------------------------------------------------------------------
  // Footer actions
  // ------------------------------------------------------------------

  private showContinueButton() {
    this.retryBtn?.destroy();
    this.retryBtn = undefined;
    this.continueBtn?.destroy();
    this.continueBtn = makeButton(
      this,
      CX,
      414,
      240,
      48,
      "CONTINUE",
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => this.leave(),
      Tokens.text.primary,
      Tokens.radius.md
    );
  }

  private showErrorActions(onRetry: () => void) {
    this.stopBtn?.container.setVisible(false);
    this.continueBtn?.destroy();
    this.continueBtn = makeButton(
      this,
      CX - 126,
      414,
      232,
      48,
      "LEAVE",
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => this.leave(),
      Tokens.text.secondary,
      Tokens.radius.md
    );
    this.retryBtn?.destroy();
    this.retryBtn = makeButton(
      this,
      CX + 126,
      414,
      232,
      48,
      "TRY AGAIN",
      Tokens.color.accent,
      Tokens.color.accentHover,
      () => {
        this.retryBtn?.destroy();
        this.retryBtn = undefined;
        this.continueBtn?.destroy();
        this.continueBtn = undefined;
        this.messageText.setColor(Tokens.text.secondary);
        onRetry();
      },
      Tokens.text.onAccent,
      Tokens.radius.md
    );
  }

  private leave() {
    fadeToScene(this, this.returnSceneKey);
  }
}
