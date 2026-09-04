/**
 * Who is standing where, in memory. The realtime channel's entire model.
 *
 * ## Why this file has no `ws` import
 *
 * Everything here is plain data and plain functions: no sockets, no timers,
 * no Prisma. That is deliberate, and it is what makes the interesting parts
 * - clamping, dedupe, the dirty-set delta - testable without standing up a
 * server or opening a connection (see server/test/realtimePresence.test.ts).
 * realtime/server.ts is the adapter that owns the sockets and calls into
 * this; if you find yourself wanting a socket handle in here, it belongs
 * there instead.
 *
 * ## In-memory, single process, on purpose
 *
 * Presence dies with the process, exactly like the rate-limit buckets in
 * routes/events.ts, and for the same reasons: this server is one process on
 * Railway, and the thing being stored is "where an avatar is standing right
 * now", which is worth nothing after a restart. A player whose socket drops
 * on deploy reconnects and re-announces their position within a second.
 * There is no Redis here and none is needed until a second instance exists
 * - at which point players on instance A simply would not see instance B's
 * players, and THAT is the day this needs a shared backplane.
 *
 * ## One presence per account
 *
 * Presence is keyed by userId, not by connection. Open the game in a second
 * tab and the first tab's socket is displaced rather than both being drawn
 * - seeing a second copy of yourself walk around is a bug report, not a
 * feature, and keying by connection would also let one account occupy the
 * room's occupancy cap by itself.
 */

import {
  Direction,
  Emote,
  MAX_ROOM_OCCUPANTS,
  PresenceDelta,
  PresencePlayer,
  RoomName,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  parseRoomKey
} from "./protocol";

/**
 * How far a player must move before the change is worth a tick's bandwidth.
 * Sub-pixel jitter (a joystick resting fractionally off centre) otherwise
 * marks someone dirty forever and defeats the point of sending deltas.
 */
const MOVE_EPSILON = 0.5;

export interface PresenceOccupant extends PresencePlayer {
  /** Server clock of the last accepted `move`. Used only for diagnostics/idle reporting. */
  lastMoveAt: number;
}

export type JoinResult = { ok: true } | { ok: false; reason: "ROOM_FULL" };

/**
 * One shared space's occupants. Today the only instance is the casino floor
 * (see protocol.ts's ROOM_OVERWORLD); the shared Roulette table will be a
 * second one, which is why this is a class rather than a module-level map.
 */
export class PresenceRoom {
  private readonly occupants = new Map<string, PresenceOccupant>();

  /**
   * Ids whose position/facing changed since the last drainDeltas(). A set
   * rather than a "changed" flag on each occupant so a tick costs the
   * number of players who actually MOVED, not the number present - the
   * difference between a busy floor and a mostly-idle one, which is the
   * normal case.
   */
  private readonly dirty = new Set<string>();

  get size(): number {
    return this.occupants.size;
  }

  has(id: string): boolean {
    return this.occupants.has(id);
  }

  get(id: string): PresenceOccupant | undefined {
    return this.occupants.get(id);
  }

  /**
   * Adds a player, clamping their announced spawn the same way a `move`
   * would be. Rejoining an id already present REPLACES it (and is not a
   * capacity check) - that is the reconnect path, where the old entry is a
   * stale ghost of the same person.
   */
  join(player: PresencePlayer, now = Date.now()): JoinResult {
    if (!this.occupants.has(player.id) && this.occupants.size >= MAX_ROOM_OCCUPANTS) {
      return { ok: false, reason: "ROOM_FULL" };
    }

    this.occupants.set(player.id, {
      ...player,
      x: clampX(player.x),
      y: clampY(player.y),
      lastMoveAt: now
    });
    // Not marked dirty: whoever needs to know about a new arrival gets an
    // explicit `join` message carrying the full player, and a delta for the
    // same tick would be redundant.
    this.dirty.delete(player.id);
    return { ok: true };
  }

  leave(id: string): boolean {
    this.dirty.delete(id);
    return this.occupants.delete(id);
  }

  /**
   * Records a client-reported position.
   *
   * Coordinates are CLAMPED to the map rather than rejected. The trust
   * model (see protocol.ts's header) is that position is cosmetic and not
   * worth validating hard - but "not worth validating" is not the same as
   * "accept anything": an off-map or NaN-adjacent coordinate would render
   * as an avatar that is invisible or infinitely far away, which reads as a
   * broken client rather than a cheating one. Clamping keeps every
   * broadcast value drawable.
   *
   * Returns false for an unknown id (a socket that moved after leaving the
   * room - a race, not an error).
   */
  move(id: string, x: number, y: number, dir: Direction, moving: boolean, now = Date.now()): boolean {
    const occupant = this.occupants.get(id);
    if (!occupant) return false;

    const nextX = clampX(x);
    const nextY = clampY(y);
    const changed =
      Math.abs(nextX - occupant.x) > MOVE_EPSILON ||
      Math.abs(nextY - occupant.y) > MOVE_EPSILON ||
      dir !== occupant.dir ||
      moving !== occupant.moving;

    occupant.x = nextX;
    occupant.y = nextY;
    occupant.dir = dir;
    occupant.moving = moving;
    occupant.lastMoveAt = now;

    if (changed) this.dirty.add(id);
    return true;
  }

  /**
   * Replaces a player's equipped wardrobe. Called with pieces read from the
   * database, never with anything a client sent - see protocol.ts's
   * AppearanceSchema, which carries no payload for exactly this reason.
   */
  setWardrobe(id: string, wardrobe: Record<string, string>): PresenceOccupant | undefined {
    const occupant = this.occupants.get(id);
    if (!occupant) return undefined;
    occupant.wardrobe = wardrobe;
    return occupant;
  }

