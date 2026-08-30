import type { Room } from '@colyseus/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CoopNetwork,
  StaleConnectionAttemptError,
  type ConnectionEvents,
  normalizeMoveResultPayload,
  normalizeSeatPayload,
  resolveGameServerUrl,
  TRANSITION_MESSAGES,
  usesHostedTransport,
} from '../../../src/client/network.ts';

class FakeRoom {
  roomId = 'room-late';
  sessionId = 'session-late';
  reconnectionToken = 'room-late:token';
  state: unknown = {};
  reconnectTransport = vi.fn();
  closeTransport = vi.fn();
  connection = {
    isOpen: true,
    reconnect: this.reconnectTransport,
    close: this.closeTransport,
  };
  reconnection = {
    enabled: true,
    maxRetries: 9,
    minDelay: 100,
    maxDelay: 1_000,
    minUptime: 0,
    retryCount: 1,
    delay: 100,
    backoff: () => 100,
    maxEnqueuedMessages: 10,
    enqueuedMessages: [{ data: new Uint8Array([1]) }],
    isReconnecting: true,
  };
  callbacks = new Map<string, Array<(...args: never[]) => void>>();
  leave = vi.fn(async () => 1000);
  removeAllListeners = vi.fn();
  send = vi.fn();

  onStateChange(callback: (...args: never[]) => void): () => void {
    return this.#add('state', callback);
  }
  onDrop(callback: (...args: never[]) => void): () => void {
    return this.#add('drop', callback);
  }
  onReconnect(callback: (...args: never[]) => void): () => void {
    return this.#add('reconnect', callback);
  }
  onError(callback: (...args: never[]) => void): () => void {
    return this.#add('error', callback);
  }
  onLeave(callback: (...args: never[]) => void): () => void {
    return this.#add('leave', callback);
  }
  onMessage(type: string, callback: (...args: never[]) => void): () => void {
    return this.#add(`message:${type}`, callback);
  }
  emit(key: string, ...args: never[]): void {
    for (const callback of this.callbacks.get(key) ?? []) callback(...args);
  }
  #add(key: string, callback: (...args: never[]) => void): () => void {
    const callbacks = this.callbacks.get(key) ?? [];
    callbacks.push(callback);
    this.callbacks.set(key, callbacks);
    return () => undefined;
  }
}

