import { Room, generateId } from '@colyseus/core';
import { ArraySchema, Schema, defineTypes } from '@colyseus/schema';
import {
  CELL_SIZE,
  COOPERATIVE_DISCOVERY_GOAL,
  GRID_HEIGHT,
  GRID_WIDTH,
  RECONNECT_GRACE_SECONDS,
  SIMULATION_HZ,
  SNAPSHOT_HZ,
  LEVEL_CATALOG,
  advanceToNextLevel,
  applyMoveTarget,
  createGameState,
  getLevelDefinition,
  projectNetworkState,
  replayCurrentLevel,
  setPlayerAvatarId,
  setPlayerConnected,
  stepGame,
} from '../game/index.ts';
import {
  isHumanAiCreateOptions,
  isHumanAiHumanJoinOptions,
  parseJoinOptions,
} from '../game/index.ts';
import { PairingTokenGate } from './pairing.ts';
import type { Client } from '@colyseus/core';
import type {
  AvatarId,
  GameState,
  MoveTargetCommand,
  PlayerId,
  RoomMode,
  RouteKind,
} from '../game/index.ts';

const PLAYER_IDS = ['player-1', 'player-2'] as const;
const ROOM_ID_LENGTH = 24;
const MAX_MOVE_SEQUENCE = 2_147_483_647;
const MAX_RESTART_SEQUENCE = 2_147_483_647;

export class PlayerSchema extends Schema {
  declare id: string;
  declare avatarId: string;
  declare connected: boolean;
  declare worldX: number;
  declare worldY: number;
  declare routeKind: string;
  declare lastMoveSeq: number;

  constructor() {
    super();
    this.id = '';
    this.avatarId = '';
    this.connected = false;
    this.worldX = 0;
    this.worldY = 0;
    this.routeKind = 'none';
    this.lastMoveSeq = -1;
  }
}

defineTypes(PlayerSchema, {
  id: 'string',
  avatarId: 'string',
  connected: 'boolean',
  worldX: 'float64',
  worldY: 'float64',
  routeKind: 'string',
  lastMoveSeq: 'int32',
});

export class PressurePlateSchema extends Schema {
  declare id: string;
  declare occupied: boolean;

  constructor() {
    super();
    this.id = '';
    this.occupied = false;
  }
}

defineTypes(PressurePlateSchema, {
  id: 'string',
  occupied: 'boolean',
});

export class TeleporterSchema extends Schema {
  declare id: string;
  declare powered: boolean;
  declare powerId: string;
  declare padIds: ArraySchema<string>;

  constructor() {
    super();
    this.id = '';
    this.powered = false;
    this.powerId = '';
    this.padIds = new ArraySchema<string>();
  }
}

defineTypes(TeleporterSchema, {
  id: 'string',
  powered: 'boolean',
  powerId: 'string',
  padIds: ['string'],
});

export class KeycardSchema extends Schema {
  declare id: string;
  declare collected: boolean;

  constructor() {
    super();
    this.id = '';
    this.collected = false;
  }
}

defineTypes(KeycardSchema, {
  id: 'string',
  collected: 'boolean',
});

export class RelayButtonSchema extends Schema {
  declare id: string;
  /** Empty when the relay is not occupied. */
  declare occupiedBy: string;

  constructor() {
    super();
    this.id = '';
    this.occupiedBy = '';
  }
}

defineTypes(RelayButtonSchema, {
  id: 'string',
  occupiedBy: 'string',
});

/** Network projection only. Routes and reconnection tokens never leave the room. */
export class CoopStateSchema extends Schema {
  declare phase: string;
  declare tick: number;
  declare levelId: string;
  declare levelNumber: number;
  declare levelCount: number;
  declare levelName: string;
  declare objective: string;
  declare doorOpen: boolean;
  declare nearPlatePressed: boolean;
  declare farPlatePressed: boolean;
  declare completedAtTick: number;
  declare levelEpoch: number;
  declare reconnectRemainingSeconds: number;
  declare collectedKeycardIds: ArraySchema<string>;
  declare latchedGateIds: ArraySchema<string>;
  declare pressurePlates: ArraySchema<PressurePlateSchema>;
  declare teleporters: ArraySchema<TeleporterSchema>;
  declare keycards: ArraySchema<KeycardSchema>;
  declare relayButtons: ArraySchema<RelayButtonSchema>;
  declare players: ArraySchema<PlayerSchema>;

