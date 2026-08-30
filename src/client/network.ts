import { Client, type Room } from '@colyseus/sdk';
import type { JoinOptions, MoveTargetCommand, RestartCommand } from '../game/index.ts';
import { HostedNetwork } from './hosted-network.ts';
import {
  clearSavedSeat,
  savedSeat,
  storeSavedSeat,
} from './seat-storage.ts';
import { EMPTY_SNAPSHOT, readSnapshot, type ClientStatus, type CoopSnapshot } from './state.ts';

export { savedRoomId } from './seat-storage.ts';

export const TRANSITION_MESSAGES = Object.freeze({
  replay: 'restartLevel',
  advance: 'nextLevel',
  replayed: 'levelRestarted',
  advanced: 'levelAdvanced',
});

const LOCAL_GAME_SERVER_URL = 'http://127.0.0.1:2567';

export interface ConnectionEvents {
  onSnapshot: (snapshot: CoopSnapshot) => void;
  onStatus: (status: ClientStatus, detail?: string) => void;
  onSeat: (seat: number | null) => void;
  onMoveResult: (result: { accepted: boolean; reason?: string; routeKind?: string }) => void;
  onRestarted: () => void;
  onAdvanced: () => void;
  onAbandoned: () => void;
}

export interface NetworkTransport {
  readonly roomId: string | null;
  readonly playerId: string | null;
  readonly snapshot: CoopSnapshot;
  readonly seat: number | null;
  create(): Promise<void>;
  join(roomId: string, options?: JoinOptions): Promise<void>;
  reconnectIfMatching(roomId: string): Promise<boolean>;
  sendMove(command: MoveTargetCommand): void;
  restart(command: RestartCommand): void;
  advance(command: RestartCommand): void;
  dispose(clearSeat?: boolean): void;
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

export function resolveGameServerUrl(
  configuredUrl: string | undefined,
  mode: string,
  browserOrigin: string | undefined,
): string {
  const configured = configuredUrl?.trim();
  if (configured !== undefined && configured.length > 0) return configured;
  if (mode !== 'production' || browserOrigin === undefined) return LOCAL_GAME_SERVER_URL;

  try {
    const origin = new URL(browserOrigin).origin;
    return origin === 'null' ? LOCAL_GAME_SERVER_URL : origin;
  } catch {
    return LOCAL_GAME_SERVER_URL;
  }
}

class ColyseusNetwork implements NetworkTransport {
  #client: Client;
  #room: Room | null = null;
  #events: ConnectionEvents;
  #disposers: Array<() => void> = [];
  #seat: number | null = null;
  #serverPlayerId: string | null = null;
  #snapshot = EMPTY_SNAPSHOT;

  constructor(events: ConnectionEvents) {
    this.#events = events;
    this.#client = new Client(resolveGameServerUrl(
      import.meta.env.VITE_GAME_SERVER_URL,
      import.meta.env.MODE,
      typeof window === 'undefined' ? undefined : window.location.origin,
    ));
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

  async reconnectIfMatching(roomId: string): Promise<boolean> {
    const saved = savedSeat();
    if (saved === null || saved.roomId !== roomId) return false;
    this.#events.onStatus('reconnecting', 'Restoring your saved seat…');
    try {
      await this.#connect(() => this.#client.reconnect(saved.reconnectionToken));
      return true;
    } catch {
      clearSavedSeat();
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
      storeSavedSeat(room.roomId, room.reconnectionToken);
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
        if (this.#room === room) {
          storeSavedSeat(room.roomId, room.reconnectionToken);
        }
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

export function usesHostedTransport(mode: string): boolean {
  return mode === 'sites';
}

export class CoopNetwork implements NetworkTransport {
  readonly #transport: NetworkTransport;

  constructor(events: ConnectionEvents, mode = import.meta.env.MODE) {
    this.#transport = usesHostedTransport(mode)
      ? new HostedNetwork(events)
      : new ColyseusNetwork(events);
  }

  get roomId(): string | null { return this.#transport.roomId; }
  get playerId(): string | null { return this.#transport.playerId; }
  get snapshot(): CoopSnapshot { return this.#transport.snapshot; }
  get seat(): number | null { return this.#transport.seat; }

  create(): Promise<void> { return this.#transport.create(); }
  join(roomId: string, options?: JoinOptions): Promise<void> {
    return this.#transport.join(roomId, options);
  }
  reconnectIfMatching(roomId: string): Promise<boolean> {
    return this.#transport.reconnectIfMatching(roomId);
  }
  sendMove(command: MoveTargetCommand): void { this.#transport.sendMove(command); }
  restart(command: RestartCommand): void { this.#transport.restart(command); }
  advance(command: RestartCommand): void { this.#transport.advance(command); }
  dispose(clearSeat = false): void { this.#transport.dispose(clearSeat); }
}
