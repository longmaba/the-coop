import { describe, expect, it } from 'vitest';
import { CELL_SIZE } from '../../../src/game/index.ts';
import { defaultAvatarIdForSeat } from '../../../src/game/index.ts';
import { HostedGameService } from '../../../src/hosted/service.ts';
import type {
  HostedRoomRecord,
  HostedRoomStore,
} from '../../../src/hosted/service.ts';

class MemoryRoomStore implements HostedRoomStore {
  readonly records = new Map<string, HostedRoomRecord>();
  failNextSwaps = 0;

  async create(record: HostedRoomRecord): Promise<boolean> {
    if (this.records.has(record.roomId)) return false;
    this.records.set(record.roomId, structuredClone(record));
    return true;
  }

  async read(roomId: string): Promise<HostedRoomRecord | null> {
    const record = this.records.get(roomId);
    return record === undefined ? null : structuredClone(record);
  }

  async compareAndSwap(
    expectedRevision: number,
    record: HostedRoomRecord,
  ): Promise<boolean> {
    if (this.failNextSwaps > 0) {
      this.failNextSwaps -= 1;
      return false;
    }
    const current = this.records.get(record.roomId);
    if (current?.revision !== expectedRevision) return false;
    this.records.set(record.roomId, structuredClone(record));
    return true;
  }

  async deleteUpdatedBefore(timestampMs: number): Promise<void> {
    for (const [roomId, record] of this.records) {
      if (record.updatedAtMs < timestampMs) this.records.delete(roomId);
    }
  }
}

function harness() {
  let nowMs = 0;
  const generated = [
    'room-code-0001',
    'player-one-token-000000000000000000000000',
    'player-two-token-000000000000000000000000',
  ];
  const store = new MemoryRoomStore();
  const service = new HostedGameService(store, {
    now: () => nowMs,
    randomToken: () => generated.shift() ?? 'unused-token-00000000000000000000000000',
    hashToken: async (token) => `hash:${token}`,
  });
  return {
    service,
    store,
    advance(milliseconds: number) { nowMs += milliseconds; },
  };
}

