import { Client, type Room } from '@colyseus/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CELL_SIZE } from '../../../src/game/index.ts';
import { CoopStateSchema, createGameServer } from '../../../src/server/index.ts';
import type { Server } from '@colyseus/core';

const PORT = 25_681;
const ENDPOINT = `ws://127.0.0.1:${PORT}`;

let gameServer: Server;

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

beforeAll(async () => {
  gameServer = createGameServer();
  await gameServer.listen(PORT, '127.0.0.1');
});

afterAll(async () => {
  await gameServer.gracefullyShutdown(false);
});

describe('authoritative private coop room', () => {
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

      const restarted = nextMessage<{ type: string; tick: number }>(guest, 'levelRestarted');
      guest.send('restartLevel', { seq: 1 });
      await expect(restarted).resolves.toEqual({ type: 'restarted', tick: 0 });
      await waitFor(() => guest?.state.phase === 'playing' && guest?.state.levelEpoch === 1, 'restart projection');
      expect(guest.state.players[0]?.lastMoveSeq).toBe(-1);
    } finally {
      await leaveQuietly(reconnectedCreator);
      await leaveQuietly(guest);
      await leaveQuietly(creator);
    }
  }, 30_000);
});
