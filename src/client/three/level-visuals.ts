import { GRID_HEIGHT, GRID_WIDTH } from '../../game/constants.ts';
import {
  LEVEL_CATALOG,
  type LevelDefinition,
} from '../../game/level.ts';
import type {
  GateId,
  GridPoint,
  KeycardId,
  LevelId,
  PressurePlateId,
  RelayButtonId,
  TeleporterId,
  TeleporterPadId,
  TeleporterPowerId,
} from '../../game/types.ts';
import {
  gridCenterToScene,
  type ScenePoint,
} from './coordinates.ts';

export type CardinalDirection = 'north' | 'east' | 'south' | 'west';
export type PassageAxis = 'x' | 'z';
export type FloorVariant = 'normal' | 'detail';
export type WallEdgeVariant = 'normal' | 'detail';

interface CellPlacement {
  readonly grid: GridPoint;
  readonly position: ScenePoint;
  readonly rotationY: number;
}

export interface FloorPlacement extends CellPlacement {
  readonly variant: FloorVariant;
}

export type WallTopPlacement = CellPlacement;

export interface WallEdgePlacement extends CellPlacement {
  readonly direction: CardinalDirection;
  readonly variant: WallEdgeVariant;
}

export interface WallCornerPlacement extends CellPlacement {
  readonly directions: readonly [CardinalDirection, CardinalDirection];
}

export interface DoorPlacement extends CellPlacement {
  readonly id: GateId;
  readonly instanceId: string;
  readonly cellIndex: number;
  /** Axis with walkable cells on both opposing sides of this door cell. */
  readonly passageAxis: PassageAxis;
}

export interface PressurePlatePlacement extends CellPlacement {
  readonly kind: 'pressure-plate';
  readonly id: PressurePlateId;
}

export interface TeleporterPowerPlacement extends CellPlacement {
  readonly kind: 'teleporter-power';
  readonly id: TeleporterPowerId;
  readonly teleporterId: TeleporterId;
}

export interface TeleporterPadPlacement extends CellPlacement {
  readonly kind: 'teleporter-pad';
  readonly id: TeleporterPadId;
  readonly teleporterId: TeleporterId;
  readonly pairedWith: TeleporterPadId;
}

export interface KeycardPlacement extends CellPlacement {
  readonly kind: 'keycard';
  readonly id: KeycardId;
}

export interface RelayPlacement extends CellPlacement {
  readonly kind: 'relay';
  readonly id: RelayButtonId;
}

export interface ExitPlacement extends CellPlacement {
  readonly kind: 'exit';
  readonly id: 'exit_zone';
  readonly cellIndex: number;
}

export interface ThresholdPlacement extends CellPlacement {
  readonly kind: 'threshold';
  readonly id: 'left-threshold' | 'right-threshold';
  readonly side: 'left' | 'right';
}

export type MechanismPlacement =
  | PressurePlatePlacement
  | TeleporterPowerPlacement
  | TeleporterPadPlacement
  | KeycardPlacement
  | RelayPlacement
  | ExitPlacement
  | ThresholdPlacement;

export interface TeleporterCircuitPlacement {
  readonly id: string;
  readonly teleporterId: TeleporterId;
  readonly padId: TeleporterPadId;
  /** Preserves the existing source -> horizontal bend -> target route. */
  readonly gridPath: readonly [GridPoint, GridPoint, GridPoint];
  readonly path: readonly [ScenePoint, ScenePoint, ScenePoint];
}

export interface LevelVisualPlan {
  readonly levelId: LevelId;
  readonly floors: readonly FloorPlacement[];
  readonly wallTops: readonly WallTopPlacement[];
  readonly wallEdges: readonly WallEdgePlacement[];
  readonly wallCorners: readonly WallCornerPlacement[];
  readonly doors: readonly DoorPlacement[];
  readonly mechanisms: readonly MechanismPlacement[];
  readonly circuits: readonly TeleporterCircuitPlacement[];
}

