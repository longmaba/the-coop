import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostedNetwork } from '../../../src/client/hosted-network.ts';
import type { ConnectionEvents } from '../../../src/client/network.ts';

function connectionEvents(): ConnectionEvents {
  return {
    onSnapshot: vi.fn(),
    onStatus: vi.fn(),
    onSeat: vi.fn(),
    onMoveResult: vi.fn(),
    onRestarted: vi.fn(),
    onAdvanced: vi.fn(),
    onAbandoned: vi.fn(),
  };
}

function sessionPayload(seat: 0 | 1 = 0) {
  return {
    roomId: 'room-1',
    token: 'seat-token-0000000000000000000000',
    playerId: seat === 0 ? 'player-1' : 'player-2',
    seat,
    snapshot: {
      phase: seat === 0 ? 'waitingForPlayers' : 'playing',
      tick: 0,
      levelId: 'level_1',
      levelNumber: 1,
      levelCount: 4,
      levelName: 'Pressure Lock',
      objective: 'Hold the line.',
      doorOpen: false,
      nearPlatePressed: false,
      farPlatePressed: false,
      completedAtTick: null,
      levelEpoch: 0,
      reconnectRemainingSeconds: 0,
      collectedKeycardIds: [],
      latchedGateIds: [],
      pressurePlates: [],
      teleporters: [],
      keycards: [],
      relayButtons: [],
      players: [
        {
          id: 'player-1',
          avatarId: 'character-female-a',
          connected: true,
          worldX: 168,
          worldY: 312,
          routeKind: 'none',
          lastMoveSeq: -1,
        },
        {
          id: 'player-2',
          avatarId: 'character-male-a',
          connected: seat === 1,
          worldX: 168,
          worldY: 504,
          routeKind: 'none',
          lastMoveSeq: -1,
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HostedNetwork request contracts', () => {
  it('omits create body for legacy callers and serializes avatar-aware create and join requests', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(sessionPayload(0)), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(sessionPayload(1)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const network = new HostedNetwork(connectionEvents());
    await network.create();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/rooms');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body).toBeUndefined();

    network.dispose();
    await network.join('room-1', {
      roomMode: 'human-human',
      controllerKind: 'human',
      avatarId: 'character-male-f',
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/rooms/room-1/join');
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit | undefined)?.body).toBe(JSON.stringify({
      roomMode: 'human-human',
      controllerKind: 'human',
      avatarId: 'character-male-f',
    }));

    network.dispose();
  });

  it('uses the hosted join endpoint for a WebMCP Player 2 session', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(sessionPayload(1)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const events = connectionEvents();
    const network = new HostedNetwork(events);

    await network.joinAsPlayerTwo('room-1', {
      roomMode: 'human-human',
      controllerKind: 'human',
      avatarId: 'character-female-e',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/rooms/room-1/join');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body).toBe(JSON.stringify({
      roomMode: 'human-human',
      controllerKind: 'human',
      avatarId: 'character-female-e',
    }));
    expect(network.roomId).toBe('room-1');
    expect(network.playerId).toBe('player-2');
    expect(network.seat).toBe(1);
    expect(events.onSeat).toHaveBeenCalledWith(1);

    network.dispose();
  });
});
