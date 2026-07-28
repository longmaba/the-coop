import { FIXED_STEP_SECONDS, PLAYER_SPEED, RECONNECT_GRACE_SECONDS } from './constants.ts';
import {
  LEVEL_ONE,
  getLevelDefinition,
  getNextLevelDefinition,
  gridToWorld,
  isDoorCell,
  isExitPosition,
  isStaticWalkable,
  nearestSafePoint,
  plateIsPressed,
  sideFor,
  worldToGrid,
} from './level.ts';
import type { LevelDefinition, TeleporterDefinition } from './level.ts';
import { findPath } from './pathfinding.ts';
import type {
  AdvanceEvent,
  GameState,
  GateId,
  LevelId,
  LevelTransitionEvent,
  MoveCommandResult,
  MoveTargetCommand,
  NetworkGameState,
  NetworkPlayerState,
  PlayerState,
  RestartCommand,
  RestartEvent,
  TeleporterPadId,
  WorldPoint,
} from './types.ts';

const clonePoint = (point: WorldPoint): WorldPoint => ({ x: point.x, y: point.y });

function initialPlayer(
  id: string,
  spawnIndex: 0 | 1,
  connected: boolean,
  level: LevelDefinition,
): PlayerState {
  const spawn = gridToWorld(level.playerSpawns[spawnIndex]);
  return {
    id,
    connected,
    spawn,
    position: clonePoint(spawn),
    lastMoveSeq: -1,
    route: [],
    routeKind: 'none',
    crossingPermit: false,
    blockedTeleporterPadId: null,
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

export function createGameState(
  playerIds: readonly [string, string],
  connected = true,
  levelId: LevelId = LEVEL_ONE.id,
): GameState {
  if (playerIds[0] === playerIds[1]) throw new Error('Two distinct player ids are required.');
  const level = getLevelDefinition(levelId);
  const players: [PlayerState, PlayerState] = [
    initialPlayer(playerIds[0], 0, connected, level),
    initialPlayer(playerIds[1], 1, connected, level),
  ];
  return {
    levelId,
    levelEpoch: 0,
    phase: connected ? 'playing' : 'waitingForPlayers',
    resumePhase: null,
    tick: 0,
    elapsedSeconds: 0,
    reconnectElapsedSeconds: 0,
    players,
    doorOpen: false,
    collectedKeycardIds: Object.freeze([]),
    latchedGateIds: Object.freeze([]),
    completedAtTick: null,
    restartSeq: -1,
  };
}

function routeFromGridPath(
  path: readonly { x: number; y: number }[],
  exactTarget: WorldPoint,
): WorldPoint[] {
  const route = path.slice(1).map(gridToWorld);
  if (route.length === 0) return [exactTarget];
  route[route.length - 1] = exactTarget;
  return route;
}

function thresholdRoute(player: PlayerState, level: LevelDefinition): WorldPoint[] {
  const current = worldToGrid(player.position, level);
  if (current === null) return [];
  const threshold = sideFor(current, level) === 'right'
    ? level.rightThreshold
    : level.leftThreshold;
  const path = findPath(current, threshold, false, level);
  return path === null ? [] : routeFromGridPath(path, gridToWorld(threshold));
}

function targetRoute(
  player: PlayerState,
  target: WorldPoint,
  doorOpen: boolean,
  level: LevelDefinition,
): WorldPoint[] | null {
  const start = worldToGrid(player.position, level);
  const targetCell = worldToGrid(target, level);
  if (start === null || targetCell === null) return null;
  const path = findPath(start, targetCell, doorOpen || player.crossingPermit, level);
  return path === null ? null : routeFromGridPath(path, target);
}

/** Applies a client click as a server-owned route, never a direct displacement. */
export function applyMoveTarget(
  state: GameState,
  playerId: string,
  command: MoveTargetCommand,
): [GameState, MoveCommandResult] {
  const index = state.players[0].id === playerId
    ? 0
    : state.players[1].id === playerId
      ? 1
      : null;
  if (index === null) {
    return [state, { accepted: false, reason: 'invalid-target', routeKind: 'none' }];
  }
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

  const level = getLevelDefinition(state.levelId);
  const requested = { x: command.worldX, y: command.worldY };
  const targetCell = worldToGrid(requested, level);
  if (targetCell === null || !isStaticWalkable(targetCell, level)) {
    const reason = targetCell !== null && isDoorCell(targetCell, level)
      ? 'doorway-target'
      : 'invalid-target';
    return [state, { accepted: false, reason, routeKind: player.routeKind }];
  }
  const safeTarget = nearestSafePoint(requested, targetCell);
  const startCell = worldToGrid(player.position, level);
  if (startCell === null) {
    return [state, { accepted: false, reason: 'invalid-target', routeKind: player.routeKind }];
  }

  const effectiveDoorOpen = deriveDoorOpen(state, level);
  const startSide = sideFor(startCell, level);
  const targetSide = sideFor(targetCell, level);
  const crossesClosedDoor = !effectiveDoorOpen
    && startSide !== targetSide
    && startSide !== 'door'
    && targetSide !== 'door';
  if (crossesClosedDoor) {
    const route = thresholdRoute(player, level);
    const next = copyPlayer(player, {
      lastMoveSeq: command.seq,
      route,
      routeKind: 'threshold-stop',
    });
    return [
      replacePlayer(state, index, next),
      { accepted: true, routeKind: 'threshold-stop' },
    ];
  }

  const route = targetRoute(player, safeTarget, effectiveDoorOpen, level);
  if (route === null) {
    return [state, { accepted: false, reason: 'invalid-target', routeKind: player.routeKind }];
  }
  const next = copyPlayer(player, {
    lastMoveSeq: command.seq,
    route,
    routeKind: route.length === 0 ? 'none' : 'target',
  });
  return [replacePlayer(state, index, next), { accepted: true, routeKind: next.routeKind }];
}

function playerOccupyingCell(
  state: GameState,
  cell: { x: number; y: number },
  level: LevelDefinition,
): PlayerState | null {
  return state.players.find((player) => plateIsPressed(player.position, cell, level)) ?? null;
}

export function pressurePlateIsOccupied(
  state: GameState,
  plateId: LevelDefinition['pressurePlates'][number]['id'],
): boolean {
  const level = getLevelDefinition(state.levelId);
  const plate = level.pressurePlates.find(({ id }) => id === plateId);
  return plate !== undefined && playerOccupyingCell(state, plate.grid, level) !== null;
}

export function teleporterIsPowered(
  state: GameState,
  teleporterId: LevelDefinition['teleporters'][number]['id'],
): boolean {
  const level = getLevelDefinition(state.levelId);
  const teleporter = level.teleporters.find(({ id }) => id === teleporterId);
  return teleporter !== undefined
    && playerOccupyingCell(state, teleporter.power.grid, level) !== null;
}

export function relayButtonOccupant(
  state: GameState,
  buttonId: LevelDefinition['relayButtons'][number]['id'],
): string | null {
  const level = getLevelDefinition(state.levelId);
  const button = level.relayButtons.find(({ id }) => id === buttonId);
  return button === undefined
    ? null
    : playerOccupyingCell(state, button.grid, level)?.id ?? null;
}

function deriveDoorOpen(
  state: GameState,
  level: LevelDefinition = getLevelDefinition(state.levelId),
): boolean {
  if (state.latchedGateIds.includes(level.doorId)) return true;
  if (level.gateRule.kind !== 'hold-any-plate') return false;
  return level.gateRule.pressurePlateIds
    .some((id) => pressurePlateIsOccupied(state, id));
}

function hasDoorEntryAhead(player: PlayerState, level: LevelDefinition): boolean {
  const next = player.route[0];
  if (next === undefined) return false;
  const nextCell = worldToGrid(next, level);
  return nextCell !== null && isDoorCell(nextCell, level);
}

function stopAtThreshold(player: PlayerState, level: LevelDefinition): PlayerState {
  const route = thresholdRoute(player, level);
  return copyPlayer(player, {
    route,
    routeKind: 'threshold-stop',
    crossingPermit: false,
  });
}

function movePlayer(
  player: PlayerState,
  doorOpen: boolean,
  level: LevelDefinition,
): PlayerState {
  if (player.route.length === 0) return player;
  if (!doorOpen && !player.crossingPermit && hasDoorEntryAhead(player, level)) {
    return stopAtThreshold(player, level);
  }

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
      position = {
        x: position.x + dx / distance * remaining,
        y: position.y + dy / distance * remaining,
      };
      remaining = 0;
    }
    const cell = worldToGrid(position, level);
    if (cell !== null && isDoorCell(cell, level)) crossingPermit = true;
    if (cell !== null && !isDoorCell(cell, level) && crossingPermit) crossingPermit = false;
  }
  return copyPlayer(player, {
    position,
    route,
    routeKind: route.length === 0 ? 'none' : player.routeKind,
    crossingPermit,
  });
}

