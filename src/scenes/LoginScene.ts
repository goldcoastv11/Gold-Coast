import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel, UIButton } from "../ui/uiHelpers";
import { createShuffleCupReveal } from "../ui/ShuffleCupReveal";
import { GC_MULTIPLIER_BASE, GcMultiplier } from "../economy/gcMultiplier";

const FIELD_W = 320;
const FIELD_H = 36;
const USERNAME_MAX = 16;
const PASSWORD_MAX = 24;

type FieldName = "username" | "password" | null;

/**
 * First scene after boot. A username/password screen backed entirely by
 * this browser's localStorage (see the warning in GameState.ts) - good
 * enough to keep a couple of people's coins/skins separate on one device,
 * not real authentication.
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
        "New username? We'll create a fresh profile.\nProgress saves in this browser only.",
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

    this.setActiveField("username");
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

  /**
   * #29: brand-new profiles play the shuffle-cup mini-game for the signup
   * bonus's GC leg before the profile is actually created; logging into an
   * existing profile is unchanged (instant, no mini-game - gameState.login
   * ignores the multiplier entirely for existing profiles anyway). Validate
   * fields here, synchronously, before deciding which path to take - a
   * blank field should still surface its error immediately rather than
   * only after the player sits through a shuffle animation.
   */
  private submit() {
    const username = this.usernameValue.trim();
    const password = this.passwordValue;
    if (!username) {
      this.errorText.setText("Enter a username");
      return;
    }
    if (!password) {
      this.errorText.setText("Enter a password");
      return;
    }

    if (gameState.isNewUsername(username)) {
      this.runSignupShuffle(username, password);
    } else {
      this.completeLogin(username, password);
    }
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
   * Plays the shuffle-cup reveal (task #28's reusable component) for a
   * confirmed brand-new username, then creates the profile with whatever
   * GC multiplier the player landed on. Explicitly disables the username/
   * password zones and the submit button while it runs - not just visually
   * covering them - since they're raw pointer-interactive targets and a
   * click-through during the animation could re-trigger submit() or
   * refocus a field mid-shuffle.
   */
  private runSignupShuffle(username: string, password: string) {
    this.setActiveField(null);
    this.setFormInteractionEnabled(false);
    this.errorText.setText("");

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

    const handle = createShuffleCupReveal(this, 400, 302, GC_MULTIPLIER_BASE, ({ multiplier }) => {
      handle.destroy();
      overlay.destroy();
      title.destroy();
      sub.destroy();
      this.completeLogin(username, password, multiplier as GcMultiplier);
    });
    handle.container.setDepth(301);
    handle.start();
  }

  /**
   * Actually creates/loads the profile via gameState.login(). `gcMultiplier`
   * is only meaningful (and only ever passed) for the brand-new-profile
   * path, straight through from the shuffle-cup's resolved value - per qa's
   * note on #27, login()/grantSignupBonus only have a defined failure mode
   * for an *invalid* multiplier, which the mini-game can't produce, but the
   * try/catch below is a defensive backstop so a login screen can never get
   * stuck rather than surfacing a retryable error.
   */
  private completeLogin(username: string, password: string, gcMultiplier: GcMultiplier = 1) {
    let result;
    try {
      result = gameState.login(username, password, gcMultiplier);
    } catch {
      this.setFormInteractionEnabled(true);
      this.errorText.setText("Something went wrong creating your profile - please try again.");
      return;
    }
    if (!result.ok) {
      this.setFormInteractionEnabled(true);
      this.errorText.setText(result.error);
      return;
    }
    this.scene.start("StartMenuScene");
  }
}
