import {
  CELL_SIZE,
  DOOR_ROWS,
  DOOR_X,
  GRID_HEIGHT,
  GRID_WIDTH,
  PLAYER_RADIUS,
} from './constants.ts';
import type { GridPoint, WorldPoint } from './types.ts';

export interface LevelDefinition {
  readonly width: number;
  readonly height: number;
  readonly walls: ReadonlySet<string>;
  readonly doorCells: readonly GridPoint[];
  readonly leftThreshold: GridPoint;
  readonly rightThreshold: GridPoint;
  readonly leftRegionMaxX: number;
  readonly rightRegionMinX: number;
  readonly playerSpawns: readonly [GridPoint, GridPoint];
  readonly nearPlate: GridPoint;
  readonly farPlate: GridPoint;
  readonly exitCells: readonly GridPoint[];
}

const key = (point: GridPoint): string => `${point.x},${point.y}`;

class ReadonlySetView<T> implements ReadonlySet<T> {
  readonly #source: Set<T>;

  constructor(source: Set<T>) {
    this.#source = source;
    Object.freeze(this);
  }

  get size(): number {
    return this.#source.size;
  }

  has(value: T): boolean {
    return this.#source.has(value);
  }

  entries(): SetIterator<[T, T]> {
    return this.#source.entries();
  }

  keys(): SetIterator<T> {
    return this.#source.keys();
  }

  values(): SetIterator<T> {
    return this.#source.values();
  }

  forEach(callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
    this.#source.forEach((value) => callbackfn.call(thisArg, value, value, this));
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.values();
  }
}

const mutableWalls = new Set<string>();
for (let x = 0; x < GRID_WIDTH; x += 1) {
  mutableWalls.add(`${x},0`);
  mutableWalls.add(`${x},${GRID_HEIGHT - 1}`);
}
for (let y = 1; y < GRID_HEIGHT - 1; y += 1) {
  mutableWalls.add(`0,${y}`);
  mutableWalls.add(`${GRID_WIDTH - 1},${y}`);
  if (!DOOR_ROWS.includes(y as (typeof DOOR_ROWS)[number])) mutableWalls.add(`${DOOR_X},${y}`);
}

// Console banks leave deliberate lanes around each plate and force a routed approach.
for (const point of [
  { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 },
  { x: 7, y: 7 }, { x: 8, y: 7 },
  { x: 15, y: 5 }, { x: 15, y: 6 }, { x: 16, y: 6 },
  { x: 18, y: 4 }, { x: 18, y: 7 },
]) mutableWalls.add(key(point));

const frozenPoint = (x: number, y: number): GridPoint => Object.freeze({ x, y });

export const LEVEL_ONE: LevelDefinition = Object.freeze({
  width: GRID_WIDTH,
  height: GRID_HEIGHT,
  walls: new ReadonlySetView(mutableWalls),
  doorCells: Object.freeze(DOOR_ROWS.map((y) => frozenPoint(DOOR_X, y))),
  leftThreshold: frozenPoint(DOOR_X - 1, 6),
  rightThreshold: frozenPoint(DOOR_X + 1, 6),
  leftRegionMaxX: DOOR_X - 1,
  rightRegionMinX: DOOR_X + 1,
  playerSpawns: Object.freeze([frozenPoint(3, 5), frozenPoint(3, 7)] as const),
  nearPlate: frozenPoint(8, 6),
  farPlate: frozenPoint(14, 6),
  exitCells: Object.freeze([
    frozenPoint(19, 4), frozenPoint(20, 4), frozenPoint(21, 4),
    frozenPoint(19, 5), frozenPoint(20, 5), frozenPoint(21, 5),
    frozenPoint(19, 6), frozenPoint(20, 6), frozenPoint(21, 6),
    frozenPoint(19, 7), frozenPoint(20, 7), frozenPoint(21, 7),
  ]),
});

export function isInBounds(point: GridPoint, level = LEVEL_ONE): boolean {
  return point.x >= 0 && point.x < level.width && point.y >= 0 && point.y < level.height;
}

export function isDoorCell(point: GridPoint, level = LEVEL_ONE): boolean {
  return level.doorCells.some((cell) => cell.x === point.x && cell.y === point.y);
}

export function isStaticWalkable(point: GridPoint, level = LEVEL_ONE): boolean {
  return isInBounds(point, level) && !level.walls.has(key(point)) && !isDoorCell(point, level);
}

export function isWalkable(point: GridPoint, doorOpen: boolean, level = LEVEL_ONE): boolean {
  return isInBounds(point, level) && !level.walls.has(key(point)) && (doorOpen || !isDoorCell(point, level));
}

export function gridToWorld(point: GridPoint): WorldPoint {
  return { x: (point.x + 0.5) * CELL_SIZE, y: (point.y + 0.5) * CELL_SIZE };
}

export function worldToGrid(point: WorldPoint): GridPoint | null {
  const x = Math.floor(point.x / CELL_SIZE);
  const y = Math.floor(point.y / CELL_SIZE);
  return isInBounds({ x, y }) ? { x, y } : null;
}

/** Keeps valid clicks exact when safe, otherwise returns the nearest safe point in that cell. */
export function nearestSafePoint(point: WorldPoint, cell: GridPoint): WorldPoint {
  const minX = cell.x * CELL_SIZE + PLAYER_RADIUS;
  const maxX = (cell.x + 1) * CELL_SIZE - PLAYER_RADIUS;
  const minY = cell.y * CELL_SIZE + PLAYER_RADIUS;
  const maxY = (cell.y + 1) * CELL_SIZE - PLAYER_RADIUS;
  return {
    x: Math.max(minX, Math.min(maxX, point.x)),
    y: Math.max(minY, Math.min(maxY, point.y)),
  };
}

export function sameGridPoint(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

export function isExitPosition(position: WorldPoint, level = LEVEL_ONE): boolean {
  const cell = worldToGrid(position);
  return cell !== null && level.exitCells.some((exit) => sameGridPoint(exit, cell));
}

export function plateIsPressed(position: WorldPoint, plate: GridPoint): boolean {
  const playerCell = worldToGrid(position);
  return playerCell !== null && sameGridPoint(playerCell, plate);
}

export function sideFor(point: GridPoint, level = LEVEL_ONE): 'left' | 'right' | 'door' {
  if (isDoorCell(point, level)) return 'door';
  return point.x <= level.leftRegionMaxX ? 'left' : 'right';
}
