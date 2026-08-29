CREATE TABLE `hosted_rooms` (
	`room_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	`simulated_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`player_one_token_hash` text NOT NULL,
	`player_one_last_seen_ms` integer,
	`player_two_token_hash` text,
	`player_two_last_seen_ms` integer
);
--> statement-breakpoint
CREATE INDEX `idx_hosted_rooms_updated_at_ms` ON `hosted_rooms` (`updated_at_ms`);