  constructor() {
    super();
    this.phase = 'waitingForPlayers';
    this.tick = 0;
    this.levelId = 'level_1';
    this.levelNumber = 1;
    this.levelCount = 1;
    this.levelName = '';
    this.objective = '';
    this.doorOpen = false;
    this.nearPlatePressed = false;
    this.farPlatePressed = false;
    this.completedAtTick = -1;
    this.levelEpoch = 0;
    this.reconnectRemainingSeconds = 0;
    this.collectedKeycardIds = new ArraySchema<string>();
    this.latchedGateIds = new ArraySchema<string>();
    this.pressurePlates = new ArraySchema<PressurePlateSchema>();
    this.teleporters = new ArraySchema<TeleporterSchema>();
    this.keycards = new ArraySchema<KeycardSchema>();
    this.relayButtons = new ArraySchema<RelayButtonSchema>();
    this.players = new ArraySchema<PlayerSchema>();
  }
}

defineTypes(CoopStateSchema, {
  phase: 'string',
  tick: 'uint32',
  levelId: 'string',
  levelNumber: 'uint8',
  levelCount: 'uint8',
  levelName: 'string',
  objective: 'string',
  doorOpen: 'boolean',
  nearPlatePressed: 'boolean',
  farPlatePressed: 'boolean',
  completedAtTick: 'int32',
  levelEpoch: 'uint32',
  reconnectRemainingSeconds: 'float64',
  collectedKeycardIds: ['string'],
  latchedGateIds: ['string'],
  pressurePlates: [PressurePlateSchema],
  teleporters: [TeleporterSchema],
  keycards: [KeycardSchema],
  relayButtons: [RelayButtonSchema],
  players: [PlayerSchema],
});

