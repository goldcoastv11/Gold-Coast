/**
 * The servers players can join, and what each one owns.
 *
 * A "server" here is one instance of the arcade: its own casino floor, its
 * own Roulette wheel, its own Blackjack table. Two players on different
 * servers never see each other and never sit at the same table. That is the
 * whole concept - everything else in this file follows from it.
 *
 * ## Public vs private
 *
 * - **Public** servers are seeded at boot and always exist, so the browser
 *   is never empty and a player can always get in somewhere.
 * - **Private** servers are created on demand and are NOT listed. They are
 *   reachable only by their join code, which is the point: a group can play
 *   together without strangers walking in.
 *
 * ## Why the tables live here rather than being module singletons
 *
 * They used to be - there was one Roulette table for the whole product.
 * Once servers exist that is wrong: two servers must run two independent
 * wheels, or players on server A would be betting on server B's spin. So
 * each server owns its own table instances, and the realtime tick advances
 * every server's tables rather than one global pair.
 *
 * ## Lifetime
 *
 * Everything here is in memory and dies with the process, exactly like
 * presence itself (see presence.ts's header). A restart drops private
 * servers and their join codes; public ones are re-seeded identically.
 * Nothing of value is stored - a server is a room people are standing in,
 * not a record. This becomes wrong the day a second Railway instance runs,
 * which is the same day presence needs a shared backplane.
 */

import { randomInt } from "node:crypto";
import { BlackjackTable } from "./blackjackTable";
import { TableBet as RouletteBet } from "./protocol";
import { RouletteTable } from "./rouletteTable";
import {
  BlackjackSeat,
  GameServerSummary,
  JOIN_CODE_LENGTH,
  RoomName,
  SERVER_CAPACITY,
  ServerVisibility,
  roomKey
} from "./protocol";

/**
 * The public servers, seeded at boot. Named rather than numbered so the
 * browser reads like somewhere to go instead of a list of shards.
 */
const PUBLIC_SERVERS: { id: string; name: string }[] = [
  { id: "boardwalk", name: "The Boardwalk" },
  { id: "highroller", name: "High Roller Room" },
  { id: "sunset", name: "Sunset Lounge" }
];

/**
 * How long an empty private server is kept before being dropped. Long
 * enough that everyone leaving to play a solo game doesn't destroy the
 * room out from under them; short enough that abandoned codes don't
 * accumulate for the life of the process.
 */
export const PRIVATE_SERVER_TTL_MS = 15 * 60_000;

/**
 * Join codes deliberately exclude characters that get misread when someone
 * reads a code out loud or types it from a photo: O/0, I/1/L, S/5, B/8.
 * A code that "works but they typed it wrong" is the main failure mode of
 * this whole feature.
 */
const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY2346789";

export interface GameServer {
  id: string;
  name: string;
  visibility: ServerVisibility;
  /** Private servers only. The public ones are reachable by id and have none. */
  joinCode: string | null;
  createdAt: number;
  /** Set while a private server is empty, so it can be reaped. Cleared as soon as someone is in it. */
  emptySince: number | null;
  roulette: RouletteTable;
  blackjack: BlackjackTable;
}

/** How the registry asks "how many people are actually in this server right now". Supplied by the caller so this module stays free of presence. */
export type OccupancyReader = (serverId: string) => number;

/**
 * How the registry tells the socket layer that something happened at one of
 * its tables, without knowing anything about sockets.
 *
 * This exists because the obvious alternative is a trap: subscribing to
 * every table once, at startup, silently misses every server created
 * afterwards - so bets at a private server would never reach the other
 * players sitting at it. Registering the sink with the REGISTRY instead
 * means new servers are wired up as they are born.
 */
export interface TableBroadcaster {
  bet(serverId: string, roundId: string, bet: RouletteBet): void;
  seat(serverId: string, roundId: string, seat: BlackjackSeat): void;
}

export class GameServerRegistry {
  private readonly servers = new Map<string, GameServer>();
  private readonly byCode = new Map<string, string>();
  private broadcaster: TableBroadcaster | null = null;
  /** Per-server unsubscribes for whatever `broadcaster` is currently wired to. */
  private readonly wiring = new Map<string, Array<() => void>>();

  constructor() {
    this.seedPublicServers();
  }

  /**
   * Points every table - existing and future - at `broadcaster`. Pass null
   * to detach (the realtime channel shutting down).
   */
  setBroadcaster(broadcaster: TableBroadcaster | null): void {
    for (const offs of this.wiring.values()) offs.forEach((off) => off());
    this.wiring.clear();

    this.broadcaster = broadcaster;
    if (!broadcaster) return;
    for (const server of this.all()) this.wire(server);
  }

  private wire(server: GameServer): void {
    const broadcaster = this.broadcaster;
    if (!broadcaster) return;
    this.wiring.set(server.id, [
      server.roulette.onBet((roundId, bet) => broadcaster.bet(server.id, roundId, bet)),
      server.blackjack.onSeat((roundId, seat) => broadcaster.seat(server.id, roundId, seat))
    ]);
  }

  private unwire(serverId: string): void {
    this.wiring.get(serverId)?.forEach((off) => off());
    this.wiring.delete(serverId);
  }

