import {
  LEVEL_CATALOG,
  LEVEL_ONE,
  getLevelDefinition,
  gridToWorld,
  isInBounds,
  levelInteractablePoint,
} from './level.ts';
import type {
  GateId,
  GridPoint,
  InteractableId,
  KeycardId,
  LevelId,
  NetworkKeycardState,
  NetworkPressurePlateState,
  NetworkRelayButtonState,
  NetworkTeleporterState,
  WorldPoint,
} from './types.ts';

export type InspectionInteractableId = InteractableId;

export type InspectionTarget =
  | { kind: 'interactable'; id: InspectionInteractableId }
  | { kind: 'grid'; x: number; y: number };

export interface InspectionPosition {
  grid: GridPoint;
  world: WorldPoint;
}

export interface InspectionObject extends InspectionPosition {
  id: InspectionInteractableId;
  kind:
    | 'pressure_plate'
    | 'teleporter_power'
    | 'teleporter_pad'
    | 'keycard'
    | 'relay_button'
    | 'exit_zone';
  occupiedCells: readonly GridPoint[];
  occupied?: boolean;
  powered?: boolean;
  active?: boolean;
  collected?: boolean;
  pairedWith?: InspectionInteractableId;
  occupiedBy?: string | null;
}

export interface LevelInspectionSource {
  levelId: LevelId;
  doorOpen: boolean;
  collectedKeycardIds?: readonly KeycardId[];
  latchedGateIds?: readonly GateId[];
  pressurePlates?: readonly NetworkPressurePlateState[];
  teleporters?: readonly NetworkTeleporterState[];
  keycards?: readonly NetworkKeycardState[];
  relayButtons?: readonly NetworkRelayButtonState[];
}

export interface LevelInspection {
  level: {
    id: LevelId;
    number: number;
    count: number;
    name: string;
    objective: string;
  };
  coordinateSystem: {
    origin: 'top-left';
    xIncreases: 'right';
    yIncreases: 'down';
    gridUnits: 'cells';
    worldUnits: 'pixels';
  };
  dimensions: {
    width: number;
    height: number;
  };
  walls: readonly InspectionPosition[];
  gate: {
    id: 'gate_main';
    open: boolean;
    unlocked: boolean;
    occupiedCells: readonly InspectionPosition[];
    rule: ReturnType<typeof getLevelDefinition>['gateRule'];
  };
  interactables: readonly InspectionObject[];
}

export interface ResolvedInspectionTarget extends InspectionPosition {
  interactableId?: InspectionInteractableId;
}

function freezeGrid(point: GridPoint): GridPoint {
  return Object.freeze({ x: point.x, y: point.y });
}

function projectPosition(point: GridPoint): InspectionPosition {
  return Object.freeze({
    grid: freezeGrid(point),
    world: Object.freeze(gridToWorld(point)),
  });
}

function rowMajor(a: GridPoint, b: GridPoint): number {
  return a.y - b.y || a.x - b.x;
}

function wallPoints(levelId: LevelId): GridPoint[] {
  const level = getLevelDefinition(levelId);
  return [...level.walls]
    .map((entry) => {
      const [x, y] = entry.split(',').map(Number);
      return { x: x ?? Number.NaN, y: y ?? Number.NaN };
    })
    .sort(rowMajor);
}

function inspectionObject(
  id: InspectionInteractableId,
  kind: InspectionObject['kind'],
  canonical: GridPoint,
  dynamic: Partial<InspectionObject> = {},
  occupiedCells: readonly GridPoint[] = [canonical],
): InspectionObject {
  return Object.freeze({
    id,
    kind,
    ...projectPosition(canonical),
    occupiedCells: Object.freeze(occupiedCells.map(freezeGrid)),
    ...dynamic,
  });
}

function normalizeSource(source: boolean | LevelInspectionSource): LevelInspectionSource {
  return typeof source === 'boolean'
    ? { levelId: LEVEL_ONE.id, doorOpen: source }
    : source;
}

/**
 * Projects a catalog level and its authoritative mechanism state into a stable,
 * JSON-safe observation. The boolean overload preserves the original Level 1 API.
 */