describe('HostedGameService', () => {
  it('creates, joins, and advances the existing authoritative simulation', async () => {
    const runtime = harness();
    const creator = await runtime.service.createRoom({
      roomMode: 'human-human',
      controllerKind: 'human',
      avatarId: 'character-male-c',
    });
    expect(creator).toMatchObject({
      roomId: 'room-code-0001',
      playerId: 'player-1',
      seat: 0,
      snapshot: {
        phase: 'waitingForPlayers',
        players: [
          { avatarId: 'character-male-c' },
          { avatarId: defaultAvatarIdForSeat(1) },
        ],
      },
    });

    const guest = await runtime.service.joinRoom(creator.roomId, {
      roomMode: 'human-human',
      controllerKind: 'human',
      avatarId: 'character-female-d',
    });
    expect(guest).toMatchObject({
      roomId: creator.roomId,
      playerId: 'player-2',
      seat: 1,
      snapshot: {
        phase: 'playing',
        players: [
          { avatarId: 'character-male-c' },
          { avatarId: 'character-female-d' },
        ],
      },
    });

    const move = await runtime.service.move(creator.roomId, creator.token, {
      seq: 1,
      worldX: 4.5 * CELL_SIZE,
      worldY: 5.5 * CELL_SIZE,
    });
    expect(move.result).toMatchObject({ accepted: true, routeKind: 'target' });
    const startingX = move.snapshot.players[0]?.worldX ?? 0;

    runtime.advance(500);
    const progressed = await runtime.service.getState(creator.roomId, creator.token);
    expect(progressed.snapshot.players[0]?.worldX).toBeGreaterThan(startingX);
    expect(progressed.snapshot.phase).toBe('playing');
  });

  it('retries optimistic conflicts and preserves simultaneous player commands', async () => {
    const runtime = harness();
    const creator = await runtime.service.createRoom();
    runtime.store.failNextSwaps = 1;
    const guest = await runtime.service.joinRoom(creator.roomId);

    const [creatorMove, guestMove] = await Promise.all([
      runtime.service.move(creator.roomId, creator.token, {
        seq: 1,
        worldX: 4.5 * CELL_SIZE,
        worldY: 5.5 * CELL_SIZE,
      }),
      runtime.service.move(creator.roomId, guest.token, {
        seq: 1,
        worldX: 5.5 * CELL_SIZE,
        worldY: 8.5 * CELL_SIZE,
      }),
    ]);

    expect(creatorMove.result.accepted).toBe(true);
    expect(guestMove.result.accepted).toBe(true);
    const state = await runtime.service.getState(creator.roomId, creator.token);
    expect(state.snapshot.players.map(({ lastMoveSeq }) => lastMoveSeq)).toEqual([1, 1]);
  });

  it('restores a saved seat during grace and abandons it after the grace window', async () => {
    const runtime = harness();
    const creator = await runtime.service.createRoom();
    const guest = await runtime.service.joinRoom(creator.roomId);

    runtime.advance(5_000);
    const grace = await runtime.service.getState(creator.roomId, creator.token);
    expect(grace.snapshot.phase).toBe('reconnectGrace');

    runtime.advance(2_000);
    const restored = await runtime.service.reconnectRoom(creator.roomId, guest.token);
    expect(restored.snapshot.phase).toBe('playing');

    runtime.advance(5_000);
    await runtime.service.getState(creator.roomId, creator.token);
    runtime.advance(31_000);
    const abandoned = await runtime.service.getState(creator.roomId, creator.token);
    expect(abandoned.snapshot.phase).toBe('abandoned');
  });

  it('rejects invalid seat tokens without exposing room state', async () => {
    const runtime = harness();
    const creator = await runtime.service.createRoom();
    await expect(
      runtime.service.getState(
        creator.roomId,
        'invalid-seat-token-000000000000000000000',
      ),
    ).rejects.toMatchObject({
      status: 401,
      code: 'invalid-seat',
    });
  });

  it('fails closed on invalid avatar ids and hydrates legacy saved records', async () => {
    const runtime = harness();
    await expect(runtime.service.createRoom({
      roomMode: 'human-human',
      controllerKind: 'human',
      avatarId: 'lion',
    })).rejects.toMatchObject({
      status: 400,
      code: 'invalid-request',
    });

    runtime.store.records.set('legacy-room', {
      roomId: 'legacy-room',
      revision: 0,
      simulatedAtMs: 0,
      updatedAtMs: 0,
      playerOneTokenHash: 'hash:legacy-player-one-token-000000000000',
      playerOneLastSeenMs: 0,
      playerTwoTokenHash: 'hash:legacy-player-two-token-000000000000',
      playerTwoLastSeenMs: 0,
      gameState: {
        levelId: 'level_1',
        levelEpoch: 0,
        phase: 'playing',
        resumePhase: null,
        tick: 0,
        elapsedSeconds: 0,
        reconnectElapsedSeconds: 0,
        players: [
          {
            id: 'player-1',
            connected: true,
            spawn: { x: 168, y: 312 },
            position: { x: 168, y: 312 },
            lastMoveSeq: -1,
            route: [],
            routeKind: 'none',
            crossingPermit: false,
            blockedTeleporterPadId: null,
          },
          {
            id: 'player-2',
            avatarId: 'lion',
            connected: true,
            spawn: { x: 168, y: 504 },
            position: { x: 168, y: 504 },
            lastMoveSeq: -1,
            route: [],
            routeKind: 'none',
            crossingPermit: false,
            blockedTeleporterPadId: null,
          },
        ],
        doorOpen: false,
        collectedKeycardIds: [],
        latchedGateIds: [],
        completedAtTick: null,
        restartSeq: -1,
      } as unknown as HostedRoomRecord['gameState'],
    });

    const hydrated = await runtime.service.getState(
      'legacy-room',
      'legacy-player-one-token-000000000000',
    );
    expect(hydrated.snapshot.players.map(({ avatarId }) => avatarId)).toEqual([
      defaultAvatarIdForSeat(0),
      defaultAvatarIdForSeat(1),
    ]);
  });
});
