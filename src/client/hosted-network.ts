import type { JoinOptions, MoveTargetCommand, RestartCommand } from '../game/index.ts';
import type {
  HostedMovePayload,
  HostedSessionPayload,
  HostedStatePayload,
  HostedTransitionPayload,
} from '../hosted/service.ts';
import type { ConnectionEvents, NetworkTransport } from './network.ts';
import { EMPTY_SNAPSHOT, readSnapshot, type CoopSnapshot } from './state.ts';
import {
  clearSavedSeat,
  savedSeat,
  storeSavedSeat,
} from './seat-storage.ts';

const API_ROOT = '/api/rooms';
const POLL_INTERVAL_MS = 200;
const MAX_RETRY_DELAY_MS = 2_000;

interface ErrorPayload {
  code?: unknown;
  message?: unknown;
}

class HostedApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HostedApiError';
  }
}

function roomPath(roomId: string, action: string): string {
  return `${API_ROOT}/${encodeURIComponent(roomId)}/${action}`;
}

async function responseError(response: Response): Promise<HostedApiError> {
  let payload: ErrorPayload = {};
  try {
    payload = await response.json() as ErrorPayload;
  } catch {
    // The status still provides a useful fallback.
  }
  return new HostedApiError(
    response.status,
    typeof payload.code === 'string' ? payload.code : 'request-failed',
    typeof payload.message === 'string'
      ? payload.message
      : 'Could not connect to the hosted game server.',
  );
}

export class HostedNetwork implements NetworkTransport {
  readonly #events: ConnectionEvents;
  #roomId: string | null = null;
  #token: string | null = null;
  #playerId: string | null = null;
  #seat: number | null = null;
  #snapshot = EMPTY_SNAPSHOT;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0;
  #consecutivePollErrors = 0;

  constructor(events: ConnectionEvents) {
    this.#events = events;
  }

  get roomId(): string | null { return this.#roomId; }
  get playerId(): string | null { return this.#playerId; }
  get snapshot(): CoopSnapshot { return this.#snapshot; }
  get seat(): number | null { return this.#seat; }

  async create(): Promise<void> {
    this.#events.onStatus('creating');
    try {
      const session = await this.#request<HostedSessionPayload>(API_ROOT, {
        method: 'POST',
      });
      this.#acceptSession(session);
    } catch (error) {
      this.#reportConnectError(error);
      throw error;
    }
  }

  async join(roomId: string, options?: JoinOptions): Promise<void> {
    this.#events.onStatus('joining');
    if (options?.roomMode === 'human-ai') {
      const error = new HostedApiError(
        400,
        'hosted-mcp-unsupported',
        'Hosted play currently supports a browser partner. Use the local app for the Codex teammate.',
      );
      this.#reportConnectError(error);
      throw error;
    }
    try {
      const session = await this.#request<HostedSessionPayload>(
        roomPath(roomId, 'join'),
        { method: 'POST' },
      );
      this.#acceptSession(session);
    } catch (error) {
      this.#reportConnectError(error);
      throw error;
    }
  }

  async reconnectIfMatching(roomId: string): Promise<boolean> {
    const saved = savedSeat();
    if (saved === null || saved.roomId !== roomId) return false;
    this.#events.onStatus('reconnecting', 'Restoring your saved seat…');
    try {
      const session = await this.#request<HostedSessionPayload>(
        roomPath(roomId, 'reconnect'),
        { method: 'POST' },
        saved.reconnectionToken,
      );
      this.#acceptSession(session);
      return true;
    } catch {
      clearSavedSeat();
      return false;
    }
  }

  sendMove(command: MoveTargetCommand): void {
    void this.#sendMove(command);
  }

  restart(command: RestartCommand): void {
    void this.#sendTransition('replay', command, () => this.#events.onRestarted());
  }

  advance(command: RestartCommand): void {
    void this.#sendTransition('advance', command, () => this.#events.onAdvanced());
  }

