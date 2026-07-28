import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  LEVEL_CATALOG,
  getLevelDefinition,
  resolveInspectionTarget,
  teleporterForPad,
  worldToGrid,
  type GridPoint,
  type InspectionTarget,
  type LevelId,
  type ResolvedInspectionTarget,
  type TeleporterPadId,
} from '../game/index.ts';
import type { CoopSnapshot } from '../client/state.ts';
import {
  PlayerTwoMovementCoordinator,
  type MoveAcceptance,
  type MovementSnapshot,
} from './movement.ts';
import { TeammateSession, type MoveResultMessage } from './session.ts';

const INSTRUCTIONS = [
  'Control only Player 2 in The Coop. Use these tools only for requests about this game.',
  'Call start_game when asked to start, and observe_game before resolving ambiguous references.',
  'observe_game intentionally omits authored solution steps and hidden rules.',
  'During play, do not inspect repository source, tests, or documentation for solutions; reason only from observations, movement outcomes, and the other player.',
  'For named movement, use an interactable ID returned by the latest observe_game call.',
  'Never claim arrival before move_player_two reports the authoritative outcome.',
  'Do not infer or request a player ID or movement sequence; the server owns both.',
  'A request to stay on a plate means arrive there and issue no newer movement.',
  'Teleporter and exit moves report the actual authoritative cell where Player 2 stopped.',
].join(' ');

const INTERACTABLE_TARGET_IDS = [
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
] as const;

const targetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('interactable'),
    id: z.string()
      .min(1)
      .max(64)
      .describe('An interactable ID returned by the latest observe_game call for the active level.'),
  }).strict(),
  z.object({
    kind: z.literal('grid'),
    x: z.number().int().min(0).max(23),
    y: z.number().int().min(0).max(11),
  }).strict(),
]);