export function createLevelInspection(
  source: boolean | LevelInspectionSource = false,
): LevelInspection {
  const snapshot = normalizeSource(source);
  const level = getLevelDefinition(snapshot.levelId);
  const pressureState = new Map(
    (snapshot.pressurePlates ?? []).map((entry) => [entry.id, entry]),
  );
  const teleporterState = new Map(
    (snapshot.teleporters ?? []).map((entry) => [entry.id, entry]),
  );
  const keycardState = new Map(
    (snapshot.keycards ?? []).map((entry) => [entry.id, entry]),
  );
  const relayState = new Map(
    (snapshot.relayButtons ?? []).map((entry) => [entry.id, entry]),
  );
  const interactables: InspectionObject[] = [];

  for (const plate of level.pressurePlates) {
    interactables.push(inspectionObject(
      plate.id,
      'pressure_plate',
      plate.grid,
      { occupied: pressureState.get(plate.id)?.occupied ?? false },
    ));
  }
  for (const teleporter of level.teleporters) {
    const powered = teleporterState.get(teleporter.id)?.powered ?? false;
    interactables.push(inspectionObject(
      teleporter.power.id,
      'teleporter_power',
      teleporter.power.grid,
      { occupied: powered, powered },
    ));
    interactables.push(inspectionObject(
      teleporter.pads[0].id,
      'teleporter_pad',
      teleporter.pads[0].grid,
      { active: powered, pairedWith: teleporter.pads[1].id },
    ));
    interactables.push(inspectionObject(
      teleporter.pads[1].id,
      'teleporter_pad',
      teleporter.pads[1].grid,
      { active: powered, pairedWith: teleporter.pads[0].id },
    ));
  }
  for (const card of level.keycards) {
    const collected = keycardState.get(card.id)?.collected
      ?? snapshot.collectedKeycardIds?.includes(card.id)
      ?? false;
    interactables.push(inspectionObject(
      card.id,
      'keycard',
      card.grid,
      { collected },
    ));
  }
  for (const button of level.relayButtons) {
    const occupiedBy = relayState.get(button.id)?.occupiedBy ?? null;
    interactables.push(inspectionObject(
      button.id,
      'relay_button',
      button.grid,
      { occupied: occupiedBy !== null, occupiedBy },
    ));
  }
  const exitCanonical = levelInteractablePoint(level, 'exit_zone')
    ?? level.exitCells[0]
    ?? { x: 0, y: 0 };
  interactables.push(inspectionObject(
    'exit_zone',
    'exit_zone',
    exitCanonical,
    {},
    level.exitCells,
  ));

  return Object.freeze({
    level: Object.freeze({
      id: level.id,
      number: level.number,
      count: LEVEL_CATALOG.length,
      name: level.name,
      objective: level.objective,
    }),
    coordinateSystem: Object.freeze({
      origin: 'top-left',
      xIncreases: 'right',
      yIncreases: 'down',
      gridUnits: 'cells',
      worldUnits: 'pixels',
    }),
    dimensions: Object.freeze({
      width: level.width,
      height: level.height,
    }),
    walls: Object.freeze(wallPoints(level.id).map(projectPosition)),
    gate: Object.freeze({
      id: level.doorId,
      open: snapshot.doorOpen,
      unlocked: snapshot.latchedGateIds?.includes(level.doorId) ?? false,
      occupiedCells: Object.freeze(
        [...level.doorCells].sort(rowMajor).map(projectPosition),
      ),
      rule: level.gateRule,
    }),
    interactables: Object.freeze(interactables),
  });
}

export function resolveInspectionTarget(
  target: InspectionTarget,
  levelOrSource: LevelId | Pick<LevelInspectionSource, 'levelId'> = LEVEL_ONE.id,
): ResolvedInspectionTarget | null {
  const levelId = typeof levelOrSource === 'string'
    ? levelOrSource
    : levelOrSource.levelId;
  const level = getLevelDefinition(levelId);
  if (target.kind === 'grid') {
    if (!Number.isInteger(target.x) || !Number.isInteger(target.y)) return null;
    const grid = { x: target.x, y: target.y };
    if (!isInBounds(grid, level)) return null;
    return projectPosition(grid);
  }

  const grid = levelInteractablePoint(level, target.id);
  if (grid === null) return null;
  const position = projectPosition(grid);
  return Object.freeze({
    grid: position.grid,
    world: position.world,
    interactableId: target.id,
  });
}
