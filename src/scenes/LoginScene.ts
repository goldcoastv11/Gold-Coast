import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, UIButton } from "../ui/uiHelpers";
import { createShuffleCupReveal } from "../ui/ShuffleCupReveal";
import { offerTripleChance } from "../ui/TripleChanceOffer";
import { GC_MULTIPLIER_BASE } from "../economy/gcMultiplier";
import * as api from "../api/client";
import { ApiError, NetworkError } from "../api/client";
import type { GcMultiplier, MeResponse } from "../api/types";

const FIELD_W = 320;
const FIELD_H = 36;
const USERNAME_MAX = 16;
const PASSWORD_MAX = 24;

type FieldName = "username" | "password" | null;

/**
 * First scene after boot. Task #37: username/password screen backed by the
 * real casino-poc/server API (POST /auth/signup, POST /auth/login, GET
 * /me) instead of the old localStorage-hashed fake auth - see
 * src/api/client.ts. Resolves the signup bonus's GC multiplier server-side
 * (the shuffle-cup mini-game is purely presentational here - it always
 * reveals whatever the server already decided, never a locally-picked
 * value; see ShuffleCupReveal.ts's `forcedMultiplier`).
 *
 * Explicit Sign Up / Sign In tabs (not "try signup, fall back to login on
 * USERNAME_TAKEN" - the previous approach): the player picks a mode up
 * front via `setMode()`, and `submit()` calls exactly the one matching
 * endpoint. A Sign Up attempt that collides with an existing username
 * surfaces that directly, pointing at the Sign In tab, rather than silently
 * retrying as a login - a wrong password on what the player believes is a
 * brand-new account would otherwise produce a confusing "wrong password"
 * message instead of "that username's taken."
 */
export class LoginScene extends Phaser.Scene {
  private usernameValue = "";
  private passwordValue = "";
  private activeField: FieldName = null;
  private cursorOn = true;
  private cursorTimer?: Phaser.Time.TimerEvent;
  private mode: "signup" | "signin" = "signup";

  private usernameText!: Phaser.GameObjects.Text;
  private passwordText!: Phaser.GameObjects.Text;
  private usernameBox!: Phaser.GameObjects.Graphics;
  private passwordBox!: Phaser.GameObjects.Graphics;
  private errorText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private usernameZone!: Phaser.GameObjects.Zone;
  private passwordZone!: Phaser.GameObjects.Zone;
  private enterBtn!: UIButton;
  private signupTabBtn!: UIButton;
  private signinTabBtn!: UIButton;

  constructor() {
    super("LoginScene");
  }

