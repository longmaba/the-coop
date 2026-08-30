import { Client, type Room } from '@colyseus/sdk';
import { cloneSnapshot, readSnapshot, type CoopSnapshot } from '../client/state.ts';
import { CoopStateSchema } from '../server/CoopRoom.ts';
import { createPairingToken, type CreatedPairingToken } from '../server/pairing.ts';
import { createTeammateObservation } from './game-tools-policy.ts';

export { createTeammateDiscoveryView as createMcpDiscoveryView } from './game-tools-policy.ts';

const DEFAULT_GAME_ENDPOINT = 'http://127.0.0.1:2567';
const HUMAN_ORIGIN = process.env.THE_COOP_HUMAN_ORIGIN ?? 'http://127.0.0.1:5173';
const SEAT_TIMEOUT_MS = 5_000;

export interface MoveResultMessage {
  seq: number;
  accepted: boolean;
  reason?: string;
  routeKind: 'none' | 'target' | 'threshold-stop';
  effectiveWorldX: number;
  effectiveWorldY: number;
}

export interface StartGameResult {
  status: 'waiting_for_player_one' | 'active';
  roomId: string;
  phase: string;
  playerId: 'player-2';
  humanJoinUrl?: string;
}

export type MoveResultListener = (result: MoveResultMessage) => void;
export type SnapshotListener = (snapshot: CoopSnapshot) => void;

function actionableConnectionError(endpoint: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `Could not connect to The Coop game server at ${endpoint}. `
    + `Start \`npm run dev\` from the repository root, then call start_game again. `
    + `Underlying error: ${detail}`,
  );
}

function isMoveResult(value: unknown): value is MoveResultMessage {
  if (value === null || typeof value !== 'object') return false;
  const result = value as Partial<MoveResultMessage>;
  return Number.isInteger(result.seq)
    && typeof result.accepted === 'boolean'
    && (result.routeKind === 'none' || result.routeKind === 'target' || result.routeKind === 'threshold-stop')
    && typeof result.effectiveWorldX === 'number'
    && Number.isFinite(result.effectiveWorldX)
    && typeof result.effectiveWorldY === 'number'
    && Number.isFinite(result.effectiveWorldY);
}

export class TeammateSession {
  readonly #endpoint: string;
  #client: Client;
  #room: Room<unknown, CoopStateSchema> | null = null;
  #snapshot: CoopSnapshot | null = null;
  #pairing: CreatedPairingToken | null = null;
  #playerId: 'player-2' | null = null;
  #moveListeners = new Set<MoveResultListener>();
  #snapshotListeners = new Set<SnapshotListener>();

  constructor(endpoint = process.env.THE_COOP_GAME_SERVER_URL ?? DEFAULT_GAME_ENDPOINT) {
    this.#endpoint = endpoint;
    this.#client = new Client(endpoint);
  }

  get snapshot(): CoopSnapshot | null {
    return this.#snapshot === null ? null : cloneSnapshot(this.#snapshot);
  }

  get roomId(): string | null {
    return this.#room?.roomId ?? null;
  }

  get playerId(): 'player-2' | null {
    return this.#playerId;
  }

