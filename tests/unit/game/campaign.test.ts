import { describe, expect, it } from 'vitest';
import {
  LEVEL_CATALOG,
  LEVEL_FOUR,
  LEVEL_ONE,
  LEVEL_THREE,
  LEVEL_TWO,
  advanceToNextLevel,
  applyMoveTarget,
  createGameState,
  createLevelInspection,
  getLevelDefinition,
  gridToWorld,
  projectNetworkState,
  replayCurrentLevel,
  resolveInspectionTarget,
  stepGame,
  validateLevelCatalog,
  worldToGrid,
} from '../../../src/game/index.ts';
import type {
  GameState,
  GridPoint,
  LevelDefinition,
  PlayerState,
} from '../../../src/game/index.ts';

function place(state: GameState, index: 0 | 1, grid: GridPoint): GameState {
  const player: PlayerState = {
    ...state.players[index],
    position: gridToWorld(grid),
    route: [],
    routeKind: 'none',
  };
  return {
    ...state,
    players: index === 0
      ? [player, state.players[1]]
      : [state.players[0], player],
  };
}

function moveTo(
  initial: GameState,
  index: 0 | 1,
  target: GridPoint,
  seq: number,
): GameState {
  const id = initial.players[index].id;
  const world = gridToWorld(target);
  const [routed, result] = applyMoveTarget(initial, id, {
    seq,
    worldX: world.x,
    worldY: world.y,
  });
  let state = routed;
  expect(result.accepted).toBe(true);
  for (let tick = 0; tick < 600; tick += 1) {
    state = stepGame(state);
    if (state.players[index].routeKind === 'none') return state;
  }
  throw new Error(`${id} did not settle at ${target.x},${target.y}`);
}

function mechanismGrid(
  level: LevelDefinition,
  id: string,
): GridPoint {
  for (const teleporter of level.teleporters) {
    if (teleporter.power.id === id) return teleporter.power.grid;
    const pad = teleporter.pads.find((entry) => entry.id === id);
    if (pad !== undefined) return pad.grid;
  }
  const card = level.keycards.find((entry) => entry.id === id);
  if (card !== undefined) return card.grid;
  const relay = level.relayButtons.find((entry) => entry.id === id);
  if (relay !== undefined) return relay.grid;
  throw new Error(`Missing ${id} in ${level.id}`);
}

describe('frozen four-level catalog', () => {
  it('keeps Level 1 compatible and validates every fixed 16x16 definition', () => {
    expect(LEVEL_CATALOG.map(({ id, number }) => ({ id, number }))).toEqual([
      { id: 'level_1', number: 1 },
      { id: 'level_2', number: 2 },
      { id: 'level_3', number: 3 },
      { id: 'level_4', number: 4 },
    ]);
    expect(LEVEL_CATALOG.every(({ width, height }) => width === 16 && height === 16)).toBe(true);
    expect(LEVEL_CATALOG.every(Object.isFrozen)).toBe(true);
    expect(validateLevelCatalog()).toEqual([]);
    expect(getLevelDefinition('level_1')).toBe(LEVEL_ONE);
    expect(LEVEL_ONE.nearPlate).toEqual({ x: 5, y: 8 });
    expect(LEVEL_ONE.farPlate).toEqual({ x: 10, y: 8 });
    expect(LEVEL_ONE.exitCells).toHaveLength(12);
    expect(Object.isFrozen(LEVEL_FOUR.gateRule)).toBe(true);
    if (LEVEL_FOUR.gateRule.kind === 'keycards-and-relays') {
      expect(Object.isFrozen(LEVEL_FOUR.gateRule.requiredKeycardIds)).toBe(true);
      expect(Object.isFrozen(LEVEL_FOUR.gateRule.requiredRelayButtonIds)).toBe(true);
    }
  });

  it('contains the prescribed stable mechanism IDs at the intended cadence', () => {
    expect(LEVEL_TWO.teleporters[0]?.pads.map(({ id }) => id)).toEqual([
      'teleporter_alpha_home',
      'teleporter_alpha_annex',
    ]);
    expect(LEVEL_TWO.keycards.map(({ id }) => id)).toEqual(['keycard_alpha']);
    expect(LEVEL_THREE.relayButtons.map(({ id }) => id)).toEqual([
      'gate_button_a',
      'gate_button_b',
    ]);
    expect(LEVEL_FOUR.teleporters.map(({ id }) => id)).toEqual([
      'teleporter_alpha',
      'teleporter_beta',
    ]);
    expect(LEVEL_FOUR.keycards.map(({ id }) => id)).toEqual([
      'keycard_alpha',
      'keycard_beta',
    ]);
  });
});