  create() {
    this.usernameValue = "";
    this.passwordValue = "";
    this.activeField = null;
    this.cursorOn = true;
    this.mode = "signup";
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    makePanel(this, 400, 300, 460, 460);

    this.add.text(400, 110, "🎰", { fontSize: "48px" }).setOrigin(0.5);

    this.add
      .text(400, 160, "GOLD COAST CASINO", {
        fontSize: "22px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    // Sign Up / Sign In tabs - see class doc comment for why this replaced
    // the old single "ENTER CASINO" button that tried signup then silently
    // fell back to login. renderTabs() (re)draws both to reflect `mode`.
    this.renderTabs();

    this.add
      .text(400, 228, "Username", { fontSize: "11px", color: Theme.textMuted })
      .setOrigin(0.5);
    this.usernameBox = this.add.graphics();
    this.drawFieldBox(this.usernameBox, 256, false);
    this.usernameText = this.add
      .text(400, 256, "", { fontSize: "15px", color: Theme.textPrimary })
      .setOrigin(0.5);
    this.usernameZone = this.add
      .zone(400, 256, FIELD_W, FIELD_H)
      .setInteractive({ useHandCursor: true });
    this.usernameZone.on("pointerdown", () => this.setActiveField("username"));

    this.add
      .text(400, 291, "Password", { fontSize: "11px", color: Theme.textMuted })
      .setOrigin(0.5);
    this.passwordBox = this.add.graphics();
    this.drawFieldBox(this.passwordBox, 319, false);
    this.passwordText = this.add
      .text(400, 319, "", { fontSize: "15px", color: Theme.textPrimary })
      .setOrigin(0.5);
    this.passwordZone = this.add
      .zone(400, 319, FIELD_W, FIELD_H)
      .setInteractive({ useHandCursor: true });
    this.passwordZone.on("pointerdown", () => this.setActiveField("password"));

    this.errorText = this.add
      .text(400, 358, "", { fontSize: "12px", color: Theme.textDanger, align: "center", wordWrap: { width: 400 } })
      .setOrigin(0.5);

    this.enterBtn = makeButton(this, 400, 406, 220, 50, "CREATE ACCOUNT", Theme.accent, Theme.accentHover, () =>
      this.submit()
    );

    this.hintText = this.add
      .text(400, 462, "", { fontSize: "11px", color: Theme.textMuted, align: "center" })
      .setOrigin(0.5);
    this.updateModeCopy();

    this.input.keyboard?.on("keydown", this.onKeyDown);
    this.cursorTimer = this.time.addEvent({
      delay: 450,
      loop: true,
      callback: () => {
        this.cursorOn = !this.cursorOn;
        this.renderFields();
      }
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off("keydown", this.onKeyDown);
      this.cursorTimer?.remove(false);
    });

    // Silent session restore: if a JWT survived a reload, try GET /me
    // before asking for credentials again (see src/api/client.ts).
    if (api.getToken()) {
      this.attemptSessionRestore();
    } else {
      this.setActiveField("username");
    }
  }

  private async attemptSessionRestore() {
    this.setFormInteractionEnabled(false);
    this.setStatus("Restoring your session...", false);
    try {
      const me = await api.getMe();
      gameState.hydrateFromServer(me);
      await this.reconcileAndEnter(me);
    } catch (err) {
      // Expired/invalid token - clear it and fall back to a normal login.
      // A network error leaves the token in place (server may just be
      // temporarily unreachable) but still unblocks the form either way.
      if (err instanceof ApiError && err.status === 401) {
        api.clearToken();
      }
      this.setStatus("", false);
      this.setFormInteractionEnabled(true);
      this.setActiveField("username");
    }
  }

  private drawFieldBox(g: Phaser.GameObjects.Graphics, y: number, focused: boolean) {
    g.setPosition(400, y);
    g.clear();
    g.fillStyle(Theme.inset, 1);
    g.fillRoundedRect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H, 8);
    g.lineStyle(2, focused ? Theme.accent : Theme.panelBorder, 1);
    g.strokeRoundedRect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H, 8);
  }

  private setActiveField(field: FieldName) {
    this.activeField = field;
    this.cursorOn = true;
    this.renderFields();
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.activeField) return;

