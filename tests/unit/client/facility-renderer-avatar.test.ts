import { describe, expect, it } from 'vitest';
import type { RemotePlayer } from '../../../src/client/state.ts';
import { renderedAvatarIdForPlayer } from '../../../src/client/three/facility-renderer.ts';

const BASE_PLAYER = {
  id: 'player-1',
  connected: true,
  worldX: 0,
  worldY: 0,
  routeKind: 'none',
  lastMoveSeq: 0,
};

describe('renderedAvatarIdForPlayer', () => {
  it('uses the authoritative avatar id when it is valid', () => {
    const player = {
      ...BASE_PLAYER,
      id: 'player-2',
      avatarId: 'character-female-d',
    } as unknown as RemotePlayer;

    expect(renderedAvatarIdForPlayer(player)).toBe('character-female-d');
  });

  it('falls back deterministically by seat when the avatar is missing or invalid', () => {
    expect(renderedAvatarIdForPlayer(BASE_PLAYER as RemotePlayer)).toBe('character-female-a');

    const invalid = {
      ...BASE_PLAYER,
      id: 'player-2',
      avatarId: 'lion',
    } as unknown as RemotePlayer;

    expect(renderedAvatarIdForPlayer(invalid)).toBe('character-male-a');
  });
});
