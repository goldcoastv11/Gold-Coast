import Phaser from "phaser";
import { gameState } from "../GameState";
import { Theme } from "../ui/Theme";
import { makeButton, makePanel } from "../ui/uiHelpers";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";

interface StartMenuData {
  /** Task #43: set by LoginScene.reconcileAndEnter() when an orphaned stateful-game round was forfeited on this login - shown once, not persisted. */
  notice?: string;
  /** Set true only right after a brand-new signup (see LoginScene.reconcileAndEnter) - threaded through to OverworldScene, which starts the onboarding tutorial (ui/TutorialGuide.ts) when it sees this flag. Not persisted anywhere; see that module's doc comment for why that's fine. */
  startTutorial?: boolean;
}

export class StartMenuScene extends Phaser.Scene {
  constructor() {
    super("StartMenuScene");
  }

  create(data: StartMenuData) {
    fadeInOnCreate(this);
    this.cameras.main.setBackgroundColor(Theme.bgDark);

    // Screen center, not a literal 400 - main.ts can now widen the game's
    // logical width on a wide phone in landscape (see its scale-config
    // comment), so this menu recenters against the live canvas instead of
    // drifting off-center-left on a wide screen. Computed once here at
    // scene-create time, same scope boundary as OverworldScene's
    // `screenCenterX` (see that comment for why not reactive on resize).
    const cx = this.scale.width / 2;

    makePanel(this, cx, 300, 460, 340);

    this.add
      .text(cx, 200, "🕹️", { fontSize: "64px" })
      .setOrigin(0.5);

    this.add
      .text(cx, 270, "GOLD COAST ARCADE", {
        fontSize: "26px",
        color: Theme.textAccent,
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 300, `Logged in as ${gameState.activeUsername ?? "guest"}`, {
        fontSize: "13px",
        color: Theme.textGold
      })
      .setOrigin(0.5);

    if (data?.notice) {
      this.add
        .text(cx, 320, data.notice, {
          fontSize: "11px",
          color: Theme.textMuted,
          align: "center",
          wordWrap: { width: 380 }
        })
        .setOrigin(0.5);
    }

    makeButton(
      this,
      cx,
      365,
      240,
      56,
      "ENTER ARCADE",
      Theme.accent,
      Theme.accentHover,
      () => fadeToScene(this, "OverworldScene", { startTutorial: data?.startTutorial })
    );

    makeButton(this, cx, 435, 160, 36, "LOG OUT", Theme.neutral, Theme.neutralHover, () => {
      gameState.logout();
      fadeToScene(this, "LoginScene");
    });
  }
}