describe('authoritative campaign mechanics', () => {
  it('powers a standing traveler, clears its route, and prevents portal bounce until departure', () => {
    let state = createGameState(['one', 'two'], true, 'level_2');
    state = place(state, 0, mechanismGrid(LEVEL_TWO, 'teleporter_alpha_power'));
    state = place(state, 1, mechanismGrid(LEVEL_TWO, 'teleporter_alpha_home'));
    state = stepGame(state);
    expect(worldToGrid(state.players[1].position, LEVEL_TWO)).toEqual(
      mechanismGrid(LEVEL_TWO, 'teleporter_alpha_annex'),
    );
    expect(state.players[1]).toMatchObject({
      route: [],
      routeKind: 'none',
      blockedTeleporterPadId: 'teleporter_alpha_annex',
    });

    state = stepGame(state);
    expect(worldToGrid(state.players[1].position, LEVEL_TWO)).toEqual(
      mechanismGrid(LEVEL_TWO, 'teleporter_alpha_annex'),
    );

    state = place(state, 1, { x: 11, y: 5 });
    state = stepGame(state);
    expect(state.players[1].blockedTeleporterPadId).toBeNull();
    state = place(state, 1, mechanismGrid(LEVEL_TWO, 'teleporter_alpha_annex'));
    state = stepGame(state);
    expect(worldToGrid(state.players[1].position, LEVEL_TWO)).toEqual(
      mechanismGrid(LEVEL_TWO, 'teleporter_alpha_home'),
    );
  });

  it('solves Powered Transit with routed movement and permanently latches Card Alpha', () => {
    let state = createGameState(['one', 'two'], true, 'level_2');
    state = moveTo(state, 0, mechanismGrid(LEVEL_TWO, 'teleporter_alpha_power'), 0);
    state = moveTo(state, 1, mechanismGrid(LEVEL_TWO, 'teleporter_alpha_home'), 0);
    expect(worldToGrid(state.players[1].position, LEVEL_TWO)).toEqual(
      mechanismGrid(LEVEL_TWO, 'teleporter_alpha_annex'),
    );
    state = moveTo(state, 1, mechanismGrid(LEVEL_TWO, 'keycard_alpha'), 1);
    expect(state.collectedKeycardIds).toEqual(['keycard_alpha']);
    expect(state.latchedGateIds).toEqual(['gate_main']);
    expect(state.doorOpen).toBe(true);

    state = place(state, 1, { x: 11, y: 3 });
    state = stepGame(state);
    expect(state.collectedKeycardIds).toEqual(['keycard_alpha']);
    expect(state.doorOpen).toBe(true);
  });

  it('solves Security Handshake only after the card return and two-player relay occupancy', () => {
    let state = createGameState(['one', 'two'], true, 'level_3');
    state = moveTo(state, 0, mechanismGrid(LEVEL_THREE, 'teleporter_alpha_power'), 0);
    state = moveTo(state, 1, mechanismGrid(LEVEL_THREE, 'teleporter_alpha_home'), 0);
    state = moveTo(state, 1, mechanismGrid(LEVEL_THREE, 'keycard_alpha'), 1);
    state = moveTo(state, 1, mechanismGrid(LEVEL_THREE, 'teleporter_alpha_annex'), 2);
    expect(worldToGrid(state.players[1].position, LEVEL_THREE)).toEqual(
      mechanismGrid(LEVEL_THREE, 'teleporter_alpha_home'),
    );
    expect(state.doorOpen).toBe(false);

    state = moveTo(state, 0, mechanismGrid(LEVEL_THREE, 'gate_button_a'), 1);
    expect(state.doorOpen).toBe(false);
    state = moveTo(state, 1, mechanismGrid(LEVEL_THREE, 'gate_button_b'), 3);
    expect(state.latchedGateIds).toEqual(['gate_main']);
    expect(state.doorOpen).toBe(true);

    state = place(state, 0, { x: 4, y: 5 });
    state = place(state, 1, { x: 4, y: 7 });
    state = stepGame(state);
    expect(state.doorOpen).toBe(true);
  });

  it('solves Crossed Circuits through Alpha, Beta, both cards, and both relays', () => {
    let state = createGameState(['one', 'two'], true, 'level_4');
    state = moveTo(state, 0, mechanismGrid(LEVEL_FOUR, 'teleporter_alpha_power'), 0);
    state = moveTo(state, 1, mechanismGrid(LEVEL_FOUR, 'teleporter_alpha_home'), 0);
    state = moveTo(state, 1, mechanismGrid(LEVEL_FOUR, 'keycard_alpha'), 1);
    state = moveTo(state, 1, mechanismGrid(LEVEL_FOUR, 'teleporter_beta_power'), 2);
    state = moveTo(state, 0, mechanismGrid(LEVEL_FOUR, 'teleporter_beta_home'), 1);
    state = moveTo(state, 0, mechanismGrid(LEVEL_FOUR, 'keycard_beta'), 2);
    state = moveTo(state, 0, mechanismGrid(LEVEL_FOUR, 'teleporter_beta_annex'), 3);
    state = moveTo(state, 0, mechanismGrid(LEVEL_FOUR, 'teleporter_alpha_power'), 4);
    state = moveTo(state, 1, mechanismGrid(LEVEL_FOUR, 'teleporter_alpha_annex'), 3);
    expect(state.collectedKeycardIds).toEqual(['keycard_alpha', 'keycard_beta']);
    expect(state.doorOpen).toBe(false);

    state = moveTo(state, 0, mechanismGrid(LEVEL_FOUR, 'gate_button_a'), 5);
    state = moveTo(state, 1, mechanismGrid(LEVEL_FOUR, 'gate_button_b'), 4);
    expect(state.latchedGateIds).toEqual(['gate_main']);
    expect(state.doorOpen).toBe(true);
  });
});

