import type { GamePhase, RouteKind } from '../game/index.ts';

export interface RemotePlayer {
  id: string;
  connected: boolean;
  worldX: number;
  worldY: number;
  routeKind: RouteKind;
  lastMoveSeq: number;
}

export interface CoopSnapshot {
  phase: GamePhase;
  tick: number;
  doorOpen: boolean;
  nearPlatePressed: boolean;
  farPlatePressed: boolean;
  completedAtTick: number | null;
  levelEpoch: number;
  reconnectRemainingSeconds: number;
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

function playerFrom(value: unknown): RemotePlayer {
  const player = asRecord(value);
  const routeKind = asString(player.routeKind);
  return {
    id: asString(player.id),
    connected: asBoolean(player.connected),
    worldX: asNumber(player.worldX),
    worldY: asNumber(player.worldY),
    routeKind: routeKind === 'target' || routeKind === 'threshold-stop' ? routeKind : 'none',
    lastMoveSeq: asNumber(player.lastMoveSeq),
  };
}

/** Converts plain state, ArraySchema, and MapSchema projections without server imports. */
export function readSnapshot(raw: unknown): CoopSnapshot {
  const state = asRecord(raw);
  const phase = asString(state.phase);
  return {
    phase: phase === 'playing' || phase === 'reconnectGrace' || phase === 'completed' || phase === 'abandoned'
      ? phase
      : 'waitingForPlayers',
    tick: asNumber(state.tick, asNumber(state.serverTick)),
    doorOpen: asBoolean(state.doorOpen),
    nearPlatePressed: asBoolean(state.nearPlatePressed),
    farPlatePressed: asBoolean(state.farPlatePressed),
    completedAtTick: typeof state.completedAtTick === 'number' && state.completedAtTick >= 0 ? state.completedAtTick : null,
    levelEpoch: asNumber(state.levelEpoch),
    reconnectRemainingSeconds: asNumber(state.reconnectRemainingSeconds),
    players: collectionValues(state.players).map(playerFrom).slice(0, 2),
  };
}

export const EMPTY_SNAPSHOT: CoopSnapshot = {
  phase: 'waitingForPlayers',
  tick: 0,
  doorOpen: false,
  nearPlatePressed: false,
  farPlatePressed: false,
  completedAtTick: null,
  levelEpoch: 0,
  reconnectRemainingSeconds: 0,
  players: [],
};

export function cloneSnapshot(snapshot: CoopSnapshot): CoopSnapshot {
  return { ...snapshot, players: snapshot.players.map((player) => ({ ...player })) };
}

export function nextRestartSequence(localSequence: number, authoritativeEpoch: number): number {
  const local = Number.isSafeInteger(localSequence) && localSequence >= 0 ? localSequence : 0;
  const epoch = Number.isSafeInteger(authoritativeEpoch) && authoritativeEpoch >= 0 ? authoritativeEpoch : 0;
  return Math.max(local, epoch) + 1;
}
