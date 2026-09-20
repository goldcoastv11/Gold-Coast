import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { RoomService, Look } from '../src/multiplayer/room';
import { app } from '../src/app';
import { signToken } from '../src/auth/jwt';

const look: Look = { shirt: '#27c6b5', skin: '#c68b60', hair: '#302922' };
describe('mobile multiplayer practice rooms', () => {
  let now: number, rooms: RoomService, code: string;
  beforeEach(() => { now = 100000; rooms = new RoomService(() => now, max => max - 1); code = rooms.join('a', 'Alice', undefined, look).code; });
  const pose = { x: 0, z: 1, yaw: 0, look };
  function approach(id: string) { for (let i = 0; i < 6; i++) { now += 200; rooms.sync(id, code, pose); } }
  function seat(id: string) { approach(id); const s = rooms.sync(id, code); return rooms.action(id, code, 'sit', s.table.revision); }
  function twoPlayers() { rooms.join('b', 'Bob', code, look); seat('a'); return seat('b'); }
  it('shares only authenticated identities, and caps room size at eight', () => {
    for (let i = 1; i < 8; i++) rooms.join(String(i), `Player${i}`, code, look);
    expect(rooms.sync('a', code).players).toHaveLength(8);
    expect(() => rooms.join('extra', 'Extra', code, look)).toThrow('full');
    expect(() => rooms.sync('outsider', code)).toThrow('session ended');
  });
  it('rejects a distant seat request and bounds movement speed', () => {
    expect(() => rooms.action('a', code, 'sit', 0)).toThrow('closer');
    const p = rooms.sync('a', code, { ...pose, x: 10, z: -7 }).players[0];
    expect(Math.hypot(p.x + 2, p.z - 5)).toBeLessThanOrEqual(.151);
  });
  it('keeps the deck and dealer hole card secret while players share a round', () => {
    const seated = twoPlayers(); const s = rooms.action('a', code, 'deal', seated.table.revision);
    expect(s.table.phase).toBe('playing'); expect(s.table.hands).toHaveLength(2);
    expect(s.table.dealer[1]).toBe(0); expect(s.table).not.toHaveProperty('deck');
    expect(rooms.sync('b', code).table).toEqual(s.table);
  });
  it('rejects out-of-turn and repeated actions without drawing more cards', () => {
    const seated = twoPlayers(), s = rooms.action('a', code, 'deal', seated.table.revision);
    expect(s.table.turn).toBe('a');
    expect(() => rooms.action('b', code, 'hit', s.table.revision)).toThrow("isn't your turn");
    const next = rooms.action('a', code, 'stand', s.table.revision);
    expect(next.table.turn).toBe('b');
    expect(() => rooms.action('a', code, 'stand', s.table.revision)).toThrow('changed');
    expect(rooms.sync('b', code).table.revision).toBe(next.table.revision);
  });
  it('resolves both players against the same dealer and then permits another hand', () => {
    const seated = twoPlayers(); let s = rooms.action('a', code, 'deal', seated.table.revision);
    while (s.table.turn) s = rooms.action(s.table.turn, code, 'stand', s.table.revision);
    expect(s.table.phase).toBe('resolved'); expect(s.table.dealer).not.toContain(0);
    expect(s.table.hands.every(h => h.result)).toBe(true);
    expect(rooms.action('a', code, 'deal', s.table.revision).table.hands).toHaveLength(2);
  });
  it('auto-stands a timed-out turn while connected players remain', () => {
    const seated = twoPlayers(); rooms.action('a', code, 'deal', seated.table.revision);
    for (let i = 0; i < 3; i++) { now += 9000; rooms.sync('a', code); rooms.sync('b', code); }
    expect(rooms.sync('b', code).table.turn).toBe('b');
  });
  it('advances after a player leaves and expires disconnected empty rooms', () => {
    const seated = twoPlayers(); rooms.action('a', code, 'deal', seated.table.revision);
    rooms.leave('a', code); expect(rooms.sync('b', code).table.turn).toBe('b');
    now += 16000; expect(() => rooms.sync('b', code)).toThrow('session ended');
    expect(() => rooms.join('c', 'Carol', code, look)).toThrow('not found');
  });
  it('rejects joining the table in the middle of a hand', () => {
    const s = seat('a'); rooms.join('b', 'Bob', code, look); approach('b');
    const game = rooms.action('a', code, 'deal', s.table.revision);
    expect(() => rooms.action('b', code, 'sit', game.table.revision)).toThrow('finish');
  });
  it('rejoining is idempotent and does not clear a seat', () => {
    seat('a'); expect(rooms.join('a', 'Alice', code, look).players[0].seated).toBe(true);
  });
  it('protects the HTTP endpoints and validates coordinates and customization', async () => {
    expect((await request(app).post('/multiplayer/join').send({ look })).status).toBe(401);
    const token = signToken({ sub: 'practice-test', username: 'Test' });
    const join = await request(app).post('/multiplayer/join').auth(token, { type: 'bearer' }).send({ look });
    expect(join.status).toBe(200);
    const bad = await request(app).post('/multiplayer/sync').auth(token, { type: 'bearer' }).send({ code: join.body.code, pose: { ...pose, x: 99999 } });
    expect(bad.status).toBe(400);
    const badLook = await request(app).post('/multiplayer/join').auth(token, { type: 'bearer' }).send({ look: { ...look, shirt: 'url(evil)' } });
    expect(badLook.status).toBe(400);
    await request(app).post('/multiplayer/leave').auth(token, { type: 'bearer' }).send({ code: join.body.code });
  });
});
