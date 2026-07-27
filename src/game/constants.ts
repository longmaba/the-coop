/** Immutable tuning shared by the authoritative simulation and its consumers. */
export const GRID_WIDTH = 24;
export const GRID_HEIGHT = 12;
export const CELL_SIZE = 48;
export const PLAYER_RADIUS = 14;
export const PLAYER_SPEED = 180;
export const SIMULATION_HZ = 30;
export const SNAPSHOT_HZ = 15;
export const FIXED_STEP_SECONDS = 1 / SIMULATION_HZ;
export const RECONNECT_GRACE_SECONDS = 30;

export const DOOR_X = 11;
export const DOOR_ROWS = [5, 6] as const;
