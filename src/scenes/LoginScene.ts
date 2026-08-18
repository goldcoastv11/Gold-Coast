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
 * src/api/client.ts. The server, not this client, decides new-vs-existing
 * (signup fails with USERNAME_TAKEN if the username exists, in which case
 * this scene transparently falls back to a login attempt with the same
 * credentials) and resolves the signup bonus's GC multiplier (the
 * shuffle-cup mini-game is purely presentational here - it always reveals
 * whatever the server already decided, never a locally-picked value; see
 * ShuffleCupReveal.ts's `forcedMultiplier`).
 */
export class LoginScene extends Phaser.Scene {
  private usernameValue = "";
  private passwordValue = "";
  private activeField: FieldName = null;
  private cursorOn = true;
  private cursorTimer?: Phaser.Time.TimerEvent;

  private usernameText!: Phaser.GameObjects.Text;
  private passwordText!: Phaser.GameObjects.Text;
  private usernameBox!: Phaser.GameObjects.Graphics;
  private passwordBox!: Phaser.GameObjects.Graphics;
  private errorText!: Phaser.GameObjects.Text;
  private usernameZone!: Phaser.GameObjects.Zone;
  private passwordZone!: Phaser.GameObjects.Zone;
  private enterBtn!: UIButton;

  constructor() {
    super("LoginScene");
  }

  create() {
    this.usernameValue = "";
    this.passwordValue = "";
    this.activeField = null;
    this.cursorOn = true;
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

    this.add
      .text(400, 187, "Log in or create a profile", {
        fontSize: "13px",
        color: Theme.textMuted
      })
      .setOrigin(0.5);

    this.add
      .text(400, 220, "Username", { fontSize: "11px", color: Theme.textMuted })
      .setOrigin(0.5);
    this.usernameBox = this.add.graphics();
    this.drawFieldBox(this.usernameBox, 248, false);
    this.usernameText = this.add
      .text(400, 248, "", { fontSize: "15px", color: Theme.textPrimary })
      .setOrigin(0.5);
    this.usernameZone = this.add
      .zone(400, 248, FIELD_W, FIELD_H)
      .setInteractive({ useHandCursor: true });
    this.usernameZone.on("pointerdown", () => this.setActiveField("username"));

    this.add
      .text(400, 283, "Password", { fontSize: "11px", color: Theme.textMuted })
      .setOrigin(0.5);
    this.passwordBox = this.add.graphics();
    this.drawFieldBox(this.passwordBox, 311, false);
    this.passwordText = this.add
      .text(400, 311, "", { fontSize: "15px", color: Theme.textPrimary })
      .setOrigin(0.5);
    this.passwordZone = this.add
      .zone(400, 311, FIELD_W, FIELD_H)
      .setInteractive({ useHandCursor: true });
    this.passwordZone.on("pointerdown", () => this.setActiveField("password"));

    this.errorText = this.add
      .text(400, 350, "", { fontSize: "12px", color: Theme.textDanger })
      .setOrigin(0.5);

    this.enterBtn = makeButton(this, 400, 400, 220, 50, "ENTER CASINO", Theme.accent, Theme.accentHover, () =>
      this.submit()
    );

    this.add
      .text(
        400,
        455,
        "New username? We'll create a fresh profile.\nYour progress now lives on the server.",
        { fontSize: "11px", color: Theme.textMuted, align: "center" }
      )
      .setOrigin(0.5);

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
    this.drawFieldBox(this.usernameBox, 248, this.activeField === "username");
    this.drawFieldBox(this.passwordBox, 311, this.activeField === "password");
  }

  private setStatus(message: string, isError: boolean) {
    this.errorText.setColor(isError ? Theme.textDanger : Theme.textMuted).setText(message);
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
    } else {
      this.usernameZone.disableInteractive();
      this.passwordZone.disableInteractive();
      this.enterBtn.setEnabled(false);
    }
  }

  /**
   * Validates fields, then tries POST /auth/signup first - since only the
   * server knows whether `username` already exists, any signup failure
   * (USERNAME_TAKEN, or any other error) falls back to POST /auth/login
   * with the same credentials rather than guessing client-side. A brand
   * new profile plays the shuffle-cup reveal (task #28/#29) reconciled to
   * the server's already-resolved multiplier before entering; logging into
   * an existing profile skips it, matching the pre-#37 UX.
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
    this.setStatus("Signing in...", false);

    try {
      const signupRes = await api.signup(username, password);
      api.setToken(signupRes.token);
      gameState.hydrateFromServer(signupRes.user);
      await this.playForcedShuffleCup(signupRes.signupBonus.gcMultiplier);
      await this.runTripleChanceOffer(signupRes.signupBonus.gcAmount);
      await this.reconcileAndEnter(signupRes.user);
      return;
    } catch (err) {
      if (!(err instanceof ApiError)) {
        this.setFormInteractionEnabled(true);
        this.setStatus(
          err instanceof NetworkError ? err.message : "Something went wrong - please try again.",
          true
        );
        return;
      }
      // Only USERNAME_TAKEN unambiguously means "this is an existing
      // account, try logging in instead." Anything else (INVALID_INPUT -
      // password too short, username has bad characters, etc.) is a real
      // validation problem on what would be a brand-new account - show it
      // directly rather than masking it behind a login attempt that would
      // just 401 with a confusing "wrong password" message.
      if (err.code !== "USERNAME_TAKEN") {
        this.setFormInteractionEnabled(true);
        this.setStatus(this.describeSignupValidationError(err), true);
        return;
      }
    }

    try {
      this.setStatus("Signing in...", false);
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
   */
  private async reconcileAndEnter(me: MeResponse) {
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
    this.scene.start("StartMenuScene", notice ? { notice } : undefined);
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
      const sub = this.add
        .text(400, 219, "Pick a cup to reveal your starting Gold Coins", {
          fontSize: "12px",
          color: Theme.textMuted
        })
        .setOrigin(0.5)
        .setDepth(301);

      const handle = createShuffleCupReveal(
        this,
        400,
        302,
        GC_MULTIPLIER_BASE,
        () => {
          handle.destroy();
          overlay.destroy();
          title.destroy();
          sub.destroy();
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
