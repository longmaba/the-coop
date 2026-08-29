import type { GameState } from '../src/game/index.ts';
import type { HostedRoomRecord, HostedRoomStore } from '../src/hosted/service.ts';

interface HostedRoomRow {
  room_id: string;
  revision: number;
  state_json: string;
  simulated_at_ms: number;
  updated_at_ms: number;
  player_one_token_hash: string;
  player_one_last_seen_ms: number | null;
  player_two_token_hash: string | null;
  player_two_last_seen_ms: number | null;
}

const CREATE_ROOMS_SQL = `CREATE TABLE IF NOT EXISTS hosted_rooms (
  room_id text PRIMARY KEY NOT NULL,
  revision integer NOT NULL,
  state_json text NOT NULL,
  simulated_at_ms integer NOT NULL,
  updated_at_ms integer NOT NULL,
  player_one_token_hash text NOT NULL,
  player_one_last_seen_ms integer,
  player_two_token_hash text,
  player_two_last_seen_ms integer
)`;

const CREATE_UPDATED_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_hosted_rooms_updated_at_ms
ON hosted_rooms(updated_at_ms)`;

export async function ensureHostedSchema(database: D1Database): Promise<void> {
  await database.batch([
    database.prepare(CREATE_ROOMS_SQL),
    database.prepare(CREATE_UPDATED_INDEX_SQL),
  ]);
}

function fromRow(row: HostedRoomRow): HostedRoomRecord {
  return {
    roomId: row.room_id,
    revision: row.revision,
    gameState: JSON.parse(row.state_json) as GameState,
    simulatedAtMs: row.simulated_at_ms,
    updatedAtMs: row.updated_at_ms,
    playerOneTokenHash: row.player_one_token_hash,
    playerOneLastSeenMs: row.player_one_last_seen_ms,
    playerTwoTokenHash: row.player_two_token_hash,
    playerTwoLastSeenMs: row.player_two_last_seen_ms,
  };
}

function bindings(record: HostedRoomRecord): readonly unknown[] {
  return [
    record.roomId,
    record.revision,
    JSON.stringify(record.gameState),
    record.simulatedAtMs,
    record.updatedAtMs,
    record.playerOneTokenHash,
    record.playerOneLastSeenMs,
    record.playerTwoTokenHash,
    record.playerTwoLastSeenMs,
  ];
}

export class D1HostedRoomStore implements HostedRoomStore {
  constructor(readonly database: D1Database) {}

  async create(record: HostedRoomRecord): Promise<boolean> {
    try {
      const result = await this.database.prepare(`INSERT INTO hosted_rooms (
        room_id,
        revision,
        state_json,
        simulated_at_ms,
        updated_at_ms,
        player_one_token_hash,
        player_one_last_seen_ms,
        player_two_token_hash,
        player_two_last_seen_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(...bindings(record))
        .run();
      return result.meta.changes === 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/unique constraint failed|constraint_unique/i.test(message)) return false;
      throw error;
    }
  }

  async read(roomId: string): Promise<HostedRoomRecord | null> {
    const row = await this.database.prepare(`SELECT
      room_id,
      revision,
      state_json,
      simulated_at_ms,
      updated_at_ms,
      player_one_token_hash,
      player_one_last_seen_ms,
      player_two_token_hash,
      player_two_last_seen_ms
    FROM hosted_rooms
    WHERE room_id = ?`)
      .bind(roomId)
      .first<HostedRoomRow>();
    return row === null ? null : fromRow(row);
  }

  async compareAndSwap(
    expectedRevision: number,
    record: HostedRoomRecord,
  ): Promise<boolean> {
    const result = await this.database.prepare(`UPDATE hosted_rooms SET
      revision = ?,
      state_json = ?,
      simulated_at_ms = ?,
      updated_at_ms = ?,
      player_one_token_hash = ?,
      player_one_last_seen_ms = ?,
      player_two_token_hash = ?,
      player_two_last_seen_ms = ?
    WHERE room_id = ? AND revision = ?`)
      .bind(
        record.revision,
        JSON.stringify(record.gameState),
        record.simulatedAtMs,
        record.updatedAtMs,
        record.playerOneTokenHash,
        record.playerOneLastSeenMs,
        record.playerTwoTokenHash,
        record.playerTwoLastSeenMs,
        record.roomId,
        expectedRevision,
      )
      .run();
    return result.meta.changes === 1;
  }

  async deleteUpdatedBefore(timestampMs: number): Promise<void> {
    await this.database.prepare(
      'DELETE FROM hosted_rooms WHERE updated_at_ms < ?',
    ).bind(timestampMs).run();
  }
}
