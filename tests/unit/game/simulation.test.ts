import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE,
  FIXED_STEP_SECONDS,
  LEVEL_ONE,
  RECONNECT_GRACE_SECONDS,
  SIMULATION_HZ,
  applyMoveTarget,
  createGameState,
  gridToWorld,
  projectNetworkState,
  restartGame,
  setPlayerConnected,
  stepGame,
} from '../../../src/game/index.ts';
import type { GameState, PlayerState, WorldPoint } from '../../../src/game/index.ts';

const point = (x: number, y: number): WorldPoint => gridToWorld({ x, y });

function place(state: GameState, index: 0 | 1, position: WorldPoint, route: WorldPoint[] = []): GameState {
  const player: PlayerState = { ...state.players[index], position, route, routeKind: route.length === 0 ? 'none' : 'target' };
  return {
    ...state,
    players: index === 0 ? [player, state.players[1]] : [state.players[0], player],
  };
}

describe('authoritative fixed-step simulation', () => {
  it('rejects non-walkable clicks and ignores stale command sequences', () => {
    const state = createGameState(['one', 'two']);
    const [wallState, wallResult] = applyMoveTarget(state, 'one', { seq: 1, worldX: 24, worldY: 24 });
    expect(wallResult).toMatchObject({ accepted: false, reason: 'invalid-target' });
    expect(wallState).toBe(state);

    const [moved, accepted] = applyMoveTarget(state, 'one', { seq: 2, worldX: point(4, 5).x, worldY: point(4, 5).y });
    expect(accepted.accepted).toBe(true);
    const [stale, staleResult] = applyMoveTarget(moved, 'one', { seq: 2, worldX: point(4, 6).x, worldY: point(4, 6).y });
    expect(stale).toBe(moved);
    expect(staleResult).toMatchObject({ accepted: false, reason: 'stale-seq' });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    'rejects invalid move and restart sequence %s without poisoning later commands',
    (seq) => {
      const state = createGameState(['one', 'two']);
      const [invalidMove, moveResult] = applyMoveTarget(state, 'one', {
        seq,
        worldX: point(4, 5).x,
        worldY: point(4, 5).y,
      });
      expect(invalidMove).toBe(state);
      expect(moveResult).toMatchObject({ accepted: false, reason: 'invalid-seq' });

      const [validMove, validResult] = applyMoveTarget(state, 'one', {
        seq: 0,
        worldX: point(4, 5).x,
        worldY: point(4, 5).y,
      });
      expect(validResult.accepted).toBe(true);
      expect(validMove.players[0].lastMoveSeq).toBe(0);

      const [invalidRestart, event] = restartGame(state, { seq });
      expect(invalidRestart).toBe(state);
      expect(event).toBeNull();
    },
  );

  it('uses a current-side threshold and never auto-resumes a closed-door route', () => {
    const state = createGameState(['one', 'two']);
    const [routed, result] = applyMoveTarget(state, 'one', { seq: 1, worldX: point(14, 6).x, worldY: point(14, 6).y });
    expect(result).toEqual({ accepted: true, routeKind: 'threshold-stop' });
    let progressed = routed;
    for (let i = 0; i < 80; i += 1) progressed = stepGame(progressed);
    expect(progressed.players[0].position).toEqual(point(10, 6));
    expect(progressed.players[0].routeKind).toBe('none');
    expect(progressed.players[0].position.x).toBeLessThan(point(11, 6).x);
  });

  it('permits a crossing already entered while open after the plates release', () => {
    let state = createGameState(['one', 'two']);
    state = place(state, 0, point(10, 6));
    state = place(state, 1, point(8, 6));
    state = { ...state, doorOpen: true };
    [state] = applyMoveTarget(state, 'one', { seq: 1, worldX: point(12, 6).x, worldY: point(12, 6).y });
    for (let i = 0; i < 4; i += 1) state = stepGame(state);
    expect(state.players[0].crossingPermit).toBe(true);
    state = place(state, 1, point(3, 7));
    for (let i = 0; i < 8; i += 1) state = stepGame(state);
    expect(state.doorOpen).toBe(false);
    expect(state.players[0].position.x).toBeGreaterThanOrEqual(12 * CELL_SIZE);
    expect(state.players[0].crossingPermit).toBe(false);
  });

  it('turns a pre-entry route into a threshold stop when the door closes', () => {
    let state = createGameState(['one', 'two']);
    state = place(state, 0, point(10, 6));
    state = place(state, 1, point(8, 6));
    state = { ...state, doorOpen: true };
    [state] = applyMoveTarget(state, 'one', { seq: 1, worldX: point(12, 6).x, worldY: point(12, 6).y });
    state = stepGame(state);
    state = place(state, 1, point(3, 7));
    state = stepGame(state);
    expect(state.players[0].routeKind).toBe('threshold-stop');
    expect(state.players[0].crossingPermit).toBe(false);
    for (let i = 0; i < 10; i += 1) state = stepGame(state);
    expect(state.players[0].position).toEqual(point(10, 6));
  });

  it('opens the door from either plate and lets players overlap', () => {
    let state = createGameState(['one', 'two']);
    state = place(state, 0, point(8, 6));
    state = stepGame(state);
    expect(state.doorOpen).toBe(true);
    state = place(state, 0, point(14, 6));
    state = stepGame(state);
    expect(state.doorOpen).toBe(true);

    const overlap = point(4, 7);
    state = place(state, 0, overlap, [point(4, 8)]);
    state = place(state, 1, overlap, [point(4, 8)]);
    state = stepGame(state);
    expect(state.players[0].position).toEqual(state.players[1].position);
  });

  it('accepts exact safe targets, clamps edge clicks to the nearest safe point, and rejects doorway stops', () => {
    const state = createGameState(['one', 'two']);
    const exact = point(4, 5);
    const [exactState, exactResult] = applyMoveTarget(state, 'one', { seq: 1, worldX: exact.x, worldY: exact.y });
    expect(exactResult.accepted).toBe(true);
    expect(exactState.players[0].route.at(-1)).toEqual(exact);
    const [clamped] = applyMoveTarget(exactState, 'one', { seq: 2, worldX: 4 * CELL_SIZE + 1, worldY: 5 * CELL_SIZE + 1 });
    expect(clamped.players[0].route.at(-1)).toEqual({ x: 4 * CELL_SIZE + 14, y: 5 * CELL_SIZE + 14 });
    const [, doorway] = applyMoveTarget(clamped, 'one', { seq: 3, worldX: point(11, 6).x, worldY: point(11, 6).y });
    expect(doorway).toMatchObject({ accepted: false, reason: 'doorway-target' });
  });

  it('completes only when both player centers are in the exit on one tick', () => {
    let state = createGameState(['one', 'two']);
    state = place(state, 0, point(20, 6));
    state = stepGame(state);
    expect(state.phase).toBe('playing');
    state = place(state, 0, point(20, 6), [point(21, 6)]);
    state = place(state, 1, point(20, 5), [point(21, 5)]);
    state = stepGame(state);
    expect(state.phase).toBe('completed');
    expect(state.completedAtTick).toBe(2);
    expect(state.players.every(
      ({ route, routeKind }) => route.length === 0 && routeKind === 'none',
    )).toBe(true);
  });

  it('pauses movement during reconnect grace and deterministically restarts', () => {
    let state = createGameState(['one', 'two']);
    [state] = applyMoveTarget(state, 'one', { seq: 4, worldX: point(4, 5).x, worldY: point(4, 5).y });
    state = setPlayerConnected(state, 'two', false);
    expect(state.phase).toBe('reconnectGrace');
    const before = state.players[0].position;
    state = stepGame(state);
    expect(state.players[0].position).toEqual(before);
    expect(state.reconnectElapsedSeconds).toBe(FIXED_STEP_SECONDS);
    state = setPlayerConnected(state, 'two', true);
    expect(state.phase).toBe('playing');

    const [restarted, event] = restartGame(state, { seq: 1 });
    expect(event).toMatchObject({
      type: 'restarted',
      tick: 0,
      levelId: 'level_1',
      levelEpoch: 1,
    });
    expect(restarted.players[0].position).toEqual(point(3, 5));
    expect(restarted.players[0].lastMoveSeq).toBe(-1);
    expect(restarted.phase).toBe('playing');
    const [stale] = restartGame(restarted, { seq: 1 });
    expect(stale).toBe(restarted);
  });

  it('abandons a frozen reconnect grace state after its fixed timeout', () => {
    let state = setPlayerConnected(createGameState(['one', 'two']), 'two', false);
    state = stepGame(state);
    const elapsed = state.reconnectElapsedSeconds;
    const duplicate = setPlayerConnected(state, 'two', false);
    expect(duplicate).toBe(state);
    expect(duplicate.reconnectElapsedSeconds).toBe(elapsed);
    state = duplicate;
    for (let i = 0; i < RECONNECT_GRACE_SECONDS * SIMULATION_HZ - 1; i += 1) state = stepGame(state);
    expect(state.phase).toBe('abandoned');
  });

  it('preserves a completed round through reconnect grace without phantom connectivity', () => {
    let state = createGameState(['one', 'two']);
    state = place(state, 0, point(20, 6));
    state = place(state, 1, point(20, 5));
    state = stepGame(state);
    expect(state.phase).toBe('completed');

    state = setPlayerConnected(state, 'two', false);
    expect(state.phase).toBe('reconnectGrace');
    expect(state.resumePhase).toBe('completed');
    expect(state.players[1].connected).toBe(false);

    state = stepGame(state);
    expect(state.phase).toBe('reconnectGrace');
    state = setPlayerConnected(state, 'two', true);
    expect(state.phase).toBe('completed');
    expect(state.resumePhase).toBeNull();
    expect(state.players[1].connected).toBe(true);
  });

  it('projects only network-safe authoritative fields', () => {
    const state = createGameState(['one', 'two']);
    const network = projectNetworkState(state);
    expect(network.players[0]).not.toHaveProperty('route');
    expect(network.players[0]).toMatchObject({ id: 'one', worldX: point(3, 5).x });
    expect(LEVEL_ONE.exitCells).toHaveLength(12);
    expect(Object.isFrozen(LEVEL_ONE)).toBe(true);
    expect('add' in LEVEL_ONE.walls).toBe(false);
  });
});
