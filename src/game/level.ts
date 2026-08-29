import {
  CELL_SIZE,
  DOOR_ROWS,
  DOOR_X,
  GRID_HEIGHT,
  GRID_WIDTH,
  PLAYER_RADIUS,
} from './constants.ts';
import type {
  GateId,
  GridPoint,
  InteractableId,
  KeycardId,
  LevelId,
  PressurePlateId,
  RelayButtonId,
  TeleporterId,
  TeleporterPadId,
  TeleporterPowerId,
  WorldPoint,
} from './types.ts';

export interface PressurePlateDefinition {
  readonly id: PressurePlateId;
  readonly grid: GridPoint;
}

export interface TeleporterPowerDefinition {
  readonly id: TeleporterPowerId;
  readonly grid: GridPoint;
}

export interface TeleporterPadDefinition {
  readonly id: TeleporterPadId;
  readonly grid: GridPoint;
}

export interface TeleporterDefinition {
  readonly id: TeleporterId;
  readonly power: TeleporterPowerDefinition;
  readonly pads: readonly [TeleporterPadDefinition, TeleporterPadDefinition];
}

export interface KeycardDefinition {
  readonly id: KeycardId;
  readonly grid: GridPoint;
}

export interface RelayButtonDefinition {
  readonly id: RelayButtonId;
  readonly grid: GridPoint;
}

export type GateRule =
  | {
      readonly kind: 'hold-any-plate';
      readonly pressurePlateIds: readonly PressurePlateId[];
      readonly latch: false;
    }
  | {
      readonly kind: 'keycards-and-relays';
      readonly requiredKeycardIds: readonly KeycardId[];
      readonly requiredRelayButtonIds: readonly RelayButtonId[];
      readonly latch: true;
    };

export interface LevelDefinition {
  readonly id: LevelId;
  readonly number: number;
  readonly name: string;
  readonly objective: string;
  readonly width: number;
  readonly height: number;
  readonly walls: ReadonlySet<string>;
  readonly doorId: GateId;
  readonly doorCells: readonly GridPoint[];
  readonly gateRule: GateRule;
  readonly leftThreshold: GridPoint;
  readonly rightThreshold: GridPoint;
  readonly leftRegionMaxX: number;
  readonly rightRegionMinX: number;
  readonly playerSpawns: readonly [GridPoint, GridPoint];
  readonly pressurePlates: readonly PressurePlateDefinition[];
  readonly teleporters: readonly TeleporterDefinition[];
  readonly keycards: readonly KeycardDefinition[];
  readonly relayButtons: readonly RelayButtonDefinition[];
  readonly exitCells: readonly GridPoint[];
  /** Compatibility aliases for the original Level 1 contract. */
  readonly nearPlate: GridPoint;
  readonly farPlate: GridPoint;
}

const key = (point: GridPoint): string => `${point.x},${point.y}`;

class ReadonlySetView<T> implements ReadonlySet<T> {
  readonly #source: Set<T>;

  constructor(source: Set<T>) {
    this.#source = source;
    Object.freeze(this);
  }

