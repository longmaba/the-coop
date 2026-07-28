export type GamePhase =
  | 'waitingForPlayers'
  | 'playing'
  | 'reconnectGrace'
  | 'completed'
  | 'abandoned';

export type RoomMode = 'human-human' | 'human-ai';

export type ControllerKind = 'human' | 'mcp';

export type PlayerId = 'player-1' | 'player-2';

export type LevelId = 'level_1' | 'level_2' | 'level_3' | 'level_4';

export type GateId = 'gate_main';

export type PressurePlateId = 'plate_a' | 'plate_b';

export type TeleporterId = 'teleporter_alpha' | 'teleporter_beta';

export type TeleporterPowerId =
  | 'teleporter_alpha_power'
  | 'teleporter_beta_power';

export type TeleporterPadId =
  | 'teleporter_alpha_home'
  | 'teleporter_alpha_annex'
  | 'teleporter_beta_home'
  | 'teleporter_beta_annex';

export type KeycardId = 'keycard_alpha' | 'keycard_beta';

export type RelayButtonId = 'gate_button_a' | 'gate_button_b';

export type InteractableId =
  | PressurePlateId
  | TeleporterPowerId
  | TeleporterPadId
  | KeycardId
  | RelayButtonId
  | 'exit_zone';

export interface HumanHumanJoinOptions {
  roomMode: 'human-human';
  controllerKind: 'human';
}

export interface HumanAiCreateOptions {
  roomMode: 'human-ai';
  controllerKind: 'mcp';
  playerId: 'player-2';
  pairingTokenHash: string;
  pairingExpiresAt: number;
}

export interface HumanAiHumanJoinOptions {
  roomMode: 'human-ai';
  controllerKind: 'human';
  playerId: 'player-1';
  pairingToken: string;
}

export type JoinOptions =
  | HumanHumanJoinOptions
  | HumanAiCreateOptions
  | HumanAiHumanJoinOptions;

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
  /** Prevents an arrival pad from immediately sending the player back. */
  blockedTeleporterPadId: TeleporterPadId | null;
}

export interface GameState {
  levelId: LevelId;
  /** Monotonic room-local generation, incremented by replay and advancement. */
  levelEpoch: number;
  phase: GamePhase;
  /** Phase restored when every seat returns from reconnect grace. */
  resumePhase: 'playing' | 'completed' | null;
  tick: number;
  elapsedSeconds: number;
  reconnectElapsedSeconds: number;
  players: readonly [PlayerState, PlayerState];
  doorOpen: boolean;
  collectedKeycardIds: readonly KeycardId[];
  latchedGateIds: readonly GateId[];
  completedAtTick: number | null;
  /** Last accepted replay or advancement command sequence. */
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

export interface NetworkPressurePlateState {
  id: PressurePlateId;
  occupied: boolean;
}

export interface NetworkTeleporterState {
  id: TeleporterId;
  powered: boolean;
  powerId: TeleporterPowerId;
  padIds: readonly [TeleporterPadId, TeleporterPadId];
}

export interface NetworkKeycardState {
  id: KeycardId;
  collected: boolean;
}

export interface NetworkRelayButtonState {
  id: RelayButtonId;
  occupiedBy: string | null;
}

export interface NetworkGameState {
  levelId: LevelId;
  levelNumber: number;
  levelEpoch: number;
  phase: GamePhase;
  tick: number;
  doorOpen: boolean;
  collectedKeycardIds: readonly KeycardId[];
  latchedGateIds: readonly GateId[];
  pressurePlates: readonly NetworkPressurePlateState[];
  teleporters: readonly NetworkTeleporterState[];
  keycards: readonly NetworkKeycardState[];
  relayButtons: readonly NetworkRelayButtonState[];
  completedAtTick: number | null;
  players: readonly [NetworkPlayerState, NetworkPlayerState];
}

export interface RestartEvent {
  type: 'restarted';
  tick: number;
  levelId: LevelId;
  levelEpoch: number;
}

export interface AdvanceEvent {
  type: 'advanced';
  tick: number;
  levelId: LevelId;
  levelEpoch: number;
}

export type LevelTransitionEvent = RestartEvent | AdvanceEvent;

const PAIRING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isHumanAiCreateOptions(value: unknown): value is HumanAiCreateOptions {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'roomMode',
    'controllerKind',
    'playerId',
    'pairingTokenHash',
    'pairingExpiresAt',
  ])) return false;

  return value.roomMode === 'human-ai'
    && value.controllerKind === 'mcp'
    && value.playerId === 'player-2'
    && typeof value.pairingTokenHash === 'string'
    && SHA_256_PATTERN.test(value.pairingTokenHash)
    && typeof value.pairingExpiresAt === 'number'
    && Number.isSafeInteger(value.pairingExpiresAt)
    && value.pairingExpiresAt >= 0;
}

export function isHumanAiHumanJoinOptions(value: unknown): value is HumanAiHumanJoinOptions {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'roomMode',
    'controllerKind',
    'playerId',
    'pairingToken',
  ])) return false;

  return value.roomMode === 'human-ai'
    && value.controllerKind === 'human'
    && value.playerId === 'player-1'
    && typeof value.pairingToken === 'string'
    && PAIRING_TOKEN_PATTERN.test(value.pairingToken);
}

/**
 * Normalizes the legacy empty join options to the human-versus-human contract.
 * Human-AI joins are deliberately strict so a caller cannot forge or swap roles.
 */
export function parseJoinOptions(value: unknown): JoinOptions | null {
  if (value === undefined || value === null) {
    return { roomMode: 'human-human', controllerKind: 'human' };
  }
  if (!isRecord(value)) return null;
  if (Object.keys(value).length === 0) {
    return { roomMode: 'human-human', controllerKind: 'human' };
  }
  if (
    hasOnlyKeys(value, ['roomMode', 'controllerKind'])
    && value.roomMode === 'human-human'
    && value.controllerKind === 'human'
  ) {
    return { roomMode: 'human-human', controllerKind: 'human' };
  }
  if (isHumanAiCreateOptions(value)) return value;
  if (isHumanAiHumanJoinOptions(value)) return value;
  return null;
}