  get usable(): boolean {
    return this.#room !== null
      && (this.#room.connection.isOpen || this.#room.reconnection.isReconnecting)
      && this.#snapshot?.phase !== 'abandoned';
  }

  async startGame(now = Date.now()): Promise<StartGameResult> {
    if (this.usable && this.#snapshot !== null && this.#room !== null) {
      const waiting = this.#snapshot.phase === 'waitingForPlayers';
      if (!waiting || (this.#pairing !== null && now < this.#pairing.expiresAt)) {
        return this.#startResult(now);
      }
    }

    await this.close();
    this.#client = new Client(this.#endpoint);
    const pairing = createPairingToken(now);

    try {
      const room = await this.#client.create<CoopStateSchema>('coop', {
        roomMode: 'human-ai',
        controllerKind: 'mcp',
        playerId: 'player-2',
        pairingTokenHash: pairing.tokenHash,
        pairingExpiresAt: pairing.expiresAt,
      }, CoopStateSchema);
      this.#room = room;
      this.#pairing = pairing;
      room.reconnection.minUptime = 0;
      room.reconnection.maxRetries = 9;
      this.#wire(room);
      this.#setSnapshot(readSnapshot(room.state));
      await this.#waitForPlayerTwoSeat(room);
      return this.#startResult(now);
    } catch (error) {
      await this.close();
      throw actionableConnectionError(this.#endpoint, error);
    }
  }

  observe(): Record<string, unknown> {
    const snapshot = this.#snapshot;
    const room = this.#room;
    if (snapshot === null || room === null || this.#playerId !== 'player-2') {
      throw new Error('No active teammate session. Call start_game before observe_game.');
    }

    const pairingAvailable = snapshot.phase === 'waitingForPlayers'
      && this.#pairing !== null
      && Date.now() < this.#pairing.expiresAt;
    return createTeammateObservation(snapshot, {
      roomId: room.roomId,
      reconnecting: room.reconnection.isReconnecting,
      pairingAvailable,
    });
  }

  onMoveResult(listener: MoveResultListener): () => void {
    this.#moveListeners.add(listener);
    return () => this.#moveListeners.delete(listener);
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.#snapshotListeners.add(listener);
    return () => this.#snapshotListeners.delete(listener);
  }

  sendMove(seq: number, worldX: number, worldY: number): boolean {
    if (this.#room === null || !this.#room.connection.isOpen) return false;
    this.#room.send('moveTarget', { seq, worldX, worldY });
    return true;
  }

  async close(): Promise<void> {
    const room = this.#room;
    this.#room = null;
    this.#snapshot = null;
    this.#pairing = null;
    this.#playerId = null;
    if (room !== null) {
      room.removeAllListeners();
      try {
        await room.leave();
      } catch {
        // The room may already be gone after reconnect exhaustion.
      }
    }
  }

  #startResult(now: number): StartGameResult {
    const room = this.#room;
    const snapshot = this.#snapshot;
    if (room === null || snapshot === null || this.#playerId !== 'player-2') {
      throw new Error('The MCP teammate did not receive its Player 2 seat.');
    }
    const canJoin = snapshot.phase === 'waitingForPlayers'
      && this.#pairing !== null
      && now < this.#pairing.expiresAt;
    return {
      status: canJoin ? 'waiting_for_player_one' : 'active',
      roomId: room.roomId,
      phase: snapshot.phase,
      playerId: 'player-2',
      ...(canJoin
        ? {
            humanJoinUrl: `${HUMAN_ORIGIN}/#room=${encodeURIComponent(room.roomId)}&pair=${encodeURIComponent(this.#pairing!.token)}`,
          }
        : {}),
    };
  }

  #wire(room: Room<unknown, CoopStateSchema>): void {
    room.onStateChange((state) => {
      if (this.#room === room) this.#setSnapshot(readSnapshot(state));
    });
    room.onLeave(() => {
      if (this.#room === room && !room.reconnection.isReconnecting) {
        this.#setSnapshot({
          ...(this.#snapshot ?? readSnapshot(room.state)),
          phase: 'abandoned',
        });
      }
    });
    room.onMessage('seat', (value: unknown) => {
      if (
        value !== null
        && typeof value === 'object'
        && (value as { playerId?: unknown }).playerId === 'player-2'
      ) {
        this.#playerId = 'player-2';
      }
    });
    room.onMessage('moveResult', (value: unknown) => {
      if (!isMoveResult(value)) return;
      for (const listener of this.#moveListeners) listener(value);
    });
  }

  #setSnapshot(snapshot: CoopSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#snapshotListeners) listener(this.snapshot!);
  }

  async #waitForPlayerTwoSeat(room: Room<unknown, CoopStateSchema>): Promise<void> {
    if (this.#playerId === 'player-2') return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for the Player 2 seat assignment.'));
      }, SEAT_TIMEOUT_MS);
      const dispose = room.onMessage('seat', (value: unknown) => {
        if (
          value !== null
          && typeof value === 'object'
          && (value as { playerId?: unknown }).playerId === 'player-2'
        ) {
          clearTimeout(timeout);
          dispose();
          this.#playerId = 'player-2';
          resolve();
        }
      });
    });
  }
}
