export type GamePhase =
  | 'waitingForPlayers'
  | 'playing'
  | 'reconnectGrace'
  | 'completed'
  | 'abandoned';

export type RouteKind = 'none' | 'target' | 'threshold-stop';

export type MoveRejectReason =
  | 'stale-seq'
  | 'invalid-seq'
  | 'invalid-target'
  | 'doorway-target'
  | 'game-not-playing';

export interface GridPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

/** Sent by clients; coordinates are never applied directly to a player. */
export interface MoveTargetCommand {
  seq: number;
  worldX: number;
  worldY: number;
}

export interface RestartCommand {
  seq: number;
}

export interface MoveCommandResult {
  accepted: boolean;
  reason?: MoveRejectReason;
  routeKind: RouteKind;
}

export interface PlayerState {
  id: string;
  connected: boolean;
  spawn: WorldPoint;
  position: WorldPoint;
  lastMoveSeq: number;
  /** Waypoints are server-generated and excluded from network projections. */
  route: WorldPoint[];
  routeKind: RouteKind;
  crossingPermit: boolean;
}

export interface GameState {
  phase: GamePhase;
  /** Phase restored when every seat returns from reconnect grace. */
  resumePhase: 'playing' | 'completed' | null;
  tick: number;
  elapsedSeconds: number;
  reconnectElapsedSeconds: number;
  players: readonly [PlayerState, PlayerState];
  doorOpen: boolean;
  completedAtTick: number | null;
  restartSeq: number;
}

export interface NetworkPlayerState {
  id: string;
  connected: boolean;
  worldX: number;
  worldY: number;
  routeKind: RouteKind;
  lastMoveSeq: number;
}

export interface NetworkGameState {
  phase: GamePhase;
  tick: number;
  doorOpen: boolean;
  completedAtTick: number | null;
  players: readonly [NetworkPlayerState, NetworkPlayerState];
}

export interface RestartEvent {
  type: 'restarted';
  tick: number;
}
