import { FIXED_STEP_SECONDS, PLAYER_SPEED, RECONNECT_GRACE_SECONDS } from './constants.ts';
import {
  LEVEL_ONE,
  gridToWorld,
  isDoorCell,
  isExitPosition,
  isStaticWalkable,
  nearestSafePoint,
  plateIsPressed,
  sideFor,
  worldToGrid,
} from './level.ts';
import { findPath } from './pathfinding.ts';
import type {
  GameState,
  MoveCommandResult,
  MoveTargetCommand,
  NetworkGameState,
  NetworkPlayerState,
  PlayerState,
  RestartCommand,
  RestartEvent,
  WorldPoint,
} from './types.ts';

const clonePoint = (point: WorldPoint): WorldPoint => ({ x: point.x, y: point.y });

function initialPlayer(id: string, spawnIndex: 0 | 1, connected: boolean): PlayerState {
  const spawn = gridToWorld(LEVEL_ONE.playerSpawns[spawnIndex]);
  return {
    id,
    connected,
    spawn,
    position: clonePoint(spawn),
    lastMoveSeq: -1,
    route: [],
    routeKind: 'none',
    crossingPermit: false,
  };
}

function bothConnected(state: GameState): boolean {
  return state.players[0].connected && state.players[1].connected;
}

function copyPlayer(player: PlayerState, changes: Partial<PlayerState>): PlayerState {
  return { ...player, ...changes };
}

function replacePlayer(state: GameState, index: 0 | 1, player: PlayerState): GameState {
  const players: [PlayerState, PlayerState] = index === 0
    ? [player, state.players[1]]
    : [state.players[0], player];
  return { ...state, players };
}

export function createGameState(playerIds: readonly [string, string], connected = true): GameState {
  if (playerIds[0] === playerIds[1]) throw new Error('Two distinct player ids are required.');
  const players: [PlayerState, PlayerState] = [
    initialPlayer(playerIds[0], 0, connected),
    initialPlayer(playerIds[1], 1, connected),
  ];
  return {
    phase: connected ? 'playing' : 'waitingForPlayers',
    resumePhase: null,
    tick: 0,
    elapsedSeconds: 0,
    reconnectElapsedSeconds: 0,
    players,
    doorOpen: false,
    completedAtTick: null,
    restartSeq: -1,
  };
}

function routeFromGridPath(path: readonly { x: number; y: number }[], exactTarget: WorldPoint): WorldPoint[] {
  const route = path.slice(1).map(gridToWorld);
  if (route.length === 0) return [exactTarget];
  route[route.length - 1] = exactTarget;
  return route;
}

function thresholdRoute(player: PlayerState): WorldPoint[] {
  const current = worldToGrid(player.position);
  if (current === null) return [];
  const threshold = sideFor(current) === 'right' ? LEVEL_ONE.rightThreshold : LEVEL_ONE.leftThreshold;
  const path = findPath(current, threshold, false);
  return path === null ? [] : routeFromGridPath(path, gridToWorld(threshold));
}

function targetRoute(player: PlayerState, target: WorldPoint, doorOpen: boolean): WorldPoint[] | null {
  const start = worldToGrid(player.position);
  const targetCell = worldToGrid(target);
  if (start === null || targetCell === null) return null;
  // A permit only exists while leaving the passage and lets that player finish it.
  const path = findPath(start, targetCell, doorOpen || player.crossingPermit);
  return path === null ? null : routeFromGridPath(path, target);
}

