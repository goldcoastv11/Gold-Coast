/**
 * The emote picker, and the top-row button that opens it.
 *
 * The first feature to use `registerTopRowButton` (see
 * topRowButtonRegistry.ts) rather than being hand-wired into
 * OverworldScene.create() - which is what that registry was built for, and
 * why adding a whole new player-facing control here costs OverworldScene.ts
 * one import line in `topRowButtonFeatures.ts` and nothing else.
 *
 * ## Why emotes and not chat
 *
 * Founder decision (2026-09-02) when multiplayer was scoped: players can
 * react to each other, but nothing a player TYPES reaches another player's
 * screen. A closed vocabulary (see api/realtimeProtocol.ts's EMOTES, and
 * the server's matching enum) is what buys this product no profanity
 * filter, no moderation queue, no report flow, and no user-generated-
 * content retention question on a social-casino app whose compliance work
 * is deliberately paused. Adding a free-text field to this panel would
 * reverse that decision, not extend this feature.
 */

import Phaser from "phaser";
import { EMOTES, Emote } from "../api/realtimeProtocol";
import { realtime } from "../api/realtime";
import { makeButton, makePanel } from "./uiHelpers";
import { Tokens } from "./DesignTokens";
import { isolateFixedUi } from "./sceneCameraSplit";
import { registerTopRowButton, TopRowButtonHost } from "./topRowButtonRegistry";
import { playSfx } from "./SoundManager";

/** Player-facing label per emote. The glyph matches what RemotePlayers.ts draws over a character's head. */
const EMOTE_LABEL: Record<Emote, string> = {
  wave: "👋 Wave",
  cheer: "🎉 Cheer",
  laugh: "😄 Laugh",
  cry: "😢 Cry",
  thumbsup: "👍 Nice",
  shock: "😮 Wow",
  heart: "❤️ Love",
  gg: "GG"
};

const COLUMNS = 2;
const BUTTON_W = 150;
const BUTTON_H = 40;
const GAP = Tokens.space.sm;

/**
 * Opens the picker. Exported (not just wired to the button below) so the
 * onboarding tutorial or a future "react to a big win" prompt can raise it
 * directly without going through the top row.
 */
export function openEmotePanel(host: TopRowButtonHost): void {
  const scene = host.scene;
  host.setPanelOpen(true);

  const rows = Math.ceil(EMOTES.length / COLUMNS);
  const panelW = COLUMNS * BUTTON_W + (COLUMNS + 1) * GAP;
  const panelH = rows * BUTTON_H + (rows + 1) * GAP + 56;

  // X from the live canvas rather than a literal - main.ts can widen the
  // canvas on a wide mobile-landscape phone (the same reasoning every other
  // panel in this codebase follows).
  const cx = scene.scale.width / 2;
  const cy = 300;

  const created: Phaser.GameObjects.GameObject[] = [];
  const buttons: { destroy: () => void }[] = [];

  const panel = makePanel(scene, cx, cy, panelW, panelH, 200).setScrollFactor(0);
  created.push(panel);

  const title = scene.add
    .text(cx, cy - panelH / 2 + Tokens.space.lg, "React", {
      fontFamily: Tokens.type.family,
      fontSize: Tokens.type.size.xl,
      color: Tokens.text.primary
    })
    .setOrigin(0.5, 0)
    .setScrollFactor(0)
    .setDepth(201);
  created.push(title);

  const close = () => {
    buttons.forEach((b) => b.destroy());
    created.forEach((o) => o.destroy());
    host.setPanelOpen(false);
  };

  const gridTop = cy - panelH / 2 + 48;
  EMOTES.forEach((emote, i) => {
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    const x = cx - panelW / 2 + GAP + BUTTON_W / 2 + col * (BUTTON_W + GAP);
    const y = gridTop + BUTTON_H / 2 + row * (BUTTON_H + GAP);

    const button = makeButton(
      scene,
      x,
      y,
      BUTTON_W,
      BUTTON_H,
      EMOTE_LABEL[emote],
      Tokens.color.surfaceRaised,
      Tokens.color.surfaceHover,
      () => {
        realtime.sendEmote(emote);
        playSfx(scene, "click");
        // Closes on pick. An emote is a single reaction, not a mode - and
        // leaving the panel up would cover the very floor the player is
        // reacting to.
        close();
      }
    );
    button.container.setScrollFactor(0).setDepth(201);
    isolateFixedUi(scene, button.container);
    buttons.push(button);
  });

  const cancel = makeButton(
    scene,
    cx,
    cy + panelH / 2 - Tokens.space.lg,
    100,
    32,
    "Close",
    Tokens.color.surface,
    Tokens.color.surfaceHover,
    close
  );
  cancel.container.setScrollFactor(0).setDepth(201);
  isolateFixedUi(scene, cancel.container);
  buttons.push(cancel);

  isolateFixedUi(scene, created);
}

registerTopRowButton({
  id: "emote",
  label: "😄 React",
  onClick: (host) => {
    // Emotes only travel to people who can see you. Offline (or standing in
    // a game screen) the button would fire into a closed socket and look
    // broken, so say so rather than silently doing nothing.
    if (realtime.currentStatus !== "online") {
      host.showToast("Not connected to other players right now", Tokens.text.muted);
      return;
    }
    openEmotePanel(host);
  }
});
