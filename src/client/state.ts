import {
  COOPERATIVE_DISCOVERY_GOAL,
  normalizeAvatarId,
  type AvatarId,
  type GamePhase,
  type RouteKind,
} from '../game/index.ts';

export interface RemotePlayer {
  id: string;
  avatarId: AvatarId;
  connected: boolean;
  worldX: number;
  worldY: number;
  routeKind: RouteKind;
  lastMoveSeq: number;
}

export interface RemotePressurePlate {
  id: string;
  occupied: boolean;
}

export interface RemoteTeleporter {
  id: string;
  powered: boolean;
  powerId: string;
  padIds: string[];
}

export interface RemoteKeycard {
  id: string;
  collected: boolean;
}

export interface RemoteRelayButton {
  id: string;
  occupiedBy: string | null;
}

export interface CoopSnapshot {
  phase: GamePhase;
  tick: number;
  levelId: string;
  levelNumber: number;
  levelCount: number;
  levelName: string;
  objective: string;
  doorOpen: boolean;
  nearPlatePressed: boolean;
  farPlatePressed: boolean;
  completedAtTick: number | null;
  levelEpoch: number;
  reconnectRemainingSeconds: number;
  collectedKeycardIds: string[];
  latchedGateIds: string[];
  pressurePlates: RemotePressurePlate[];
  teleporters: RemoteTeleporter[];
  keycards: RemoteKeycard[];
  relayButtons: RemoteRelayButton[];
  players: RemotePlayer[];
}

export type ClientStatus =
  | 'landing'
  | 'creating'
  | 'joining'
  | 'waiting'
  | 'playing'
  | 'reconnecting'
  | 'abandoned'
  | 'error';

type RecordLike = Record<string, unknown>;

const asRecord = (value: unknown): RecordLike =>
  value !== null && typeof value === 'object' ? value as RecordLike : {};

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asString = (value: unknown): string => typeof value === 'string' ? value : '';

const asBoolean = (value: unknown): boolean => value === true;

function collectionValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const candidate = value as { forEach?: (callback: (item: unknown) => void) => void };
    if (typeof candidate.forEach === 'function') {
      const entries: unknown[] = [];
      candidate.forEach((entry) => entries.push(entry));
      return entries;
    }
    if (Symbol.iterator in value) return [...(value as Iterable<unknown>)];
  }
  return [];
}

function playerFrom(value: unknown, index: number): RemotePlayer {
  const player = asRecord(value);
  const id = asString(player.id);
  const routeKind = asString(player.routeKind);
  return {
    id,
    avatarId: normalizeAvatarId(player.avatarId, id, index === 0 ? 0 : 1),
    connected: asBoolean(player.connected),
    worldX: asNumber(player.worldX),
    worldY: asNumber(player.worldY),
    routeKind: routeKind === 'target' || routeKind === 'threshold-stop' ? routeKind : 'none',
    lastMoveSeq: asNumber(player.lastMoveSeq),
  };
}

function pressurePlateFrom(value: unknown): RemotePressurePlate {
  const pressurePlate = asRecord(value);
  return {
    id: asString(pressurePlate.id),
    occupied: asBoolean(pressurePlate.occupied),
  };
}

function teleporterFrom(value: unknown): RemoteTeleporter {
  const teleporter = asRecord(value);
  return {
    id: asString(teleporter.id),
    powered: asBoolean(teleporter.powered),
    powerId: asString(teleporter.powerId),
    padIds: collectionValues(teleporter.padIds).map(asString).filter(Boolean).slice(0, 2),
  };
}

function keycardFrom(value: unknown): RemoteKeycard {
  const keycard = asRecord(value);
  return {
    id: asString(keycard.id),
    collected: asBoolean(keycard.collected),
  };
}

function relayButtonFrom(value: unknown): RemoteRelayButton {
  const relayButton = asRecord(value);
  const occupiedBy = asString(relayButton.occupiedBy);
  return {
    id: asString(relayButton.id),
    occupiedBy: occupiedBy.length > 0 ? occupiedBy : null,
  };
}

