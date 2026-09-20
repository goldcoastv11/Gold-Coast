import { describe, expect, it } from 'vitest';
import { GAMES, STATIONS, nearestStation, requestedArcadeGame } from './catalog';
import { RoomService } from '../../server/src/multiplayer/room';

describe('mobile game entry', () => {
  it('only permits known embedded game destinations', () => {
    expect(requestedArcadeGame('?game=slots')).toBeUndefined();
    expect(requestedArcadeGame('?mobileGame=1&game=https://evil.test')).toBeUndefined();
    for (const game of GAMES) expect(requestedArcadeGame(`?mobileGame=1&game=${game.id}`)?.scene).toBe(game.scene);
  });
  it('finds the nearest reachable table without offering distant interactions', () => {
    expect(nearestStation(0, -7)).toBeUndefined();
    for (const station of STATIONS) expect(nearestStation(station.x, station.z + 2.2)?.id).toBe(station.id);
  });
  it('plays a complete offline hand using the same practice rules without accounts or coins', () => {
    const rooms = new RoomService(() => 1000, max => max - 1);
    let state = rooms.join('local', 'You', undefined, { shirt: '#27c6b5', skin: '#c68b60', hair: '#302922' });
    state = rooms.action('local', state.code, 'sit', 0, 'coast', true);
    state = rooms.action('local', state.code, 'deal', state.table.revision);
    while (state.table.turn) state = rooms.action('local', state.code, 'stand', state.table.revision);
    expect(state.table.phase).toBe('resolved'); expect(state.table.hands[0].result).toBeTruthy();
    expect(state).not.toHaveProperty('goldCoins');
    state = rooms.action('local', state.code, 'leave', state.table.revision);
    expect(state.players[0].seated).toBe(false);
  });
});