/** Applies a client click as a server-owned route, never a direct displacement. */
export function applyMoveTarget(state: GameState, playerId: string, command: MoveTargetCommand): [GameState, MoveCommandResult] {
  const index = state.players[0].id === playerId ? 0 : state.players[1].id === playerId ? 1 : null;
  if (index === null) return [state, { accepted: false, reason: 'invalid-target', routeKind: 'none' }];
  const player = state.players[index];
  if (!Number.isSafeInteger(command.seq) || command.seq < 0) {
    return [state, { accepted: false, reason: 'invalid-seq', routeKind: player.routeKind }];
  }
  if (command.seq <= player.lastMoveSeq) {
    return [state, { accepted: false, reason: 'stale-seq', routeKind: player.routeKind }];
  }
  if (state.phase !== 'playing') {
    return [state, { accepted: false, reason: 'game-not-playing', routeKind: player.routeKind }];
  }

  const requested = { x: command.worldX, y: command.worldY };
  const targetCell = worldToGrid(requested);
  if (targetCell === null || !isStaticWalkable(targetCell)) {
    const reason = targetCell !== null && isDoorCell(targetCell) ? 'doorway-target' : 'invalid-target';
    return [state, { accepted: false, reason, routeKind: player.routeKind }];
  }
  const safeTarget = nearestSafePoint(requested, targetCell);
  const startCell = worldToGrid(player.position);
  if (startCell === null) return [state, { accepted: false, reason: 'invalid-target', routeKind: player.routeKind }];

  const effectiveDoorOpen = deriveDoorOpen(state);
  const crossesClosedDoor = !effectiveDoorOpen
    && sideFor(startCell) !== sideFor(targetCell)
    && sideFor(startCell) !== 'door'
    && sideFor(targetCell) !== 'door';
  if (crossesClosedDoor) {
    const route = thresholdRoute(player);
    const next = copyPlayer(player, { lastMoveSeq: command.seq, route, routeKind: 'threshold-stop' });
    return [replacePlayer(state, index, next), { accepted: true, routeKind: 'threshold-stop' }];
  }
  const route = targetRoute(player, safeTarget, effectiveDoorOpen);
  if (route === null) return [state, { accepted: false, reason: 'invalid-target', routeKind: player.routeKind }];
  const next = copyPlayer(player, { lastMoveSeq: command.seq, route, routeKind: route.length === 0 ? 'none' : 'target' });
  return [replacePlayer(state, index, next), { accepted: true, routeKind: next.routeKind }];
}

function deriveDoorOpen(state: GameState): boolean {
  return state.players.some((player) =>
    plateIsPressed(player.position, LEVEL_ONE.nearPlate) || plateIsPressed(player.position, LEVEL_ONE.farPlate));
}

function hasDoorEntryAhead(player: PlayerState): boolean {
  const next = player.route[0];
  if (next === undefined) return false;
  const nextCell = worldToGrid(next);
  return nextCell !== null && isDoorCell(nextCell);
}

function stopAtThreshold(player: PlayerState): PlayerState {
  const route = thresholdRoute(player);
  return copyPlayer(player, { route, routeKind: 'threshold-stop', crossingPermit: false });
}

function movePlayer(player: PlayerState, doorOpen: boolean): PlayerState {
  if (player.route.length === 0) return player;
  if (!doorOpen && !player.crossingPermit && hasDoorEntryAhead(player)) return stopAtThreshold(player);

  let remaining = PLAYER_SPEED * FIXED_STEP_SECONDS;
  let position = clonePoint(player.position);
  let route = player.route.slice();
  let crossingPermit = player.crossingPermit;
  while (remaining > 0 && route.length > 0) {
    const waypoint = route[0];
    if (waypoint === undefined) break;
    const dx = waypoint.x - position.x;
    const dy = waypoint.y - position.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= remaining || distance === 0) {
      position = clonePoint(waypoint);
      remaining -= distance;
      route = route.slice(1);
    } else {
      position = { x: position.x + dx / distance * remaining, y: position.y + dy / distance * remaining };
      remaining = 0;
    }
    const cell = worldToGrid(position);
    if (cell !== null && isDoorCell(cell)) crossingPermit = true;
    if (cell !== null && !isDoorCell(cell) && crossingPermit) crossingPermit = false;
  }
  return copyPlayer(player, {
    position,
    route,
    routeKind: route.length === 0 ? 'none' : player.routeKind,
    crossingPermit,
  });
}

