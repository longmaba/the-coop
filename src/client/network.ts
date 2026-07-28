import { Client, type Room } from '@colyseus/sdk';
import type { JoinOptions, MoveTargetCommand, RestartCommand } from '../game/index.ts';
import { EMPTY_SNAPSHOT, readSnapshot, type ClientStatus, type CoopSnapshot } from './state.ts';

const SEAT_KEY = 'the-coop:seat';

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
  onMoveResult: (result: { accepted: boolean; reason?: string; routeKind?: string }) => void;
  onRestarted: () => void;
  onAdvanced: () => void;
  onAbandoned: () => void;
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
  if (typeof value.playerId !== 'string' || value.playerId.length === 0) return null;
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

export class CoopNetwork {
  #client = new Client(import.meta.env.VITE_GAME_SERVER_URL ?? 'http://127.0.0.1:2567');
  #room: Room | null = null;
  #events: ConnectionEvents;
  #disposers: Array<() => void> = [];
  #seat: number | null = null;
  #serverPlayerId: string | null = null;
  #snapshot = EMPTY_SNAPSHOT;

  constructor(events: ConnectionEvents) { this.#events = events; }

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

  async reconnectIfMatching(roomId: string): Promise<boolean> {
    const saved = savedSeat();
    if (saved === null || saved.roomId !== roomId) return false;
    this.#events.onStatus('reconnecting', 'Restoring your saved seat…');
    try {
      await this.#connect(() => this.#client.reconnect(saved.reconnectionToken));
      return true;
    } catch {
      sessionStorage.removeItem(SEAT_KEY);
      return false;
    }
  }

  sendMove(command: MoveTargetCommand): void { this.#room?.send('moveTarget', command); }
  restart(command: RestartCommand): void { this.#room?.send(TRANSITION_MESSAGES.replay, command); }
  advance(command: RestartCommand): void { this.#room?.send(TRANSITION_MESSAGES.advance, command); }

  dispose(clearSeat = false): void {
    for (const dispose of this.#disposers.splice(0)) dispose();
    const room = this.#room;
    this.#room = null;
    this.#seat = null;
    this.#serverPlayerId = null;
    if (room !== null) {
      room.removeAllListeners();
      void room.leave().catch(() => undefined);
    }
    if (clearSeat) clearSavedSeat();
  }

  async #connect(join: () => Promise<Room>): Promise<void> {
    this.dispose();
    try {
      const room = await join();
      this.#room = room;
      // Cover the full server-side grace window, including drops immediately
      // after joining. Nine bounded exponential retries stay within 30 seconds.
      room.reconnection.minUptime = 0;
      room.reconnection.maxRetries = 9;
      storeSeat(room);
      this.#wire(room);
      this.#events.onStatus('waiting');
    } catch (error) {
      this.#events.onStatus('error', errorText(error));
      throw error;
    }
  }

  #wire(room: Room): void {
    room.onStateChange((state) => {
      this.#snapshot = readSnapshot(state);
      this.#events.onSnapshot(this.#snapshot);
      this.#events.onStatus(this.#snapshot.phase === 'playing' ? 'playing' : this.#snapshot.phase === 'abandoned' ? 'abandoned' : 'waiting');
      if (this.#seat === null) {
        const seat = this.#snapshot.players.findIndex((player) => player.id === this.#serverPlayerId || player.id === room.sessionId);
        if (seat >= 0) { this.#seat = seat; this.#events.onSeat(seat); }
      }
    });
    room.onDrop(() => this.#events.onStatus('reconnecting', 'Connection lost. Retrying…'));
    room.onReconnect(() => {
      // The SDK publishes onReconnect immediately before rotating its token.
      queueMicrotask(() => {
        if (this.#room === room) storeSeat(room);
      });
      this.#events.onStatus('waiting', 'Connection restored.');
    });
    room.onError((_code, message) => this.#events.onStatus('error', errorText(message)));
    room.onLeave(() => {
      if (this.#room !== room) return;
      this.#events.onStatus('abandoned', 'The session ended.');
    });
    this.#disposers.push(room.onMessage('seat', (payload: unknown) => {
      const seat = normalizeSeatPayload(payload);
      if (seat === null) {
        this.#seat = null;
        this.#serverPlayerId = null;
        this.#events.onSeat(null);
        this.#events.onStatus('error', 'The server returned an invalid seat assignment.');
        return;
      }
      this.#serverPlayerId = seat.playerId;
      this.#seat = seat.seat;
      this.#events.onSeat(seat.seat);
    }));
    this.#disposers.push(room.onMessage('moveResult', (payload: unknown) => {
      const result = payload as { accepted?: unknown; reason?: unknown; routeKind?: unknown };
      const normalized = { accepted: result.accepted === true };
      this.#events.onMoveResult({
        ...normalized,
        ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
        ...(typeof result.routeKind === 'string' ? { routeKind: result.routeKind } : {}),
      });
    }));
    this.#disposers.push(room.onMessage(TRANSITION_MESSAGES.replayed, () => this.#events.onRestarted()));
    this.#disposers.push(room.onMessage('restarted', () => this.#events.onRestarted()));
    this.#disposers.push(room.onMessage(TRANSITION_MESSAGES.advanced, () => this.#events.onAdvanced()));
    this.#disposers.push(room.onMessage('sessionAbandoned', () => {
      clearSavedSeat();
      this.#events.onAbandoned();
    }));
    this.#disposers.push(room.onMessage('opponentLeft', () => {
      clearSavedSeat();
      this.#events.onAbandoned();
    }));
  }
}