interface DirectionDefinition {
  readonly direction: CardinalDirection;
  readonly dx: number;
  readonly dy: number;
  readonly rotationY: number;
}

const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

const DIRECTIONS: readonly DirectionDefinition[] = Object.freeze([
  Object.freeze({ direction: 'north', dx: 0, dy: -1, rotationY: 0 }),
  Object.freeze({ direction: 'east', dx: 1, dy: 0, rotationY: QUARTER_TURN }),
  Object.freeze({ direction: 'south', dx: 0, dy: 1, rotationY: HALF_TURN }),
  Object.freeze({ direction: 'west', dx: -1, dy: 0, rotationY: -QUARTER_TURN }),
]);

const CORNER_PAIRS = Object.freeze([
  Object.freeze(['north', 'east'] as const),
  Object.freeze(['east', 'south'] as const),
  Object.freeze(['south', 'west'] as const),
  Object.freeze(['west', 'north'] as const),
]);

const pointKey = (point: GridPoint): string => `${point.x},${point.y}`;

function frozenGrid(x: number, y: number): GridPoint {
  return Object.freeze({ x, y });
}

function frozenScene(point: GridPoint): ScenePoint {
  return Object.freeze(gridCenterToScene(point));
}

function placementBase(
  point: GridPoint,
  rotationY = 0,
): CellPlacement {
  const grid = frozenGrid(point.x, point.y);
  return {
    grid,
    position: frozenScene(grid),
    rotationY,
  };
}

function rowMajor(a: GridPoint, b: GridPoint): number {
  return a.y - b.y || a.x - b.x;
}

function parseWallKey(value: string): GridPoint {
  const match = /^(-?\d+),(-?\d+)$/.exec(value);
  if (match === null) throw new Error(`Invalid wall key: ${value}`);
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new Error(`Invalid wall key: ${value}`);
  }
  return frozenGrid(x, y);
}

function stableHash(
  levelNumber: number,
  x: number,
  y: number,
  salt: number,
): number {
  return (
    Math.imul(levelNumber, 73_856_093)
    ^ Math.imul(x + 1, 19_349_663)
    ^ Math.imul(y + 1, 83_492_791)
    ^ Math.imul(salt, 1_103_515_245)
  ) >>> 0;
}

function stableRotation(level: LevelDefinition, point: GridPoint, salt: number): number {
  return stableHash(level.number, point.x, point.y, salt) % 4 * QUARTER_TURN;
}

function allReservedFloorKeys(level: LevelDefinition): ReadonlySet<string> {
  const points: GridPoint[] = [
    ...[...level.walls].map(parseWallKey),
    ...level.doorCells,
    ...level.playerSpawns,
    ...level.pressurePlates.map(({ grid }) => grid),
    ...level.teleporters.flatMap(({ power, pads }) => [power.grid, ...pads.map(({ grid }) => grid)]),
    ...level.keycards.map(({ grid }) => grid),
    ...level.relayButtons.map(({ grid }) => grid),
    ...level.exitCells,
    level.leftThreshold,
    level.rightThreshold,
  ];
  return new Set(points.map(pointKey));
}

function createFloors(level: LevelDefinition): readonly FloorPlacement[] {
  const reserved = allReservedFloorKeys(level);
  const floors: FloorPlacement[] = [];
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const point = frozenGrid(x, y);
      const detail = !reserved.has(pointKey(point))
        && stableHash(level.number, x, y, 1) % 9 === 0;
      floors.push(Object.freeze({
        ...placementBase(point, stableRotation(level, point, 2)),
        variant: detail ? 'detail' : 'normal',
      }));
    }
  }
  return Object.freeze(floors);
}

function effectiveWallCells(level: LevelDefinition): readonly GridPoint[] {
  const doorKeys = new Set(level.doorCells.map(pointKey));
  return Object.freeze(
    [...level.walls]
      .map(parseWallKey)
      .filter((point) => !doorKeys.has(pointKey(point)))
      .sort(rowMajor),
  );
}

