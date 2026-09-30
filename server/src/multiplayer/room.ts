// Portable free-practice rules, reused in the explicitly offline solo mode.
function randomInt(max: number) {
  const limit = Math.floor(0x100000000 / max) * max, bytes = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % max;
}
function handValue(cards: number[]) {
  let sum = cards.reduce((n, r) => n + (r === 1 ? 11 : Math.min(r, 10)), 0), aces = cards.filter(r => r === 1).length;
  while (sum > 21 && aces-- > 0) sum -= 10;
  return sum;
}
export const SOCIAL_TABLES = [
  { id: 'palm', name: 'Palm Blackjack', game: 'blackjack', x: -6, z: -4 },
  { id: 'coast', name: 'Coast Blackjack', game: 'blackjack', x: 6, z: -4 },
  { id: 'roulette', name: 'Sunset Roulette', game: 'roulette', x: -12, z: 6 },
  { id: 'baccarat', name: 'Pearl Baccarat', game: 'baccarat', x: 0, z: 6 },
  { id: 'slots', name: 'Golden Slots', game: 'slots', x: 12, z: 6 },
  { id: 'coinflip', name: 'Coin Flip', game: 'coinflip', x: -20, z: -4 },
  { id: 'dragontower', name: 'Dragon Tower', game: 'dragontower', x: 20, z: -4 },
  { id: 'mines', name: 'Mines', game: 'mines', x: -21, z: 8 },
  { id: 'dice', name: 'Dice', game: 'dice', x: 21, z: 8 },
  { id: 'limbo', name: 'Limbo', game: 'limbo', x: -20, z: 20 },
  { id: 'plinko', name: 'Plinko', game: 'plinko', x: -10, z: 20 },
  { id: 'keno', name: 'Keno', game: 'keno', x: 0, z: 20 },
  { id: 'wheel', name: 'Wheel', game: 'wheel', x: 10, z: 20 },
  { id: 'hilo', name: 'Hi-Lo', game: 'hilo', x: 20, z: 20 },
  { id: 'videopoker', name: 'Video Poker', game: 'videopoker', x: 0, z: 32 },
] as const;
export const BLACKJACK_TABLES = SOCIAL_TABLES.filter(t => t.game === 'blackjack');
export const LOUNGE_BOUNDS = { minX: -28, maxX: 28, minZ: -10, maxZ: 38 } as const;
export type TableId = typeof SOCIAL_TABLES[number]['id'];

export type Look = { shirt: string; skin: string; hair: string; outfit?: string };
export const OUTFIT_IDS = ['Casual_2', 'Casual_Hoodie', 'Beach', 'Suit', 'Punk', 'Worker', 'Farmer', 'Adventurer', 'King', 'Spacesuit', 'Swat', 'Women_Adventurer', 'Women_Casual', 'Women_Formal', 'Women_Medieval', 'Women_Punk', 'Women_SciFi', 'Women_Soldier', 'Women_Suit', 'Women_Witch', 'Women_Worker'] as const;
export const SHIRTS = ["#27c6b5", "#e9ae54", "#a78bfa", "#f47591", "#f4f4f5", "#182536", "#e34e54", "#4b88df", "#60855c", "#cba675"];
export const SKINS = ["#f0c5a3", "#c68b60", "#865338", "#51362a", "#ffe0c2", "#a66e49"];
export const HAIR = ["#302922", "#ac733b", "#e9ce8a", "#e8e8e8", "#c54c36", "#7664bd"];
type Player = { id: string; name: string; x: number; z: number; yaw: number; look: Look; seen: number; moved: number; seated: boolean; tableId: TableId | null; seat: number | null };
type Hand = { id: string; name: string; cards: number[]; bet: number; done: boolean; result: string | null };
export type LoungeGameView = Record<string, string | number | boolean | number[] | string[] | null>;
type Activity = { phase: "waiting" | "playing" | "resolved"; result: string | null; view: LoungeGameView | null; startedAt: number };
type Table = { game: string; phase: "waiting" | "playing" | "resolved"; revision: number; deck: number[]; dealer: number[]; hands: Hand[]; bets: Record<string, number>; activities: Record<string, Activity>; turn: string | null; deadline: number; lastPlay: { playerId: string; playerName: string; result: string; view: LoungeGameView | null } | null };
type Room = { code: string; players: Map<string, Player>; tables: Record<TableId, Table> };
export const INDEPENDENT_LOUNGE_GAMES = ['slots', 'coinflip', 'dragontower', 'mines', 'hilo', 'videopoker'] as const;
const independentGame = (game: string) => (INDEPENDENT_LOUNGE_GAMES as readonly string[]).includes(game);
const table = (game: string): Table => ({ game, phase: "waiting", revision: 0, deck: [], dealer: [], hands: [], bets: {}, activities: {}, turn: null, deadline: 0, lastPlay: null });
export class RoomError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Single-process, free-practice rooms. No wallet access; a restart clears rooms. */
export class RoomService {
  private rooms = new Map<string, Room>();
  constructor(private now = () => Date.now(), private random = (max: number) => randomInt(max)) {}

