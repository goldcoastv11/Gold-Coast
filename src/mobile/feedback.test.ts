import { describe, expect, it } from 'vitest';
import { ResultTracker, resultTone } from './feedback';
describe('table outcome feedback', () => {
  it('distinguishes wins, naturals, losses, busts and pushes', () => {
    expect(['You win', 'Blackjack!', 'Dealer wins', 'Bust', 'Push', null].map(resultTone)).toEqual(['win', 'win', 'loss', 'loss', 'push', null]);
  });
  it('plays only once when a watched round resolves', () => {
    const tracker = new ResultTracker();
    tracker.observe({ key: 'room/palm', phase: 'playing', revision: 4, result: null });
    const resolved = { key: 'room/palm', phase: 'resolved', revision: 5, result: 'You win' };
    expect(tracker.observe(resolved)).toBe('win');
    expect(tracker.observe(resolved)).toBeNull();
    expect(tracker.observe({ ...resolved, revision: 6 })).toBeNull();
  });
  it('does not replay old results when entering a table or changing rooms', () => {
    const tracker = new ResultTracker();
    expect(tracker.observe({ key: 'one/palm', phase: 'resolved', revision: 8, result: 'You win' })).toBeNull();
    tracker.observe({ key: 'one/palm', phase: 'playing', revision: 9, result: null });
    expect(tracker.observe({ key: 'two/palm', phase: 'resolved', revision: 10, result: 'Bust' })).toBeNull();
  });
  it('handles instant blackjack resolution after a deal and cancels failed deals', () => {
    const tracker = new ResultTracker(); tracker.arm();
    expect(tracker.observe({ key: 'one/coast', phase: 'resolved', revision: 2, result: 'Blackjack!' })).toBe('win');
    tracker.arm(); tracker.cancel();
    expect(tracker.observe({ key: 'one/coast', phase: 'resolved', revision: 3, result: 'Push' })).toBeNull();
  });
});
