import { describe, expect, it } from 'vitest';
import {
  cloneSnapshot,
  nextRestartSequence,
  nextTransitionSequence,
  readSnapshot,
} from '../../../src/client/state.ts';

describe('readSnapshot', () => {
  it('normalizes the canonical room projection', () => {
    const snapshot = readSnapshot({
      phase: 'playing',
      tick: 42,
      levelId: 'level_4',
      levelNumber: 4,
      levelCount: 4,
      levelName: 'Crossed Circuits',
      objective: 'Recover both cards and complete the security handshake.',
      doorOpen: true,
      nearPlatePressed: true,
      farPlatePressed: false,
      completedAtTick: -1,
      levelEpoch: 3,
      reconnectRemainingSeconds: 0,
      collectedKeycardIds: ['keycard_alpha'],
      latchedGateIds: ['gate_main'],
      pressurePlates: [{ id: 'plate_a', occupied: true }],
      teleporters: [{
        id: 'teleporter_alpha',
        powered: true,
        powerId: 'teleporter_alpha_power',
        padIds: ['teleporter_alpha_home', 'teleporter_alpha_annex'],
      }],
      keycards: [{ id: 'keycard_alpha', collected: true }],
      relayButtons: [{ id: 'gate_button_a', occupiedBy: 'player-1' }],
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
      levelId: 'level_4',
      levelNumber: 4,
      levelCount: 4,
      levelName: 'Crossed Circuits',
      doorOpen: true,
      nearPlatePressed: true,
      completedAtTick: null,
      levelEpoch: 3,
    });
    expect(snapshot.collectedKeycardIds).toEqual(['keycard_alpha']);
    expect(snapshot.latchedGateIds).toEqual(['gate_main']);
    expect(snapshot.pressurePlates).toEqual([{ id: 'plate_a', occupied: true }]);
    expect(snapshot.teleporters[0]).toEqual({
      id: 'teleporter_alpha',
      powered: true,
      powerId: 'teleporter_alpha_power',
      padIds: ['teleporter_alpha_home', 'teleporter_alpha_annex'],
    });
    expect(snapshot.keycards).toEqual([{ id: 'keycard_alpha', collected: true }]);
    expect(snapshot.relayButtons).toEqual([{ id: 'gate_button_a', occupiedBy: 'player-1' }]);
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

  it('normalizes schema-like mechanism collections and empty relay occupancy', () => {
    const collection = (values: unknown[]) => ({
      forEach(callback: (value: unknown) => void) {
        values.forEach(callback);
      },
    });
    const snapshot = readSnapshot({
      levelId: 'level_3',
      levelNumber: 3,
      collectedKeycardIds: collection(['keycard_alpha']),
      latchedGateIds: collection([]),
      teleporters: collection([{
        id: 'teleporter_alpha',
        powered: false,
        powerId: 'teleporter_alpha_power',
        padIds: collection(['teleporter_alpha_home', 'teleporter_alpha_annex']),
      }]),
      relayButtons: collection([
        { id: 'gate_button_a', occupiedBy: '' },
        { id: 'gate_button_b', occupiedBy: 'player-2' },
      ]),
    });

    expect(snapshot.levelId).toBe('level_3');
    expect(snapshot.collectedKeycardIds).toEqual(['keycard_alpha']);
    expect(snapshot.teleporters[0]?.padIds).toEqual([
      'teleporter_alpha_home',
      'teleporter_alpha_annex',
    ]);
    expect(snapshot.relayButtons).toEqual([
      { id: 'gate_button_a', occupiedBy: null },
      { id: 'gate_button_b', occupiedBy: 'player-2' },
    ]);
  });

  it('deep-clones collection state for notification-safe local rendering', () => {
    const original = readSnapshot({
      collectedKeycardIds: ['keycard_alpha'],
      teleporters: [{
        id: 'teleporter_alpha',
        powered: true,
        padIds: ['teleporter_alpha_home', 'teleporter_alpha_annex'],
      }],
    });
    const copy = cloneSnapshot(original);

    copy.collectedKeycardIds.length = 0;
    copy.teleporters[0]?.padIds.splice(0);

    expect(original.collectedKeycardIds).toEqual(['keycard_alpha']);
    expect(original.teleporters[0]?.padIds).toEqual([
      'teleporter_alpha_home',
      'teleporter_alpha_annex',
    ]);
  });
});

describe('nextRestartSequence', () => {
  it('derives the next command only from the authoritative level epoch', () => {
    expect(nextRestartSequence(0, 0)).toBe(1);
    expect(nextRestartSequence(0, 1)).toBe(2);
    expect(nextRestartSequence(4, 2)).toBe(3);
    expect(nextTransitionSequence(4, 5)).toBe(6);
    expect(nextTransitionSequence(2_147_483_647, 5)).toBe(6);
  });
});
