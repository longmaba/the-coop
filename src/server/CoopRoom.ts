import { Room, generateId } from '@colyseus/core';
import { ArraySchema, Schema, defineTypes } from '@colyseus/schema';
import {
  CELL_SIZE,
  GRID_HEIGHT,
  GRID_WIDTH,
  RECONNECT_GRACE_SECONDS,
  SIMULATION_HZ,
  SNAPSHOT_HZ,
  applyMoveTarget,
  createGameState,
  plateIsPressed,
  restartGame,
  setPlayerConnected,
  stepGame,
} from '../game/index.ts';
import { LEVEL_ONE } from '../game/index.ts';
import type { Client } from '@colyseus/core';
import type { GameState, MoveTargetCommand, RouteKind } from '../game/index.ts';

const PLAYER_IDS = ['player-1', 'player-2'] as const;
const ROOM_ID_LENGTH = 24;
const MAX_MOVE_SEQUENCE = 2_147_483_647;
const MAX_RESTART_SEQUENCE = 2_147_483_647;

export class PlayerSchema extends Schema {
  declare id: string;
  declare connected: boolean;
  declare worldX: number;
  declare worldY: number;
  declare routeKind: string;
  declare lastMoveSeq: number;

  constructor() {
    super();
    this.id = '';
    this.connected = false;
    this.worldX = 0;
    this.worldY = 0;
    this.routeKind = 'none';
    this.lastMoveSeq = -1;
  }
}

defineTypes(PlayerSchema, {
  id: 'string',
  connected: 'boolean',
  worldX: 'float64',
  worldY: 'float64',
  routeKind: 'string',
  lastMoveSeq: 'int32',
});

/** Network projection only. Routes and reconnection tokens never leave the room. */
export class CoopStateSchema extends Schema {
  declare phase: string;
  declare tick: number;
  declare doorOpen: boolean;
  declare nearPlatePressed: boolean;
  declare farPlatePressed: boolean;
  declare completedAtTick: number;
  declare levelEpoch: number;
  declare reconnectRemainingSeconds: number;
  declare players: ArraySchema<PlayerSchema>;

  constructor() {
    super();
    this.phase = 'waitingForPlayers';
    this.tick = 0;
    this.doorOpen = false;
    this.nearPlatePressed = false;
    this.farPlatePressed = false;
    this.completedAtTick = -1;
    this.levelEpoch = 0;
    this.reconnectRemainingSeconds = 0;
    this.players = new ArraySchema<PlayerSchema>();
  }
}

defineTypes(CoopStateSchema, {
  phase: 'string',
  tick: 'uint32',
  doorOpen: 'boolean',
  nearPlatePressed: 'boolean',
  farPlatePressed: 'boolean',
  completedAtTick: 'int32',
  levelEpoch: 'uint32',
  reconnectRemainingSeconds: 'float64',
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
  private readonly playerBySession = new Map<string, (typeof PLAYER_IDS)[number]>();
  private readonly droppedSessions = new Set<string>();
  private readonly finalizedSessions = new Set<string>();

  override async onCreate(): Promise<void> {
    this.roomId = generateId(ROOM_ID_LENGTH);
    await this.setPrivate(true);
    this.setState(new CoopStateSchema());
    this.syncSchema();
    this.setSimulationInterval(() => {
      this.game = stepGame(this.game);
    }, 1000 / SIMULATION_HZ);

    this.onMessage('moveTarget', (client, message: unknown) => this.handleMoveTarget(client, message));
    this.onMessage('restartLevel', (client, message: unknown) => this.handleRestart(client, message));
  }

  override onBeforePatch(): void {
    this.syncSchema();
  }

  override onJoin(client: Client): void {
    const playerId = this.playerBySession.get(client.sessionId) ?? this.assignSeat(client.sessionId);
    if (playerId === undefined) throw new Error('The coop room already has two seats.');

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
    if (!isValidRestartCommand(message) || this.game.phase !== 'completed') return;
    const [next, event] = restartGame(this.game, message);
    this.game = next;
    this.publish();
    if (event !== null) this.broadcast('levelRestarted', event);
    // Referencing the sender makes unauthorized command ownership explicit even
    // though either connected seat may request a completed-level restart.
    void client;
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
    const [first, second] = this.game.players;
    const players = [first, second];
    while (this.state.players.length < players.length) this.state.players.push(new PlayerSchema());

    this.state.phase = this.game.phase;
    this.state.tick = this.game.tick;
    this.state.doorOpen = this.game.doorOpen;
    this.state.nearPlatePressed = players.some((player) => plateIsPressed(player.position, LEVEL_ONE.nearPlate));
    this.state.farPlatePressed = players.some((player) => plateIsPressed(player.position, LEVEL_ONE.farPlate));
    this.state.completedAtTick = this.game.completedAtTick ?? -1;
    this.state.levelEpoch = Math.max(0, this.game.restartSeq);
    this.state.reconnectRemainingSeconds = this.game.phase === 'reconnectGrace'
      ? Math.max(0, RECONNECT_GRACE_SECONDS - this.game.reconnectElapsedSeconds)
      : 0;

    for (let index = 0; index < players.length; index += 1) {
      const source = players[index];
      const target = this.state.players[index];
      if (source === undefined || target === undefined) continue;
      target.id = source.id;
      target.connected = source.connected;
      target.worldX = source.position.x;
      target.worldY = source.position.y;
      target.routeKind = source.routeKind;
      target.lastMoveSeq = source.lastMoveSeq;
    }
  }
}
