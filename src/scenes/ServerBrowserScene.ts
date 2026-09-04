/**
 * SERVER BROWSER - pick which arcade to walk into.
 *
 * Sits between the start menu and the casino floor. A "server" is one
 * instance of the arcade: its own floor, its own Roulette wheel, its own
 * Blackjack table (see server/src/realtime/gameServers.ts). Two players on
 * different servers never see each other.
 *
 * Three ways in, which is the whole screen:
 *
 * - **Join a public one** from the list, with live player counts.
 * - **Create a private one** and get a join code to share.
 * - **Enter a code** somebody gave you.
 *
 * ## Why this screen exists rather than one global floor
 *
 * One shared floor caps out: at some point it is either empty or a crowd,
 * and neither is a good first impression. Servers let the floor stay
 * populated-but-navigable, and private ones let a group play together
 * without strangers - which is the thing people actually asked for.
 *
 * ## Degrading
 *
 * If the list can't be fetched the screen says so and offers a retry rather
 * than sitting blank. Nothing else in the game depends on this screen, so a
 * failure here strands the player on a screen with a Back button, never in
 * a broken state.
 */

import Phaser from "phaser";
import { fadeToScene, fadeInOnCreate } from "../ui/sceneTransition";
import { gameState } from "../GameState";
import { Tokens } from "../ui/DesignTokens";
import { makeButton, makeText, makePanel, makeInset, UIButton } from "../ui/uiHelpers";
import { liveCenterX } from "../ui/Layout";
import * as api from "../api/client";
import { NetworkError } from "../api/client";
import { GameServerSummary, JOIN_CODE_LENGTH } from "../api/realtimeProtocol";
import { realtime } from "../api/realtime";
import { playSfx } from "../ui/SoundManager";

const TITLE_Y = 150;
const SUBTITLE_Y = 176;
const LIST_TOP = 208;
const ROW_H = 46;
const ROW_GAP = 8;
/** Rows shown before the list scrolls off the safe zone. Three public servers exist, so this is headroom, not a squeeze. */
const MAX_ROWS = 4;
const PANEL_W = 460;
const ACTIONS_Y = 452;

export class ServerBrowserScene extends Phaser.Scene {
  private cx = 400;
  private statusText!: Phaser.GameObjects.Text;
  /** Everything below the header that gets torn down and redrawn on a refresh or a mode switch. */
  private body: Phaser.GameObjects.GameObject[] = [];
  private bodyButtons: UIButton[] = [];
  /** Typed join code, while the code entry is open. Null when it isn't. */
  private codeEntry: string | null = null;
  private busy = false;

  constructor() {
    super("ServerBrowserScene");
  }

  create() {
    fadeInOnCreate(this);
    this.cameras.main.setBackgroundColor(Tokens.color.bg);

    // Phaser reuses the scene instance between visits, so every field that
    // holds a game object has to be reset here - see CLAUDE.md's trap #3.
    this.body = [];
    this.bodyButtons = [];
    this.codeEntry = null;
    this.busy = false;

    this.cx = liveCenterX(this);

    makePanel(this, this.cx, 300, PANEL_W, 360);

    makeText(this, this.cx, TITLE_Y, "CHOOSE A SERVER", {
      size: Tokens.type.size.xl,
      weight: Tokens.type.weight.bold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5
    });

    this.statusText = makeText(this, this.cx, SUBTITLE_Y, "Loading servers…", {
      size: Tokens.type.size.sm,
      color: Tokens.text.muted,
      align: "center",
      originX: 0.5
    });

    // Keyboard entry for the join code. Registered once for the scene and
    // ignored unless the code entry is actually open, so it can never eat
    // keystrokes meant for anything else.
    this.input.keyboard?.on("keydown", this.onKey, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off("keydown", this.onKey, this);
    });

