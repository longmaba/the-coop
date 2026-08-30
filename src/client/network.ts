import { Client, type Room } from '@colyseus/sdk';
import type { JoinOptions, MoveTargetCommand, RestartCommand } from '../game/index.ts';
import { EMPTY_SNAPSHOT, readSnapshot, type ClientStatus, type CoopSnapshot } from './state.ts';

const SEAT_KEY = 'the-coop:seat';
export const PLAYER_TWO_SEAT_TIMEOUT_MS = 5_000;

export const TRANSITION_MESSAGES = Object.freeze({
  replay: 'restartLevel',
  advance: 'nextLevel',
  replayed: 'levelRestarted',
  advanced: 'levelAdvanced',
});

interface SavedSeat {
  roomId: string;
  reconnectionToken: string;
}

export interface ConnectionEvents {
  onSnapshot: (snapshot: CoopSnapshot) => void;
  onStatus: (status: ClientStatus, detail?: string) => void;
  onSeat: (seat: number | null) => void;
  onMoveResult: (result: NetworkMoveResult) => void;
  onRestarted: () => void;
  onAdvanced: () => void;
  onAbandoned: () => void;
}

export interface NetworkMoveResult {
  seq: number;
  accepted: boolean;
  reason?: string;
  routeKind: 'none' | 'target' | 'threshold-stop';
  effectiveWorldX: number;
  effectiveWorldY: number;
}

interface SeatWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type NetworkClient = Pick<Client, 'create' | 'joinById' | 'reconnect'>;

export class StaleConnectionAttemptError extends Error {
  constructor() {
    super('The connection attempt was superseded before it completed.');
    this.name = 'StaleConnectionAttemptError';
  }
}

function clearSavedSeat(): void {
  sessionStorage.removeItem(SEAT_KEY);
}

function storeSeat(room: Room): void {
  sessionStorage.setItem(SEAT_KEY, JSON.stringify({
    roomId: room.roomId,
    reconnectionToken: room.reconnectionToken,
  } satisfies SavedSeat));
}

function savedSeat(): SavedSeat | null {
  try {
    const value = sessionStorage.getItem(SEAT_KEY);
    if (value === null) return null;
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      const candidate = parsed as Partial<SavedSeat>;
      if (typeof candidate.roomId === 'string' && typeof candidate.reconnectionToken === 'string') return candidate as SavedSeat;
    }
  } catch { /* bad session data is disposable */ }
  return null;
}

export function savedRoomId(): string | null {
  return savedSeat()?.roomId ?? null;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/full|seat reservation/i.test(message)) return 'That room is full.';
  if (/not found|invalid|matchmake/i.test(message)) return 'That room code is invalid or has expired.';
  if (/reconnect/i.test(message)) return 'That previous seat is no longer available.';
  return 'Could not connect to the game server.';
}

export function normalizeSeatPayload(payload: unknown): { playerId: string; seat: number } | null {
  if (payload === null || typeof payload !== 'object') return null;
  const value = payload as { seat?: unknown; index?: unknown; slot?: unknown; playerId?: unknown };
  if (value.playerId !== 'player-1' && value.playerId !== 'player-2') return null;
  const candidate = typeof value.seat === 'number'
    ? value.seat
    : typeof value.index === 'number'
      ? value.index
      : typeof value.slot === 'number'
        ? value.slot - 1
        : Number.NaN;
  return Number.isInteger(candidate) && (candidate === 0 || candidate === 1)
    ? { playerId: value.playerId, seat: candidate }
    : null;
}

export function normalizeMoveResultPayload(payload: unknown): NetworkMoveResult | null {
  if (payload === null || typeof payload !== 'object') return null;
  const result = payload as Partial<NetworkMoveResult>;
  if (
    typeof result.seq !== 'number'
    || !Number.isSafeInteger(result.seq)
    || typeof result.accepted !== 'boolean'
    || (result.routeKind !== 'none' && result.routeKind !== 'target' && result.routeKind !== 'threshold-stop')
    || typeof result.effectiveWorldX !== 'number'
    || !Number.isFinite(result.effectiveWorldX)
    || typeof result.effectiveWorldY !== 'number'
    || !Number.isFinite(result.effectiveWorldY)
    || (result.reason !== undefined && typeof result.reason !== 'string')
  ) return null;
  return {
    seq: result.seq,
    accepted: result.accepted,
    routeKind: result.routeKind,
    effectiveWorldX: result.effectiveWorldX,
    effectiveWorldY: result.effectiveWorldY,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
  };
}

export class CoopNetwork {
  #client: NetworkClient;
  #room: Room | null = null;
  #events: ConnectionEvents;
  #disposers: Array<() => void> = [];
  #seat: number | null = null;
  #serverPlayerId: string | null = null;
  #snapshot = EMPTY_SNAPSHOT;
  #seatWaiters = new Set<SeatWaiter>();
  #seatError: Error | null = null;
  #connectionAttempt = 0;