const idsFrom = (value: unknown): string[] =>
  collectionValues(value).map(asString).filter(Boolean);

/** Converts plain state, ArraySchema, and MapSchema projections without server imports. */
export function readSnapshot(raw: unknown): CoopSnapshot {
  const state = asRecord(raw);
  const phase = asString(state.phase);
  const levelNumber = Math.max(1, Math.trunc(asNumber(state.levelNumber, 1)));
  return {
    phase: phase === 'playing' || phase === 'reconnectGrace' || phase === 'completed' || phase === 'abandoned'
      ? phase
      : 'waitingForPlayers',
    tick: asNumber(state.tick, asNumber(state.serverTick)),
    levelId: asString(state.levelId) || 'level_1',
    levelNumber,
    levelCount: Math.max(levelNumber, Math.trunc(asNumber(state.levelCount, 4))),
    levelName: asString(state.levelName) || 'Pressure Lock',
    objective: asString(state.objective) || COOPERATIVE_DISCOVERY_GOAL,
    doorOpen: asBoolean(state.doorOpen),
    nearPlatePressed: asBoolean(state.nearPlatePressed),
    farPlatePressed: asBoolean(state.farPlatePressed),
    completedAtTick: typeof state.completedAtTick === 'number' && state.completedAtTick >= 0 ? state.completedAtTick : null,
    levelEpoch: asNumber(state.levelEpoch),
    reconnectRemainingSeconds: asNumber(state.reconnectRemainingSeconds),
    collectedKeycardIds: idsFrom(state.collectedKeycardIds),
    latchedGateIds: idsFrom(state.latchedGateIds),
    pressurePlates: collectionValues(state.pressurePlates).map(pressurePlateFrom).filter(({ id }) => id.length > 0),
    teleporters: collectionValues(state.teleporters).map(teleporterFrom).filter(({ id }) => id.length > 0),
    keycards: collectionValues(state.keycards).map(keycardFrom).filter(({ id }) => id.length > 0),
    relayButtons: collectionValues(state.relayButtons).map(relayButtonFrom).filter(({ id }) => id.length > 0),
    players: collectionValues(state.players).slice(0, 2).map(playerFrom),
  };
}

export const EMPTY_SNAPSHOT: CoopSnapshot = {
  phase: 'waitingForPlayers',
  tick: 0,
  levelId: 'level_1',
  levelNumber: 1,
  levelCount: 4,
  levelName: 'Pressure Lock',
  objective: COOPERATIVE_DISCOVERY_GOAL,
  doorOpen: false,
  nearPlatePressed: false,
  farPlatePressed: false,
  completedAtTick: null,
  levelEpoch: 0,
  reconnectRemainingSeconds: 0,
  collectedKeycardIds: [],
  latchedGateIds: [],
  pressurePlates: [],
  teleporters: [],
  keycards: [],
  relayButtons: [],
  players: [],
};

export function cloneSnapshot(snapshot: CoopSnapshot): CoopSnapshot {
  return {
    ...snapshot,
    collectedKeycardIds: [...snapshot.collectedKeycardIds],
    latchedGateIds: [...snapshot.latchedGateIds],
    pressurePlates: snapshot.pressurePlates.map((pressurePlate) => ({ ...pressurePlate })),
    teleporters: snapshot.teleporters.map((teleporter) => ({
      ...teleporter,
      padIds: [...teleporter.padIds],
    })),
    keycards: snapshot.keycards.map((keycard) => ({ ...keycard })),
    relayButtons: snapshot.relayButtons.map((relayButton) => ({ ...relayButton })),
    players: snapshot.players.map((player) => ({ ...player })),
  };
}

export function nextTransitionSequence(localSequence: number, authoritativeEpoch: number): number {
  void localSequence;
  const epoch = Number.isSafeInteger(authoritativeEpoch) && authoritativeEpoch >= 0 ? authoritativeEpoch : 0;
  return epoch + 1;
}

/** Kept for the existing diagnostics and clients that still name replay as restart. */
export const nextRestartSequence = nextTransitionSequence;