    this.refresh();
  }

  // -------------------------------------------------------------------------
  // The list
  // -------------------------------------------------------------------------

  private refresh() {
    this.busy = true;
    this.statusText.setText("Loading servers…").setColor(Tokens.text.muted);

    api
      .listServers()
      .then((res) => {
        // The scene can be gone by the time this lands (the player hit
        // Back); a destroyed scene's `add` factory throws.
        if (!this.scene.isActive()) return;
        this.busy = false;
        this.renderList(res.servers);
      })
      .catch((err) => {
        if (!this.scene.isActive()) return;
        this.busy = false;
        this.renderError(err);
      });
  }

  private renderList(servers: GameServerSummary[]) {
    this.clearBody();
    this.codeEntry = null;
    this.statusText.setText("Pick a table to join, or play with friends").setColor(Tokens.text.muted);

    servers.slice(0, MAX_ROWS).forEach((server, i) => {
      const y = LIST_TOP + i * (ROW_H + ROW_GAP);
      const full = server.players >= server.capacity;

      this.track(makeInset(this, this.cx, y, PANEL_W - 48, ROW_H, Tokens.radius.md));
      this.track(
        makeText(this, this.cx - PANEL_W / 2 + 40, y, server.name, {
          size: Tokens.type.size.lg,
          weight: Tokens.type.weight.semibold,
          color: Tokens.text.primary,
          originY: 0.5
        })
      );
      this.track(
        makeText(
          this,
          this.cx - PANEL_W / 2 + 40,
          y + 14,
          full ? "Full" : `${server.players} / ${server.capacity} playing`,
          {
            size: Tokens.type.size.xs,
            color: full ? Tokens.text.negative : Tokens.text.muted,
            originY: 0.5
          }
        )
      );

      const join = makeButton(
        this,
        this.cx + PANEL_W / 2 - 74,
        y,
        92,
        30,
        full ? "FULL" : "JOIN",
        full ? Tokens.color.surface : Tokens.color.accent,
        full ? Tokens.color.surface : Tokens.color.accentHover,
        () => this.enter(server.id),
        undefined,
        Tokens.radius.sm
      );
      // A full server's button stays visible but dead - hiding it would
      // make the row look broken rather than busy.
      if (full) join.setEnabled(false);
      this.trackButton(join);
    });

    this.renderActions();
  }

  private renderActions() {
    this.trackButton(
      makeButton(
        this,
        this.cx - 150,
        ACTIONS_Y,
        140,
        34,
        "🔒 PRIVATE",
        Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        () => this.createPrivate(),
        undefined,
        Tokens.radius.sm
      )
    );
    this.trackButton(
      makeButton(
        this,
        this.cx,
        ACTIONS_Y,
        140,
        34,
        "ENTER CODE",
        Tokens.color.surfaceRaised,
        Tokens.color.surfaceHover,
        () => this.openCodeEntry(),
        undefined,
        Tokens.radius.sm
      )
    );
    this.trackButton(
      makeButton(
        this,
        this.cx + 150,
        ACTIONS_Y,
        140,
        34,
        "BACK",
        Tokens.color.surface,
        Tokens.color.surfaceHover,
        () => fadeToScene(this, "StartMenuScene"),
        undefined,
        Tokens.radius.sm
      )
    );
  }

  private renderError(err: unknown) {
    this.clearBody();
    const message =
      err instanceof NetworkError
        ? "Couldn't reach the server list."
        : "Something went wrong loading servers.";
    this.statusText.setText(message).setColor(Tokens.text.negative);

    this.trackButton(
      makeButton(
        this,
        this.cx - 80,
        LIST_TOP + 40,
        140,
        36,
        "TRY AGAIN",
        Tokens.color.accent,
        Tokens.color.accentHover,
        () => this.refresh(),
        undefined,
        Tokens.radius.sm
      )
    );
    this.trackButton(
      makeButton(
        this,
        this.cx + 80,
        LIST_TOP + 40,
        140,
        36,
        "BACK",
        Tokens.color.surface,
        Tokens.color.surfaceHover,
        () => fadeToScene(this, "StartMenuScene"),
        undefined,
        Tokens.radius.sm
      )
    );
  }

  // -------------------------------------------------------------------------
  // Private servers
  // -------------------------------------------------------------------------

  private createPrivate() {
    if (this.busy) return;
    this.busy = true;
    playSfx(this, "click");
    this.statusText.setText("Creating your table…").setColor(Tokens.text.muted);

    api
      .createServer()
      .then((res) => {
        if (!this.scene.isActive()) return;
        this.busy = false;
        this.showJoinCode(res.server.id, res.server.joinCode);
      })
      .catch(() => {
        if (!this.scene.isActive()) return;
        this.busy = false;
        this.statusText.setText("Couldn't create a private table.").setColor(Tokens.text.negative);
      });
  }

  /**
   * Shows the code and waits, rather than dropping the host straight in.
   *
   * The code only ever comes back once, in the create response - there is no
   * route that hands it out again. Walking the host into the server
   * immediately would leave them with a private table nobody else can ever
   * reach.
   */
  private showJoinCode(serverId: string, joinCode: string) {
    this.clearBody();
    this.statusText.setText("Share this code - it isn't shown again").setColor(Tokens.text.muted);

    this.track(makeInset(this, this.cx, LIST_TOP + 30, 260, 64, Tokens.radius.md));
    this.track(
      makeText(this, this.cx, LIST_TOP + 30, joinCode, {
        size: Tokens.type.size.display,
        weight: Tokens.type.weight.bold,
        color: Tokens.text.accent,
        align: "center",
        originX: 0.5,
        originY: 0.5
      })
    );

    this.trackButton(
      makeButton(
        this,
        this.cx,
        LIST_TOP + 100,
        200,
        40,
        "ENTER TABLE",
        Tokens.color.accent,
        Tokens.color.accentHover,
        () => this.enter(serverId),
        undefined,
        Tokens.radius.md
      )
    );
    this.trackButton(
      makeButton(
        this,
        this.cx,
        LIST_TOP + 150,
        200,
        32,
        "BACK TO LIST",
        Tokens.color.surface,
        Tokens.color.surfaceHover,
        () => this.refresh(),
        undefined,
        Tokens.radius.sm
      )
    );
  }

  private openCodeEntry() {
    if (this.busy) return;
    this.clearBody();
    this.codeEntry = "";
    this.statusText
      .setText(`Type the ${JOIN_CODE_LENGTH}-character code, then Enter`)
      .setColor(Tokens.text.muted);

    this.track(makeInset(this, this.cx, LIST_TOP + 30, 260, 64, Tokens.radius.md));
    const entry = makeText(this, this.cx, LIST_TOP + 30, "______", {
      size: Tokens.type.size.display,
      weight: Tokens.type.weight.bold,
      color: Tokens.text.primary,
      align: "center",
      originX: 0.5,
      originY: 0.5
    });
    this.track(entry);
    this.codeDisplay = entry;

    this.trackButton(
      makeButton(
        this,
        this.cx,
        LIST_TOP + 110,
        200,
        32,
        "BACK TO LIST",
        Tokens.color.surface,
        Tokens.color.surfaceHover,
        () => this.refresh(),
        undefined,
        Tokens.radius.sm
      )
    );
  }

  private codeDisplay?: Phaser.GameObjects.Text;

  /**
   * Typed input for the join code.
   *
   * A no-op unless the code entry is open, so this handler can be
   * registered once for the scene's whole life instead of being added and
   * removed - which is the version that leaks a listener across a restart.
   */
  private onKey(event: KeyboardEvent) {
    if (this.codeEntry === null || this.busy) return;

    if (event.key === "Enter") {
      this.submitCode();
      return;
    }
    if (event.key === "Backspace") {
      this.codeEntry = this.codeEntry.slice(0, -1);
      this.paintCode();
      return;
    }
    if (event.key === "Escape") {
      this.refresh();
      return;
    }
    // Codes are uppercase alphanumeric; anything else is a stray keypress.
    if (/^[a-zA-Z0-9]$/.test(event.key) && this.codeEntry.length < JOIN_CODE_LENGTH) {
      this.codeEntry += event.key.toUpperCase();
      this.paintCode();
    }
  }

  private paintCode() {
    const code = this.codeEntry ?? "";
    this.codeDisplay?.setText(code.padEnd(JOIN_CODE_LENGTH, "_"));
  }

  private submitCode() {
    const code = this.codeEntry ?? "";
    if (code.length < JOIN_CODE_LENGTH) {
      this.statusText.setText("That code is too short").setColor(Tokens.text.negative);
      return;
    }

    this.busy = true;
    this.statusText.setText("Finding that table…").setColor(Tokens.text.muted);

    api
      .joinServerByCode(code)
      .then((res) => {
        if (!this.scene.isActive()) return;
        this.busy = false;
        this.enter(res.server.id);
      })
      .catch(() => {
        if (!this.scene.isActive()) return;
        this.busy = false;
        // Deliberately vague, matching the server: distinguishing "expired"
        // from "never existed" would turn this into a way to test codes.
        this.statusText.setText("No table with that code").setColor(Tokens.text.negative);
      });
  }

  // -------------------------------------------------------------------------
  // Entering
  // -------------------------------------------------------------------------

  /**
   * Walks into a server.
   *
   * The id is remembered on `gameState` as well as handed to the realtime
   * client, because OverworldScene is recreated on every visit and needs to
   * know which server to re-enter without asking this screen again.
   */
  private enter(serverId: string) {
    if (this.busy) return;
    playSfx(this, "click");
    gameState.activeServerId = serverId;
    realtime.start();
    fadeToScene(this, "OverworldScene");
  }

  // -------------------------------------------------------------------------
  // Teardown helpers
  // -------------------------------------------------------------------------

  private track<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.body.push(obj);
    return obj;
  }

  private trackButton(button: UIButton): UIButton {
    this.bodyButtons.push(button);
    return button;
  }

  /** Destroys everything below the header, so a redraw can't leave two lists stacked on each other. */
  private clearBody() {
    this.bodyButtons.forEach((b) => b.destroy());
    this.bodyButtons = [];
    this.body.forEach((o) => o.destroy());
    this.body = [];
    this.codeDisplay = undefined;
  }
}