  /**
   * (Re)creates the public servers. Called from the constructor and again
   * by reset() - a public server must always exist, so the browser can
   * never present a player with nowhere to go.
   */
  private seedPublicServers(now = Date.now()): void {
    for (const def of PUBLIC_SERVERS) {
      this.servers.set(def.id, {
        id: def.id,
        name: def.name,
        visibility: "public",
        joinCode: null,
        createdAt: now,
        emptySince: null,
        roulette: new RouletteTable(),
        blackjack: new BlackjackTable()
      });
    }
  }

  get(serverId: string): GameServer | undefined {
    return this.servers.get(serverId);
  }

  /** Resolves a join code (case-insensitively) to its server. */
  resolveCode(code: string): GameServer | undefined {
    const id = this.byCode.get(code.trim().toUpperCase());
    return id ? this.servers.get(id) : undefined;
  }

  all(): GameServer[] {
    return [...this.servers.values()];
  }

  /**
   * The server browser's list: public servers only, with live player
   * counts. Private ones are deliberately absent - they are reachable by
   * code alone, and listing them (even by name) would defeat the point.
   */
  listPublic(occupancy: OccupancyReader): GameServerSummary[] {
    return this.all()
      .filter((s) => s.visibility === "public")
      .map((s) => this.summarize(s, occupancy));
  }

  summarize(server: GameServer, occupancy: OccupancyReader): GameServerSummary {
    return {
      id: server.id,
      name: server.name,
      visibility: server.visibility,
      players: occupancy(server.id),
      capacity: SERVER_CAPACITY
    };
  }

  /** Creates a private server with a fresh join code. */
  createPrivate(name: string, now = Date.now()): GameServer {
    const id = `p_${randomToken(10)}`;
    const joinCode = this.uniqueJoinCode();

    const server: GameServer = {
      id,
      name,
      visibility: "private",
      joinCode,
      createdAt: now,
      // Born empty: the creator hasn't walked in yet, and if they never do
      // it must still be reapable.
      emptySince: now,
      roulette: new RouletteTable(),
      blackjack: new BlackjackTable()
    };

    this.servers.set(id, server);
    this.byCode.set(joinCode, id);
    // Wired immediately, so a private server broadcasts its bets from its
    // very first round rather than only if it happened to exist at boot.
    this.wire(server);
    return server;
  }

  /**
   * Starts a server's tables if they aren't already running. Called when
   * someone enters, rather than at boot, so idle servers cost nothing -
   * a dozen empty tables all ticking is pure waste.
   */
  ensureTablesRunning(server: GameServer, now = Date.now()): void {
    if (!server.roulette.running) server.roulette.start(now);
    if (!server.blackjack.running) server.blackjack.start(now);
  }

  /**
   * Housekeeping, called on the realtime tick: stops the tables of servers
   * nobody is in, and drops private servers that have been empty past the
   * TTL. Returns the ids that were removed so the caller can tidy up.
   */
  sweep(occupancy: OccupancyReader, now = Date.now()): string[] {
    const removed: string[] = [];

    for (const server of this.all()) {
      const players = occupancy(server.id);

      if (players > 0) {
        server.emptySince = null;
        continue;
      }

      if (server.emptySince === null) server.emptySince = now;

      // An empty server's tables have nobody to deal to. Stopping them
      // frees the loop and means a returning player gets a fresh round
      // rather than walking into the middle of one played to an empty room.
      if (server.roulette.running) server.roulette.stop();
      if (server.blackjack.running) server.blackjack.stop();

      if (server.visibility === "private" && now - server.emptySince > PRIVATE_SERVER_TTL_MS) {
        this.unwire(server.id);
        this.servers.delete(server.id);
        if (server.joinCode) this.byCode.delete(server.joinCode);
        removed.push(server.id);
      }
    }

    return removed;
  }

  /** Drops every private server and re-seeds the public ones. Used by tests to get a clean slate. */
  reset(now = Date.now()): void {
    for (const id of [...this.wiring.keys()]) this.unwire(id);
    this.servers.clear();
    this.byCode.clear();
    this.seedPublicServers(now);
    // The seeded servers are brand-new objects, so anything that was
    // listening to the old ones has to be re-pointed at these.
    for (const server of this.all()) this.wire(server);
  }

  private uniqueJoinCode(): string {
    // Collisions are vanishingly unlikely at this alphabet size, but a
    // duplicate code would silently drop players into a stranger's private
    // server, so it is checked rather than assumed.
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = randomCode();
      if (!this.byCode.has(code)) return code;
    }
    // Every attempt collided, which in practice means something is very
    // wrong. Falling back to a longer code is better than handing out a
    // duplicate.
    return randomCode() + randomCode();
  }
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return out;
}

function randomToken(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)].toLowerCase();
  }
  return out;
}

/**
 * The one registry.
 *
 * Module-level for the same reason the Roulette table used to be: the HTTP
 * routes and the realtime tick both need the same objects, and threading it
 * through Express's wiring to reach three routes would be more machinery
 * than one instance is worth.
 */
export const gameServers = new GameServerRegistry();

/** Every room key a server owns - what the caller needs to count its occupants or tear it down. */
export function roomKeysFor(serverId: string, rooms: readonly RoomName[]): string[] {
  return rooms.map((room) => roomKey(serverId, room));
}
