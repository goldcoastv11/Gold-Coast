import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel } from "../ui/uiHelpers";

interface StartMenuData {
  /** Task #43: set by LoginScene.reconcileAndEnter() when an orphaned stateful-game round was forfeited on this login - shown once, not persisted. */
  notice?: string;
}

export class StartMenuScene extends Phaser.Scene {
  constructor() {
    super("StartMenuScene");
  }

  create(data: StartMenuData) {
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    makePanel(this, 400, 300, 460, 340);

    this.add
      .text(400, 200, "🎰", { fontSize: "64px" })
      .setOrigin(0.5);

    this.add
      .text(400, 270, "GOLD COAST CASINO", {
        fontSize: "26px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    this.add
      .text(400, 300, `Logged in as ${gameState.activeUsername ?? "guest"}`, {
        fontSize: "13px",
        color: Theme.textGold
      })
      .setOrigin(0.5);

    if (data?.notice) {
      this.add
        .text(400, 320, data.notice, {
          fontSize: "11px",
          color: Theme.textMuted,
          align: "center",
          wordWrap: { width: 380 }
        })
        .setOrigin(0.5);
    }

    makeButton(
      this,
      400,
      365,
      240,
      56,
      "ENTER CASINO",
      Theme.accent,
      Theme.accentHover,
      () => this.scene.start("OverworldScene")
    );

    makeButton(this, 400, 435, 160, 36, "LOG OUT", Theme.neutral, Theme.neutralHover, () => {
      gameState.logout();
      this.scene.start("LoginScene");
    });
  }
}
