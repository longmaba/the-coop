import { describe, expect, it } from 'vitest';
import {
  createLevelInspection,
  parseJoinOptions,
  resolveInspectionTarget,
} from '../../../src/game/index.ts';

describe('shared room join contracts', () => {
  it('preserves empty human-human joins and accepts only role-bound human-AI joins', () => {
    expect(parseJoinOptions({})).toEqual({
      roomMode: 'human-human',
      controllerKind: 'human',
    });
    expect(parseJoinOptions({
      roomMode: 'human-ai',
      controllerKind: 'mcp',
      playerId: 'player-2',
      pairingTokenHash: 'a'.repeat(64),
      pairingExpiresAt: 123,
    })).not.toBeNull();
    expect(parseJoinOptions({
      roomMode: 'human-ai',
      controllerKind: 'human',
      playerId: 'player-1',
      pairingToken: 'a'.repeat(43),
    })).not.toBeNull();

    expect(parseJoinOptions({
      roomMode: 'human-ai',
      controllerKind: 'mcp',
      playerId: 'player-1',
      pairingTokenHash: 'a'.repeat(64),
      pairingExpiresAt: 123,
    })).toBeNull();
    expect(parseJoinOptions({
      roomMode: 'human-ai',
      controllerKind: 'human',
      playerId: 'player-2',
      pairingToken: 'a'.repeat(43),
    })).toBeNull();
    expect(parseJoinOptions({
      roomMode: 'human-ai',
      controllerKind: 'human',
      playerId: 'player-1',
      pairingToken: 'a'.repeat(43),
      forged: true,
    })).toBeNull();
  });
});

describe('deterministic level inspection', () => {
  it('projects canonical geometry in top-left grid and world coordinates', () => {
    const inspection = createLevelInspection(false);
    expect(inspection.coordinateSystem).toEqual({
      origin: 'top-left',
      xIncreases: 'right',
      yIncreases: 'down',
      gridUnits: 'cells',
      worldUnits: 'pixels',
    });
    expect(inspection.dimensions).toEqual({ width: 16, height: 16 });
    expect(inspection.gate).toMatchObject({
      id: 'gate_main',
      open: false,
      unlocked: false,
      occupiedCells: [
        { grid: { x: 7, y: 7 }, world: { x: 360, y: 360 } },
        { grid: { x: 7, y: 8 }, world: { x: 360, y: 408 } },
      ],
    });
    expect(inspection.interactables.map(({ id, grid, world }) => ({ id, grid, world }))).toEqual([
      { id: 'plate_a', grid: { x: 5, y: 8 }, world: { x: 264, y: 408 } },
      { id: 'plate_b', grid: { x: 10, y: 8 }, world: { x: 504, y: 408 } },
      { id: 'exit_zone', grid: { x: 13, y: 8 }, world: { x: 648, y: 408 } },
    ]);
    expect(createLevelInspection(false)).toEqual(inspection);
    expect(inspection.walls[0]?.grid).toEqual({ x: 0, y: 0 });
  });

  it('resolves named and bounded grid targets', () => {
    expect(resolveInspectionTarget({ kind: 'interactable', id: 'plate_b' })).toEqual({
      interactableId: 'plate_b',
      grid: { x: 10, y: 8 },
      world: { x: 504, y: 408 },
    });
    expect(resolveInspectionTarget({ kind: 'grid', x: 3, y: 5 })).toEqual({
      grid: { x: 3, y: 5 },
      world: { x: 168, y: 264 },
    });
    expect(resolveInspectionTarget({ kind: 'grid', x: 16, y: 5 })).toBeNull();
    expect(resolveInspectionTarget({ kind: 'grid', x: 3.5, y: 5 })).toBeNull();
  });
});