  private finishBlackjack(t: Table) {
    while (handValue(t.dealer) < 17) t.dealer.push(t.deck.pop()!);
    const dealer = handValue(t.dealer);
    const dealerNatural = dealer === 21 && t.dealer.length === 2;
    for (const h of t.hands) {
      const score = handValue(h.cards);
      const natural = score === 21 && h.cards.length === 2;
      h.result = score > 21 ? "Bust" : dealerNatural ? (natural ? "Push" : "Dealer wins") : natural ? "Blackjack!" : dealer > 21 || score > dealer ? "You win" : score === dealer ? "Push" : "Dealer wins";
    }
    t.phase = "resolved"; t.bets = {}; t.turn = null; t.deadline = 0;
  }
  private advance(t: Table) {
    const next = t.hands.find(h => !h.done);
    if (next) { t.turn = next.id; t.deadline = this.now() + 25000; }
    else this.finishBlackjack(t);
  }
  private nextSocialTurn(room: Room, t: Table, afterId?: string) {
    const seated = [...room.players.values()].filter(p => p.tableId && room.tables[p.tableId] === t).sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
    if (!seated.length) { t.turn = null; t.phase = 'waiting'; t.deadline = 0; return; }
    const current = seated.findIndex(p => p.id === (afterId ?? t.turn));
    t.turn = seated[(current + 1 + seated.length) % seated.length].id;
    t.phase = 'waiting'; t.deadline = 0;
  }
  private sweep() {
    for (const [code, room] of this.rooms) {
      for (const [id, p] of room.players) if (this.now() - p.seen > 15000) room.players.delete(id);
      for (const t of Object.values(room.tables)) {
        if (!t.hands.length && t.phase === 'playing' && this.now() >= t.deadline) {
          const player = room.players.get(t.turn ?? '');
          if (player) t.lastPlay = { playerId: player.id, playerName: player.name, result: 'Turn ended', view: null };
          this.nextSocialTurn(room, t); t.revision++;
          continue;
        }
        if (t.phase === "playing") {
          let changed = false;
          for (const h of t.hands) if (!h.done && !room.players.has(h.id)) { h.done = true; changed = true; }
          const current = t.hands.find(h => h.id === t.turn);
          if (current && !current.done && this.now() >= t.deadline) { current.done = true; changed = true; }
          if (changed) { t.revision++; if (!current || current.done) this.advance(t); }
        }
      }
      if (!room.players.size) this.rooms.delete(code);
    }
  }
  private room(id: string, code: string) {
    this.sweep();
    const room = this.rooms.get(code);
    if (!room?.players.has(id)) throw new RoomError("Your room session ended. Join again to reconnect.", 404);
    return room;
  }
  join(id: string, name: string, code: string | undefined, look: Look) {
    this.sweep();
    // Rejoining the same room is idempotent and does not reset a seated player.
    const existing = code && this.rooms.get(code);
    if (existing && existing.players.has(id)) { existing.players.get(id)!.seen = this.now(); return this.snapshot(existing, id); }
    if (code && !existing) throw new RoomError("Room not found. Check the invite code.", 404);
    if (existing && existing.players.size >= 8) throw new RoomError("This room is full (8 players).", 409);
    if (!code && this.rooms.size >= 100) throw new RoomError("Rooms are busy. Please try again later.", 503);
    for (const room of this.rooms.values()) room.players.delete(id);
    if (!code) { do { code = randomInt(0x1000000).toString(16).padStart(6, '0').toUpperCase(); } while (this.rooms.has(code)); }
    let room = this.rooms.get(code);
    if (!room) {
      const tables = Object.fromEntries(SOCIAL_TABLES.map(s => [s.id, table(s.game)])) as Record<TableId, Table>;
      room = { code, players: new Map(), tables }; this.rooms.set(code, room);
    }
    room.players.set(id, { id, name, x: room.players.size * 0.7 - 2, z: 2.2, yaw: 0, look, seen: this.now(), moved: this.now(), seated: false, tableId: null, seat: null });
    return this.snapshot(room, id);
  }
  sync(id: string, code: string, pose?: { x: number; z: number; yaw: number; look: Look }) {
    const room = this.room(id, code), p = room.players.get(id)!;
    const now = this.now();
    if (pose) {
      const dx = pose.x - p.x, dz = pose.z - p.z, distance = Math.hypot(dx, dz);
      const max = Math.min(1, (now - p.moved) / 1000) * 6 + 0.15;
      const factor = distance > max ? max / distance : 1;
      if (!p.seated) { p.x += dx * factor; p.z += dz * factor; p.yaw = pose.yaw; }
      p.look = pose.look; p.moved = now;
    }
    p.seen = now;
    return this.snapshot(room, id);
  }
  action(id: string, code: string, action: "sit" | "leave" | "bet" | "deal" | "hit" | "stand" | "begin" | "share" | "finish", revision: number, tableId?: TableId, quickplay = false, result = 'Round complete', betAmount = 0, view: LoungeGameView | null = null) {
    const room = this.room(id, code), p = room.players.get(id)!;
    const chosen = tableId ?? p.tableId ?? 'palm', t = room.tables[chosen], station = SOCIAL_TABLES.find(s => s.id === chosen)!;
    if (!t || !station) throw new RoomError('Unknown table.');
    if (p.tableId && p.tableId !== chosen) throw new RoomError('Leave your current table first.');
    p.seen = this.now();
    if (revision !== t.revision) throw new RoomError("The table changed. Please try again.", 409);
    if (action === "sit") {
      if (t.game === 'blackjack' && t.hands.length && t.phase === "playing") throw new RoomError("Wait for this hand to finish.");
      if (!quickplay && Math.hypot(p.x - station.x, p.z - station.z) > 3.5) throw new RoomError(`Walk closer to the ${station.name} table.`);
      const seated = [...room.players.values()].filter(v => v.tableId === chosen);
      if (!p.seated && seated.length >= 4) throw new RoomError("All four seats are taken.");
      if (!p.seated) p.seat = [0, 1, 2, 3].find(seat => !seated.some(v => v.seat === seat))!;
      p.seated = true; p.tableId = chosen;
      p.x = station.x + [-1.8, -.6, .6, 1.8][p.seat!]; p.z = station.z + 2.2; p.yaw = Math.PI;
      if (!t.turn) t.turn = p.id;
    } else if (action === "leave") {
      p.seated = false; p.tableId = null; p.seat = null; p.z = station.z + 3;
      delete t.bets[id];
      delete t.activities[id];
      const h = t.hands.find(v => v.id === id);
      if (t.game === 'blackjack' && t.phase === "playing" && h && !h.done) { h.done = true; if (t.turn === id) this.advance(t); }
      if ((!t.hands.length || t.game !== 'blackjack') && t.turn === id) this.nextSocialTurn(room, t, id);
    } else if (action === "bet") {
      if (t.game !== 'blackjack') throw new RoomError('This table does not use Blackjack bets.');
      if (!p.seated || p.tableId !== chosen || t.phase === 'playing') throw new RoomError('Take a seat and wait for the current hand to finish.');
      if (!Number.isInteger(betAmount) || betAmount < 1 || betAmount > 10000) throw new RoomError('Choose a bet from 1 to 10,000 Gold Coins.');
      if (t.phase === 'resolved') { t.phase = 'waiting'; t.hands = []; t.dealer = []; t.bets = {}; t.turn = null; }
      t.bets[id] = betAmount;
    } else if (action === "deal") {
      if (t.game !== 'blackjack') throw new RoomError('This table uses player turns.');
      if (p.tableId !== chosen || t.phase === "playing") throw new RoomError("Take a seat and wait for the current hand to finish.");
      const seated = [...room.players.values()].filter(v => v.tableId === chosen);
      if (!seated.length || seated.some(v => !t.bets[v.id])) throw new RoomError('Every seated player must place a bet before the deal.');
      t.deck = Array.from({ length: 52 }, (_, i) => i % 13 + 1);
      for (let i = 51; i > 0; i--) { const j = this.random(i + 1); [t.deck[i], t.deck[j]] = [t.deck[j], t.deck[i]]; }
      t.dealer = [t.deck.pop()!, t.deck.pop()!];
      t.hands = seated.map(v => ({ id: v.id, name: v.name, cards: [t.deck.pop()!, t.deck.pop()!], bet: t.bets[v.id], done: false, result: null }));
      for (const h of t.hands) h.done = handValue(h.cards) === 21;
      t.phase = "playing";
      if (handValue(t.dealer) === 21) this.finishBlackjack(t); else this.advance(t);
    } else if (action === 'begin') {
      if (t.game === 'blackjack') throw new RoomError('Blackjack uses shared table bets and Deal.');
      if (!p.seated || p.tableId !== chosen) throw new RoomError('Take a seat before playing.', 409);
      if (independentGame(t.game)) {
        if (t.activities[id]?.phase === 'playing') throw new RoomError('Your game is already in progress.', 409);
        t.activities[id] = { phase: 'playing', result: 'Starting…', view: null, startedAt: this.now() };
      } else {
        if (t.turn !== id) throw new RoomError("It isn't your turn.", 409);
        if (t.phase === 'playing') throw new RoomError('This turn is already in progress.', 409);
        t.hands = []; t.dealer = []; t.deck = []; t.lastPlay = null; t.phase = 'playing'; t.deadline = this.now() + 180000;
      }
    } else if (action === 'finish') {
      if (!p.seated || p.tableId !== chosen) throw new RoomError('Take a seat before playing.', 409);
      if (independentGame(t.game)) {
        if (t.activities[id]?.phase !== 'playing') throw new RoomError('Your game is not in progress.', 409);
        t.activities[id] = { phase: 'resolved', result: result.slice(0, 80), view, startedAt: t.activities[id].startedAt };
        t.lastPlay = { playerId: p.id, playerName: p.name, result: result.slice(0, 80), view };
      } else {
        if (t.turn !== id || t.phase !== 'playing') throw new RoomError("It isn't your turn.", 409);
        t.lastPlay = { playerId: p.id, playerName: p.name, result: result.slice(0, 80), view };
        this.nextSocialTurn(room, t, id);
      }
    } else if (action === 'share') {
      if (!p.seated || p.tableId !== chosen) throw new RoomError('Take a seat before playing.', 409);
      if (independentGame(t.game)) {
        if (t.activities[id]?.phase !== 'playing') throw new RoomError('Your game is not in progress.', 409);
        t.activities[id].result = result.slice(0, 80); t.activities[id].view = view;
      } else if (t.turn !== id || t.phase !== 'playing') throw new RoomError("It isn't your turn.", 409);
      t.lastPlay = { playerId: p.id, playerName: p.name, result: result.slice(0, 80), view };
    } else {
      if (t.phase !== "playing" || t.turn !== id || !p.seated) throw new RoomError("It isn't your turn.", 409);
      const h = t.hands.find(v => v.id === id)!;
      if (action === "hit") h.cards.push(t.deck.pop()!);
      if (action === "stand" || handValue(h.cards) >= 21) { h.done = true; this.advance(t); }
    }
    t.revision++;
    return this.snapshot(room, id);
  }
  leave(id: string, code: string) { this.rooms.get(code)?.players.delete(id); this.sweep(); }
  private snapshot(room: Room, id: string) {
    const chosen = room.players.get(id)!.tableId ?? 'palm', t = room.tables[chosen];
    return { code: room.code, self: id, tables: SOCIAL_TABLES.map(s => ({ ...s, phase: room.tables[s.id].phase, revision: room.tables[s.id].revision, seats: [...room.players.values()].filter(p => p.tableId === s.id).length })), players: [...room.players.values()].map(({ seen, moved, ...p }) => p), table: {
      id: chosen,
      game: t.game, lastPlay: t.lastPlay,
      phase: t.phase, revision: t.revision, dealer: t.phase === "playing" ? [t.dealer[0], 0] : t.dealer,
      bets: { ...t.bets }, activities: Object.fromEntries(Object.entries(t.activities).map(([playerId, activity]) => [playerId, { ...activity }])), hands: t.hands.map(h => ({ ...h, cards: [...h.cards], total: handValue(h.cards) })), turn: t.turn,
      remainingMs: Math.max(0, t.deadline - this.now())
    } };
  }
}
