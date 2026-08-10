import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel } from "../ui/uiHelpers";

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
    const usernameZone = this.add
      .zone(400, 248, FIELD_W, FIELD_H)
      .setInteractive({ useHandCursor: true });
    usernameZone.on("pointerdown", () => this.setActiveField("username"));

    this.add
      .text(400, 283, "Password", { fontSize: "11px", color: Theme.textMuted })
      .setOrigin(0.5);
    this.passwordBox = this.add.graphics();
    this.drawFieldBox(this.passwordBox, 311, false);
    this.passwordText = this.add
      .text(400, 311, "", { fontSize: "15px", color: Theme.textPrimary })
      .setOrigin(0.5);
    const passwordZone = this.add
      .zone(400, 311, FIELD_W, FIELD_H)
      .setInteractive({ useHandCursor: true });
    passwordZone.on("pointerdown", () => this.setActiveField("password"));

    this.errorText = this.add
      .text(400, 350, "", { fontSize: "12px", color: Theme.textDanger })
      .setOrigin(0.5);

    makeButton(this, 400, 400, 220, 50, "ENTER CASINO", Theme.accent, Theme.accentHover, () =>
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

  private submit() {
    const result = gameState.login(this.usernameValue, this.passwordValue);
    if (!result.ok) {
      this.errorText.setText(result.error);
      return;
    }
    this.scene.start("StartMenuScene");
  }
}
