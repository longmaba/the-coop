import {
  hydrateGameStateAvatarIds,
  parseJoinOptions,
  LEVEL_CATALOG,
  RECONNECT_GRACE_SECONDS,
  SIMULATION_HZ,
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
import type {
  GameState,
  HumanHumanJoinOptions,
  MoveCommandResult,
  MoveTargetCommand,
  RestartCommand,
} from '../game/index.ts';

const PLAYER_IDS = ['player-1', 'player-2'] as const;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;
const CLIENT_STALE_MS = 4_000;
const ROOM_EXPIRY_MS = 24 * 60 * 60 * 1_000;
const MAX_ADVANCE_STEPS = SIMULATION_HZ * 60;
const MAX_MUTATION_ATTEMPTS = 6;
const STEP_MS = 1_000 / SIMULATION_HZ;

export type HostedSeat = 0 | 1;

export interface HostedRoomRecord {
  roomId: string;
  revision: number;
  gameState: GameState;
  simulatedAtMs: number;
  updatedAtMs: number;
  playerOneTokenHash: string;
  playerOneLastSeenMs: number | null;
  playerTwoTokenHash: string | null;
  playerTwoLastSeenMs: number | null;
}

export interface HostedRoomStore {
  create(record: HostedRoomRecord): Promise<boolean>;
  read(roomId: string): Promise<HostedRoomRecord | null>;
  compareAndSwap(expectedRevision: number, record: HostedRoomRecord): Promise<boolean>;
  deleteUpdatedBefore(timestampMs: number): Promise<void>;
}

export interface HostedSessionPayload {
  roomId: string;
  token: string;
  playerId: (typeof PLAYER_IDS)[number];
  seat: HostedSeat;
  snapshot: HostedSnapshot;
}

export interface HostedStatePayload {
  snapshot: HostedSnapshot;
}

export interface HostedMovePayload extends HostedStatePayload {
  result: MoveCommandResult;
}

export interface HostedTransitionPayload extends HostedStatePayload {
  changed: boolean;
}

export interface HostedSnapshot {
  phase: GameState['phase'];
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
  collectedKeycardIds: readonly string[];
  latchedGateIds: readonly string[];
  pressurePlates: ReadonlyArray<{ id: string; occupied: boolean }>;
  teleporters: ReadonlyArray<{
    id: string;
    powered: boolean;
    powerId: string;
    padIds: readonly string[];
  }>;
  keycards: ReadonlyArray<{ id: string; collected: boolean }>;
  relayButtons: ReadonlyArray<{ id: string; occupiedBy: string | null }>;
  players: ReadonlyArray<{
    id: string;
    avatarId: string;
    connected: boolean;
    worldX: number;
    worldY: number;
    routeKind: string;
    lastMoveSeq: number;
  }>;
}

export class HostedServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HostedServiceError';
  }
}

interface ServiceOptions {
  now?: () => number;
  randomToken?: (byteLength: number) => string;
  hashToken?: (token: string) => Promise<string>;
}

function randomToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function equalTokenHashes(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function assertRoomId(roomId: string): void {
  if (!ROOM_ID_PATTERN.test(roomId)) {
    throw new HostedServiceError(400, 'invalid-room', 'That room code is invalid.');
  }
}

function parseHostedHumanOptions(value: unknown): HumanHumanJoinOptions {
  const parsed = parseJoinOptions(value);
  if (parsed === null || parsed.roomMode !== 'human-human' || parsed.controllerKind !== 'human') {
    throw new HostedServiceError(400, 'invalid-request', 'The request is invalid.');
  }
  return parsed;
}

function advanceSimulation(
  gameState: GameState,
  simulatedAtMs: number,
  nowMs: number,
): { gameState: GameState; simulatedAtMs: number } {
  if (
    gameState.phase === 'waitingForPlayers'
    || gameState.phase === 'completed'
    || gameState.phase === 'abandoned'
  ) {
    return { gameState, simulatedAtMs: nowMs };
  }

  const availableSteps = Math.max(
    0,
    Math.floor((nowMs - simulatedAtMs) / STEP_MS + Number.EPSILON),
  );
  const stepCount = Math.min(availableSteps, MAX_ADVANCE_STEPS);
  let next = gameState;
  for (let index = 0; index < stepCount; index += 1) {
    next = stepGame(next);
    if (next.phase === 'completed' || next.phase === 'abandoned') break;
  }

  const reachedStablePhase = next.phase === 'completed' || next.phase === 'abandoned';
  const droppedOldTime = availableSteps > MAX_ADVANCE_STEPS;
  return {
    gameState: next,
    simulatedAtMs: reachedStablePhase || droppedOldTime
      ? nowMs
      : simulatedAtMs + stepCount * STEP_MS,
  };
}

export function projectHostedSnapshot(gameState: GameState): HostedSnapshot {
  const projection = projectNetworkState(gameState);
  const level = getLevelDefinition(gameState.levelId);
  return {
    ...projection,
    levelCount: LEVEL_CATALOG.length,
    levelName: level.name,
    objective: level.objective,
    nearPlatePressed: projection.pressurePlates
      .some(({ id, occupied }) => id === 'plate_a' && occupied),
    farPlatePressed: projection.pressurePlates
      .some(({ id, occupied }) => id === 'plate_b' && occupied),
    reconnectRemainingSeconds: gameState.phase === 'reconnectGrace'
      ? Math.max(0, RECONNECT_GRACE_SECONDS - gameState.reconnectElapsedSeconds)
      : 0,
  };
}

export class HostedGameService {
  readonly #now: () => number;
  readonly #randomToken: (byteLength: number) => string;
  readonly #hashToken: (token: string) => Promise<string>;

  constructor(
    readonly store: HostedRoomStore,
    options: ServiceOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#randomToken = options.randomToken ?? randomToken;
    this.#hashToken = options.hashToken ?? hashToken;
  }

  async createRoom(options?: unknown): Promise<HostedSessionPayload> {
    const joinOptions = parseHostedHumanOptions(options);
    const nowMs = this.#now();
    await this.store.deleteUpdatedBefore(nowMs - ROOM_EXPIRY_MS);

    for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
      const roomId = this.#randomToken(18);
      const token = this.#randomToken(32);
      const playerOneTokenHash = await this.#hashToken(token);
      const disconnected = createGameState(PLAYER_IDS, false);
      const selected = joinOptions.avatarId === undefined
        ? disconnected
        : setPlayerAvatarId(disconnected, PLAYER_IDS[0], joinOptions.avatarId);
      const gameState = setPlayerConnected(selected, PLAYER_IDS[0], true);
      const record: HostedRoomRecord = {
        roomId,
        revision: 0,
        gameState,
        simulatedAtMs: nowMs,
        updatedAtMs: nowMs,
        playerOneTokenHash,
        playerOneLastSeenMs: nowMs,
        playerTwoTokenHash: null,
        playerTwoLastSeenMs: null,
      };
      if (await this.store.create(record)) {
        return this.#session(record, token, 0);
      }
    }

    throw new HostedServiceError(
      503,
      'room-id-exhausted',
      'A room could not be created. Try again.',
    );
  }

  async joinRoom(roomId: string, options?: unknown): Promise<HostedSessionPayload> {
    const joinOptions = parseHostedHumanOptions(options);
    assertRoomId(roomId);
    const token = this.#randomToken(32);
    const tokenHash = await this.#hashToken(token);

    for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
      const current = await this.#requiredRoom(roomId);
      const nowMs = this.#now();
      const prepared = this.#prepare(current, null, nowMs);
      if (prepared.gameState.phase === 'abandoned') {
        throw new HostedServiceError(410, 'room-ended', 'That room has ended.');
      }
      if (prepared.playerTwoTokenHash !== null) {
        throw new HostedServiceError(409, 'room-full', 'That room is full.');
      }

      const selected = joinOptions.avatarId === undefined
        ? prepared.gameState
        : setPlayerAvatarId(prepared.gameState, PLAYER_IDS[1], joinOptions.avatarId);
      const gameState = setPlayerConnected(selected, PLAYER_IDS[1], true);
      const next: HostedRoomRecord = {
        ...prepared,
        revision: current.revision + 1,
        gameState,
        updatedAtMs: nowMs,
        playerTwoTokenHash: tokenHash,
        playerTwoLastSeenMs: nowMs,
      };
      if (await this.store.compareAndSwap(current.revision, next)) {
        return this.#session(next, token, 1);
      }
    }

    throw this.#busyError();
  }

  async reconnectRoom(roomId: string, token: string): Promise<HostedSessionPayload> {
    const { record, seat } = await this.#mutateAuthenticated(
      roomId,
      token,
      (prepared) => {
        if (prepared.gameState.phase === 'abandoned') {
          throw new HostedServiceError(410, 'room-ended', 'That room has ended.');
        }
        return { record: prepared, result: undefined };
      },
    );
    return this.#session(record, token, seat);
  }

  async getState(roomId: string, token: string): Promise<HostedStatePayload> {
    const { record } = await this.#mutateAuthenticated(
      roomId,
      token,
      (prepared) => ({ record: prepared, result: undefined }),
    );
    return { snapshot: projectHostedSnapshot(record.gameState) };
  }

  async move(
    roomId: string,
    token: string,
    command: MoveTargetCommand,
  ): Promise<HostedMovePayload> {
    const { record, result } = await this.#mutateAuthenticated(
      roomId,
      token,
      (prepared, seat) => {
        const [gameState, moveResult] = applyMoveTarget(
          prepared.gameState,
          PLAYER_IDS[seat],
          command,
        );
        return {
          record: { ...prepared, gameState },
          result: moveResult,
        };
      },
    );
    return { result, snapshot: projectHostedSnapshot(record.gameState) };
  }

  async replay(
    roomId: string,
    token: string,
    command: RestartCommand,
  ): Promise<HostedTransitionPayload> {
    return this.#transition(roomId, token, command, 'replay');
  }

  async advance(
    roomId: string,
    token: string,
    command: RestartCommand,
  ): Promise<HostedTransitionPayload> {
    return this.#transition(roomId, token, command, 'advance');
  }

  async leave(roomId: string, token: string): Promise<void> {
    await this.#mutateAuthenticated(roomId, token, (prepared, seat) => {
      const gameState = setPlayerConnected(prepared.gameState, PLAYER_IDS[seat], false);
      return {
        record: seat === 0
          ? { ...prepared, gameState, playerOneLastSeenMs: null }
          : { ...prepared, gameState, playerTwoLastSeenMs: null },
        result: undefined,
      };
    });
  }

  async #transition(
    roomId: string,
    token: string,
    command: RestartCommand,
    kind: 'replay' | 'advance',
  ): Promise<HostedTransitionPayload> {
    const { record, result } = await this.#mutateAuthenticated(
      roomId,
      token,
      (prepared) => {
        const [gameState, event] = kind === 'replay'
          ? replayCurrentLevel(prepared.gameState, command)
          : advanceToNextLevel(prepared.gameState, command);
        return {
          record: { ...prepared, gameState },
          result: event !== null,
        };
      },
    );
    return { changed: result, snapshot: projectHostedSnapshot(record.gameState) };
  }

  async #mutateAuthenticated<T>(
    roomId: string,
    token: string,
    mutate: (
      prepared: HostedRoomRecord,
      seat: HostedSeat,
    ) => { record: HostedRoomRecord; result: T },
  ): Promise<{ record: HostedRoomRecord; result: T; seat: HostedSeat }> {
    assertRoomId(roomId);
    if (token.length < 20 || token.length > 256) {
      throw new HostedServiceError(401, 'invalid-seat', 'That seat is unavailable.');
    }
    const tokenHash = await this.#hashToken(token);

    for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
      const current = await this.#requiredRoom(roomId);
      const seat = this.#seatForHash(current, tokenHash);
      if (seat === null) {
        throw new HostedServiceError(401, 'invalid-seat', 'That seat is unavailable.');
      }
      const nowMs = this.#now();
      const prepared = this.#prepare(current, seat, nowMs);
      const mutation = mutate(prepared, seat);
      const next: HostedRoomRecord = {
        ...mutation.record,
        revision: current.revision + 1,
        updatedAtMs: nowMs,
      };
      if (await this.store.compareAndSwap(current.revision, next)) {
        return { record: next, result: mutation.result, seat };
      }
    }

    throw this.#busyError();
  }

  #prepare(
    current: HostedRoomRecord,
    currentSeat: HostedSeat | null,
    nowMs: number,
  ): HostedRoomRecord {
    let playerOneLastSeenMs = current.playerOneLastSeenMs;
    let playerTwoLastSeenMs = current.playerTwoLastSeenMs;
    if (currentSeat === 0) playerOneLastSeenMs = nowMs;
    if (currentSeat === 1) playerTwoLastSeenMs = nowMs;

    const playerOneConnected = playerOneLastSeenMs !== null
      && nowMs - playerOneLastSeenMs <= CLIENT_STALE_MS;
    const playerTwoConnected = current.playerTwoTokenHash !== null
      && playerTwoLastSeenMs !== null
      && nowMs - playerTwoLastSeenMs <= CLIENT_STALE_MS;
    let gameState = setPlayerConnected(
      current.gameState,
      PLAYER_IDS[0],
      playerOneConnected,
    );
    gameState = setPlayerConnected(gameState, PLAYER_IDS[1], playerTwoConnected);
    const advanced = advanceSimulation(gameState, current.simulatedAtMs, nowMs);

    return {
      ...current,
      gameState: advanced.gameState,
      simulatedAtMs: advanced.simulatedAtMs,
      playerOneLastSeenMs,
      playerTwoLastSeenMs,
    };
  }

  #seatForHash(record: HostedRoomRecord, tokenHash: string): HostedSeat | null {
    if (equalTokenHashes(record.playerOneTokenHash, tokenHash)) return 0;
    if (
      record.playerTwoTokenHash !== null
      && equalTokenHashes(record.playerTwoTokenHash, tokenHash)
    ) return 1;
    return null;
  }

  async #requiredRoom(roomId: string): Promise<HostedRoomRecord> {
    const room = await this.store.read(roomId);
    if (room === null) {
      throw new HostedServiceError(404, 'room-not-found', 'That room code is invalid or has expired.');
    }
    return {
      ...room,
      gameState: hydrateGameStateAvatarIds(room.gameState),
    };
  }

  #session(
    record: HostedRoomRecord,
    token: string,
    seat: HostedSeat,
  ): HostedSessionPayload {
    return {
      roomId: record.roomId,
      token,
      playerId: PLAYER_IDS[seat],
      seat,
      snapshot: projectHostedSnapshot(record.gameState),
    };
  }

  #busyError(): HostedServiceError {
    return new HostedServiceError(
      409,
      'room-busy',
      'The room changed at the same time. Try again.',
    );
  }
}
