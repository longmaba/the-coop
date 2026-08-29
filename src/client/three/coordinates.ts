import { CELL_SIZE, GRID_HEIGHT, GRID_WIDTH } from '../../game/constants.ts';
import type { GridPoint, WorldPoint } from '../../game/types.ts';

/** Presentation scale only. Authoritative simulation coordinates remain in CELL_SIZE units. */
export const SCENE_CELL_SIZE = 4;

export interface ScenePoint {
  readonly x: number;
  readonly z: number;
}

export interface BoardBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly width: number;
  readonly depth: number;
}

const HALF_BOARD_SCENE_WIDTH = GRID_WIDTH * SCENE_CELL_SIZE / 2;
const HALF_BOARD_SCENE_DEPTH = GRID_HEIGHT * SCENE_CELL_SIZE / 2;

/** Scene-space cell-edge bounds for the centered 16 by 16 board. */
export const BOARD_BOUNDS: BoardBounds = Object.freeze({
  minX: -HALF_BOARD_SCENE_WIDTH,
  maxX: HALF_BOARD_SCENE_WIDTH,
  minZ: -HALF_BOARD_SCENE_DEPTH,
  maxZ: HALF_BOARD_SCENE_DEPTH,
  width: GRID_WIDTH * SCENE_CELL_SIZE,
  depth: GRID_HEIGHT * SCENE_CELL_SIZE,
});

/** Converts exact server-world coordinates to the centered Three.js ground plane. */
export function worldToScene(point: WorldPoint): ScenePoint {
  return {
    x: (point.x / CELL_SIZE - GRID_WIDTH / 2) * SCENE_CELL_SIZE,
    z: (point.y / CELL_SIZE - GRID_HEIGHT / 2) * SCENE_CELL_SIZE,
  };
}

/** Exact algebraic inverse of worldToScene; no grid snapping is applied. */
export function sceneToWorld(point: ScenePoint): WorldPoint {
  return {
    x: (point.x / SCENE_CELL_SIZE + GRID_WIDTH / 2) * CELL_SIZE,
    y: (point.z / SCENE_CELL_SIZE + GRID_HEIGHT / 2) * CELL_SIZE,
  };
}

export function gridCenterToWorld(point: GridPoint): WorldPoint {
  return {
    x: (point.x + 0.5) * CELL_SIZE,
    y: (point.y + 0.5) * CELL_SIZE,
  };
}

export function gridCenterToScene(point: GridPoint): ScenePoint {
  return worldToScene(gridCenterToWorld(point));
}