  constructor(
    events: ConnectionEvents,
    client: NetworkClient = new Client(import.meta.env.VITE_GAME_SERVER_URL ?? 'http://127.0.0.1:2567'),
  ) {
    this.#events = events;
    this.#client = client;
  }

  get roomId(): string | null { return this.#room?.roomId ?? null; }
  get playerId(): string | null { return this.#serverPlayerId ?? this.#room?.sessionId ?? null; }
  get snapshot(): CoopSnapshot { return this.#snapshot; }
  get seat(): number | null { return this.#seat; }

  async create(): Promise<void> {
    this.#events.onStatus('creating');
    await this.#connect(() => this.#client.create('coop'));
  }

  async join(roomId: string, options?: JoinOptions): Promise<void> {
    this.#events.onStatus('joining');
    await this.#connect(() => this.#client.joinById(roomId, options));
  }

  async joinAsPlayerTwo(roomId: string): Promise<void> {
    this.#events.onStatus('joining');
    let attempt: number | null = null;
    try {
      await this.#connect(
        () => this.#client.joinById(roomId),
        (startedAttempt) => { attempt = startedAttempt; },
      );
      await this.#waitForPlayerTwoSeat();
    } catch (error) {
      if (attempt !== null && attempt === this.#connectionAttempt) this.dispose(true);
      throw error;
    }
  }

  async reconnectIfMatching(roomId: string): Promise<boolean> {
    const saved = savedSeat();
    if (saved === null || saved.roomId !== roomId) return false;
    this.#events.onStatus('reconnecting', 'Restoring your saved seat…');
    try {
      await this.#connect(() => this.#client.reconnect(saved.reconnectionToken));
      return true;
    } catch (error) {
      if (error instanceof StaleConnectionAttemptError) throw error;
      sessionStorage.removeItem(SEAT_KEY);
      return false;
    }
  }

  sendMove(command: MoveTargetCommand): boolean {
    if (this.#room === null || !this.#room.connection.isOpen) return false;
    this.#room.send('moveTarget', command);
    return true;
  }
  restart(command: RestartCommand): void { this.#room?.send(TRANSITION_MESSAGES.replay, command); }
  advance(command: RestartCommand): void { this.#room?.send(TRANSITION_MESSAGES.advance, command); }

  dispose(clearSeat = false): void {
    this.#connectionAttempt += 1;
    this.#rejectSeatWaiters(new Error('The connection attempt was cancelled.'));
    for (const dispose of this.#disposers.splice(0)) dispose();
    const room = this.#room;
    this.#room = null;
    this.#seat = null;
    this.#serverPlayerId = null;
    this.#seatError = null;
    if (room !== null) {
      this.#closeRoom(room);
    }
    if (clearSeat) clearSavedSeat();
  }

  async #connect(
    join: () => Promise<Room>,
    onAttempt?: (attempt: number) => void,
  ): Promise<number> {
    this.dispose();
    const attempt = ++this.#connectionAttempt;
    onAttempt?.(attempt);
    try {
      const room = await join();
      this.#fenceRoomReconnection(room, attempt);
      if (attempt !== this.#connectionAttempt || this.#room !== null) {
        this.#closeRoom(room);
        throw new StaleConnectionAttemptError();
      }
      this.#room = room;
      this.#seatError = null;
      // Cover the full server-side grace window, including drops immediately
      // after joining. Nine bounded exponential retries stay within 30 seconds.
      room.reconnection.minUptime = 0;
      room.reconnection.maxRetries = 9;
      storeSeat(room);
      this.#wire(room, attempt);
      this.#events.onStatus('waiting');
      return attempt;
    } catch (error) {
      if (attempt === this.#connectionAttempt) {
        this.#events.onStatus('error', errorText(error));
      }
      throw error;
    }
  }

  #wire(room: Room, attempt: number): void {
    room.onStateChange((state) => {
      if (!this.#isCurrentRoom(room, attempt)) return;
      this.#snapshot = readSnapshot(state);
      this.#events.onSnapshot(this.#snapshot);
      this.#events.onStatus(this.#snapshot.phase === 'playing' ? 'playing' : this.#snapshot.phase === 'abandoned' ? 'abandoned' : 'waiting');
      if (this.#seat === null) {
        const seat = this.#snapshot.players.findIndex((player) => player.id === this.#serverPlayerId || player.id === room.sessionId);
        if (seat >= 0) { this.#seat = seat; this.#events.onSeat(seat); }
      }
    });
    room.onDrop(() => {
      if (!this.#isCurrentRoom(room, attempt)) return;
      this.#events.onStatus('reconnecting', 'Connection lost. Retrying…');
    });
    room.onReconnect(() => {
      if (!this.#isCurrentRoom(room, attempt)) return;
      // The SDK publishes onReconnect immediately before rotating its token.
      queueMicrotask(() => {
        if (this.#isCurrentRoom(room, attempt)) storeSeat(room);
      });
      this.#events.onStatus('waiting', 'Connection restored.');
    });
    room.onError((_code, message) => {
      if (!this.#isCurrentRoom(room, attempt)) return;
      this.#events.onStatus('error', errorText(message));
    });
    room.onLeave(() => {
      if (!this.#isCurrentRoom(room, attempt)) return;
      this.#rejectSeatWaiters(new Error('The room closed before Player 2 was assigned.'));
      this.#events.onStatus('abandoned', 'The session ended.');
    });
    this.#disposers.push(room.onMessage('seat', (payload: unknown) => {
      if (!this.#isCurrentRoom(room, attempt)) return;
      const seat = normalizeSeatPayload(payload);
      if (seat === null) {
        this.#seat = null;
        this.#serverPlayerId = null;
        this.#events.onSeat(null);
        this.#seatError = new Error('The server returned an invalid seat assignment.');
        this.#rejectSeatWaiters(this.#seatError);
        this.#events.onStatus('error', this.#seatError.message);
        return;
      }
      this.#serverPlayerId = seat.playerId;
      this.#seat = seat.seat;
      this.#events.onSeat(seat.seat);
      if (seat.seat === 1 && seat.playerId === 'player-2') {
        this.#resolveSeatWaiters();
      } else {
        this.#seatError = new Error(
          `Expected Player 2 in seat 2, but the server assigned ${seat.playerId} in seat ${seat.seat + 1}.`,
        );
        this.#rejectSeatWaiters(this.#seatError);
      }
    }));
    this.#disposers.push(room.onMessage('moveResult', (payload: unknown) => {
      if (!this.#isCurrentRoom(room, attempt)) return;
      const result = normalizeMoveResultPayload(payload);
      if (result === null) {
        this.#events.onStatus('error', 'The server returned an invalid movement result.');
        return;
      }
      this.#events.onMoveResult(result);
    }));
    this.#disposers.push(room.onMessage(TRANSITION_MESSAGES.replayed, () => {
      if (this.#isCurrentRoom(room, attempt)) this.#events.onRestarted();
    }));
    this.#disposers.push(room.onMessage('restarted', () => {
      if (this.#isCurrentRoom(room, attempt)) this.#events.onRestarted();
    }));
    this.#disposers.push(room.onMessage(TRANSITION_MESSAGES.advanced, () => {
      if (this.#isCurrentRoom(room, attempt)) this.#events.onAdvanced();
    }));
    this.#disposers.push(room.onMessage('sessionAbandoned', () => {
      if (!this.#isCurrentRoom(room, attempt)) return;
      clearSavedSeat();
      this.#events.onAbandoned();
    }));
    this.#disposers.push(room.onMessage('opponentLeft', () => {
      if (!this.#isCurrentRoom(room, attempt)) return;
      clearSavedSeat();
      this.#events.onAbandoned();
    }));
  }

  #isCurrentRoom(room: Room, attempt: number): boolean {
    return this.#room === room && this.#connectionAttempt === attempt;
  }

  #fenceRoomReconnection(room: Room, attempt: number): void {
    const reconnect = room.connection.reconnect.bind(room.connection);
    room.connection.reconnect = (query) => {
      if (
        this.#isCurrentRoom(room, attempt)
        && room.reconnection.enabled
      ) reconnect(query);
    };
  }

  #closeRoom(room: Room): void {
    room.reconnection.enabled = false;
    room.reconnection.maxRetries = 0;
    room.reconnection.isReconnecting = false;
    room.reconnection.enqueuedMessages.length = 0;
    room.removeAllListeners();
    const leave = room.connection.isOpen ? room.leave() : room.leave(false);
    void leave.catch(() => {
      room.connection.close();
    });
  }

  async #waitForPlayerTwoSeat(): Promise<void> {
    if (this.#seat === 1 && this.#serverPlayerId === 'player-2') return;
    if (this.#seatError !== null) throw this.#seatError;
    await new Promise<void>((resolve, reject) => {
      const waiter: SeatWaiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.#seatWaiters.delete(waiter);
          reject(new Error('Timed out waiting for the authoritative Player 2 seat assignment.'));
        }, PLAYER_TWO_SEAT_TIMEOUT_MS),
      };
      this.#seatWaiters.add(waiter);
    });
  }

  #resolveSeatWaiters(): void {
    for (const waiter of this.#seatWaiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve();
    }
    this.#seatWaiters.clear();
  }

  #rejectSeatWaiters(error: Error): void {
    for (const waiter of this.#seatWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.#seatWaiters.clear();
  }
}
