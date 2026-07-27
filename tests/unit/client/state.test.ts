import { describe, expect, it } from 'vitest';
import { nextRestartSequence, readSnapshot } from '../../../src/client/state.ts';

describe('readSnapshot', () => {
  it('normalizes the canonical room projection', () => {
    const snapshot = readSnapshot({
      phase: 'playing',
      tick: 42,
      doorOpen: true,
      nearPlatePressed: true,
      farPlatePressed: false,
      completedAtTick: -1,
      levelEpoch: 3,
      reconnectRemainingSeconds: 0,
      players: [
        {
          id: 'player-1',
          connected: true,
          worldX: 168,
          worldY: 264,
          routeKind: 'target',
          lastMoveSeq: 7,
        },
      ],
    });

    expect(snapshot).toMatchObject({
      phase: 'playing',
      tick: 42,
      doorOpen: true,
      nearPlatePressed: true,
      completedAtTick: null,
      levelEpoch: 3,
    });
    expect(snapshot.players).toEqual([
      {
        id: 'player-1',
        connected: true,
        worldX: 168,
        worldY: 264,
        routeKind: 'target',
        lastMoveSeq: 7,
      },
    ]);
  });

  it('bounds unknown data and supports an ArraySchema-like collection', () => {
    const players = {
      forEach(callback: (value: unknown) => void) {
        callback({ id: 'player-1', connected: true, routeKind: 'unexpected' });
        callback({ id: 'player-2', connected: false, routeKind: 'threshold-stop' });
        callback({ id: 'ignored-player', connected: true });
      },
    };

    const snapshot = readSnapshot({
      phase: '<script>',
      serverTick: 9,
      completedAtTick: 0,
      players,
    });

    expect(snapshot.phase).toBe('waitingForPlayers');
    expect(snapshot.tick).toBe(9);
    expect(snapshot.completedAtTick).toBe(0);
    expect(snapshot.players).toHaveLength(2);
    expect(snapshot.players[0]?.routeKind).toBe('none');
    expect(snapshot.players[1]?.routeKind).toBe('threshold-stop');
  });
});

describe('nextRestartSequence', () => {
  it('advances beyond a restart performed by the other client', () => {
    expect(nextRestartSequence(0, 0)).toBe(1);
    expect(nextRestartSequence(0, 1)).toBe(2);
    expect(nextRestartSequence(4, 2)).toBe(5);
  });
});
