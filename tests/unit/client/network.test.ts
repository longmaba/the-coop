import { describe, expect, it } from 'vitest';
import { normalizeSeatPayload } from '../../../src/client/network.ts';

describe('normalizeSeatPayload', () => {
  it('accepts canonical one-based slots and legacy zero-based seats', () => {
    expect(normalizeSeatPayload({ playerId: 'player-1', slot: 1 })).toEqual({
      playerId: 'player-1',
      seat: 0,
    });
    expect(normalizeSeatPayload({ playerId: 'player-2', seat: 1 })).toEqual({
      playerId: 'player-2',
      seat: 1,
    });
  });

  it.each([
    null,
    {},
    { playerId: '', slot: 1 },
    { playerId: 'player-1', slot: 0 },
    { playerId: 'player-1', slot: 3 },
    { playerId: 'player-1', slot: 1.5 },
    { playerId: 'player-1', seat: Number.NaN },
  ])('rejects malformed or out-of-range seat payloads: %j', (payload) => {
    expect(normalizeSeatPayload(payload)).toBeNull();
  });
});