  get size(): number { return this.#source.size; }
  has(value: T): boolean { return this.#source.has(value); }
  entries(): SetIterator<[T, T]> { return this.#source.entries(); }
  keys(): SetIterator<T> { return this.#source.keys(); }
  values(): SetIterator<T> { return this.#source.values(); }
  forEach(
    callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void,
    thisArg?: unknown,
  ): void {
    this.#source.forEach((value) => callbackfn.call(thisArg, value, value, this));
  }
  [Symbol.iterator](): SetIterator<T> { return this.values(); }
}

const frozenPoint = (x: number, y: number): GridPoint =>
  Object.freeze({ x, y });

const freezePoint = (point: GridPoint): GridPoint =>
  frozenPoint(point.x, point.y);

const STANDARD_DOOR_CELLS = Object.freeze(
  DOOR_ROWS.map((y) => frozenPoint(DOOR_X, y)),
);

const STANDARD_EXIT_CELLS = Object.freeze([
  frozenPoint(12, 6), frozenPoint(13, 6), frozenPoint(14, 6),
  frozenPoint(12, 7), frozenPoint(13, 7), frozenPoint(14, 7),
  frozenPoint(12, 8), frozenPoint(13, 8), frozenPoint(14, 8),
  frozenPoint(12, 9), frozenPoint(13, 9), frozenPoint(14, 9),
]);

function standardWalls(extras: readonly GridPoint[]): ReadonlySet<string> {
  const walls = new Set<string>();
  for (let x = 0; x < GRID_WIDTH; x += 1) {
    walls.add(`${x},0`);
    walls.add(`${x},${GRID_HEIGHT - 1}`);
  }
  for (let y = 1; y < GRID_HEIGHT - 1; y += 1) {
    walls.add(`0,${y}`);
    walls.add(`${GRID_WIDTH - 1},${y}`);
    if (!DOOR_ROWS.includes(y as (typeof DOOR_ROWS)[number])) {
      walls.add(`${DOOR_X},${y}`);
    }
  }
  for (const point of extras) walls.add(key(point));
  return new ReadonlySetView(walls);
}

function pressurePlate(
  id: PressurePlateId,
  x: number,
  y: number,
): PressurePlateDefinition {
  return Object.freeze({ id, grid: frozenPoint(x, y) });
}

function teleporter(
  id: TeleporterId,
  powerId: TeleporterPowerId,
  power: GridPoint,
  firstId: TeleporterPadId,
  first: GridPoint,
  secondId: TeleporterPadId,
  second: GridPoint,
): TeleporterDefinition {
  return Object.freeze({
    id,
    power: Object.freeze({ id: powerId, grid: freezePoint(power) }),
    pads: Object.freeze([
      Object.freeze({ id: firstId, grid: freezePoint(first) }),
      Object.freeze({ id: secondId, grid: freezePoint(second) }),
    ] as const),
  });
}

function keycard(id: KeycardId, x: number, y: number): KeycardDefinition {
  return Object.freeze({ id, grid: frozenPoint(x, y) });
}

function relay(id: RelayButtonId, x: number, y: number): RelayButtonDefinition {
  return Object.freeze({ id, grid: frozenPoint(x, y) });
}

interface LevelInput {
  id: LevelId;
  number: number;
  name: string;
  objective: string;
  extras: readonly GridPoint[];
  playerSpawns?: readonly [GridPoint, GridPoint];
  pressurePlates?: readonly PressurePlateDefinition[];
  teleporters?: readonly TeleporterDefinition[];
  keycards?: readonly KeycardDefinition[];
  relayButtons?: readonly RelayButtonDefinition[];
  gateRule: GateRule;
  exitCells?: readonly GridPoint[];
  nearPlate: GridPoint;
  farPlate: GridPoint;
}

function createLevel(input: LevelInput): LevelDefinition {
  const gateRule: GateRule = input.gateRule.kind === 'hold-any-plate'
    ? Object.freeze({
        ...input.gateRule,
        pressurePlateIds: Object.freeze([...input.gateRule.pressurePlateIds]),
      })
    : Object.freeze({
        ...input.gateRule,
        requiredKeycardIds: Object.freeze([...input.gateRule.requiredKeycardIds]),
        requiredRelayButtonIds: Object.freeze([...input.gateRule.requiredRelayButtonIds]),
      });
  return Object.freeze({
    id: input.id,
    number: input.number,
    name: input.name,
    objective: input.objective,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    walls: standardWalls(input.extras),
    doorId: 'gate_main',
    doorCells: STANDARD_DOOR_CELLS,
    gateRule,
    leftThreshold: frozenPoint(DOOR_X - 1, 8),
    rightThreshold: frozenPoint(DOOR_X + 1, 8),
    leftRegionMaxX: DOOR_X - 1,
    rightRegionMinX: DOOR_X + 1,
    playerSpawns: Object.freeze(
      (input.playerSpawns ?? [frozenPoint(3, 6), frozenPoint(3, 10)])
        .map(freezePoint) as [GridPoint, GridPoint],
    ),
    pressurePlates: Object.freeze([...(input.pressurePlates ?? [])]),
    teleporters: Object.freeze([...(input.teleporters ?? [])]),
    keycards: Object.freeze([...(input.keycards ?? [])]),
    relayButtons: Object.freeze([...(input.relayButtons ?? [])]),
    exitCells: Object.freeze(
      [...(input.exitCells ?? STANDARD_EXIT_CELLS)].map(freezePoint),
    ),
    nearPlate: freezePoint(input.nearPlate),
    farPlate: freezePoint(input.farPlate),
  });
}

const LEVEL_ONE_PLATE_A = frozenPoint(5, 8);
const LEVEL_ONE_PLATE_B = frozenPoint(10, 8);

export const LEVEL_ONE = createLevel({
  id: 'level_1',
  number: 1,
  name: 'Pressure Lock',
  objective: 'Hold either pressure plate to open gate_main, then place both explorers in exit_zone.',
  extras: [
    frozenPoint(3, 3), frozenPoint(4, 3), frozenPoint(3, 4),
    frozenPoint(4, 12), frozenPoint(5, 12), frozenPoint(5, 11),
    frozenPoint(9, 3), frozenPoint(10, 3), frozenPoint(10, 4),
    frozenPoint(10, 12), frozenPoint(11, 12), frozenPoint(11, 11),
  ],
  pressurePlates: [
    pressurePlate('plate_a', 5, 8),
    pressurePlate('plate_b', 10, 8),
  ],
  gateRule: {
    kind: 'hold-any-plate',
    pressurePlateIds: ['plate_a', 'plate_b'],
    latch: false,
  },
  nearPlate: LEVEL_ONE_PLATE_A,
  farPlate: LEVEL_ONE_PLATE_B,
});

export const LEVEL_TWO = createLevel({
  id: 'level_2',
  number: 2,
  name: 'Powered Transit',
  objective: 'Hold Alpha power while your partner uses the teleporter and collects Card Alpha to unlock gate_main.',
  extras: [
    frozenPoint(3, 3), frozenPoint(4, 3), frozenPoint(5, 3),
    frozenPoint(3, 12), frozenPoint(4, 12),
    frozenPoint(9, 3), frozenPoint(10, 3), frozenPoint(10, 4),
    frozenPoint(10, 12), frozenPoint(11, 12), frozenPoint(12, 12),
  ],
  teleporters: [
    teleporter(
      'teleporter_alpha',
      'teleporter_alpha_power',
      frozenPoint(4, 11),
      'teleporter_alpha_home',
      frozenPoint(5, 5),
      'teleporter_alpha_annex',
      frozenPoint(10, 5),
    ),
  ],
  keycards: [keycard('keycard_alpha', 13, 3)],
  gateRule: {
    kind: 'keycards-and-relays',
    requiredKeycardIds: ['keycard_alpha'],
    requiredRelayButtonIds: [],
    latch: true,
  },
  nearPlate: frozenPoint(4, 11),
  farPlate: frozenPoint(10, 5),
});

export const LEVEL_THREE = createLevel({
  id: 'level_3',
  number: 3,
  name: 'Security Handshake',
  objective: 'Retrieve Card Alpha, return through Alpha, then occupy both gate buttons to unlock gate_main.',
  extras: [
    frozenPoint(3, 3), frozenPoint(4, 3),
    frozenPoint(3, 9), frozenPoint(4, 9),
    frozenPoint(9, 3), frozenPoint(10, 3),
    frozenPoint(10, 11), frozenPoint(11, 11),
  ],
  teleporters: [
    teleporter(
      'teleporter_alpha',
      'teleporter_alpha_power',
      frozenPoint(4, 12),
      'teleporter_alpha_home',
      frozenPoint(5, 5),
      'teleporter_alpha_annex',
      frozenPoint(10, 5),
    ),
  ],
  keycards: [keycard('keycard_alpha', 13, 3)],
  relayButtons: [
    relay('gate_button_a', 5, 3),
    relay('gate_button_b', 5, 12),
  ],
  gateRule: {
    kind: 'keycards-and-relays',
    requiredKeycardIds: ['keycard_alpha'],
    requiredRelayButtonIds: ['gate_button_a', 'gate_button_b'],
    latch: true,
  },
  nearPlate: frozenPoint(5, 3),
  farPlate: frozenPoint(5, 12),
});

export const LEVEL_FOUR = createLevel({
  id: 'level_4',
  number: 4,
  name: 'Crossed Circuits',
  objective: 'Chain Alpha and Beta to collect both cards, reunite, and occupy both gate buttons.',
  extras: [
    frozenPoint(3, 3), frozenPoint(4, 3),
    frozenPoint(3, 13), frozenPoint(4, 13),
    frozenPoint(9, 3), frozenPoint(10, 3),
    frozenPoint(11, 13), frozenPoint(12, 13),
  ],
  teleporters: [
    teleporter(
      'teleporter_alpha',
      'teleporter_alpha_power',
      frozenPoint(4, 11),
      'teleporter_alpha_home',
      frozenPoint(5, 5),
      'teleporter_alpha_annex',
      frozenPoint(10, 5),
    ),
    teleporter(
      'teleporter_beta',
      'teleporter_beta_power',
      frozenPoint(12, 11),
      'teleporter_beta_home',
      frozenPoint(5, 11),
      'teleporter_beta_annex',
      frozenPoint(13, 12),
    ),
  ],
  keycards: [
    keycard('keycard_alpha', 12, 3),
    keycard('keycard_beta', 14, 13),
  ],
  relayButtons: [
    relay('gate_button_a', 5, 3),
    relay('gate_button_b', 5, 13),
  ],
  gateRule: {
    kind: 'keycards-and-relays',
    requiredKeycardIds: ['keycard_alpha', 'keycard_beta'],
    requiredRelayButtonIds: ['gate_button_a', 'gate_button_b'],
    latch: true,
  },
  nearPlate: frozenPoint(5, 3),
  farPlate: frozenPoint(5, 13),
});

export const LEVEL_CATALOG = Object.freeze([
  LEVEL_ONE,
  LEVEL_TWO,
  LEVEL_THREE,
  LEVEL_FOUR,
] as const);

const LEVEL_BY_ID = new Map<LevelId, LevelDefinition>(
  LEVEL_CATALOG.map((level) => [level.id, level]),
);

export function getLevelDefinition(levelId: LevelId): LevelDefinition {
  return LEVEL_BY_ID.get(levelId) ?? LEVEL_ONE;
}

export function getNextLevelDefinition(levelId: LevelId): LevelDefinition {
  const current = getLevelDefinition(levelId);
  return LEVEL_CATALOG[current.number % LEVEL_CATALOG.length] ?? LEVEL_ONE;
}

export function getNextLevelId(levelId: LevelId): LevelId {
  return getNextLevelDefinition(levelId).id;
}

export function levelInteractablePoint(
  level: LevelDefinition,
  id: InteractableId,
): GridPoint | null {
  if (id === 'exit_zone') {
    if (level.exitCells.length === 0) return null;
    const center = level.exitCells.reduce(
      (sum, cell) => ({ x: sum.x + cell.x, y: sum.y + cell.y }),
      { x: 0, y: 0 },
    );
    const centerX = Math.round(center.x / level.exitCells.length);
    const centerY = Math.round(center.y / level.exitCells.length);
    return level.exitCells.find((cell) => cell.x === centerX && cell.y === centerY)
      ?? level.exitCells.reduce((nearest, cell) => {
        const nearestDistance = (nearest.x - centerX) ** 2 + (nearest.y - centerY) ** 2;
        const cellDistance = (cell.x - centerX) ** 2 + (cell.y - centerY) ** 2;
        return cellDistance < nearestDistance ? cell : nearest;
      });
  }
  const pressure = level.pressurePlates.find((entry) => entry.id === id);
  if (pressure !== undefined) return pressure.grid;
  for (const entry of level.teleporters) {
    if (entry.power.id === id) return entry.power.grid;
    const pad = entry.pads.find((candidate) => candidate.id === id);
    if (pad !== undefined) return pad.grid;
  }
  const card = level.keycards.find((entry) => entry.id === id);
  if (card !== undefined) return card.grid;
  const button = level.relayButtons.find((entry) => entry.id === id);
  return button?.grid ?? null;
}

export function teleporterForPad(
  level: LevelDefinition,
  padId: TeleporterPadId,
): { teleporter: TeleporterDefinition; pad: TeleporterPadDefinition; destination: TeleporterPadDefinition } | null {
  for (const entry of level.teleporters) {
    const index = entry.pads.findIndex((pad) => pad.id === padId);
    if (index === 0) {
      return { teleporter: entry, pad: entry.pads[0], destination: entry.pads[1] };
    }
    if (index === 1) {
      return { teleporter: entry, pad: entry.pads[1], destination: entry.pads[0] };
    }
  }
  return null;
}

function allInteractableEntries(level: LevelDefinition): Array<{ id: InteractableId; grid: GridPoint }> {
  return [
    ...level.pressurePlates,
    ...level.teleporters.flatMap((entry) => [entry.power, ...entry.pads]),
    ...level.keycards,
    ...level.relayButtons,
  ];
}

export function levelValidationErrors(level: LevelDefinition): string[] {
  const errors: string[] = [];
  if (level.width !== GRID_WIDTH || level.height !== GRID_HEIGHT) {
    errors.push(`${level.id}: dimensions must remain ${GRID_WIDTH}x${GRID_HEIGHT}`);
  }

  const ids = new Set<string>();
  const points = [
    ...level.playerSpawns,
    ...level.doorCells,
    ...level.exitCells,
    ...allInteractableEntries(level).map(({ grid }) => grid),
  ];
  for (const point of points) {
    if (!isInBounds(point, level)) errors.push(`${level.id}: point ${key(point)} is outside the grid`);
  }
  for (const wall of level.walls) {
    const match = /^(-?\d+),(-?\d+)$/.exec(wall);
    if (match === null) {
      errors.push(`${level.id}: invalid wall key ${wall}`);
      continue;
    }
    const point = { x: Number(match[1]), y: Number(match[2]) };
    if (!isInBounds(point, level)) errors.push(`${level.id}: wall ${wall} is outside the grid`);
  }

  const occupiedCells = new Map<string, string>();
  for (const entry of allInteractableEntries(level)) {
    if (ids.has(entry.id)) errors.push(`${level.id}: duplicate interactable id ${entry.id}`);
    ids.add(entry.id);
    if (level.walls.has(key(entry.grid)) || isDoorCell(entry.grid, level)) {
      errors.push(`${level.id}: interactable ${entry.id} is not on walkable floor`);
    }
    const previous = occupiedCells.get(key(entry.grid));
    if (previous !== undefined) {
      errors.push(`${level.id}: interactable ${entry.id} overlaps ${previous}`);
    } else {
      occupiedCells.set(key(entry.grid), entry.id);
    }
  }
  const doorCells = new Set<string>();
  for (const cell of level.doorCells) {
    if (doorCells.has(key(cell))) errors.push(`${level.id}: duplicate door cell ${key(cell)}`);
    doorCells.add(key(cell));
    if (level.walls.has(key(cell))) errors.push(`${level.id}: door overlaps wall at ${key(cell)}`);
  }
  for (const [index, spawn] of level.playerSpawns.entries()) {
    if (level.walls.has(key(spawn)) || isDoorCell(spawn, level)) {
      errors.push(`${level.id}: player spawn ${index + 1} is not on walkable floor`);
    }
  }
  if (level.exitCells.length === 0) errors.push(`${level.id}: exit zone is empty`);
  for (const exit of level.exitCells) {
    if (level.walls.has(key(exit)) || isDoorCell(exit, level)) {
      errors.push(`${level.id}: exit cell ${key(exit)} is not on walkable floor`);
    }
  }
  const teleporterIds = new Set<TeleporterId>();
  for (const entry of level.teleporters) {
    if (teleporterIds.has(entry.id)) errors.push(`${level.id}: duplicate teleporter id ${entry.id}`);
    teleporterIds.add(entry.id);
    if (sameGridPoint(entry.pads[0].grid, entry.pads[1].grid)) {
      errors.push(`${level.id}: teleporter ${entry.id} pads must occupy different cells`);
    }
  }

  if (level.gateRule.kind === 'hold-any-plate') {
    for (const id of level.gateRule.pressurePlateIds) {
      if (!level.pressurePlates.some((entry) => entry.id === id)) {
        errors.push(`${level.id}: gate references missing pressure plate ${id}`);
      }
    }
  } else {
    for (const id of level.gateRule.requiredKeycardIds) {
      if (!level.keycards.some((entry) => entry.id === id)) {
        errors.push(`${level.id}: gate references missing keycard ${id}`);
      }
    }
    for (const id of level.gateRule.requiredRelayButtonIds) {
      if (!level.relayButtons.some((entry) => entry.id === id)) {
        errors.push(`${level.id}: gate references missing relay ${id}`);
      }
    }
  }
  return errors;
}

export function validateLevelCatalog(
  levels: readonly LevelDefinition[] = LEVEL_CATALOG,
): string[] {
  const errors = levels.flatMap(levelValidationErrors);
  const ids = new Set<LevelId>();
  const numbers = new Set<number>();
  for (const level of levels) {
    if (ids.has(level.id)) errors.push(`${level.id}: duplicate level id`);
    if (numbers.has(level.number)) errors.push(`${level.id}: duplicate level number ${level.number}`);
    ids.add(level.id);
    numbers.add(level.number);
  }
  return errors;
}

const catalogErrors = validateLevelCatalog();
if (catalogErrors.length > 0) {
  throw new Error(`Invalid level catalog:\n${catalogErrors.join('\n')}`);
}

export function isInBounds(point: GridPoint, level = LEVEL_ONE): boolean {
  return point.x >= 0 && point.x < level.width
    && point.y >= 0 && point.y < level.height;
}

export function isDoorCell(point: GridPoint, level = LEVEL_ONE): boolean {
  return level.doorCells.some((cell) => cell.x === point.x && cell.y === point.y);
}

export function isStaticWalkable(point: GridPoint, level = LEVEL_ONE): boolean {
  return isInBounds(point, level)
    && !level.walls.has(key(point))
    && !isDoorCell(point, level);
}

export function isWalkable(
  point: GridPoint,
  doorOpen: boolean,
  level = LEVEL_ONE,
): boolean {
  return isInBounds(point, level)
    && !level.walls.has(key(point))
    && (doorOpen || !isDoorCell(point, level));
}

export function gridToWorld(point: GridPoint): WorldPoint {
  return {
    x: (point.x + 0.5) * CELL_SIZE,
    y: (point.y + 0.5) * CELL_SIZE,
  };
}

export function worldToGrid(
  point: WorldPoint,
  level = LEVEL_ONE,
): GridPoint | null {
  const x = Math.floor(point.x / CELL_SIZE);
  const y = Math.floor(point.y / CELL_SIZE);
  return isInBounds({ x, y }, level) ? { x, y } : null;
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

export function isExitPosition(
  position: WorldPoint,
  level = LEVEL_ONE,
): boolean {
  const cell = worldToGrid(position, level);
  return cell !== null
    && level.exitCells.some((exit) => sameGridPoint(exit, cell));
}

export function plateIsPressed(
  position: WorldPoint,
  plate: GridPoint,
  level = LEVEL_ONE,
): boolean {
  const playerCell = worldToGrid(position, level);
  return playerCell !== null && sameGridPoint(playerCell, plate);
}

export function sideFor(
  point: GridPoint,
  level = LEVEL_ONE,
): 'left' | 'right' | 'door' {
  if (isDoorCell(point, level)) return 'door';
  return point.x <= level.leftRegionMaxX ? 'left' : 'right';
}
