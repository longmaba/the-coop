import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE,
  GRID_HEIGHT,
  GRID_WIDTH,
} from '../../../src/game/constants.ts';
import {
  LEVEL_CATALOG,
  isStaticWalkable,
  type LevelDefinition,
} from '../../../src/game/level.ts';
import type { GridPoint } from '../../../src/game/types.ts';
import {
  BOARD_BOUNDS,
  gridCenterToScene,
  gridCenterToWorld,
  sceneToWorld,
  SCENE_CELL_SIZE,
  worldToScene,
} from '../../../src/client/three/coordinates.ts';
import {
  buildLevelVisualPlan,
  getLevelVisualPlan,
  LEVEL_VISUAL_PLANS,
  type CardinalDirection,
  type LevelVisualPlan,
} from '../../../src/client/three/level-visuals.ts';

const pointKey = (point: GridPoint): string => `${point.x},${point.y}`;

const directionOffsets: Readonly<Record<CardinalDirection, GridPoint>> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

const cornerPairs = [
  ['north', 'east'],
  ['east', 'south'],
  ['south', 'west'],
  ['west', 'north'],
] as const satisfies readonly (readonly [CardinalDirection, CardinalDirection])[];

function effectiveWallKeys(level: LevelDefinition): Set<string> {
  const doors = new Set(level.doorCells.map(pointKey));
  return new Set([...level.walls].filter((key) => !doors.has(key)));
}

function expectedEdgeKeys(level: LevelDefinition): string[] {
  const walls = effectiveWallKeys(level);
  return [...walls].flatMap((wallKey) => {
    const [rawX, rawY] = wallKey.split(',');
    const x = Number(rawX);
    const y = Number(rawY);
    return Object.entries(directionOffsets).flatMap(([direction, offset]) =>
      walls.has(`${x + offset.x},${y + offset.y}`)
        ? []
        : [`${wallKey}:${direction}`]);
  }).sort();
}

function expectedCornerKeys(level: LevelDefinition): string[] {
  const edges = new Set(expectedEdgeKeys(level));
  return [...effectiveWallKeys(level)].flatMap((wallKey) =>
    cornerPairs.flatMap(([first, second]) =>
      edges.has(`${wallKey}:${first}`) && edges.has(`${wallKey}:${second}`)
        ? [`${wallKey}:${first}-${second}`]
        : []),
  ).sort();
}

function plannedIds(plan: LevelVisualPlan, kind: LevelVisualPlan['mechanisms'][number]['kind']): string[] {
  return plan.mechanisms
    .filter((mechanism) => mechanism.kind === kind)
    .map(({ id }) => id);
}

describe('Three.js coordinate transforms', () => {
  it('keeps the authoritative world scale while centering the presentation board', () => {
    expect(CELL_SIZE).toBe(48);
    expect(SCENE_CELL_SIZE).toBe(4);
    expect(BOARD_BOUNDS).toEqual({
      minX: -32,
      maxX: 32,
      minZ: -32,
      maxZ: 32,
      width: 64,
      depth: 64,
    });
    expect(worldToScene({ x: 0, y: 0 })).toEqual({ x: -32, z: -32 });
    expect(worldToScene({
      x: GRID_WIDTH * CELL_SIZE,
      y: GRID_HEIGHT * CELL_SIZE,
    })).toEqual({ x: 32, z: 32 });
  });

  it('round-trips fractional world coordinates without snapping', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 137.25, y: 91.5 },
      { x: GRID_WIDTH * CELL_SIZE, y: GRID_HEIGHT * CELL_SIZE },
    ];
    for (const point of points) {
      expect(sceneToWorld(worldToScene(point))).toEqual(point);
    }
    expect(sceneToWorld({ x: -30.5, z: 13.25 })).toEqual({
      x: 18,
      y: 543,
    });
  });

  it('projects exact centers for corner cells', () => {
    expect(gridCenterToWorld({ x: 0, y: 0 })).toEqual({ x: 24, y: 24 });
    expect(gridCenterToScene({ x: 0, y: 0 })).toEqual({ x: -30, z: -30 });
    expect(gridCenterToWorld({ x: 15, y: 15 })).toEqual({ x: 744, y: 744 });
    expect(gridCenterToScene({ x: 15, y: 15 })).toEqual({ x: 30, z: 30 });
  });
});

