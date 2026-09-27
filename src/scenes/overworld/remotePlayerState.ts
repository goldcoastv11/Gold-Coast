/**
 * The Phaser-free half of remote-player rendering: who is on the floor,
 * where they are being drawn right now, and where the server last said
 * they were.
 *
 * Split out from RemotePlayers.ts for the reason this repo splits
 * `leaderboardGeometry.ts` and `quickplayGrid.ts` out of their panels -
 * importing the `phaser` package root throws under plain Node (device
 * detection reaches for `window`), so anything that imports it cannot be
 * unit tested at all. The interpolation below is exactly the kind of code
 * that is easy to get subtly wrong and impossible to eyeball from a
 * screenshot, so it lives here where a test can drive it frame by frame.
 *
 * ## Why interpolate at all
 *
 * The server broadcasts at 10Hz (TICK_MS) and the game renders at 60. Drawn
 * naively, a remote player teleports 16 pixels every sixth frame - which
 * reads as a stuttering, broken character rather than a walking one. So the
 * authoritative position from the server is a TARGET, and the drawn
 * position eases toward it. The cost is that a remote player is rendered
 * roughly one tick behind where they actually are, which nobody can
 * perceive and which matters for nothing here, because no interaction in
 * this game depends on another player's exact position.
 */

import { Direction, PresenceDelta, PresencePlayer, TICK_MS } from "../../api/realtimeProtocol";

/**
 * A jump larger than this is a teleport, not a walk, and is snapped rather
 * than eased - otherwise a player who walks out of a game cabinet and back
 * onto the floor at a different spot appears to glide across the room
 * through the walls. Sized well above the ~16px a player covers in one tick
 * at PLAYER_SPEED (160 px/s), so ordinary fast movement is never mistaken
 * for one.
 */
export const SNAP_DISTANCE = 96;

export interface RemotePlayerState {
  id: string;
  username: string;
  wardrobe: Record<string, string>;
  /** Where this player is being DRAWN - eased toward the target every frame. */
  x: number;
  y: number;
  /** Where the server last said they are. */
  targetX: number;
  targetY: number;
  dir: Direction;
  moving: boolean;
  /** Set when a roster/join/appearance message changes what they are wearing, so the renderer knows to rebuild their layer stack. */
  appearanceDirty: boolean;
}

/**
 * Eases one coordinate toward its target.
 *
 * Exponential smoothing, with `deltaMs / TICK_MS` as the per-frame factor:
 * over one server tick's worth of frames it closes about two thirds of the
 * gap, whatever the frame rate. Two consequences, both wanted:
 *
 * - The character is always still moving when the next target arrives, so
 *   it never sits parked between updates the way a fixed-duration lerp does
 *   if a packet is late.
 * - A player who keeps walking is drawn at a small, CONSTANT distance
 *   behind where the server says they are - roughly a third of a tick, a
 *   handful of pixels. Nothing in this game depends on another player's
 *   exact position, so that trade buys smoothness for free.
 *
 * Clamped at 1 so a long frame (a tab regaining focus, a GC pause) closes
 * the gap completely instead of overshooting and oscillating around the
 * target.
 */
export function easeToward(current: number, target: number, deltaMs: number): number {
  const factor = Math.min(1, deltaMs / TICK_MS);
  return current + (target - current) * factor;
}

/**
 * Everyone else on the casino floor.
 *
 * Owns no sprites and no scene reference - the renderer reads this and
 * makes the display match. Keeping the "who is here" bookkeeping separate
 * from "which sprites exist" also means a scene restart (which destroys
 * every sprite) can rebuild the whole display from the store without a
 * round trip to the server.
 */
export class RemotePlayerStore {
  private readonly players = new Map<string, RemotePlayerState>();

  get size(): number {
    return this.players.size;
  }

  get(id: string): RemotePlayerState | undefined {
    return this.players.get(id);
  }

  all(): RemotePlayerState[] {
    return [...this.players.values()];
  }

  /**
   * Replaces the whole roster - the response to entering a room.
   *
   * A wholesale replace, not a merge: the roster IS the truth about who is
   * present, so anyone in the old set who isn't in the new one has left,
   * and keeping them would leave a ghost standing on the floor forever.
   * Returns the ids that disappeared so the renderer can destroy exactly
   * those sprites.
   */
  applyRoster(players: PresencePlayer[]): { removed: string[] } {
    const incoming = new Set(players.map((p) => p.id));
    const removed: string[] = [];
    for (const id of this.players.keys()) {
      if (!incoming.has(id)) removed.push(id);
    }
    for (const id of removed) this.players.delete(id);

    for (const player of players) this.upsert(player);
    return { removed };
  }

  /** Adds (or refreshes) one player. Used for `join` and, with a changed wardrobe, for `appearance`. */
  upsert(player: PresencePlayer): RemotePlayerState {
    const existing = this.players.get(player.id);
    if (existing) {
      // Position is NOT taken from this message when the player is already
      // known: `appearance` carries whatever the server last recorded,
      // which may be older than the deltas already applied. Only the
      // appearance actually changes.
      existing.username = player.username;
      existing.appearanceDirty = !wardrobeEquals(existing.wardrobe, player.wardrobe);
      existing.wardrobe = player.wardrobe;
      return existing;
    }

    const state: RemotePlayerState = {
      id: player.id,
      username: player.username,
      wardrobe: player.wardrobe,
      // A newly-seen player is drawn AT their reported position rather than
      // eased into it from wherever the last player with that slot stood -
      // they should appear where they are, not walk in from the origin.
      x: player.x,
      y: player.y,
      targetX: player.x,
      targetY: player.y,
      dir: player.dir,
      moving: player.moving,
      appearanceDirty: true
    };
    this.players.set(player.id, state);
    return state;
  }

  remove(id: string): boolean {
    return this.players.delete(id);
  }

  clear(): void {
    this.players.clear();
  }

  /**
   * Applies one server tick's movement. Deltas for unknown ids are ignored:
   * that is a `state` broadcast racing a `leave`, which is normal, not an
   * error - and creating a player from a delta would produce someone with
   * no username and no wardrobe.
   */
  applyDeltas(deltas: PresenceDelta[]): void {
    for (const delta of deltas) {
      const state = this.players.get(delta.id);
      if (!state) continue;

      state.targetX = delta.x;
      state.targetY = delta.y;
      state.dir = delta.dir;
      state.moving = delta.moving;

      if (Math.hypot(delta.x - state.x, delta.y - state.y) > SNAP_DISTANCE) {
        state.x = delta.x;
        state.y = delta.y;
      }
    }
  }

  /** Advances every drawn position one frame toward its target. Call once per frame with the frame's delta in ms. */
  advance(deltaMs: number): void {
    for (const state of this.players.values()) {
      state.x = easeToward(state.x, state.targetX, deltaMs);
      state.y = easeToward(state.y, state.targetY, deltaMs);
    }
  }

  /** Clears the appearance-changed flag once the renderer has rebuilt that player's layers. */
  markAppearanceApplied(id: string): void {
    const state = this.players.get(id);
    if (state) state.appearanceDirty = false;
  }
}

function wardrobeEquals(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}
