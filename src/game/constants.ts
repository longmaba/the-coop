/** Immutable tuning shared by the authoritative simulation and its consumers. */
export const GRID_WIDTH = 16;
export const GRID_HEIGHT = 16;
export const CELL_SIZE = 48;
export const PLAYER_RADIUS = 14;
export const PLAYER_SPEED = 180;
export const SIMULATION_HZ = 30;
export const SNAPSHOT_HZ = 15;
export const FIXED_STEP_SECONDS = 1 / SIMULATION_HZ;
export const RECONNECT_GRACE_SECONDS = 30;

/** Shared player-facing goal that preserves discovery of each level's mechanics. */
export const COOPERATIVE_DISCOVERY_GOAL =
  'Explore the facility together and get both explorers into the exit.';

export const DOOR_X = 7;
export const DOOR_ROWS = [7, 8] as const;