  dispose(clearSeat = false): void {
    this.#generation += 1;
    if (this.#pollTimer !== null) clearTimeout(this.#pollTimer);
    this.#pollTimer = null;
    const roomId = this.#roomId;
    const token = this.#token;
    this.#roomId = null;
    this.#token = null;
    this.#playerId = null;
    this.#seat = null;
    this.#snapshot = EMPTY_SNAPSHOT;
    if (roomId !== null && token !== null) {
      void this.#request<void>(roomPath(roomId, 'leave'), { method: 'POST' }, token)
        .catch(() => undefined);
    }
    if (clearSeat) clearSavedSeat();
  }

  async #sendMove(command: MoveTargetCommand): Promise<void> {
    const connection = this.#connection();
    if (connection === null) return;
    try {
      const payload = await this.#request<HostedMovePayload>(
        roomPath(connection.roomId, 'move'),
        { method: 'POST', body: JSON.stringify(command) },
        connection.token,
      );
      this.#applySnapshot(payload.snapshot);
      this.#events.onMoveResult(payload.result);
    } catch (error) {
      this.#handleRuntimeError(error);
    }
  }

  async #sendTransition(
    action: 'replay' | 'advance',
    command: RestartCommand,
    notify: () => void,
  ): Promise<void> {
    const connection = this.#connection();
    if (connection === null) return;
    try {
      const payload = await this.#request<HostedTransitionPayload>(
        roomPath(connection.roomId, action),
        { method: 'POST', body: JSON.stringify(command) },
        connection.token,
      );
      this.#applySnapshot(payload.snapshot);
      if (payload.changed) notify();
    } catch (error) {
      this.#handleRuntimeError(error);
    }
  }

  #acceptSession(session: HostedSessionPayload): void {
    this.dispose();
    this.#roomId = session.roomId;
    this.#token = session.token;
    this.#playerId = session.playerId;
    this.#seat = session.seat;
    storeSavedSeat(session.roomId, session.token);
    this.#events.onSeat(session.seat);
    this.#applySnapshot(session.snapshot);
    this.#schedulePoll();
  }

  #applySnapshot(raw: unknown): void {
    this.#snapshot = readSnapshot(raw);
    this.#events.onSnapshot(this.#snapshot);
    const status = this.#snapshot.phase === 'playing'
      ? 'playing'
      : this.#snapshot.phase === 'abandoned'
        ? 'abandoned'
        : 'waiting';
    this.#events.onStatus(status);
    if (this.#snapshot.phase === 'abandoned') {
      clearSavedSeat();
      this.#events.onAbandoned();
    }
  }

  #schedulePoll(delayMs = POLL_INTERVAL_MS): void {
    if (this.#roomId === null || this.#token === null) return;
    if (this.#pollTimer !== null) clearTimeout(this.#pollTimer);
    const generation = this.#generation;
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = null;
      void this.#poll(generation);
    }, delayMs);
  }

  async #poll(generation: number): Promise<void> {
    const connection = this.#connection();
    if (connection === null || generation !== this.#generation) return;
    try {
      const payload = await this.#request<HostedStatePayload>(
        roomPath(connection.roomId, 'state'),
        { method: 'GET' },
        connection.token,
      );
      if (generation !== this.#generation) return;
      this.#consecutivePollErrors = 0;
      this.#applySnapshot(payload.snapshot);
      if (this.#snapshot.phase !== 'abandoned') this.#schedulePoll();
    } catch (error) {
      if (generation !== this.#generation) return;
      if (this.#isTerminal(error)) {
        clearSavedSeat();
        this.#events.onStatus('abandoned', error instanceof Error ? error.message : 'The session ended.');
        this.#events.onAbandoned();
        return;
      }
      this.#consecutivePollErrors += 1;
      this.#events.onStatus('reconnecting', 'Connection lost. Retrying…');
      const delay = Math.min(
        MAX_RETRY_DELAY_MS,
        POLL_INTERVAL_MS * 2 ** Math.min(this.#consecutivePollErrors, 4),
      );
      this.#schedulePoll(delay);
    }
  }

  async #request<T>(
    path: string,
    init: RequestInit,
    token?: string,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && init.body !== null) {
      headers.set('content-type', 'application/json');
    }
    if (token !== undefined) headers.set('authorization', `Bearer ${token}`);
    const response = await fetch(path, { ...init, headers, cache: 'no-store' });
    if (!response.ok) throw await responseError(response);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  #connection(): { roomId: string; token: string } | null {
    return this.#roomId === null || this.#token === null
      ? null
      : { roomId: this.#roomId, token: this.#token };
  }

  #reportConnectError(error: unknown): void {
    const message = error instanceof Error
      ? error.message
      : 'Could not connect to the hosted game server.';
    this.#events.onStatus('error', message);
  }

  #handleRuntimeError(error: unknown): void {
    if (this.#isTerminal(error)) {
      clearSavedSeat();
      this.#events.onStatus('abandoned', error instanceof Error ? error.message : 'The session ended.');
      this.#events.onAbandoned();
      return;
    }
    this.#events.onStatus('reconnecting', 'Connection lost. Retrying…');
  }

  #isTerminal(error: unknown): boolean {
    return error instanceof HostedApiError
      && (error.status === 401 || error.status === 404 || error.status === 410);
  }
}
