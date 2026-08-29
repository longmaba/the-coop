import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const hostedRooms = sqliteTable('hosted_rooms', {
  roomId: text('room_id').primaryKey(),
  revision: integer('revision').notNull(),
  stateJson: text('state_json').notNull(),
  simulatedAtMs: integer('simulated_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
  playerOneTokenHash: text('player_one_token_hash').notNull(),
  playerOneLastSeenMs: integer('player_one_last_seen_ms'),
  playerTwoTokenHash: text('player_two_token_hash'),
  playerTwoLastSeenMs: integer('player_two_last_seen_ms'),
}, (table) => [
  index('idx_hosted_rooms_updated_at_ms').on(table.updatedAtMs),
]);
