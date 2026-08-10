import Phaser from "phaser";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel } from "../ui/uiHelpers";

export class StartMenuScene extends Phaser.Scene {
  constructor() {
    super("StartMenuScene");
  }

  create() {
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    makePanel(this, 400, 300, 460, 320);

    this.add
      .text(400, 220, "🎰", { fontSize: "64px" })
      .setOrigin(0.5);

    this.add
      .text(400, 290, "GOLD COAST CASINO", {
        fontSize: "26px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    this.add
      .text(400, 325, "A proof-of-concept build", {
        fontSize: "13px",
        color: Theme.textMuted
      })
      .setOrigin(0.5);

    makeButton(
      this,
      400,
      390,
      240,
      56,
      "ENTER CASINO",
      Theme.accent,
      Theme.accentHover,
      () => this.scene.start("OverworldScene")
    );
  }
}