function createWalls(level: LevelDefinition): {
  readonly wallTops: readonly WallTopPlacement[];
  readonly wallEdges: readonly WallEdgePlacement[];
  readonly wallCorners: readonly WallCornerPlacement[];
} {
  const walls = effectiveWallCells(level);
  const wallKeys = new Set(walls.map(pointKey));
  const wallTops: WallTopPlacement[] = [];
  const wallEdges: WallEdgePlacement[] = [];
  const wallCorners: WallCornerPlacement[] = [];

  for (const point of walls) {
    wallTops.push(Object.freeze({
      ...placementBase(point, stableRotation(level, point, 3)),
    }));

    const exposed = new Set<CardinalDirection>();
    for (const direction of DIRECTIONS) {
      const neighbor = frozenGrid(point.x + direction.dx, point.y + direction.dy);
      if (wallKeys.has(pointKey(neighbor))) continue;
      exposed.add(direction.direction);
      wallEdges.push(Object.freeze({
        ...placementBase(point, direction.rotationY),
        direction: direction.direction,
        variant: stableHash(
          level.number,
          point.x,
          point.y,
          DIRECTIONS.indexOf(direction) + 4,
        ) % 7 === 0
          ? 'detail'
          : 'normal',
      }));
    }

    for (const [first, second] of CORNER_PAIRS) {
      if (!exposed.has(first) || !exposed.has(second)) continue;
      const direction = DIRECTIONS.find(({ direction: candidate }) => candidate === first);
      if (direction === undefined) throw new Error(`Unknown wall direction: ${first}`);
      wallCorners.push(Object.freeze({
        ...placementBase(point, direction.rotationY),
        directions: Object.freeze([first, second] as const),
      }));
    }
  }

  return {
    wallTops: Object.freeze(wallTops),
    wallEdges: Object.freeze(wallEdges),
    wallCorners: Object.freeze(wallCorners),
  };
}

function isOpenNeighbor(
  level: LevelDefinition,
  doorKeys: ReadonlySet<string>,
  x: number,
  y: number,
): boolean {
  if (x < 0 || x >= level.width || y < 0 || y >= level.height) return false;
  const key = `${x},${y}`;
  return !level.walls.has(key) && !doorKeys.has(key);
}

function inferDoorPassageAxis(
  level: LevelDefinition,
  point: GridPoint,
  doorKeys: ReadonlySet<string>,
): PassageAxis {
  const alongX = isOpenNeighbor(level, doorKeys, point.x - 1, point.y)
    && isOpenNeighbor(level, doorKeys, point.x + 1, point.y);
  const alongZ = isOpenNeighbor(level, doorKeys, point.x, point.y - 1)
    && isOpenNeighbor(level, doorKeys, point.x, point.y + 1);
  if (alongX === alongZ) {
    throw new Error(
      `${level.id}: door ${pointKey(point)} must have exactly one opposing walkable-neighbor axis`,
    );
  }
  return alongX ? 'x' : 'z';
}

function createDoors(level: LevelDefinition): readonly DoorPlacement[] {
  const doorKeys = new Set(level.doorCells.map(pointKey));
  return Object.freeze(level.doorCells.map((point, cellIndex) => {
    const passageAxis = inferDoorPassageAxis(level, point, doorKeys);
    return Object.freeze({
      ...placementBase(point, passageAxis === 'x' ? 0 : QUARTER_TURN),
      id: level.doorId,
      instanceId: `${level.doorId}:${cellIndex}`,
      cellIndex,
      passageAxis,
    });
  }));
}