function connectionEvents() {
  return {
    onSnapshot: vi.fn(),
    onStatus: vi.fn(),
    onSeat: vi.fn(),
    onMoveResult: vi.fn(),
    onRestarted: vi.fn(),
    onAdvanced: vi.fn(),
    onAbandoned: vi.fn(),
  } satisfies ConnectionEvents;
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('campaign transition protocol', () => {
  it('uses the authoritative replay and advancement message names', () => {
    expect(TRANSITION_MESSAGES).toEqual({
      replay: 'restartLevel',
      advance: 'nextLevel',
      replayed: 'levelRestarted',
      advanced: 'levelAdvanced',
    });
  });
});

describe('normalizeMoveResultPayload', () => {
  it('accepts only complete authoritative movement results', () => {
    expect(normalizeMoveResultPayload({
      seq: 4,
      accepted: true,
      routeKind: 'threshold-stop',
      effectiveWorldX: 120,
      effectiveWorldY: 240,
    })).toEqual({
      seq: 4,
      accepted: true,
      routeKind: 'threshold-stop',
      effectiveWorldX: 120,
      effectiveWorldY: 240,
    });
  });

  it.each([
    null,
    { accepted: true, routeKind: 'target', effectiveWorldX: 1, effectiveWorldY: 2 },
    { seq: 1, accepted: 'yes', routeKind: 'target', effectiveWorldX: 1, effectiveWorldY: 2 },
    { seq: 1, accepted: true, routeKind: 'teleport', effectiveWorldX: 1, effectiveWorldY: 2 },
    { seq: 1, accepted: true, routeKind: 'target', effectiveWorldX: Number.NaN, effectiveWorldY: 2 },
    { seq: 1, accepted: true, routeKind: 'target', effectiveWorldX: 1 },
  ])('rejects incomplete or malformed results: %j', (payload) => {
    expect(normalizeMoveResultPayload(payload)).toBeNull();
  });
});

describe('normalizeSeatPayload', () => {
  it('accepts canonical one-based slots and legacy zero-based seats', () => {
    expect(normalizeSeatPayload({ playerId: 'player-1', slot: 1 })).toEqual({
      playerId: 'player-1',
      seat: 0,
    });
    expect(normalizeSeatPayload({ playerId: 'player-2', seat: 1 })).toEqual({
      playerId: 'player-2',
      seat: 1,
    });
  });

  it.each([
    null,
    {},
    { playerId: '', slot: 1 },
    { playerId: 'intruder', slot: 2 },
    { playerId: 'player-1', slot: 0 },
    { playerId: 'player-1', slot: 3 },
    { playerId: 'player-1', slot: 1.5 },
    { playerId: 'player-1', seat: Number.NaN },
  ])('rejects malformed or out-of-range seat payloads: %j', (payload) => {
    expect(normalizeSeatPayload(payload)).toBeNull();
  });
});

describe('transport selection', () => {
  it('uses the Sites adapter only for the dedicated Sites build mode', () => {
    expect(usesHostedTransport('sites')).toBe(true);
    expect(usesHostedTransport('production')).toBe(false);
    expect(usesHostedTransport('development')).toBe(false);
  });

  it('uses the browser origin for an ordinary production build', () => {
    expect(resolveGameServerUrl(undefined, 'production', 'https://coop.example.test/play')).toBe(
      'https://coop.example.test',
    );
  });

  it('preserves explicit and development server endpoints', () => {
    expect(resolveGameServerUrl(' https://games.example.test ', 'production', 'https://ignored.test'))
      .toBe('https://games.example.test');
    expect(resolveGameServerUrl(undefined, 'development', 'http://127.0.0.1:5173'))
      .toBe('http://127.0.0.1:2567');
    expect(resolveGameServerUrl(undefined, 'production', 'not a URL'))
      .toBe('http://127.0.0.1:2567');
  });
});

describe('CoopNetwork lifecycle fencing', () => {
  it('closes and rejects a room that arrives after the attempt was disposed', async () => {
    const room = new FakeRoom();
    let resolveJoin!: (room: Room) => void;
    const client = {
      create: vi.fn(),
      reconnect: vi.fn(),
      joinById: vi.fn(() => new Promise<Room>((resolve) => { resolveJoin = resolve; })),
    };
    const events = connectionEvents();
    const network = new CoopNetwork(events, client as never);

    const joining = network.join('room-late');
    network.dispose();
    resolveJoin(room as unknown as Room);

    await expect(joining).rejects.toBeInstanceOf(StaleConnectionAttemptError);
    expect(network.roomId).toBeNull();
    expect(room.reconnection.enabled).toBe(false);
    expect(room.reconnection.enqueuedMessages).toHaveLength(0);
    expect(room.leave).toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(events.onStatus).not.toHaveBeenCalledWith('waiting');
  });

  it('does not clear a newer saved seat when a stale Player 2 join rejects late', async () => {
    const staleRoom = new FakeRoom();
    const currentRoom = new FakeRoom();
    currentRoom.roomId = 'room-current';
    currentRoom.reconnectionToken = 'room-current:new-token';
    let resolvePlayerTwoJoin!: (room: Room) => void;
    const staleClient = {
      create: vi.fn(),
      reconnect: vi.fn(),
      joinById: vi.fn(() => new Promise<Room>((resolve) => { resolvePlayerTwoJoin = resolve; })),
    };
    const currentClient = {
      create: vi.fn(async () => currentRoom as unknown as Room),
      reconnect: vi.fn(),
      joinById: vi.fn(),
    };
    const staleNetwork = new CoopNetwork(connectionEvents(), staleClient as never);
    const currentNetwork = new CoopNetwork(connectionEvents(), currentClient as never);

    const staleJoin = staleNetwork.joinAsPlayerTwo('room-stale');
    staleNetwork.dispose();
    await currentNetwork.create();
    vi.mocked(sessionStorage.removeItem).mockClear();
    resolvePlayerTwoJoin(staleRoom as unknown as Room);

    await expect(staleJoin).rejects.toBeInstanceOf(StaleConnectionAttemptError);
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      'the-coop:seat',
      JSON.stringify({ roomId: 'room-current', reconnectionToken: 'room-current:new-token' }),
    );
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(currentNetwork.roomId).toBe('room-current');
  });

  it('clears the saved seat when the owning Player 2 join fails', async () => {
    const client = {
      create: vi.fn(),
      reconnect: vi.fn(),
      joinById: vi.fn(async () => { throw new Error('room is full'); }),
    };
    const network = new CoopNetwork(connectionEvents(), client as never);

    await expect(network.joinAsPlayerTwo('room-full')).rejects.toThrow('room is full');
    expect(sessionStorage.removeItem).toHaveBeenCalledWith('the-coop:seat');
  });

  it('lets a newer connect attempt survive a late failure from the superseded attempt', async () => {
    const staleRoom = new FakeRoom();
    staleRoom.roomId = 'room-stale';
    const currentRoom = new FakeRoom();
    currentRoom.roomId = 'room-current';
    let resolveCreate!: (room: Room) => void;
    let resolveJoin!: (room: Room) => void;
    const client = {
      create: vi.fn(() => new Promise<Room>((resolve) => { resolveCreate = resolve; })),
      reconnect: vi.fn(),
      joinById: vi.fn(() => new Promise<Room>((resolve) => { resolveJoin = resolve; })),
    };
    const events = connectionEvents();
    const network = new CoopNetwork(events, client as never);

    const creating = network.create();
    const joining = network.join('room-current');
    resolveJoin(currentRoom as unknown as Room);
    await joining;
    resolveCreate(staleRoom as unknown as Room);

    await expect(creating).rejects.toBeInstanceOf(StaleConnectionAttemptError);
    expect(network.roomId).toBe('room-current');
    expect(currentRoom.leave).not.toHaveBeenCalled();
    expect(staleRoom.leave).toHaveBeenCalled();
  });

  it('blocks scheduled reconnect and every stale callback after disposal', async () => {
    const room = new FakeRoom();
    const client = {
      create: vi.fn(async () => room as unknown as Room),
      reconnect: vi.fn(),
      joinById: vi.fn(),
    };
    const events = connectionEvents();
    const network = new CoopNetwork(events, client as never);
    await network.create();
    events.onStatus.mockClear();

    network.dispose();
    room.connection.reconnect({ reconnectionToken: 'token' });
    room.emit('state', { phase: 'playing' } as never);
    room.emit('drop');
    room.emit('error', 500 as never, 'late' as never);
    room.emit('message:seat', { playerId: 'player-2', slot: 2 } as never);
    room.emit('message:moveResult', {
      seq: 1,
      accepted: true,
      routeKind: 'target',
      effectiveWorldX: 1,
      effectiveWorldY: 1,
    } as never);
    room.emit('message:sessionAbandoned');

    expect(room.reconnectTransport).not.toHaveBeenCalled();
    expect(events.onStatus).not.toHaveBeenCalled();
    expect(events.onSnapshot).not.toHaveBeenCalled();
    expect(events.onSeat).not.toHaveBeenCalled();
    expect(events.onMoveResult).not.toHaveBeenCalled();
    expect(events.onAbandoned).not.toHaveBeenCalled();
  });
});