describe('campaign transitions and inspection', () => {
  it('replays deterministically, advances only completed levels, and wraps Level 4', () => {
    let state = createGameState(['one', 'two'], true, 'level_4');
    const [rejected, noEvent] = advanceToNextLevel(state, { seq: 0 });
    expect(rejected).toBe(state);
    expect(noEvent).toBeNull();

    state = {
      ...state,
      phase: 'completed',
      completedAtTick: 12,
      collectedKeycardIds: ['keycard_alpha', 'keycard_beta'],
      latchedGateIds: ['gate_main'],
      doorOpen: true,
    };
    const [poisoned, poisonEvent] = advanceToNextLevel(state, {
      seq: 2_147_483_647,
    });
    expect(poisoned).toBe(state);
    expect(poisonEvent).toBeNull();

    const [advanced, event] = advanceToNextLevel(state, { seq: 1 });
    expect(event).toEqual({
      type: 'advanced',
      tick: 0,
      levelId: 'level_1',
      levelEpoch: 1,
    });
    expect(advanced).toMatchObject({
      levelId: 'level_1',
      levelEpoch: 1,
      phase: 'playing',
      collectedKeycardIds: [],
      latchedGateIds: [],
      doorOpen: false,
      completedAtTick: null,
    });
    expect(advanced.players.every(({ lastMoveSeq }) => lastMoveSeq === -1)).toBe(true);

    const levelTwo = createGameState(['one', 'two'], true, 'level_2');
    const [replayed, replayEvent] = replayCurrentLevel(levelTwo, { seq: 1 });
    expect(replayEvent).toMatchObject({
      type: 'restarted',
      levelId: 'level_2',
      levelEpoch: 1,
    });
    expect(replayed.players[0].position).toEqual(
      gridToWorld(LEVEL_TWO.playerSpawns[0]),
    );
  });

  it('projects active mechanisms and resolves only targets present in the active level', () => {
    let state = createGameState(['one', 'two'], true, 'level_4');
    state = place(state, 1, mechanismGrid(LEVEL_FOUR, 'teleporter_beta_power'));
    state = {
      ...state,
      collectedKeycardIds: ['keycard_alpha'],
    };
    const network = projectNetworkState(state);
    const inspection = createLevelInspection(network);
    expect(inspection.level).toMatchObject({
      id: 'level_4',
      number: 4,
      count: 4,
      name: 'Crossed Circuits',
    });
    expect(inspection.gate.rule).toMatchObject({
      kind: 'keycards-and-relays',
      requiredKeycardIds: ['keycard_alpha', 'keycard_beta'],
    });
    expect(inspection.interactables.find(
      ({ id }) => id === 'teleporter_beta_home',
    )).toMatchObject({
      active: true,
      pairedWith: 'teleporter_beta_annex',
    });
    expect(inspection.interactables.find(
      ({ id }) => id === 'keycard_alpha',
    )).toMatchObject({ collected: true });

    expect(resolveInspectionTarget(
      { kind: 'interactable', id: 'teleporter_beta_annex' },
      'level_4',
    )?.grid).toEqual(mechanismGrid(LEVEL_FOUR, 'teleporter_beta_annex'));
    expect(resolveInspectionTarget(
      { kind: 'interactable', id: 'teleporter_beta_annex' },
      'level_2',
    )).toBeNull();
  });
});