function createMechanisms(level: LevelDefinition): readonly MechanismPlacement[] {
  const mechanisms: MechanismPlacement[] = [];

  for (const pressurePlate of level.pressurePlates) {
    mechanisms.push(Object.freeze({
      ...placementBase(pressurePlate.grid),
      kind: 'pressure-plate',
      id: pressurePlate.id,
    }));
  }

  for (const teleporter of level.teleporters) {
    mechanisms.push(Object.freeze({
      ...placementBase(teleporter.power.grid),
      kind: 'teleporter-power',
      id: teleporter.power.id,
      teleporterId: teleporter.id,
    }));
    const [first, second] = teleporter.pads;
    mechanisms.push(
      Object.freeze({
        ...placementBase(first.grid),
        kind: 'teleporter-pad',
        id: first.id,
        teleporterId: teleporter.id,
        pairedWith: second.id,
      }),
      Object.freeze({
        ...placementBase(second.grid),
        kind: 'teleporter-pad',
        id: second.id,
        teleporterId: teleporter.id,
        pairedWith: first.id,
      }),
    );
  }

  for (const keycard of level.keycards) {
    mechanisms.push(Object.freeze({
      ...placementBase(keycard.grid),
      kind: 'keycard',
      id: keycard.id,
    }));
  }

  for (const relay of level.relayButtons) {
    mechanisms.push(Object.freeze({
      ...placementBase(relay.grid),
      kind: 'relay',
      id: relay.id,
    }));
  }

  level.exitCells.forEach((grid, cellIndex) => {
    mechanisms.push(Object.freeze({
      ...placementBase(grid),
      kind: 'exit',
      id: 'exit_zone',
      cellIndex,
    }));
  });

  mechanisms.push(
    Object.freeze({
      ...placementBase(level.leftThreshold),
      kind: 'threshold',
      id: 'left-threshold',
      side: 'left',
    }),
    Object.freeze({
      ...placementBase(level.rightThreshold),
      kind: 'threshold',
      id: 'right-threshold',
      side: 'right',
    }),
  );

  return Object.freeze(mechanisms);
}

function createCircuits(level: LevelDefinition): readonly TeleporterCircuitPlacement[] {
  const circuits: TeleporterCircuitPlacement[] = [];
  for (const teleporter of level.teleporters) {
    for (const pad of teleporter.pads) {
      const source = frozenGrid(teleporter.power.grid.x, teleporter.power.grid.y);
      const bend = frozenGrid(pad.grid.x, teleporter.power.grid.y);
      const target = frozenGrid(pad.grid.x, pad.grid.y);
      circuits.push(Object.freeze({
        id: `${teleporter.id}:${pad.id}`,
        teleporterId: teleporter.id,
        padId: pad.id,
        gridPath: Object.freeze([source, bend, target] as const),
        path: Object.freeze([
          frozenScene(source),
          frozenScene(bend),
          frozenScene(target),
        ] as const),
      }));
    }
  }
  return Object.freeze(circuits);
}

function createLevelVisualPlan(level: LevelDefinition): LevelVisualPlan {
  const { wallTops, wallEdges, wallCorners } = createWalls(level);
  return Object.freeze({
    levelId: level.id,
    floors: createFloors(level),
    wallTops,
    wallEdges,
    wallCorners,
    doors: createDoors(level),
    mechanisms: createMechanisms(level),
    circuits: createCircuits(level),
  });
}

function catalogLevel(levelId: string): LevelDefinition {
  return LEVEL_CATALOG.find(({ id }) => id === levelId) ?? LEVEL_CATALOG[0];
}

/** Builds a fresh deterministic plan using only the authoritative level catalog. */
export function buildLevelVisualPlan(levelId: string): LevelVisualPlan {
  return createLevelVisualPlan(catalogLevel(levelId));
}

/** Frozen plans for every authoritative catalog level, in campaign order. */
export const LEVEL_VISUAL_PLANS: readonly LevelVisualPlan[] = Object.freeze(
  LEVEL_CATALOG.map(createLevelVisualPlan),
);

/** Returns a cached catalog plan and deliberately follows the Level 1 fallback contract. */
export function getLevelVisualPlan(levelId: string): LevelVisualPlan {
  return LEVEL_VISUAL_PLANS.find(({ levelId: candidate }) => candidate === levelId)
    ?? LEVEL_VISUAL_PLANS[0]
    ?? createLevelVisualPlan(LEVEL_CATALOG[0]);
}
