import {
  COOPERATIVE_DISCOVERY_GOAL,
  LEVEL_CATALOG,
  createLevelInspection,
  getLevelDefinition,
  resolveInspectionTarget,
  teleporterForPad,
  worldToGrid,
  type GridPoint,
  type InspectionObject,
  type InspectionTarget,
  type InteractableId,
  type LevelId,
  type LevelInspectionSource,
  type ResolvedInspectionTarget,
  type TeleporterPadId,
} from '../game/index.ts';
import type { CoopSnapshot } from '../client/state.ts';
import type { MoveAcceptance, MovementSnapshot } from './movement.ts';

export interface AuthoritativeMoveResult {
  seq: number;
  accepted: boolean;
  reason?: string;
  routeKind: 'none' | 'target' | 'threshold-stop';
  effectiveWorldX: number;
  effectiveWorldY: number;
}

export interface TeammateObservationContext {
  roomId: string;
  reconnecting: boolean;
  pairingAvailable: boolean;
}

export type TeammateMovementTarget =
  | { kind: 'interactable'; id: string }
  | { kind: 'grid'; x: number; y: number };

export interface ResolvedTeammateMovementTarget {
  command: ResolvedInspectionTarget;
  validArrivals: readonly GridPoint[];
}

const INTERACTABLE_TARGET_IDS = new Set([
  'plate_a',
  'plate_b',
  'teleporter_alpha_power',
  'teleporter_beta_power',
  'teleporter_alpha_home',
  'teleporter_alpha_annex',
  'teleporter_beta_home',
  'teleporter_beta_annex',
  'keycard_alpha',
  'keycard_beta',
  'gate_button_a',
  'gate_button_b',
  'exit_zone',
]);

const TELEPORTER_PAD_IDS = new Set<TeleporterPadId>([
  'teleporter_alpha_home',
  'teleporter_alpha_annex',
  'teleporter_beta_home',
  'teleporter_beta_annex',
]);

function levelIdFrom(value: string): LevelId {
  return LEVEL_CATALOG.find(({ id }) => id === value)?.id ?? 'level_1';
}

function inspectionSource(snapshot: CoopSnapshot): LevelInspectionSource {
  const levelId = levelIdFrom(snapshot.levelId);
  const level = getLevelDefinition(levelId);
  return {
    levelId,
    doorOpen: snapshot.doorOpen,
    collectedKeycardIds: level.keycards
      .filter(({ id }) => snapshot.collectedKeycardIds.includes(id))
      .map(({ id }) => id),
    latchedGateIds: snapshot.latchedGateIds.includes(level.doorId) ? [level.doorId] : [],
    pressurePlates: level.pressurePlates.map(({ id }) => ({
      id,
      occupied: snapshot.pressurePlates.find((state) => state.id === id)?.occupied ?? false,
    })),
    teleporters: level.teleporters.map(({ id, power, pads }) => ({
      id,
      powered: snapshot.teleporters.find((state) => state.id === id)?.powered ?? false,
      powerId: power.id,
      padIds: [pads[0].id, pads[1].id],
    })),
    keycards: level.keycards.map(({ id }) => ({
      id,
      collected: snapshot.keycards.find((state) => state.id === id)?.collected
        ?? snapshot.collectedKeycardIds.includes(id),
    })),
    relayButtons: level.relayButtons.map(({ id }) => ({
      id,
      occupiedBy: snapshot.relayButtons.find((state) => state.id === id)?.occupiedBy ?? null,
    })),
  };
}

type DiscoveryInteractable = Omit<InspectionObject, 'pairedWith'>;

function observableInteractable(interactable: InspectionObject): DiscoveryInteractable {
  return Object.freeze({
    id: interactable.id,
    kind: interactable.kind,
    grid: interactable.grid,
    world: interactable.world,
    occupiedCells: interactable.occupiedCells,
    ...(interactable.occupied === undefined ? {} : { occupied: interactable.occupied }),
    ...(interactable.powered === undefined ? {} : { powered: interactable.powered }),
    ...(interactable.active === undefined ? {} : { active: interactable.active }),
    ...(interactable.collected === undefined ? {} : { collected: interactable.collected }),
    ...(interactable.occupiedBy === undefined ? {} : { occupiedBy: interactable.occupiedBy }),
  });
}