function toolResult(value: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function levelIdFrom(value: string): LevelId {
  return LEVEL_CATALOG.find(({ id }) => id === value)?.id ?? 'level_1';
}

function movementSnapshot(snapshot: CoopSnapshot): MovementSnapshot {
  const playerTwo = snapshot.players.find(({ id }) => id === 'player-2');
  const level = getLevelDefinition(levelIdFrom(snapshot.levelId));
  return {
    levelEpoch: snapshot.levelEpoch,
    phase: snapshot.phase,
    playerTwo: playerTwo === undefined
      ? null
      : {
          connected: playerTwo.connected,
          lastMoveSeq: playerTwo.lastMoveSeq,
          routeKind: playerTwo.routeKind,
          grid: worldToGrid({ x: playerTwo.worldX, y: playerTwo.worldY }, level),
        },
  };
}

function moveAcceptance(result: MoveResultMessage): MoveAcceptance {
  return {
    seq: result.seq,
    accepted: result.accepted,
    routeKind: result.routeKind,
    effectiveTarget: worldToGrid({
      x: result.effectiveWorldX,
      y: result.effectiveWorldY,
    }),
    ...(result.reason === undefined ? {} : { reason: result.reason }),
  };
}

const TELEPORTER_PAD_IDS = new Set<TeleporterPadId>([
  'teleporter_alpha_home',
  'teleporter_alpha_annex',
  'teleporter_beta_home',
  'teleporter_beta_annex',
]);

function isTeleporterPadId(id: string): id is TeleporterPadId {
  return TELEPORTER_PAD_IDS.has(id as TeleporterPadId);
}

type InteractableTargetId = typeof INTERACTABLE_TARGET_IDS[number];
const INTERACTABLE_TARGET_ID_SET = new Set<string>(INTERACTABLE_TARGET_IDS);

function isInteractableTargetId(id: string): id is InteractableTargetId {
  return INTERACTABLE_TARGET_ID_SET.has(id);
}

export type McpMovementTarget =
  | { kind: 'interactable'; id: string }
  | { kind: 'grid'; x: number; y: number };

export interface ResolvedMcpMovementTarget {
  command: ResolvedInspectionTarget;
  validArrivals: readonly GridPoint[];
}

/**
 * Resolves only interactables present in the active level. Semantic targets
 * retain every cell where the authoritative simulation can stop movement.
 */
export function resolveMcpMovementTarget(
  snapshot: CoopSnapshot,
  target: McpMovementTarget,
): ResolvedMcpMovementTarget | null {
  const level = getLevelDefinition(levelIdFrom(snapshot.levelId));
  const inspectionTarget: InspectionTarget | null = target.kind === 'grid'
    ? target
    : isInteractableTargetId(target.id)
      ? { kind: 'interactable', id: target.id }
      : null;
  if (inspectionTarget === null) return null;
  const command = resolveInspectionTarget(inspectionTarget, level.id);
  if (command === null) return null;
  if (inspectionTarget.kind === 'interactable' && inspectionTarget.id === 'exit_zone') {
    return { command, validArrivals: level.exitCells };
  }
  if (
    inspectionTarget.kind !== 'interactable'
    || !isTeleporterPadId(inspectionTarget.id)
  ) {
    return { command, validArrivals: [command.grid] };
  }

  const pairing = teleporterForPad(level, inspectionTarget.id);
  if (pairing === null) return null;
  return {
    command,
    validArrivals: [command.grid, pairing.destination.grid],
  };
}

export interface TeammateMcpRuntime {
  server: McpServer;
  session: TeammateSession;
  movement: PlayerTwoMovementCoordinator;
  close(): Promise<void>;
}

export function createTeammateMcpRuntime(
  session = new TeammateSession(),
): TeammateMcpRuntime {
  const movement = new PlayerTwoMovementCoordinator();
  const server = new McpServer(
    { name: 'the-coop-teammate', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );

  session.onSnapshot((snapshot) => movement.observe(movementSnapshot(snapshot)));
  session.onMoveResult((result) => movement.handleMoveResult(moveAcceptance(result)));

  server.registerTool('start_game', {
    title: 'Start The Coop game',
    description: 'Create or return the single active human-AI session and its one-time Player 1 browser link.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => {
    const result = await session.startGame();
    const snapshot = session.snapshot;
    if (snapshot !== null) movement.observe(movementSnapshot(snapshot));
    return toolResult({ ...result });
  });

  server.registerTool('observe_game', {
    title: 'Observe The Coop game',
    description: 'Read the authoritative current-level map, directly observable objects, players, connectivity, routes, phase, tick, and shared goal without an authored walkthrough.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => toolResult(session.observe()));

  server.registerTool('move_player_two', {
    title: 'Move Player 2',
    description: 'Request an authoritative Player 2 route to an interactable from the latest observation or a bounded top-left grid cell.',
    inputSchema: {
      target: targetSchema,
      waitUntil: z.enum(['accepted', 'arrived']).default('arrived'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, async ({ target, waitUntil }) => {
    const snapshot = session.snapshot;
    if (snapshot === null) {
      return toolResult({
        status: 'unavailable',
        seq: -1,
        target,
        effectiveTarget: null,
        currentPosition: null,
        phase: 'unavailable',
        reason: 'No active teammate session. Call start_game first.',
      });
    }

    const authoritative = movementSnapshot(snapshot);
    const resolved = resolveMcpMovementTarget(snapshot, target);
    if (resolved === null) {
      return toolResult({
        status: 'rejected',
        seq: -1,
        target,
        effectiveTarget: null,
        currentPosition: authoritative.playerTwo?.grid ?? null,
        phase: snapshot.phase,
        reason: target.kind === 'interactable'
          ? `Interactable ${target.id} is not available in ${snapshot.levelId}.`
          : 'The target is outside the level grid.',
      });
    }

    const pending = movement.begin(
      authoritative,
      resolved.command.grid,
      waitUntil,
      resolved.validArrivals,
    );
    if (!session.sendMove(
      pending.seq,
      resolved.command.world.x,
      resolved.command.world.y,
    )) {
      movement.markUnavailable('Player 2 is disconnected from the local game server.');
    }
    return toolResult({ ...(await pending.outcome) });
  });

  return {
    server,
    session,
    movement,
    async close() {
      movement.dispose();
      await session.close();
      await server.close();
    },
  };
}

export async function runTeammateMcpServer(): Promise<TeammateMcpRuntime> {
  const runtime = createTeammateMcpRuntime();
  await runtime.server.connect(new StdioServerTransport());
  return runtime;
}

const isDirectEntry = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectEntry) {
  void runTeammateMcpServer().then((runtime) => {
    const shutdown = (): void => {
      void runtime.close().finally(() => {
        process.exitCode = 0;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
