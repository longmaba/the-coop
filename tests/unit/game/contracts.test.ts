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
    expect(inspection.dimensions).toEqual({ width: 24, height: 12 });
    expect(inspection.gate).toMatchObject({
      id: 'gate_main',
      open: false,
      unlocked: false,
      occupiedCells: [
        { grid: { x: 11, y: 5 }, world: { x: 552, y: 264 } },
        { grid: { x: 11, y: 6 }, world: { x: 552, y: 312 } },
      ],
    });
    expect(inspection.interactables.map(({ id, grid, world }) => ({ id, grid, world }))).toEqual([
      { id: 'plate_a', grid: { x: 8, y: 6 }, world: { x: 408, y: 312 } },
      { id: 'plate_b', grid: { x: 14, y: 6 }, world: { x: 696, y: 312 } },
      { id: 'exit_zone', grid: { x: 20, y: 6 }, world: { x: 984, y: 312 } },
    ]);
    expect(createLevelInspection(false)).toEqual(inspection);
    expect(inspection.walls[0]?.grid).toEqual({ x: 0, y: 0 });
  });

  it('resolves named and bounded grid targets', () => {
    expect(resolveInspectionTarget({ kind: 'interactable', id: 'plate_b' })).toEqual({
      interactableId: 'plate_b',
      grid: { x: 14, y: 6 },
      world: { x: 696, y: 312 },
    });
    expect(resolveInspectionTarget({ kind: 'grid', x: 3, y: 5 })).toEqual({
      grid: { x: 3, y: 5 },
      world: { x: 168, y: 264 },
    });
    expect(resolveInspectionTarget({ kind: 'grid', x: 24, y: 5 })).toBeNull();
    expect(resolveInspectionTarget({ kind: 'grid', x: 3.5, y: 5 })).toBeNull();
  });
});