  /** Everyone in the room, as the wire shape. `excludeId` drops the requester, who does not need to be told about themselves. */
  roster(excludeId?: string): PresencePlayer[] {
    const players: PresencePlayer[] = [];
    for (const occupant of this.occupants.values()) {
      if (occupant.id === excludeId) continue;
      players.push(toWire(occupant));
    }
    return players;
  }

  /**
   * The movement that happened since the last call, clearing the dirty set.
   * Returns an empty array when nobody moved, which the caller uses to skip
   * the broadcast entirely - an idle floor should cost no traffic at all.
   */
  drainDeltas(): PresenceDelta[] {
    if (this.dirty.size === 0) return [];

    const deltas: PresenceDelta[] = [];
    for (const id of this.dirty) {
      const occupant = this.occupants.get(id);
      // Left between being marked dirty and this drain - their `leave`
      // already went out, so there is nothing to say about them.
      if (!occupant) continue;
      deltas.push({
        id: occupant.id,
        x: round1(occupant.x),
        y: round1(occupant.y),
        dir: occupant.dir,
        moving: occupant.moving
      });
    }
    this.dirty.clear();
    return deltas;
  }

  ids(): string[] {
    return [...this.occupants.keys()];
  }
}

/**
 * Every shared room, keyed by name, plus the reverse index of which room a
 * given player is in - so a disconnect can remove someone without the
 * caller having to remember where they were.
 */
export class PresenceHub {
  private readonly rooms = new Map<string, PresenceRoom>();
  private readonly roomByPlayer = new Map<string, string>();

  room(name: string): PresenceRoom {
    let room = this.rooms.get(name);
    if (!room) {
      room = new PresenceRoom();
      this.rooms.set(name, room);
    }
    return room;
  }

  roomNameFor(playerId: string): string | undefined {
    return this.roomByPlayer.get(playerId);
  }

  /** Moves a player into a room, removing them from whichever one they were in first. */
  enter(roomName: string, player: PresencePlayer, now = Date.now()): JoinResult {
    this.exit(player.id);
    const result = this.room(roomName).join(player, now);
    if (result.ok) this.roomByPlayer.set(player.id, roomName);
    return result;
  }

  /** Removes a player from whatever room they are in. Returns the room's name if they were in one. */
  exit(playerId: string): string | undefined {
    const roomName = this.roomByPlayer.get(playerId);
    if (!roomName) return undefined;
    this.rooms.get(roomName)?.leave(playerId);
    this.roomByPlayer.delete(playerId);
    return roomName;
  }

  /** Rooms that currently hold at least one player, for the tick loop to iterate. */
  activeRooms(): { name: string; room: PresenceRoom }[] {
    const active: { name: string; room: PresenceRoom }[] = [];
    for (const [name, room] of this.rooms) {
      if (room.size > 0) active.push({ name, room });
    }
    return active;
  }

  /**
   * Which server and room a player is in, or null if they're nowhere
   * shared.
   *
   * This is the authority the HTTP routes use to decide which server's
   * table a bet belongs to. Deliberately NOT taken from the request body:
   * a client that could name its own server could bet on a table it isn't
   * sitting at, and on this product that moves real Gold Coins. Where a
   * player is standing is established by their socket, and only their
   * socket.
   */
  locate(playerId: string): { serverId: string; room: RoomName } | null {
    const key = this.roomByPlayer.get(playerId);
    return key ? parseRoomKey(key) : null;
  }

  /**
   * How many players are anywhere inside `serverId` - the casino floor plus
   * every table. A player occupies exactly one room at a time, so this is a
   * head count rather than a sum with double-counting.
   */
  occupancy(serverId: string): number {
    let count = 0;
    for (const key of this.roomByPlayer.values()) {
      if (parseRoomKey(key)?.serverId === serverId) count += 1;
    }
    return count;
  }

  /** Drops every room and every player. Tests only - a live hub is emptied by players leaving. */
  clear(): void {
    this.rooms.clear();
    this.roomByPlayer.clear();
  }
}

/**
 * The one hub.
 *
 * Module-level because two very different callers need the same object: the
 * socket adapter, which writes it, and the HTTP game routes, which read it
 * to answer "which server's table is this player actually sitting at". See
 * locate() above for why that question must not be answered by the client.
 */
export const presenceHub = new PresenceHub();

function toWire(occupant: PresenceOccupant): PresencePlayer {
  return {
    id: occupant.id,
    username: occupant.username,
    x: round1(occupant.x),
    y: round1(occupant.y),
    dir: occupant.dir,
    moving: occupant.moving,
    wardrobe: occupant.wardrobe
  };
}

/** One decimal place is well under a pixel on a 16px tile and keeps the 10Hz payload small. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampX(x: number): number {
  return clamp(x, 0, WORLD_WIDTH);
}

function clampY(y: number): number {
  return clamp(y, 0, WORLD_HEIGHT);
}

function clamp(value: number, min: number, max: number): number {
  // NaN fails both comparisons, so it would fall through to `return value`
  // - checked explicitly rather than relying on the caller's zod
  // `.finite()`, since this is the last line of defence before a coordinate
  // reaches other players' screens.
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Re-exported so the socket adapter and tests import one module for the room model. */
export type { Direction, Emote, PresenceDelta, PresencePlayer };