type MoveResult = {
  seq: number;
  accepted: boolean;
  reason?: string;
  routeKind: RouteKind;
  effectiveWorldX: number;
  effectiveWorldY: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidMoveCommand(value: unknown): value is MoveTargetCommand {
  if (!isRecord(value)) return false;
  const { seq, worldX, worldY } = value;
  const maxWorldX = GRID_WIDTH * CELL_SIZE;
  const maxWorldY = GRID_HEIGHT * CELL_SIZE;
  return typeof seq === 'number'
    && Number.isFinite(seq)
    && Number.isInteger(seq)
    && seq >= 0
    && seq <= MAX_MOVE_SEQUENCE
    && typeof worldX === 'number'
    && Number.isFinite(worldX)
    && worldX >= 0
    && worldX < maxWorldX
    && typeof worldY === 'number'
    && Number.isFinite(worldY)
    && worldY >= 0
    && worldY < maxWorldY;
}

function isValidRestartCommand(value: unknown): value is { seq: number } {
  return isRecord(value)
    && typeof value.seq === 'number'
    && Number.isFinite(value.seq)
    && Number.isInteger(value.seq)
    && value.seq >= 0
    && value.seq <= MAX_RESTART_SEQUENCE;
}

/**
 * Authoritative two-seat adapter. `game` is the sole simulation state; `state`
 * is its deliberately limited Colyseus Schema projection.
 */
export class CoopRoom extends Room<{ state: CoopStateSchema }> {
  override maxClients = 2;
  override patchRate = 1000 / SNAPSHOT_HZ;
  override maxMessagesPerSecond = 30;

  private game: GameState = createGameState(PLAYER_IDS, false);
  private roomMode: RoomMode = 'human-human';
  private pairingGate: PairingTokenGate | null = null;
  private readonly playerBySession = new Map<string, (typeof PLAYER_IDS)[number]>();
  private readonly authorizedPlayerBySession = new Map<string, PlayerId>();
  private readonly requestedAvatarBySession = new Map<string, AvatarId>();
  private readonly droppedSessions = new Set<string>();
  private readonly finalizedSessions = new Set<string>();

  override async onCreate(options: unknown): Promise<void> {
    const parsedOptions = parseJoinOptions(options);
    if (parsedOptions === null) throw new Error('Invalid room creation options.');
    this.roomMode = parsedOptions.roomMode;
    if (this.roomMode === 'human-ai') {
      if (!isHumanAiCreateOptions(parsedOptions)) {
        throw new Error('Human-AI rooms must be created by the MCP teammate.');
      }
      this.pairingGate = new PairingTokenGate(
        parsedOptions.pairingTokenHash,
        parsedOptions.pairingExpiresAt,
      );
    }

    this.roomId = generateId(ROOM_ID_LENGTH);
    await this.setPrivate(true);
    this.setState(new CoopStateSchema());
    this.syncSchema();
    this.setSimulationInterval(() => {
      this.game = stepGame(this.game);
    }, 1000 / SIMULATION_HZ);

    this.onMessage('moveTarget', (client, message: unknown) => this.handleMoveTarget(client, message));
    this.onMessage('restartLevel', (client, message: unknown) => this.handleRestart(client, message));
    this.onMessage('nextLevel', (client, message: unknown) => this.handleNextLevel(client, message));
  }

  override onAuth(client: Client, options: unknown): boolean {
    const parsed = parseJoinOptions(options);
    if (parsed === null || parsed.roomMode !== this.roomMode) {
      throw new Error('Join options do not match this room.');
    }

    if (this.roomMode === 'human-human') {
      if (parsed.controllerKind !== 'human') {
        throw new Error('Only human clients can join this room.');
      }
      if (parsed.avatarId !== undefined) {
        this.requestedAvatarBySession.set(client.sessionId, parsed.avatarId);
      }
      return true;
    }

    if (
      isHumanAiCreateOptions(parsed)
      && this.playerBySession.size === 0
      && !this.authorizedPlayerBySession.has(client.sessionId)
    ) {
      this.authorizedPlayerBySession.set(client.sessionId, 'player-2');
      if (parsed.avatarId !== undefined) {
        this.requestedAvatarBySession.set(client.sessionId, parsed.avatarId);
      }
      return true;
    }

    if (isHumanAiHumanJoinOptions(parsed) && this.pairingGate !== null) {
      const claimed = this.pairingGate.claim(parsed.pairingToken, client.sessionId);
      if (claimed.accepted) {
        this.authorizedPlayerBySession.set(client.sessionId, 'player-1');
        if (parsed.avatarId !== undefined) {
          this.requestedAvatarBySession.set(client.sessionId, parsed.avatarId);
        }
        return true;
      }
    }

    throw new Error('The Player 1 pairing invite is invalid or unavailable.');
  }

  override onBeforePatch(): void {
    this.syncSchema();
  }

  override onJoin(client: Client): void {
    const playerId = this.playerBySession.get(client.sessionId) ?? (
      this.roomMode === 'human-ai'
        ? this.assignAuthorizedSeat(client.sessionId)
        : this.assignSeat(client.sessionId)
    );
    if (playerId === undefined) throw new Error('The coop room already has two seats.');

    if (this.roomMode === 'human-ai' && playerId === 'player-1') {
      const consumed = this.pairingGate?.consumeClaim(client.sessionId);
      if (consumed?.accepted !== true) {
        this.playerBySession.delete(client.sessionId);
        this.authorizedPlayerBySession.delete(client.sessionId);
        this.requestedAvatarBySession.delete(client.sessionId);
        throw new Error('The Player 1 pairing invite expired before seat assignment.');
      }
    }

    const requestedAvatarId = this.requestedAvatarBySession.get(client.sessionId);
    if (requestedAvatarId !== undefined) {
      this.game = setPlayerAvatarId(this.game, playerId, requestedAvatarId);
      this.requestedAvatarBySession.delete(client.sessionId);
    }
    this.game = setPlayerConnected(this.game, playerId, true);
    this.droppedSessions.delete(client.sessionId);
    this.finalizedSessions.delete(client.sessionId);
    this.publish();
    this.sendSeat(client, playerId);

    if (this.playerBySession.size === PLAYER_IDS.length) {
      void this.lock().catch(() => undefined);
    }
  }

  override onDrop(client: Client): void {
    const playerId = this.playerBySession.get(client.sessionId);
    if (playerId === undefined || this.finalizedSessions.has(client.sessionId)) return;

    this.game = setPlayerConnected(this.game, playerId, false);
    this.publish();

    this.droppedSessions.add(client.sessionId);
    // Colyseus retains the session/reconnection token. The handled rejection is
    // expected at timeout and is finalized by onLeave without an unhandled promise.
    void this.allowReconnection(client, RECONNECT_GRACE_SECONDS).catch(() => undefined);
  }

  override onReconnect(client: Client): void {
    const playerId = this.playerBySession.get(client.sessionId);
    if (playerId === undefined || this.finalizedSessions.has(client.sessionId)) {
      throw new Error('Unknown reconnection seat.');
    }
    this.droppedSessions.delete(client.sessionId);
    this.game = setPlayerConnected(this.game, playerId, true);
    this.publish();
    this.sendSeat(client, playerId);
  }

  override onLeave(client: Client): void {
    const playerId = this.playerBySession.get(client.sessionId);
    if (playerId === undefined || this.finalizedSessions.has(client.sessionId)) return;
    this.finalizedSessions.add(client.sessionId);

    const matchHadTwoSeats = this.playerBySession.size === PLAYER_IDS.length;
    const wasActive = this.game.phase !== 'waitingForPlayers';
    this.droppedSessions.delete(client.sessionId);
    this.game = setPlayerConnected(this.game, playerId, false);
    if ((wasActive || matchHadTwoSeats) && this.game.phase !== 'completed') {
      this.game = { ...this.game, phase: 'abandoned' };
      this.broadcast('sessionAbandoned', { playerId });
    }
    this.publish();
  }

  private assignSeat(sessionId: string): (typeof PLAYER_IDS)[number] | undefined {
    const next = PLAYER_IDS.find((playerId) => ![...this.playerBySession.values()].includes(playerId));
    if (next !== undefined) this.playerBySession.set(sessionId, next);
    return next;
  }

  private assignAuthorizedSeat(sessionId: string): PlayerId | undefined {
    const playerId = this.authorizedPlayerBySession.get(sessionId);
    if (playerId === undefined || [...this.playerBySession.values()].includes(playerId)) {
      return undefined;
    }
    this.playerBySession.set(sessionId, playerId);
    return playerId;
  }

  private sendSeat(client: Client, playerId: (typeof PLAYER_IDS)[number]): void {
    client.send('seat', {
      playerId,
      slot: playerId === 'player-1' ? 1 : 2,
      roomId: this.roomId,
    }, { afterNextPatch: true });
  }

  private handleMoveTarget(client: Client, message: unknown): void {
    const playerId = this.playerBySession.get(client.sessionId);
    if (playerId === undefined || !isValidMoveCommand(message)) {
      const seq = isRecord(message) && typeof message.seq === 'number' ? message.seq : -1;
      client.send('moveResult', this.invalidMoveResult(seq));
      return;
    }

    const [next, result] = applyMoveTarget(this.game, playerId, message);
    this.game = next;
    const player = this.game.players[playerId === 'player-1' ? 0 : 1];
    const destination = player.route.at(-1) ?? player.position;
    const response: MoveResult = {
      seq: message.seq,
      accepted: result.accepted,
      routeKind: result.routeKind,
      effectiveWorldX: destination.x,
      effectiveWorldY: destination.y,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    };
    this.publish();
    client.send('moveResult', response);
  }

  private handleRestart(client: Client, message: unknown): void {
    if (
      !this.playerBySession.has(client.sessionId)
      || !isValidRestartCommand(message)
      || this.game.phase !== 'completed'
    ) return;
    const [next, event] = replayCurrentLevel(this.game, message);
    this.game = next;
    this.publish();
    if (event !== null) this.broadcast('levelRestarted', event);
  }

  private handleNextLevel(client: Client, message: unknown): void {
    if (
      !this.playerBySession.has(client.sessionId)
      || !isValidRestartCommand(message)
      || this.game.phase !== 'completed'
    ) return;
    const [next, event] = advanceToNextLevel(this.game, message);
    this.game = next;
    this.publish();
    if (event !== null) this.broadcast('levelAdvanced', event);
  }

  private invalidMoveResult(seq: number): MoveResult {
    return {
      seq,
      accepted: false,
      reason: 'invalid-target',
      routeKind: 'none',
      effectiveWorldX: 0,
      effectiveWorldY: 0,
    };
  }

  private publish(): void {
    this.syncSchema();
    this.broadcastPatch();
  }

  private syncSchema(): void {
    const snapshot = projectNetworkState(this.game);
    const level = getLevelDefinition(snapshot.levelId);
    const players = [...snapshot.players];
    while (this.state.players.length < players.length) this.state.players.push(new PlayerSchema());

    this.state.phase = snapshot.phase;
    this.state.tick = snapshot.tick;
    this.state.levelId = snapshot.levelId;
    this.state.levelNumber = snapshot.levelNumber;
    this.state.levelCount = LEVEL_CATALOG.length;
    this.state.levelName = level.name;
    this.state.objective = COOPERATIVE_DISCOVERY_GOAL;
    this.state.doorOpen = snapshot.doorOpen;
    this.state.nearPlatePressed = snapshot.pressurePlates.some(
      ({ id, occupied }) => id === 'plate_a' && occupied,
    );
    this.state.farPlatePressed = snapshot.pressurePlates.some(
      ({ id, occupied }) => id === 'plate_b' && occupied,
    );
    this.state.completedAtTick = snapshot.completedAtTick ?? -1;
    this.state.levelEpoch = snapshot.levelEpoch;
    this.state.reconnectRemainingSeconds = snapshot.phase === 'reconnectGrace'
      ? Math.max(0, RECONNECT_GRACE_SECONDS - this.game.reconnectElapsedSeconds)
      : 0;

    this.syncMechanisms(snapshot);

    for (let index = 0; index < players.length; index += 1) {
      const source = players[index];
      const target = this.state.players[index];
      if (source === undefined || target === undefined) continue;
      target.id = source.id;
      target.avatarId = source.avatarId;
      target.connected = source.connected;
      target.worldX = source.worldX;
      target.worldY = source.worldY;
      target.routeKind = source.routeKind;
      target.lastMoveSeq = source.lastMoveSeq;
    }
  }

  private syncMechanisms(snapshot: ReturnType<typeof projectNetworkState>): void {
    this.syncStrings(this.state.collectedKeycardIds, snapshot.collectedKeycardIds);
    this.syncStrings(this.state.latchedGateIds, snapshot.latchedGateIds);

    while (this.state.pressurePlates.length > snapshot.pressurePlates.length) {
      this.state.pressurePlates.pop();
    }
    while (this.state.pressurePlates.length < snapshot.pressurePlates.length) {
      this.state.pressurePlates.push(new PressurePlateSchema());
    }
    snapshot.pressurePlates.forEach((source, index) => {
      const target = this.state.pressurePlates[index];
      if (target === undefined) return;
      target.id = source.id;
      target.occupied = source.occupied;
    });

    while (this.state.teleporters.length > snapshot.teleporters.length) {
      this.state.teleporters.pop();
    }
    while (this.state.teleporters.length < snapshot.teleporters.length) {
      this.state.teleporters.push(new TeleporterSchema());
    }
    snapshot.teleporters.forEach((source, index) => {
      const target = this.state.teleporters[index];
      if (target === undefined) return;
      target.id = source.id;
      target.powered = source.powered;
      target.powerId = source.powerId;
      this.syncStrings(target.padIds, source.padIds);
    });

    while (this.state.keycards.length > snapshot.keycards.length) {
      this.state.keycards.pop();
    }
    while (this.state.keycards.length < snapshot.keycards.length) {
      this.state.keycards.push(new KeycardSchema());
    }
    snapshot.keycards.forEach((source, index) => {
      const target = this.state.keycards[index];
      if (target === undefined) return;
      target.id = source.id;
      target.collected = source.collected;
    });

    while (this.state.relayButtons.length > snapshot.relayButtons.length) {
      this.state.relayButtons.pop();
    }
    while (this.state.relayButtons.length < snapshot.relayButtons.length) {
      this.state.relayButtons.push(new RelayButtonSchema());
    }
    snapshot.relayButtons.forEach((source, index) => {
      const target = this.state.relayButtons[index];
      if (target === undefined) return;
      target.id = source.id;
      target.occupiedBy = source.occupiedBy ?? '';
    });
  }

  private syncStrings(target: ArraySchema<string>, source: readonly string[]): void {
    while (target.length > source.length) target.pop();
    while (target.length < source.length) target.push('');
    source.forEach((value, index) => {
      target[index] = value;
    });
  }
}
