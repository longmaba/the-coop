import { Client, type Room } from '@colyseus/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CELL_SIZE, COOPERATIVE_DISCOVERY_GOAL } from '../../../src/game/index.ts';
import { CoopRoom, CoopStateSchema, createGameServer } from '../../../src/server/index.ts';
import { createPairingToken } from '../../../src/server/pairing.ts';
import type { Server } from '@colyseus/core';
import type { GameState } from '../../../src/game/index.ts';

const PORT = 25_681;
const ENDPOINT = `ws://127.0.0.1:${PORT}`;

let gameServer: Server;
const authoritativeRooms = new Map<string, CoopRoom>();
const originalOnCreate = CoopRoom.prototype.onCreate;

async function waitFor(check: () => boolean, message: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function nextMessage<T>(room: Room, type: string): Promise<T> {
  return new Promise((resolve) => room.onMessage<T>(type, resolve));
}

async function leaveQuietly(room: Room | undefined): Promise<void> {
  if (room === undefined) return;
  try {
    await room.leave();
  } catch {
    // The test can already have closed the room through a reconnection path.
  }
}

function updateAuthoritativeGame(
  roomId: string,
  update: (state: GameState) => GameState,
): void {
  const room = authoritativeRooms.get(roomId);
  if (room === undefined) throw new Error(`Missing authoritative room ${roomId}.`);
  const internals = room as unknown as { game: GameState };
  internals.game = update(internals.game);
}

function forceCompleted(roomId: string): void {
  updateAuthoritativeGame(roomId, (state) => ({
    ...state,
    phase: 'completed',
    resumePhase: null,
    completedAtTick: state.tick,
  }));
}

function mechanismSnapshot(room: Room): Record<string, unknown> {
  const state = room.state as CoopStateSchema;
  return {
    collectedKeycardIds: [...state.collectedKeycardIds],
    latchedGateIds: [...state.latchedGateIds],
    pressurePlates: [...state.pressurePlates].map(({ id, occupied }) => ({ id, occupied })),
    teleporters: [...state.teleporters].map(({ id, powered, powerId, padIds }) => ({
      id,
      powered,
      powerId,
      padIds: [...padIds],
    })),
    keycards: [...state.keycards].map(({ id, collected }) => ({ id, collected })),
    relayButtons: [...state.relayButtons].map(({ id, occupiedBy }) => ({ id, occupiedBy })),
  };
}

beforeAll(async () => {
  CoopRoom.prototype.onCreate = async function captureRoom(options: unknown): Promise<void> {
    await originalOnCreate.call(this, options);
    authoritativeRooms.set(this.roomId, this);
  };
  gameServer = createGameServer();
  await gameServer.listen(PORT, '127.0.0.1');
});

afterAll(async () => {
  try {
    await gameServer.gracefullyShutdown(false);
  } finally {
    CoopRoom.prototype.onCreate = originalOnCreate;
    authoritativeRooms.clear();
  }
});

describe('authoritative private coop room', () => {
  it('projects campaign mechanisms and serializes replay, advance, reconnect, and wrap transitions', async () => {
    let creator: Room | undefined;
    let guest: Room | undefined;
    let reconnectedCreator: Room | undefined;

    try {
      creator = await new Client(ENDPOINT).create('coop', {}, CoopStateSchema);
      guest = await new Client(ENDPOINT).joinById(creator.roomId, {}, CoopStateSchema);
      await waitFor(
        () => creator?.state.phase === 'playing'
          && creator.state.levelId === 'level_1'
          && creator.state.levelCount === 4,
        'initial campaign projection',
      );
      expect(creator.state.levelNumber).toBe(1);
      expect(creator.state.levelName).not.toBe('');
      expect(creator.state.objective).toBe(COOPERATIVE_DISCOVERY_GOAL);
      expect(creator.state.pressurePlates.map(({ id }: { id: string }) => id)).toEqual([
        'plate_a',
        'plate_b',
      ]);

      creator.send('restartLevel', { seq: 0 });
      guest.send('nextLevel', { seq: 0 });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(creator.state.levelEpoch).toBe(0);
      expect(creator.state.phase).toBe('playing');

      forceCompleted(creator.roomId);
      await waitFor(() => creator?.state.phase === 'completed', 'forced completed protocol fixture');
      creator.send('nextLevel', { seq: 2_147_483_647 });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(creator.state.levelId).toBe('level_1');
      expect(creator.state.levelEpoch).toBe(0);
      expect(creator.state.phase).toBe('completed');

      const advancedEvents: unknown[] = [];
      const disposeAdvanced = creator.onMessage('levelAdvanced', (event: unknown) => {
        advancedEvents.push(event);
      });
      creator.send('nextLevel', { seq: 1 });
      guest.send('nextLevel', { seq: 1 });
      await waitFor(
        () => creator?.state.phase === 'playing'
          && creator.state.levelId === 'level_2'
          && creator.state.levelEpoch === 1,
        'single concurrent advance winner',
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      disposeAdvanced();
      expect(advancedEvents).toHaveLength(1);
      expect(advancedEvents[0]).toMatchObject({
        type: 'advanced',
        levelId: 'level_2',
        levelEpoch: 1,
        tick: 0,
      });
      expect(creator.state.players.map(({ id }: { id: string }) => id)).toEqual([
        'player-1',
        'player-2',
      ]);
      expect(creator.state.players.every(
        ({ routeKind, lastMoveSeq }: { routeKind: string; lastMoveSeq: number }) =>
          routeKind === 'none' && lastMoveSeq === -1,
      )).toBe(true);

      updateAuthoritativeGame(creator.roomId, (state) => ({
        ...state,
        collectedKeycardIds: ['keycard_alpha'],
        latchedGateIds: ['gate_main'],
        doorOpen: true,
        players: [
          {
            ...state.players[0],
            position: { x: 6.5 * CELL_SIZE, y: 7.5 * CELL_SIZE },
            route: [],
            routeKind: 'none',
          },
          state.players[1],
        ],
      }));
      await waitFor(
        () => creator?.state.collectedKeycardIds.includes('keycard_alpha') === true
          && creator.state.latchedGateIds.includes('gate_main') === true
          && creator.state.teleporters.some(
            ({ id, powered }: { id: string; powered: boolean }) =>
              id === 'teleporter_alpha' && powered,
          )
          && creator.state.keycards.some(
            ({ id, collected }: { id: string; collected: boolean }) =>
              id === 'keycard_alpha' && collected,
          ),
        'level mechanism projection',
      );
      const beforeReconnect = mechanismSnapshot(creator);

      const reconnectToken = creator.reconnectionToken;
      creator.reconnection.enabled = false;
      void creator.leave(false);
      creator = undefined;
      await waitFor(
        () => guest?.state.phase === 'reconnectGrace'
          && guest.state.collectedKeycardIds.includes('keycard_alpha'),
        'campaign reconnect grace',
      );
      reconnectedCreator = await new Client(ENDPOINT).reconnect(reconnectToken, CoopStateSchema);
      await waitFor(
        () => reconnectedCreator?.state.phase === 'playing'
          && reconnectedCreator.state.levelId === 'level_2'
          && reconnectedCreator.state.players[0]?.connected === true,
        'campaign reconnect restoration',
      );
      expect(mechanismSnapshot(reconnectedCreator)).toEqual(beforeReconnect);

      forceCompleted(reconnectedCreator.roomId);
      await waitFor(() => reconnectedCreator?.state.phase === 'completed', 'level two replay gate');
      const restarted = nextMessage<{
        type: string;
        levelId: string;
        levelEpoch: number;
        tick: number;
      }>(reconnectedCreator, 'levelRestarted');
      reconnectedCreator.send('restartLevel', { seq: 2 });
      await expect(restarted).resolves.toEqual({
        type: 'restarted',
        levelId: 'level_2',
        levelEpoch: 2,
        tick: 0,
      });
      await waitFor(
        () => reconnectedCreator?.state.phase === 'playing'
          && reconnectedCreator.state.levelId === 'level_2'
          && reconnectedCreator.state.levelEpoch === 2,
        'current-level replay',
      );
      expect(reconnectedCreator.state.collectedKeycardIds).toHaveLength(0);
      expect(reconnectedCreator.state.latchedGateIds).toHaveLength(0);
      expect(reconnectedCreator.state.keycards.every(
        ({ collected }: { collected: boolean }) => !collected,
      )).toBe(true);

      forceCompleted(reconnectedCreator.roomId);
      await waitFor(() => guest?.state.phase === 'completed', 'stale transition fixture');
      reconnectedCreator.send('nextLevel', { seq: 2 });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(reconnectedCreator.state.levelId).toBe('level_2');
      expect(reconnectedCreator.state.levelEpoch).toBe(2);
      expect(reconnectedCreator.state.phase).toBe('completed');

      guest.send('nextLevel', { seq: 3 });
      await waitFor(
        () => guest?.state.levelId === 'level_3' && guest.state.levelEpoch === 3,
        'guest-owned level three advance',
      );
      forceCompleted(guest.roomId);
      await waitFor(() => guest?.state.phase === 'completed', 'level three completion');
      reconnectedCreator.send('nextLevel', { seq: 4 });
      await waitFor(
        () => reconnectedCreator?.state.levelId === 'level_4'
          && reconnectedCreator.state.levelEpoch === 4,
        'level four advance',
      );
      forceCompleted(reconnectedCreator.roomId);
      await waitFor(() => guest?.state.phase === 'completed', 'level four completion');
      guest.send('nextLevel', { seq: 5 });
      await waitFor(
        () => guest?.state.phase === 'playing'
          && guest.state.levelId === 'level_1'
          && guest.state.levelEpoch === 5,
        'final level wrap',
      );
      expect(guest.roomId).toBe(reconnectedCreator.roomId);
      expect(guest.state.players.map(
        ({ id, connected }: { id: string; connected: boolean }) => ({ id, connected }),
      )).toEqual([
        { id: 'player-1', connected: true },
        { id: 'player-2', connected: true },
      ]);
    } finally {
      await leaveQuietly(reconnectedCreator);
      await leaveQuietly(guest);
      await leaveQuietly(creator);
    }
  }, 30_000);

  it('binds a one-time human-AI invite to Player 1 while the MCP owns Player 2', async () => {
    const pairing = createPairingToken();
    let mcpRoom: Room | undefined;
    let humanRoom: Room | undefined;
    let reconnectedMcp: Room | undefined;

    try {
      mcpRoom = await new Client(ENDPOINT).create('coop', {
        roomMode: 'human-ai',
        controllerKind: 'mcp',
        playerId: 'player-2',
        pairingTokenHash: pairing.tokenHash,
        pairingExpiresAt: pairing.expiresAt,
      }, CoopStateSchema);
      const mcpSeat = nextMessage<{ playerId: string; slot: number; roomId: string }>(mcpRoom, 'seat');
      await expect(mcpSeat).resolves.toEqual({
        playerId: 'player-2',
        slot: 2,
        roomId: mcpRoom.roomId,
      });

      await expect(new Client(ENDPOINT).joinById(mcpRoom.roomId, {}, CoopStateSchema)).rejects.toThrow();
      await expect(new Client(ENDPOINT).joinById(mcpRoom.roomId, {
        roomMode: 'human-ai',
        controllerKind: 'human',
        playerId: 'player-2',
        pairingToken: pairing.token,
      }, CoopStateSchema)).rejects.toThrow();
      await expect(new Client(ENDPOINT).joinById(mcpRoom.roomId, {
        roomMode: 'human-ai',
        controllerKind: 'human',
        playerId: 'player-1',
        pairingToken: 'x'.repeat(43),
      }, CoopStateSchema)).rejects.toThrow();

      const invite = {
        roomMode: 'human-ai',
        controllerKind: 'human',
        playerId: 'player-1',
        pairingToken: pairing.token,
      } as const;
      const contenders = await Promise.allSettled([
        new Client(ENDPOINT).joinById(mcpRoom.roomId, invite, CoopStateSchema),
        new Client(ENDPOINT).joinById(mcpRoom.roomId, invite, CoopStateSchema),
      ]);
      const winners = contenders.filter(
        (result): result is PromiseFulfilledResult<Room> => result.status === 'fulfilled',
      );
      expect(winners).toHaveLength(1);
      expect(contenders.filter((result) => result.status === 'rejected')).toHaveLength(1);
      humanRoom = winners[0]?.value;
      expect(humanRoom).toBeDefined();
      if (humanRoom === undefined) throw new Error('Expected one pairing winner.');

      const humanSeat = nextMessage<{ playerId: string; slot: number; roomId: string }>(humanRoom, 'seat');
      await expect(humanSeat).resolves.toEqual({
        playerId: 'player-1',
        slot: 1,
        roomId: mcpRoom.roomId,
      });
      await waitFor(
        () => mcpRoom?.state.phase === 'playing'
          && mcpRoom.state.players[0]?.connected === true
          && mcpRoom.state.players[1]?.connected === true,
        'role-bound human-AI seats',
      );
      expect(mcpRoom.state.players[0]?.id).toBe('player-1');
      expect(mcpRoom.state.players[1]?.id).toBe('player-2');
      await expect(new Client(ENDPOINT).joinById(mcpRoom.roomId, invite, CoopStateSchema)).rejects.toThrow();

      const reconnectToken = mcpRoom.reconnectionToken;
      mcpRoom.reconnection.enabled = false;
      void mcpRoom.leave(false);
      mcpRoom = undefined;
      await waitFor(
        () => humanRoom?.state.phase === 'reconnectGrace'
          && humanRoom.state.players[1]?.connected === false,
        'MCP Player 2 reconnect grace',
      );
      reconnectedMcp = await new Client(ENDPOINT).reconnect(reconnectToken, CoopStateSchema);
      const reconnectedSeat = nextMessage<{ playerId: string; slot: number }>(reconnectedMcp, 'seat');
      await expect(reconnectedSeat).resolves.toMatchObject({ playerId: 'player-2', slot: 2 });
      await waitFor(
        () => reconnectedMcp?.state.phase === 'playing'
          && reconnectedMcp.state.players[1]?.connected === true,
        'MCP Player 2 identity after reconnect',
      );
    } finally {
      await leaveQuietly(reconnectedMcp);
      await leaveQuietly(humanRoom);
      await leaveQuietly(mcpRoom);
    }
  }, 30_000);

  it('reserves a creator seat when the waiting room reloads', async () => {
    const creatorClient = new Client(ENDPOINT);
    let creator: Room | undefined;
    let reconnectedCreator: Room | undefined;
    let guest: Room | undefined;

    try {
      creator = await creatorClient.create('coop', {}, CoopStateSchema);
      const token = creator.reconnectionToken;
      creator.reconnection.enabled = false;
      void creator.leave(false);
      creator = undefined;

      reconnectedCreator = await new Client(ENDPOINT).reconnect(token, CoopStateSchema);
      guest = await new Client(ENDPOINT).joinById(reconnectedCreator.roomId, {}, CoopStateSchema);
      await waitFor(
        () => reconnectedCreator?.state.phase === 'playing'
          && reconnectedCreator?.state.players[0]?.connected === true
          && reconnectedCreator?.state.players[1]?.connected === true,
        'waiting creator and guest to start',
      );
    } finally {
      await leaveQuietly(guest);
      await leaveQuietly(reconnectedCreator);
      await leaveQuietly(creator);
    }
  });

  it('seats only two private clients, owns movement, reconnects, and restarts a completed level', async () => {
    const creatorClient = new Client(ENDPOINT);
    const guestClient = new Client(ENDPOINT);
    const thirdClient = new Client(ENDPOINT);
    let creator: Room | undefined;
    let guest: Room | undefined;
    let reconnectedCreator: Room | undefined;

    try {
      const initialCreator = await creatorClient.create('coop', {}, CoopStateSchema);
      creator = initialCreator;
      const creatorSeat = nextMessage<{ playerId: string; slot: number; roomId: string }>(initialCreator, 'seat');
      guest = await guestClient.joinById(initialCreator.roomId, {}, CoopStateSchema);
      guest.onMessage('sessionAbandoned', () => undefined);
      const guestSeat = nextMessage<{ playerId: string; slot: number; roomId: string }>(guest, 'seat');

      await waitFor(() => initialCreator.state.phase === 'playing' && initialCreator.state.players.length === 2, 'both seats to start');
      await expect(thirdClient.joinById(initialCreator.roomId, {}, CoopStateSchema)).rejects.toThrow();
      await expect(creatorSeat).resolves.toEqual({ playerId: 'player-1', slot: 1, roomId: initialCreator.roomId });
      await expect(guestSeat).resolves.toEqual({ playerId: 'player-2', slot: 2, roomId: initialCreator.roomId });
      expect(initialCreator.state.players[0]?.id).toBe('player-1');
      expect(initialCreator.state.players[1]?.id).toBe('player-2');

      const beforeMoveX = initialCreator.state.players[0]?.worldX;
      const moveResult = nextMessage<{ accepted: boolean; routeKind: string; seq: number }>(initialCreator, 'moveResult');
      initialCreator.send('moveTarget', { seq: 1, worldX: 4.5 * CELL_SIZE, worldY: 5.5 * CELL_SIZE });
      await expect(moveResult).resolves.toMatchObject({ seq: 1, accepted: true, routeKind: 'target' });
      await waitFor(() => (initialCreator.state.players[0]?.worldX ?? 0) > (beforeMoveX ?? Number.POSITIVE_INFINITY), 'authoritative movement progress');

      const ownedPosition = {
        x: initialCreator.state.players[0]?.worldX,
        y: initialCreator.state.players[0]?.worldY,
      };
      initialCreator.send('setPosition', { playerId: 'player-1', worldX: 9_999, worldY: 9_999 });
      initialCreator.send('moveTarget', { seq: 'not-an-integer', worldX: 9_999, worldY: 9_999 });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(initialCreator.state.players[0]?.worldX).not.toBe(9_999);
      expect(initialCreator.state.players[0]?.worldY).not.toBe(9_999);
      expect(initialCreator.state.players[0]?.worldX).toBeGreaterThanOrEqual(ownedPosition.x ?? 0);

      const reconnectionToken = initialCreator.reconnectionToken;
      initialCreator.reconnection.enabled = false;
      void initialCreator.leave(false);
      creator = undefined;
      await waitFor(() => guest?.state.phase === 'reconnectGrace' && guest?.state.players[0]?.connected === false, 'reconnect grace');
      reconnectedCreator = await new Client(ENDPOINT).reconnect(reconnectionToken, CoopStateSchema);
      reconnectedCreator.onMessage('levelRestarted', () => undefined);
      await waitFor(() => reconnectedCreator?.state.phase === 'playing' && reconnectedCreator?.state.players[0]?.connected === true, 'successful reconnection');

      // Controlled completion: guest holds the near plate while creator reaches
      // the far plate; guest crosses to the exit, then creator joins the exit.
      const guestToNearPlate = nextMessage<{ accepted: boolean }>(guest, 'moveResult');
      guest.send('moveTarget', { seq: 1, worldX: 8.5 * CELL_SIZE, worldY: 6.5 * CELL_SIZE });
      await expect(guestToNearPlate).resolves.toMatchObject({ accepted: true });
      await waitFor(() => guest?.state.nearPlatePressed === true, 'near plate press', 8_000);

      const creatorToFarPlate = nextMessage<{ accepted: boolean }>(reconnectedCreator, 'moveResult');
      reconnectedCreator.send('moveTarget', { seq: 2, worldX: 14.5 * CELL_SIZE, worldY: 6.5 * CELL_SIZE });
      await expect(creatorToFarPlate).resolves.toMatchObject({ accepted: true });
      await waitFor(() => reconnectedCreator?.state.farPlatePressed === true, 'far plate press', 10_000);

      const guestToExit = nextMessage<{ accepted: boolean }>(guest, 'moveResult');
      guest.send('moveTarget', { seq: 2, worldX: 20.5 * CELL_SIZE, worldY: 5.5 * CELL_SIZE });
      await expect(guestToExit).resolves.toMatchObject({ accepted: true });
      await waitFor(() => (guest?.state.players[1]?.worldX ?? 0) >= 19 * CELL_SIZE, 'guest exit arrival', 10_000);

      const creatorToExit = nextMessage<{ accepted: boolean }>(reconnectedCreator, 'moveResult');
      reconnectedCreator.send('moveTarget', { seq: 3, worldX: 20.5 * CELL_SIZE, worldY: 6.5 * CELL_SIZE });
      await expect(creatorToExit).resolves.toMatchObject({ accepted: true });
      await waitFor(() => reconnectedCreator?.state.phase === 'completed', 'completed authoritative state', 10_000);

      const restarted = nextMessage<{
        type: string;
        levelId: string;
        levelEpoch: number;
        tick: number;
      }>(guest, 'levelRestarted');
      guest.send('restartLevel', { seq: 1 });
      await expect(restarted).resolves.toEqual({
        type: 'restarted',
        levelId: 'level_1',
        levelEpoch: 1,
        tick: 0,
      });
      await waitFor(() => guest?.state.phase === 'playing' && guest?.state.levelEpoch === 1, 'restart projection');
      expect(guest.state.players[0]?.lastMoveSeq).toBe(-1);
    } finally {
      await leaveQuietly(reconnectedCreator);
      await leaveQuietly(guest);
      await leaveQuietly(creator);
    }
  }, 30_000);
});