describe('catalog-derived Three.js level visual plans', () => {
  it('prebuilds one deterministic plan per authoritative level and falls back to Level 1', () => {
    expect(LEVEL_VISUAL_PLANS.map(({ levelId }) => levelId)).toEqual(
      LEVEL_CATALOG.map(({ id }) => id),
    );
    for (const level of LEVEL_CATALOG) {
      expect(buildLevelVisualPlan(level.id)).toEqual(buildLevelVisualPlan(level.id));
      expect(getLevelVisualPlan(level.id)).toEqual(buildLevelVisualPlan(level.id));
    }
    expect(getLevelVisualPlan('unknown-level')).toBe(LEVEL_VISUAL_PLANS[0]);
    expect(buildLevelVisualPlan('unknown-level')).toEqual(buildLevelVisualPlan('level_1'));
  });

  it.each(LEVEL_CATALOG)('$id has exactly one base floor per grid cell', (level) => {
    const first = buildLevelVisualPlan(level.id);
    const second = buildLevelVisualPlan(level.id);
    expect(first.floors).toHaveLength(GRID_WIDTH * GRID_HEIGHT);
    expect(first.floors.filter(({ variant }) => variant === 'detail').length).toBeGreaterThan(0);
    expect(first.floors.filter(({ variant }) => variant === 'normal').length).toBeGreaterThan(0);
    expect(first.floors.map(({ grid }) => pointKey(grid))).toEqual(
      Array.from({ length: GRID_HEIGHT }, (_, y) =>
        Array.from({ length: GRID_WIDTH }, (__, x) => `${x},${y}`)).flat(),
    );
    expect(first.floors).toEqual(second.floors);

    const reserved = new Set([
      ...level.walls,
      ...level.doorCells.map(pointKey),
      ...level.playerSpawns.map(pointKey),
      ...level.pressurePlates.map(({ grid }) => pointKey(grid)),
      ...level.teleporters.flatMap(({ power, pads }) => [
        pointKey(power.grid),
        ...pads.map(({ grid }) => pointKey(grid)),
      ]),
      ...level.keycards.map(({ grid }) => pointKey(grid)),
      ...level.relayButtons.map(({ grid }) => pointKey(grid)),
      ...level.exitCells.map(pointKey),
      pointKey(level.leftThreshold),
      pointKey(level.rightThreshold),
    ]);
    expect(
      first.floors
        .filter(({ variant }) => variant === 'detail')
        .every(({ grid }) => !reserved.has(pointKey(grid))),
    ).toBe(true);
  });

  it.each([
    ['level_1', 84, 176],
    ['level_2', 83, 174],
    ['level_3', 80, 168],
    ['level_4', 80, 168],
  ] as const)('%s has exact wall tops and exposed four-neighbor edges', (
    levelId,
    wallTopCount,
    wallEdgeCount,
  ) => {
    const level = LEVEL_CATALOG.find(({ id }) => id === levelId);
    if (level === undefined) throw new Error(`Missing fixture level ${levelId}`);
    const plan = buildLevelVisualPlan(level.id);
    const walls = [...effectiveWallKeys(level)].sort();

    expect(plan.wallTops).toHaveLength(wallTopCount);
    expect(plan.wallTops.map(({ grid }) => pointKey(grid)).sort()).toEqual(walls);
    expect(plan.wallEdges).toHaveLength(wallEdgeCount);
    expect(
      plan.wallEdges.map(({ grid, direction }) => `${pointKey(grid)}:${direction}`).sort(),
    ).toEqual(expectedEdgeKeys(level));
    expect(
      plan.wallCorners
        .map(({ grid, directions }) => `${pointKey(grid)}:${directions.join('-')}`)
        .sort(),
    ).toEqual(expectedCornerKeys(level));
    expect(plan.wallEdges.some(({ variant }) => variant === 'detail')).toBe(true);
    expect(plan.wallEdges).toEqual(buildLevelVisualPlan(level.id).wallEdges);
  });

  it.each(LEVEL_CATALOG)('$id mirrors every mechanism, threshold, exit, and circuit', (level) => {
    const plan = buildLevelVisualPlan(level.id);
    expect(plannedIds(plan, 'pressure-plate')).toEqual(
      level.pressurePlates.map(({ id }) => id),
    );
    expect(plannedIds(plan, 'teleporter-power')).toEqual(
      level.teleporters.map(({ power }) => power.id),
    );
    expect(plannedIds(plan, 'teleporter-pad')).toEqual(
      level.teleporters.flatMap(({ pads }) => pads.map(({ id }) => id)),
    );
    expect(plannedIds(plan, 'keycard')).toEqual(level.keycards.map(({ id }) => id));
    expect(plannedIds(plan, 'relay')).toEqual(level.relayButtons.map(({ id }) => id));
    expect(plannedIds(plan, 'exit')).toEqual(level.exitCells.map(() => 'exit_zone'));
    expect(plannedIds(plan, 'threshold')).toEqual(['left-threshold', 'right-threshold']);

    const expectedMechanismCount = level.pressurePlates.length
      + level.teleporters.length * 3
      + level.keycards.length
      + level.relayButtons.length
      + level.exitCells.length
      + 2;
    expect(plan.mechanisms).toHaveLength(expectedMechanismCount);

    const plannedGrids = new Map(
      plan.mechanisms.map(({ kind, id, grid }) => [`${kind}:${id}:${pointKey(grid)}`, grid]),
    );
    for (const exit of level.exitCells) {
      expect(plannedGrids.has(`exit:exit_zone:${pointKey(exit)}`)).toBe(true);
    }
    expect(plannedGrids.has(`threshold:left-threshold:${pointKey(level.leftThreshold)}`)).toBe(true);
    expect(plannedGrids.has(`threshold:right-threshold:${pointKey(level.rightThreshold)}`)).toBe(true);

    expect(plan.circuits).toHaveLength(level.teleporters.length * 2);
    for (const teleporter of level.teleporters) {
      for (const pad of teleporter.pads) {
        const circuit = plan.circuits.find(({ padId }) => padId === pad.id);
        expect(circuit).toBeDefined();
        expect(circuit?.teleporterId).toBe(teleporter.id);
        expect(circuit?.gridPath).toEqual([
          teleporter.power.grid,
          { x: pad.grid.x, y: teleporter.power.grid.y },
          pad.grid,
        ]);
        const [source, bend, target] = circuit?.path ?? [];
        expect(source?.z).toBe(bend?.z);
        expect(bend?.x).toBe(target?.x);
      }
    }
  });

  it.each(LEVEL_CATALOG)('$id keeps mechanisms off walls and doors', (level) => {
    const blocked = new Set([...level.walls, ...level.doorCells.map(pointKey)]);
    const plan = buildLevelVisualPlan(level.id);
    expect(plan.mechanisms.every(({ grid }) => !blocked.has(pointKey(grid)))).toBe(true);
  });

  it.each(LEVEL_CATALOG)('$id keeps rendered blockers and exits authoritative', (level) => {
    const plan = buildLevelVisualPlan(level.id);
    expect(plan.wallTops.every(({ grid }) => !isStaticWalkable(grid, level))).toBe(true);
    expect(plan.doors.every(({ grid }) => !isStaticWalkable(grid, level))).toBe(true);
    expect(level.exitCells.every((grid) => isStaticWalkable(grid, level))).toBe(true);
  });

  it.each(LEVEL_CATALOG)('$id infers one unambiguous passage axis for every door cell', (level) => {
    const doors = new Set(level.doorCells.map(pointKey));
    const open = (x: number, y: number): boolean =>
      x >= 0
      && x < level.width
      && y >= 0
      && y < level.height
      && !level.walls.has(`${x},${y}`)
      && !doors.has(`${x},${y}`);

    const plan = buildLevelVisualPlan(level.id);
    expect(plan.doors).toHaveLength(level.doorCells.length);
    plan.doors.forEach((door, index) => {
      expect(door.grid).toEqual(level.doorCells[index]);
      const alongX = open(door.grid.x - 1, door.grid.y)
        && open(door.grid.x + 1, door.grid.y);
      const alongZ = open(door.grid.x, door.grid.y - 1)
        && open(door.grid.x, door.grid.y + 1);
      expect(Number(alongX) + Number(alongZ)).toBe(1);
      expect(door.passageAxis).toBe(alongX ? 'x' : 'z');
    });
  });
});