export function createTeammateDiscoveryView(snapshot: CoopSnapshot) {
  const inspection = createLevelInspection(inspectionSource(snapshot));
  return {
    level: {
      id: inspection.level.id,
      number: inspection.level.number,
      count: inspection.level.count,
      name: inspection.level.name,
    },
    coordinateSystem: inspection.coordinateSystem,
    dimensions: inspection.dimensions,
    walls: inspection.walls,
    gate: {
      id: inspection.gate.id,
      open: inspection.gate.open,
      occupiedCells: inspection.gate.occupiedCells,
    },
    interactables: inspection.interactables.map(observableInteractable),
    objective: {
      summary: COOPERATIVE_DISCOVERY_GOAL,
      complete: snapshot.phase === 'completed',
    },
  };
}

/** Safe current-level projection shared by the browser and stdio adapters. */
export function createTeammateObservation(
  snapshot: CoopSnapshot,
  context: TeammateObservationContext,
): Record<string, unknown> {
  const discovery = createTeammateDiscoveryView(snapshot);
  const level = getLevelDefinition(levelIdFrom(snapshot.levelId));
  const players = snapshot.players.map((player) => ({
    id: player.id,
    connected: player.connected,
    grid: worldToGrid({ x: player.worldX, y: player.worldY }, level),
    world: { x: player.worldX, y: player.worldY },
    routeState: player.routeKind,
    lastMoveSeq: player.lastMoveSeq,
  }));
  const playerOne = players.find(({ id }) => id === 'player-1');
  const playerTwo = players.find(({ id }) => id === 'player-2');
  return {
    session: {
      status: snapshot.phase === 'waitingForPlayers'
        ? 'waiting_for_player_one'
        : context.reconnecting
          ? 'reconnecting'
          : snapshot.phase,
      roomId: context.roomId,
      phase: snapshot.phase,
      tick: snapshot.tick,
      levelEpoch: snapshot.levelEpoch,
      pairingAvailable: context.pairingAvailable,
    },
    ...discovery,
    players,
    connectivity: {
      playerOne: playerOne?.connected ?? false,
      playerTwo: playerTwo?.connected ?? false,
    },
  };
}

export function movementSnapshot(snapshot: CoopSnapshot): MovementSnapshot {
  const playerTwo = snapshot.players.find(({ id }) => id === 'player-2');
  const level = getLevelDefinition(levelIdFrom(snapshot.levelId));
  return {
    levelEpoch: snapshot.levelEpoch,
    phase: snapshot.phase,
    playerTwo: playerTwo === undefined ? null : {
      connected: playerTwo.connected,
      lastMoveSeq: playerTwo.lastMoveSeq,
      routeKind: playerTwo.routeKind,
      grid: worldToGrid({ x: playerTwo.worldX, y: playerTwo.worldY }, level),
    },
  };
}

export function moveAcceptance(result: AuthoritativeMoveResult): MoveAcceptance {
  return {
    seq: result.seq,
    accepted: result.accepted,
    routeKind: result.routeKind,
    effectiveTarget: worldToGrid({ x: result.effectiveWorldX, y: result.effectiveWorldY }),
    ...(result.reason === undefined ? {} : { reason: result.reason }),
  };
}

export function resolveTeammateMovementTarget(
  snapshot: CoopSnapshot,
  target: TeammateMovementTarget,
): ResolvedTeammateMovementTarget | null {
  const level = getLevelDefinition(levelIdFrom(snapshot.levelId));
  const inspectionTarget: InspectionTarget | null = target.kind === 'grid'
    ? target
    : INTERACTABLE_TARGET_IDS.has(target.id)
      ? { kind: 'interactable', id: target.id as InteractableId }
      : null;
  if (inspectionTarget === null) return null;
  const command = resolveInspectionTarget(inspectionTarget, level.id);
  if (command === null) return null;
  if (inspectionTarget.kind === 'interactable' && inspectionTarget.id === 'exit_zone') {
    return { command, validArrivals: level.exitCells };
  }
  if (
    inspectionTarget.kind !== 'interactable'
    || !TELEPORTER_PAD_IDS.has(inspectionTarget.id as TeleporterPadId)
  ) {
    return { command, validArrivals: [command.grid] };
  }
  const pairing = teleporterForPad(level, inspectionTarget.id as TeleporterPadId);
  return pairing === null
    ? null
    : { command, validArrivals: [command.grid, pairing.destination.grid] };
}