function padById(
  level: LevelDefinition,
  padId: TeleporterPadId,
): { teleporter: TeleporterDefinition; padIndex: 0 | 1 } | null {
  for (const teleporter of level.teleporters) {
    if (teleporter.pads[0].id === padId) return { teleporter, padIndex: 0 };
    if (teleporter.pads[1].id === padId) return { teleporter, padIndex: 1 };
  }
  return null;
}

function sameCell(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function processTeleporters(state: GameState, level: LevelDefinition): GameState {
  let next = state;
  for (const index of [0, 1] as const) {
    let player = next.players[index];
    const currentCell = worldToGrid(player.position, level);
    if (currentCell === null) continue;

    if (player.blockedTeleporterPadId !== null) {
      const blocked = padById(level, player.blockedTeleporterPadId);
      const remainsOnArrivalPad = blocked !== null
        && sameCell(currentCell, blocked.teleporter.pads[blocked.padIndex].grid);
      if (remainsOnArrivalPad) continue;
      player = copyPlayer(player, { blockedTeleporterPadId: null });
      next = replacePlayer(next, index, player);
    }

    for (const teleporter of level.teleporters) {
      if (!teleporterIsPowered(next, teleporter.id)) continue;
      const sourceIndex = teleporter.pads.findIndex(({ grid }) => sameCell(grid, currentCell));
      if (sourceIndex !== 0 && sourceIndex !== 1) continue;
      const destination = teleporter.pads[sourceIndex === 0 ? 1 : 0];
      const teleported = copyPlayer(player, {
        position: gridToWorld(destination.grid),
        route: [],
        routeKind: 'none',
        crossingPermit: false,
        blockedTeleporterPadId: destination.id,
      });
      next = replacePlayer(next, index, teleported);
      break;
    }
  }
  return next;
}

function collectKeycards(state: GameState, level: LevelDefinition): GameState {
  const collectedKeycardIds = level.keycards
    .filter(({ id, grid }) =>
      state.collectedKeycardIds.includes(id)
      || state.players.some((player) => plateIsPressed(player.position, grid, level)))
    .map(({ id }) => id);
  const unchanged = collectedKeycardIds.length === state.collectedKeycardIds.length
    && collectedKeycardIds.every((id, index) => id === state.collectedKeycardIds[index]);
  return unchanged
    ? state
    : { ...state, collectedKeycardIds: Object.freeze(collectedKeycardIds) };
}

function relayRequirementsMet(state: GameState, level: LevelDefinition): boolean {
  const ids = level.gateRule.kind === 'keycards-and-relays'
    ? level.gateRule.requiredRelayButtonIds
    : [];
  if (ids.length === 0) return true;
  const occupants = ids.map((id) => relayButtonOccupant(state, id));
  if (occupants.some((id) => id === null)) return false;
  return new Set(occupants).size === occupants.length;
}

function latchSatisfiedGate(state: GameState, level: LevelDefinition): GameState {
  if (level.gateRule.kind !== 'keycards-and-relays') return state;
  if (state.latchedGateIds.includes(level.doorId)) return state;
  const cardsMet = level.gateRule.requiredKeycardIds
    .every((id) => state.collectedKeycardIds.includes(id));
  if (!cardsMet || !relayRequirementsMet(state, level)) return state;
  const latchedGateIds: readonly GateId[] = Object.freeze([level.doorId]);
  return { ...state, latchedGateIds };
}

/** One authoritative 30 Hz tick. Order: phase, movement, portals, cards, gate, completion. */
export function stepGame(state: GameState): GameState {
  const level = getLevelDefinition(state.levelId);
  const ticked = { ...state, tick: state.tick + 1 };
  if (ticked.phase === 'completed' || ticked.phase === 'abandoned') return ticked;
  if (ticked.phase === 'waitingForPlayers') return ticked;
  if (ticked.phase === 'reconnectGrace') {
    const reconnectElapsedSeconds = ticked.reconnectElapsedSeconds + FIXED_STEP_SECONDS;
    return reconnectElapsedSeconds + FIXED_STEP_SECONDS * 1e-6 >= RECONNECT_GRACE_SECONDS
      ? { ...ticked, reconnectElapsedSeconds, phase: 'abandoned' }
      : { ...ticked, reconnectElapsedSeconds };
  }

  const doorOpenBeforeMovement = deriveDoorOpen(ticked, level);
  const first = movePlayer(ticked.players[0], doorOpenBeforeMovement, level);
  const second = movePlayer(ticked.players[1], doorOpenBeforeMovement, level);
  let progressed: GameState = {
    ...ticked,
    elapsedSeconds: ticked.elapsedSeconds + FIXED_STEP_SECONDS,
    players: [first, second],
    doorOpen: false,
  };
  progressed = processTeleporters(progressed, level);
  progressed = collectKeycards(progressed, level);
  progressed = latchSatisfiedGate(progressed, level);
  const doorOpen = deriveDoorOpen(progressed, level);
  const complete = isExitPosition(progressed.players[0].position, level)
    && isExitPosition(progressed.players[1].position, level);
  const players: readonly [PlayerState, PlayerState] = complete
    ? [
        copyPlayer(progressed.players[0], {
          route: [],
          routeKind: 'none',
          crossingPermit: false,
        }),
        copyPlayer(progressed.players[1], {
          route: [],
          routeKind: 'none',
          crossingPermit: false,
        }),
      ]
    : progressed.players;
  return {
    ...progressed,
    players,
    doorOpen,
    phase: complete ? 'completed' : 'playing',
    completedAtTick: complete ? progressed.tick : null,
  };
}

/** Pure connection transition for the server lifecycle adapter. */
export function setPlayerConnected(
  state: GameState,
  playerId: string,
  connected: boolean,
): GameState {
  const index = state.players[0].id === playerId
    ? 0
    : state.players[1].id === playerId
      ? 1
      : null;
  if (index === null || state.phase === 'abandoned') return state;
  if (state.players[index].connected === connected) return state;
  const changed = replacePlayer(
    state,
    index,
    copyPlayer(state.players[index], { connected }),
  );
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

function transitionLevel(
  state: GameState,
  command: RestartCommand,
  levelId: LevelId,
  type: LevelTransitionEvent['type'],
  requireCompleted: boolean,
): [GameState, LevelTransitionEvent | null] {
  if (
    (requireCompleted && state.phase !== 'completed')
    || !Number.isSafeInteger(command.seq)
    || command.seq < 0
    || command.seq !== state.levelEpoch + 1
    || command.seq <= state.restartSeq
  ) return [state, null];

  const level = getLevelDefinition(levelId);
  const players: [PlayerState, PlayerState] = [
    initialPlayer(state.players[0].id, 0, state.players[0].connected, level),
    initialPlayer(state.players[1].id, 1, state.players[1].connected, level),
  ];
  const next: GameState = {
    ...state,
    levelId,
    levelEpoch: state.levelEpoch + 1,
    phase: players[0].connected && players[1].connected ? 'playing' : 'waitingForPlayers',
    resumePhase: null,
    tick: 0,
    elapsedSeconds: 0,
    reconnectElapsedSeconds: 0,
    players,
    doorOpen: false,
    collectedKeycardIds: Object.freeze([]),
    latchedGateIds: Object.freeze([]),
    completedAtTick: null,
    restartSeq: command.seq,
  };
  const event: LevelTransitionEvent = type === 'restarted'
    ? {
        type: 'restarted',
        tick: next.tick,
        levelId: next.levelId,
        levelEpoch: next.levelEpoch,
      }
    : {
        type: 'advanced',
        tick: next.tick,
        levelId: next.levelId,
        levelEpoch: next.levelEpoch,
      };
  return [next, event];
}

export function replayCurrentLevel(
  state: GameState,
  command: RestartCommand,
): [GameState, RestartEvent | null] {
  const [next, event] = transitionLevel(
    state,
    command,
    state.levelId,
    'restarted',
    false,
  );
  return [next, event?.type === 'restarted' ? event : null];
}

export function advanceToNextLevel(
  state: GameState,
  command: RestartCommand,
): [GameState, AdvanceEvent | null] {
  const [next, event] = transitionLevel(
    state,
    command,
    getNextLevelDefinition(state.levelId).id,
    'advanced',
    true,
  );
  return [next, event?.type === 'advanced' ? event : null];
}

/** Backward-compatible replay name retained for existing room adapters. */
export function restartGame(
  state: GameState,
  command: RestartCommand,
): [GameState, RestartEvent | null] {
  return replayCurrentLevel(state, command);
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
  const level = getLevelDefinition(state.levelId);
  return {
    levelId: state.levelId,
    levelNumber: level.number,
    levelEpoch: state.levelEpoch,
    phase: state.phase,
    tick: state.tick,
    doorOpen: state.doorOpen,
    collectedKeycardIds: [...state.collectedKeycardIds],
    latchedGateIds: [...state.latchedGateIds],
    pressurePlates: level.pressurePlates.map(({ id }) => ({
      id,
      occupied: pressurePlateIsOccupied(state, id),
    })),
    teleporters: level.teleporters.map(({ id, power, pads }) => ({
      id,
      powered: teleporterIsPowered(state, id),
      powerId: power.id,
      padIds: [pads[0].id, pads[1].id],
    })),
    keycards: level.keycards.map(({ id }) => ({
      id,
      collected: state.collectedKeycardIds.includes(id),
    })),
    relayButtons: level.relayButtons.map(({ id }) => ({
      id,
      occupiedBy: relayButtonOccupant(state, id),
    })),
    completedAtTick: state.completedAtTick,
    players: [projectPlayer(state.players[0]), projectPlayer(state.players[1])],
  };
}
