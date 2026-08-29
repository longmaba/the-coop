import { describe, expect, it } from 'vitest';
import { COOPERATIVE_DISCOVERY_GOAL } from '../../../src/game/index.ts';
import type { CoopSnapshot } from '../../../src/client/state.ts';
import { resolveMcpMovementTarget } from '../../../src/mcp/server.ts';
import { createMcpDiscoveryView } from '../../../src/mcp/session.ts';

function levelTwoSnapshot(powered: boolean): CoopSnapshot {
  return {
    phase: 'playing',
    tick: 42,
    levelId: 'level_2',
    levelNumber: 2,
    levelCount: 4,
    levelName: 'Powered Transit',
    objective: 'Hold Alpha power while your partner uses the teleporter and collects Card Alpha to unlock gate_main.',
    doorOpen: false,
    nearPlatePressed: false,
    farPlatePressed: false,
    completedAtTick: null,
    levelEpoch: 3,
    reconnectRemainingSeconds: 0,
    collectedKeycardIds: [],
    latchedGateIds: [],
    pressurePlates: [],
    teleporters: [{
      id: 'teleporter_alpha',
      powered,
      powerId: 'teleporter_alpha_power',
      padIds: ['teleporter_alpha_home', 'teleporter_alpha_annex'],
    }],
    keycards: [{ id: 'keycard_alpha', collected: false }],
    relayButtons: [],
    players: [],
  };
}

function levelFourSnapshot(): CoopSnapshot {
  return {
    ...levelTwoSnapshot(false),
    levelId: 'level_4',
    levelNumber: 4,
    levelName: 'Crossed Circuits',
    objective: 'Chain Alpha and Beta to collect both cards, reunite, and occupy both gate buttons.',
    doorOpen: true,
    collectedKeycardIds: ['keycard_alpha', 'keycard_beta'],
    latchedGateIds: ['gate_main'],
    teleporters: [
      {
        id: 'teleporter_alpha',
        powered: true,
        powerId: 'teleporter_alpha_power',
        padIds: ['teleporter_alpha_home', 'teleporter_alpha_annex'],
      },
      {
        id: 'teleporter_beta',
        powered: false,
        powerId: 'teleporter_beta_power',
        padIds: ['teleporter_beta_home', 'teleporter_beta_annex'],
      },
    ],
    keycards: [
      { id: 'keycard_alpha', collected: true },
      { id: 'keycard_beta', collected: true },
    ],
    relayButtons: [
      { id: 'gate_button_a', occupiedBy: 'player-1' },
      { id: 'gate_button_b', occupiedBy: 'player-2' },
    ],
  };
}

describe('campaign-aware MCP inspection', () => {
  it('projects observable Level 4 state without authored solution metadata', () => {
    const inspection = createMcpDiscoveryView(levelFourSnapshot());

    expect(inspection.level).toEqual({
      id: 'level_4',
      number: 4,
      count: 4,
      name: 'Crossed Circuits',
    });
    expect(inspection.gate).toMatchObject({
      id: 'gate_main',
      open: true,
    });
    expect(inspection.gate).not.toHaveProperty('unlocked');
    expect(inspection.gate).not.toHaveProperty('rule');
    expect(inspection.objective).toEqual({
      summary: COOPERATIVE_DISCOVERY_GOAL,
      complete: false,
    });
    expect(inspection.interactables.map(({ id }) => id)).toEqual([
      'teleporter_alpha_power',
      'teleporter_alpha_home',
      'teleporter_alpha_annex',
      'teleporter_beta_power',
      'teleporter_beta_home',
      'teleporter_beta_annex',
      'keycard_alpha',
      'keycard_beta',
      'gate_button_a',
      'gate_button_b',
      'exit_zone',
    ]);
    expect(inspection.interactables.find(({ id }) => id === 'teleporter_alpha_home')).toMatchObject({
      active: true,
      grid: { x: 5, y: 5 },
      world: { x: 264, y: 264 },
    });
    expect(inspection.interactables.find(
      ({ id }) => id === 'teleporter_alpha_home',
    )).not.toHaveProperty('pairedWith');
    expect(inspection.interactables.find(({ id }) => id === 'teleporter_beta_annex')).toMatchObject({
      active: false,
      grid: { x: 13, y: 12 },
      world: { x: 648, y: 600 },
    });
    expect(inspection.interactables.find(({ id }) => id === 'keycard_beta')).toMatchObject({
      collected: true,
    });
    expect(inspection.interactables.find(({ id }) => id === 'gate_button_b')).toMatchObject({
      occupied: true,
      occupiedBy: 'player-2',
    });
    const serialized = JSON.stringify(inspection);
    expect(serialized).not.toContain(levelFourSnapshot().objective);
    expect(serialized).not.toContain('requiredKeycardIds');
    expect(serialized).not.toContain('requiredRelayButtonIds');
    expect(serialized).not.toContain('pairedWith');
    expect(createMcpDiscoveryView(levelFourSnapshot())).toEqual(inspection);
  });

  it('rejects named targets absent from the active level', () => {
    const snapshot = levelTwoSnapshot(false);
    expect(resolveMcpMovementTarget(snapshot, {
      kind: 'interactable',
      id: 'keycard_beta',
    })).toBeNull();
    expect(resolveMcpMovementTarget(snapshot, {
      kind: 'interactable',
      id: 'plate_a',
    })).toBeNull();
    expect(resolveMcpMovementTarget(snapshot, {
      kind: 'grid',
      x: 16,
      y: 6,
    })).toBeNull();
  });

  it('keeps both teleporter endpoints valid regardless of pre-command power', () => {
    const inactive = resolveMcpMovementTarget(levelTwoSnapshot(false), {
      kind: 'interactable',
      id: 'teleporter_alpha_home',
    });
    expect(inactive).toMatchObject({
      command: {
        interactableId: 'teleporter_alpha_home',
        grid: { x: 5, y: 5 },
      },
      validArrivals: [{ x: 5, y: 5 }, { x: 10, y: 5 }],
    });

    const powered = resolveMcpMovementTarget(levelTwoSnapshot(true), {
      kind: 'interactable',
      id: 'teleporter_alpha_home',
    });
    expect(powered).toMatchObject({
      command: {
        interactableId: 'teleporter_alpha_home',
        grid: { x: 5, y: 5 },
      },
      validArrivals: [{ x: 5, y: 5 }, { x: 10, y: 5 }],
    });
  });

  it('allows every active-level exit cell to settle the semantic exit target', () => {
    const snapshot: CoopSnapshot = {
      ...levelFourSnapshot(),
      teleporters: [],
      keycards: [],
    };

    expect(resolveMcpMovementTarget(snapshot, {
      kind: 'interactable',
      id: 'exit_zone',
    })).toMatchObject({
      command: { grid: { x: 13, y: 8 } },
      validArrivals: [
        { x: 12, y: 6 }, { x: 13, y: 6 }, { x: 14, y: 6 },
        { x: 12, y: 7 }, { x: 13, y: 7 }, { x: 14, y: 7 },
        { x: 12, y: 8 }, { x: 13, y: 8 }, { x: 14, y: 8 },
        { x: 12, y: 9 }, { x: 13, y: 9 }, { x: 14, y: 9 },
      ],
    });
  });
});