/** One authoritative 30 Hz tick. Order: phase gate, door, players, plates, completion. */
export function stepGame(state: GameState): GameState {
  const ticked = { ...state, tick: state.tick + 1 };
  if (ticked.phase === 'completed' || ticked.phase === 'abandoned') return ticked;
  if (ticked.phase === 'waitingForPlayers') return ticked;
  if (ticked.phase === 'reconnectGrace') {
    const reconnectElapsedSeconds = ticked.reconnectElapsedSeconds + FIXED_STEP_SECONDS;
    return reconnectElapsedSeconds + FIXED_STEP_SECONDS * 1e-6 >= RECONNECT_GRACE_SECONDS
      ? { ...ticked, reconnectElapsedSeconds, phase: 'abandoned' }
      : { ...ticked, reconnectElapsedSeconds };
  }

  const doorOpenBeforeMovement = deriveDoorOpen(ticked);
  const first = movePlayer(ticked.players[0], doorOpenBeforeMovement);
  const second = movePlayer(ticked.players[1], doorOpenBeforeMovement);
  const progressed: GameState = {
    ...ticked,
    elapsedSeconds: ticked.elapsedSeconds + FIXED_STEP_SECONDS,
    players: [first, second],
    doorOpen: false,
  };
  const doorOpen = deriveDoorOpen(progressed);
  const complete = isExitPosition(first.position) && isExitPosition(second.position);
  return {
    ...progressed,
    doorOpen,
    phase: complete ? 'completed' : 'playing',
    completedAtTick: complete ? progressed.tick : null,
  };
}

/** Pure connection transition for the server lifecycle adapter. */
export function setPlayerConnected(state: GameState, playerId: string, connected: boolean): GameState {
  const index = state.players[0].id === playerId ? 0 : state.players[1].id === playerId ? 1 : null;
  if (index === null || state.phase === 'abandoned') return state;
  if (state.players[index].connected === connected) return state;
  const changed = replacePlayer(state, index, copyPlayer(state.players[index], { connected }));
  if (bothConnected(changed)) {
    return {
      ...changed,
      phase: changed.resumePhase ?? 'playing',
      resumePhase: null,
      reconnectElapsedSeconds: 0,
    };
  }
  return changed.phase === 'waitingForPlayers'
    ? changed
    : changed.phase === 'reconnectGrace'
      ? changed
      : {
          ...changed,
          phase: 'reconnectGrace',
          resumePhase: changed.phase === 'completed' ? 'completed' : 'playing',
          reconnectElapsedSeconds: 0,
        };
}

export function restartGame(state: GameState, command: RestartCommand): [GameState, RestartEvent | null] {
  if (!Number.isSafeInteger(command.seq) || command.seq < 0) return [state, null];
  if (command.seq <= state.restartSeq) return [state, null];
  const players: [PlayerState, PlayerState] = [
    initialPlayer(state.players[0].id, 0, state.players[0].connected),
    initialPlayer(state.players[1].id, 1, state.players[1].connected),
  ];
  const next: GameState = {
    ...state,
    phase: players[0].connected && players[1].connected ? 'playing' : 'waitingForPlayers',
    resumePhase: null,
    tick: 0,
    elapsedSeconds: 0,
    reconnectElapsedSeconds: 0,
    players,
    doorOpen: false,
    completedAtTick: null,
    restartSeq: command.seq,
  };
  return [next, { type: 'restarted', tick: next.tick }];
}

function projectPlayer(player: PlayerState): NetworkPlayerState {
  return {
    id: player.id,
    connected: player.connected,
    worldX: player.position.x,
    worldY: player.position.y,
    routeKind: player.routeKind,
    lastMoveSeq: player.lastMoveSeq,
  };
}

export function projectNetworkState(state: GameState): NetworkGameState {
  return {
    phase: state.phase,
    tick: state.tick,
    doorOpen: state.doorOpen,
    completedAtTick: state.completedAtTick,
    players: [projectPlayer(state.players[0]), projectPlayer(state.players[1])],
  };
}
