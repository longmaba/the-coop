import { describe, expect, it } from 'vitest';
import {
  normalizeSeatPayload,
  TRANSITION_MESSAGES,
  usesHostedTransport,
} from '../../../src/client/network.ts';

describe('campaign transition protocol', () => {
  it('uses the authoritative replay and advancement message names', () => {
    expect(TRANSITION_MESSAGES).toEqual({
      replay: 'restartLevel',
      advance: 'nextLevel',
      replayed: 'levelRestarted',
      advanced: 'levelAdvanced',
    });
  });
});

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

describe('transport selection', () => {
  it('uses the Sites adapter only for the dedicated Sites build mode', () => {
    expect(usesHostedTransport('sites')).toBe(true);
    expect(usesHostedTransport('production')).toBe(false);
    expect(usesHostedTransport('development')).toBe(false);
  });
});
