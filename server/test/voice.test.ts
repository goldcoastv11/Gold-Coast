import { describe, expect, it } from 'vitest';
import { RoomService } from '../src/multiplayer/room';

const look = { shirt: '#27c6b5', skin: '#c68b60', hair: '#302922' };

describe('room voice signaling', () => {
  it('only routes WebRTC signals between voice members in the same room', () => {
    const rooms = new RoomService(() => 1_000, () => 1);
    const first = rooms.join('a', 'Ava', undefined, look);
    rooms.join('b', 'Ben', first.code, look);

    expect(rooms.voiceJoin('a', first.code).members).toEqual([{ id: 'a', name: 'Ava' }]);
    expect(rooms.voiceJoin('b', first.code).members).toEqual([{ id: 'a', name: 'Ava' }, { id: 'b', name: 'Ben' }]);

    rooms.voiceSignal('b', first.code, 'a', 'offer', { type: 'offer', sdp: 'test-offer' });
    expect(rooms.voicePoll('a', first.code).signals).toMatchObject([{ from: 'b', fromName: 'Ben', kind: 'offer', payload: { type: 'offer', sdp: 'test-offer' } }]);
    expect(rooms.voicePoll('a', first.code).signals).toEqual([]);

    rooms.voiceLeave('b', first.code);
    expect(rooms.voicePoll('a', first.code)).toMatchObject({ members: [{ id: 'a', name: 'Ava' }], signals: [{ from: 'b', kind: 'left' }] });
  });

  it('rejects signaling to a player who did not join voice', () => {
    const rooms = new RoomService(() => 1_000, () => 2);
    const first = rooms.join('a', 'Ava', undefined, look);
    rooms.join('b', 'Ben', first.code, look);
    rooms.voiceJoin('a', first.code);
    expect(() => rooms.voiceSignal('a', first.code, 'b', 'offer', { type: 'offer', sdp: 'x' })).toThrow('no longer in voice chat');
  });
});