    if (event.key === "Tab") {
      event.preventDefault();
      this.setActiveField(this.activeField === "username" ? "password" : "username");
      return;
    }
    if (event.key === "Enter") {
      if (this.activeField === "username") this.setActiveField("password");
      else this.submit();
      return;
    }
    if (event.key === "Escape") {
      this.setActiveField(null);
      return;
    }
    if (event.key === "Backspace") {
      if (this.activeField === "username") this.usernameValue = this.usernameValue.slice(0, -1);
      else this.passwordValue = this.passwordValue.slice(0, -1);
      this.renderFields();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (this.activeField === "username" && this.usernameValue.length < USERNAME_MAX) {
        this.usernameValue += event.key;
      } else if (this.activeField === "password" && this.passwordValue.length < PASSWORD_MAX) {
        this.passwordValue += event.key;
      }
      this.renderFields();
    }
  };

  private renderFields() {
    const userCursor = this.activeField === "username" && this.cursorOn ? "_" : "";
    const passCursor = this.activeField === "password" && this.cursorOn ? "_" : "";
    this.usernameText.setText(this.usernameValue + userCursor);
    this.passwordText.setText("•".repeat(this.passwordValue.length) + passCursor);
    this.drawFieldBox(this.usernameBox, 256, this.activeField === "username");
    this.drawFieldBox(this.passwordBox, 319, this.activeField === "password");
  }

  private setStatus(message: string, isError: boolean) {
    this.errorText.setColor(isError ? Theme.textDanger : Theme.textMuted).setText(message);
  }

  /** (Re)draws the Sign Up / Sign In tabs, highlighting whichever matches `this.mode`. Destroys and recreates rather than restyling in place - cheap for two small buttons, and keeps the active/inactive color logic in one place (uiHelpers' UIButton has no "recolor" API, only enable/disable). */
  private renderTabs() {
    this.signupTabBtn?.destroy();
    this.signinTabBtn?.destroy();

    const signupColors = this.mode === "signup" ? ([Theme.accent, Theme.accentHover] as const) : ([Theme.neutral, Theme.neutralHover] as const);
    const signinColors = this.mode === "signin" ? ([Theme.accent, Theme.accentHover] as const) : ([Theme.neutral, Theme.neutralHover] as const);

    this.signupTabBtn = makeButton(this, 292, 195, 200, 36, "Sign Up", signupColors[0], signupColors[1], () =>
      this.setMode("signup")
    );
    this.signinTabBtn = makeButton(this, 508, 195, 200, 36, "Sign In", signinColors[0], signinColors[1], () =>
      this.setMode("signin")
    );
  }

  /** Updates the submit button label and the footer hint to match `this.mode`. Split out from setMode() so create() can call it once for the initial mode without also calling renderTabs() a second time. */
  private updateModeCopy() {
    this.enterBtn.setLabel(this.mode === "signup" ? "CREATE ACCOUNT" : "SIGN IN");
    this.hintText.setText(
      this.mode === "signup"
        ? "We'll create a fresh profile.\nYour progress lives on the server."
        : "Enter your existing username and password."
    );
  }

  private setMode(mode: "signup" | "signin") {
    if (this.mode === mode) return;
    this.mode = mode;
    this.setStatus("", false);
    this.renderTabs();
    this.updateModeCopy();
  }

  /**
   * POST /auth/signup's 400 INVALID_INPUT body includes zod's flattened
   * field errors (`details.fieldErrors.{username,password}`) - surface the
   * first one if present (e.g. "password must be at least 6 characters")
   * instead of the generic "Invalid signup payload" top-level message.
   */
  private describeSignupValidationError(err: ApiError): string {
    const body = err.body as { details?: { fieldErrors?: Record<string, string[]> } } | undefined;
    const fieldErrors = body?.details?.fieldErrors;
    if (fieldErrors) {
      for (const key of Object.keys(fieldErrors)) {
        const first = fieldErrors[key]?.[0];
        if (first) return first;
      }
    }
    return err.message;
  }

  private setFormInteractionEnabled(enabled: boolean) {
    if (enabled) {
      this.usernameZone.setInteractive({ useHandCursor: true });
      this.passwordZone.setInteractive({ useHandCursor: true });
      this.enterBtn.setEnabled(true);
      this.signupTabBtn.setEnabled(true);
      this.signinTabBtn.setEnabled(true);
    } else {
      this.usernameZone.disableInteractive();
      this.passwordZone.disableInteractive();
      this.enterBtn.setEnabled(false);
      this.signupTabBtn.setEnabled(false);
      this.signinTabBtn.setEnabled(false);
    }
  }

  /**
   * Validates fields, then calls exactly the one endpoint matching
   * `this.mode` - no signup-then-fallback-to-login guessing (see class doc
   * comment). A brand new profile plays the shuffle-cup reveal (task
   * #28/#29) reconciled to the server's already-resolved multiplier before
   * entering; signing in to an existing profile skips it, matching the
   * pre-#37 UX.
   */
  private async submit() {
    const username = this.usernameValue.trim();
    const password = this.passwordValue;
    if (!username) {
      this.setStatus("Enter a username", true);
      return;
    }
    if (!password) {
      this.setStatus("Enter a password", true);
      return;
    }

    this.setActiveField(null);
    this.setFormInteractionEnabled(false);

    if (this.mode === "signup") {
      this.setStatus("Creating your profile...", false);
      try {
        const signupRes = await api.signup(username, password);
        api.setToken(signupRes.token);
        gameState.hydrateFromServer(signupRes.user);
        await this.playForcedShuffleCup(signupRes.signupBonus.gcMultiplier);
        await this.runTripleChanceOffer(signupRes.signupBonus.gcAmount);
        await this.reconcileAndEnter(signupRes.user, true);
      } catch (err) {
        this.setFormInteractionEnabled(true);
        if (err instanceof ApiError) {
          // USERNAME_TAKEN unambiguously means "this is an existing
          // account" - point the player at the Sign In tab explicitly
          // rather than silently retrying as a login behind their back
          // (which would risk a confusing "wrong password" message if
          // they'd meant to create a new account with a typo'd password).
          this.setStatus(
            err.code === "USERNAME_TAKEN"
              ? "That username's taken - switch to Sign In to log in instead."
              : this.describeSignupValidationError(err),
            true
          );
        } else if (err instanceof NetworkError) {
          this.setStatus(err.message, true);
        } else {
          this.setStatus("Something went wrong - please try again.", true);
        }
      }
      return;
    }

    this.setStatus("Signing in...", false);
    try {
      const loginRes = await api.login(username, password);
      api.setToken(loginRes.token);
      gameState.hydrateFromServer(loginRes.user);
      await this.reconcileAndEnter(loginRes.user);
    } catch (err) {
      this.setFormInteractionEnabled(true);
      if (err instanceof ApiError) {
        this.setStatus(
          err.code === "INVALID_CREDENTIALS" ? "Wrong username or password" : err.message,
          true
        );
      } else if (err instanceof NetworkError) {
        this.setStatus(err.message, true);
      } else {
        this.setStatus("Something went wrong - please try again.", true);
      }
    }
  }

  /**
   * Task #43: the one checkpoint where an orphaned stateful-game round
   * (WALK AWAY without cashing out, crash, refresh, or the 401-auto-logout
   * path re-authenticating later) is guaranteed to be discoverable with a
   * VALID token - `me.activeRound` (added to MeResponse alongside #42's
   * POST /games/abandon) is populated on every login/signup/GET-/me
   * response. Deliberately NOT handled inside the 401 handler itself
   * (main.ts's setUnauthorizedHandler) - that fires with the token that
   * just got rejected, which can't authenticate an abandon call either.
   * Forfeits (no refund, by design - see server/src/routes/games.ts's
   * /games/abandon) and re-hydrates before entering the start menu, so the
   * player sees their real, already-updated balance rather than a stale
   * one. Best-effort: if the abandon call itself fails (rare - network
   * hiccup, or a race where it somehow already resolved), this doesn't
   * block login - the ROUND_ALREADY_ACTIVE auto-recovery in each stateful
   * scene's start() is the fallback safety net for that edge case.
   *
   * `startTutorial` (onboarding tutorial): threaded through to
   * StartMenuScene and, from there, to OverworldScene - see
   * ui/TutorialGuide.ts's doc comment for why this one-shot flag (set true
   * only from the signup branch of submit(), never from login or session
   * restore) is enough to guarantee "runs exactly once per account" with
   * no persisted state anywhere.
   */
  private async reconcileAndEnter(me: MeResponse, startTutorial = false) {
    let notice: string | undefined;
    if (me.activeRound) {
      try {
        const result = await api.abandonRound();
        gameState.hydrateFromServer(result.user);
        notice = `An unfinished ${result.game} round was forfeited.`;
      } catch {
        // Best-effort - see doc comment above.
      }
    }
    this.scene.start("StartMenuScene", { notice, startTutorial });
  }

  /**
   * Plays the shuffle-cup reveal (task #28) for the signup bonus's GC leg,
   * forced to reveal `multiplier` regardless of which cup the player picks
   * (see ShuffleCupReveal.ts's `forcedMultiplier` doc comment - the server
   * already resolved this in the POST /auth/signup response, this is
   * animation only). Resolves once the reveal finishes.
   */
  private playForcedShuffleCup(multiplier: GcMultiplier): Promise<void> {
    return new Promise((resolve) => {
      const overlay = makePanel(this, 400, 300, 420, 260, 300);
      const title = this.add
        .text(400, 195, "🪙 New Profile Bonus", {
          fontSize: "17px",
          color: Theme.textGold,
          fontStyle: "bold"
        })
        .setOrigin(0.5)
        .setDepth(301);
      // No separate subtitle here (there used to be one, statically saying
      // "Shuffle the cups, then pick one...") - ShuffleCupReveal's own
      // statusText now explains each phase itself (added alongside the
      // click-to-shuffle change), positioned at this exact same y. Having
      // both rendered the two literally on top of each other ("Shuffle the
      // cups..." under "Pick a cup!") - confirmed via a live screenshot.

      const handle = createShuffleCupReveal(
        this,
        400,
        302,
        GC_MULTIPLIER_BASE,
        () => {
          handle.destroy();
          overlay.destroy();
          title.destroy();
          resolve();
        },
        multiplier
      );
      handle.container.setDepth(301);
      handle.start();
    });
  }

  /**
   * #46: offers the "Triple Chance" bonus round on the signup bonus's GC
   * leg, right after the shuffle-cup reveal finishes and before entering
   * the start menu. Purely additive to the existing flow - declining
   * (or the round eventually ending in a loss) still proceeds to
   * reconcileAndEnter exactly as before #46 existed. See
   * ui/TripleChanceOffer.ts for the full offer/play/chain mechanic.
   */
  private runTripleChanceOffer(startingAmount: number): Promise<void> {
    return new Promise((resolve) => {
      offerTripleChance(this, 400, 300, startingAmount, () => resolve());
    });
  }
}
