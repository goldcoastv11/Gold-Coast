import { describe, expect, it } from 'vitest';
import { GAMES, STATIONS, nearestStation, requestedArcadeGame, gameLaunchUrl } from './catalog';
import { RoomService, LOUNGE_BOUNDS } from '../../server/src/multiplayer/room';

describe('mobile game entry', () => {
  it('keeps direct Quickplay and lounge presentations distinct for every game', () => {
    for (const game of GAMES) {
      expect(gameLaunchUrl(game.id, true)).toContain('view=quickplay');
      expect(gameLaunchUrl(game.id, false)).toContain('view=lounge');
      expect(requestedArcadeGame(new URL(gameLaunchUrl(game.id, true), 'http://localhost').search)?.id).toBe(game.id);
    }
  });
  it('provides reachable lounge stations for all fourteen games', () => {
    expect(new Set(STATIONS.map(s => s.game))).toEqual(new Set(GAMES.map(g => g.id)));
    expect(new Set(STATIONS.map(s => s.id)).size).toBe(STATIONS.length);
    for (const s of STATIONS) {
      expect(s.x).toBeGreaterThanOrEqual(LOUNGE_BOUNDS.minX);
      expect(s.x).toBeLessThanOrEqual(LOUNGE_BOUNDS.maxX);
      expect(s.z + 2.2).toBeLessThanOrEqual(LOUNGE_BOUNDS.maxZ);
      expect(nearestStation(s.x, s.z + 2.2)?.id).toBe(s.id);
    }
  });
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
