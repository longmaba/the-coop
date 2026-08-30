import { GRID_HEIGHT, GRID_WIDTH } from '../game/index.ts';
import type { MovementOutcome } from '../mcp/movement.ts';
import { CHAT_DISMISS_AFTER_MS } from './transient-chat.ts';

export const CHAT_MESSAGE_MAX_LENGTH = 500;
export const ROOM_CODE_MAX_LENGTH = 128;

interface JsonObjectSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: readonly string[];
  additionalProperties: false;
}

interface SiteToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObjectSchema;
  execute(input?: unknown): unknown | Promise<unknown>;
}

interface ModelContext {
  registerTool(
    tool: SiteToolDefinition,
    options?: { signal?: AbortSignal },
  ): Promise<void> | void;
}

export class WebMcpRegistrationError extends Error {
  readonly toolName: string;

  constructor(toolName: string, cause: unknown) {
    super(`WebMCP registration failed for ${toolName}.`, { cause });
    this.name = 'WebMcpRegistrationError';
    this.toolName = toolName;
  }
}

export type ChatToolResult =
  | { displayed: true; dismissAfterMs: typeof CHAT_DISMISS_AFTER_MS }
  | { displayed: false; error: { code: 'NO_ACTIVE_GAME'; message: string } };

export type BrowserMovementTarget =
  | { kind: 'interactable'; id: string }
  | { kind: 'grid'; x: number; y: number };

export interface BrowserJoinResult {
  joined: true;
  roomId: string;
  playerId: 'player-2';
}

export type BrowserGameUnavailable = {
  status: 'unavailable' | 'wrong_seat';
  reason: string;
};

export interface BrowserGameAvailabilityState {
  status: string;
  phase: string;
  hasNetwork: boolean;
  seat: number | null;
  playerId: string | null;
  roomId: string | null;
  terminal: boolean;
}

export function browserGameUnavailable(
  state: BrowserGameAvailabilityState,
): BrowserGameUnavailable | null {
  if (
    !state.hasNetwork
    || state.status === 'landing'
    || state.status === 'creating'
    || state.status === 'joining'
  ) {
    return { status: 'unavailable', reason: 'No active Player 2 browser session. Call join_game from the landing page first.' };
  }
  if (
    state.terminal
    || state.status === 'error'
    || state.status === 'abandoned'
    || state.phase === 'abandoned'
  ) {
    return { status: 'unavailable', reason: 'The Player 2 browser session is no longer available.' };
  }
  if (state.status === 'reconnecting' || state.phase === 'reconnectGrace') {
    return { status: 'unavailable', reason: 'The Player 2 browser session is reconnecting.' };
  }
  if (state.seat !== 1 || state.playerId !== 'player-2') {
    return { status: 'wrong_seat', reason: 'These tools control only a browser assigned as Player 2.' };
  }
  if (state.roomId === null) {
    return { status: 'unavailable', reason: 'The Player 2 browser is not connected to a room.' };
  }
  return null;
}

export function browserMovementUnavailableReason(status: string): string | null {
  if (status === 'reconnecting') return 'The Player 2 browser session is reconnecting.';
  if (status === 'error' || status === 'abandoned') {
    return 'The Player 2 connection became unavailable.';
  }
  return null;
}

export interface BrowserRejectedMovement {
  status: 'rejected';
  seq: -1;
  target: BrowserMovementTarget;
  effectiveTarget: null;
  currentPosition: { x: number; y: number } | null;
  phase: string;
  reason: string;
}

export interface BrowserGameToolOperations {
  displayMessage(message: string): boolean;
  joinGame(code: string): Promise<BrowserJoinResult>;
  observeGame(): Record<string, unknown> | BrowserGameUnavailable;
  movePlayerTwo(
    target: BrowserMovementTarget,
    waitUntil: 'accepted' | 'arrived',
  ): Promise<MovementOutcome | BrowserRejectedMovement | BrowserGameUnavailable>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function modelContextFrom(host: unknown): ModelContext | null {
  if (!isRecord(host) || !isRecord(host.modelContext)) return null;
  const candidate = host.modelContext;
  return typeof candidate.registerTool === 'function'
    ? candidate as unknown as ModelContext
    : null;
}

function requireExactObject(input: unknown, keys: readonly string[], tool: string): Record<string, unknown> {
  if (!isRecord(input)) throw new TypeError(`${tool} requires an object input.`);
  const actual = Object.keys(input);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) {
    throw new TypeError(`${tool} requires exactly ${keys.join(' and ')}.`);
  }
  return input;
}

function parseMessage(input: unknown): string {
  const value = requireExactObject(input, ['message'], 'chat');
  if (typeof value.message !== 'string') {
    throw new TypeError('chat requires exactly one string property named message.');
  }
  if (value.message.trim().length === 0) throw new TypeError('chat message must not be empty or whitespace-only.');
  if ([...value.message].length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new TypeError(`chat message must be at most ${CHAT_MESSAGE_MAX_LENGTH} characters.`);
  }
  return value.message;
}

function parseRoomCode(input: unknown): string {
  const value = requireExactObject(input, ['code'], 'join_game');
  if (typeof value.code !== 'string') {
    throw new TypeError('join_game requires exactly one string property named code.');
  }
  const code = value.code.trim();
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(code)) {
    throw new TypeError('join_game code must be 4 to 128 letters, numbers, underscores, or hyphens.');
  }
  return code;
}

function parseNoInput(input: unknown, tool: string): void {
  if (input === undefined) return;
  requireExactObject(input, [], tool);
}

function parseTarget(value: unknown): BrowserMovementTarget {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new TypeError('move_player_two target must be an interactable or grid target.');
  }
  if (value.kind === 'interactable') {
    const target = requireExactObject(value, ['kind', 'id'], 'interactable target');
    if (typeof target.id !== 'string' || target.id.length < 1 || target.id.length > 64) {
      throw new TypeError('interactable target id must be a 1 to 64 character string.');
    }
    return { kind: 'interactable', id: target.id };
  }
  if (value.kind === 'grid') {
    const target = requireExactObject(value, ['kind', 'x', 'y'], 'grid target');
    if (
      !Number.isInteger(target.x)
      || !Number.isInteger(target.y)
      || (target.x as number) < 0
      || (target.x as number) >= GRID_WIDTH
      || (target.y as number) < 0
      || (target.y as number) >= GRID_HEIGHT
    ) throw new TypeError('grid target must contain bounded integer x and y coordinates.');
    return { kind: 'grid', x: target.x as number, y: target.y as number };
  }
  throw new TypeError('move_player_two target kind must be interactable or grid.');
}

function parseMoveInput(input: unknown): {
  target: BrowserMovementTarget;
  waitUntil: 'accepted' | 'arrived';
} {
  if (!isRecord(input)) throw new TypeError('move_player_two requires an object input.');
  const keys = Object.keys(input);
  if (!Object.hasOwn(input, 'target') || keys.some((key) => key !== 'target' && key !== 'waitUntil')) {
    throw new TypeError('move_player_two accepts only target and optional waitUntil properties.');
  }
  const waitUntil = input.waitUntil ?? 'arrived';
  if (waitUntil !== 'accepted' && waitUntil !== 'arrived') {
    throw new TypeError('move_player_two waitUntil must be accepted or arrived.');
  }
  return { target: parseTarget(input.target), waitUntil };
}

const chatTool = (displayMessage: BrowserGameToolOperations['displayMessage']): SiteToolDefinition => ({
  name: 'chat',
  description: 'Display a transient message in the active game page for 5 seconds.',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string', minLength: 1, maxLength: CHAT_MESSAGE_MAX_LENGTH } },
    required: ['message'],
    additionalProperties: false,
  },
  execute(input): ChatToolResult {
    const message = parseMessage(input);
    return displayMessage(message)
      ? { displayed: true, dismissAfterMs: CHAT_DISMISS_AFTER_MS }
      : { displayed: false, error: { code: 'NO_ACTIVE_GAME', message: 'No game shell is active in this page.' } };
  },
});

export async function registerWebMcpTools(
  operations: BrowserGameToolOperations,
  host: unknown = document,
): Promise<boolean> {
  const modelContext = modelContextFrom(host);
  if (modelContext === null) return false;

  const tools: SiteToolDefinition[] = [
    chatTool(operations.displayMessage),
    {
      name: 'join_game',
      description: 'Join an existing human-created room as Player 2 from this landing page.',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 4, maxLength: ROOM_CODE_MAX_LENGTH, pattern: '^[A-Za-z0-9_-]+$' },
        },
        required: ['code'],
        additionalProperties: false,
      },
      execute: (input) => operations.joinGame(parseRoomCode(input)),
    },
    {
      name: 'observe_game',
      description: 'Observe the safe current-level projection for this active Player 2 browser session.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute(input) {
        parseNoInput(input, 'observe_game');
        return operations.observeGame();
      },
    },
    {
      name: 'move_player_two',
      description: 'Request an authoritative Player 2 route and wait for acceptance or confirmed arrival.',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            oneOf: [
              {
                type: 'object',
                properties: { kind: { const: 'interactable' }, id: { type: 'string', minLength: 1, maxLength: 64 } },
                required: ['kind', 'id'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { const: 'grid' },
                  x: { type: 'integer', minimum: 0, maximum: GRID_WIDTH - 1 },
                  y: { type: 'integer', minimum: 0, maximum: GRID_HEIGHT - 1 },
                },
                required: ['kind', 'x', 'y'],
                additionalProperties: false,
              },
            ],
          },
          waitUntil: { type: 'string', enum: ['accepted', 'arrived'], default: 'arrived' },
        },
        required: ['target'],
        additionalProperties: false,
      },
      execute(input) {
        const { target, waitUntil } = parseMoveInput(input);
        return operations.movePlayerTwo(target, waitUntil);
      },
    },
  ];
  const controller = new AbortController();
  let active = false;
  let failed: WebMcpRegistrationError | null = null;
  let resolveReady!: () => void;
  let rejectReady!: (error: WebMcpRegistrationError) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => undefined);
  const guardedTools = tools.map((tool): SiteToolDefinition => ({
    ...tool,
    execute(input) {
      if (failed !== null) return Promise.reject(failed);
      if (active) return tool.execute(input);
      return ready.then(() => tool.execute(input));
    },
  }));
  const registrations = await Promise.allSettled(guardedTools.map(async (tool) => {
    try {
      await modelContext.registerTool(tool, { signal: controller.signal });
    } catch (error) {
      throw new WebMcpRegistrationError(tool.name, error);
    }
  }));
  const rejected = registrations.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (rejected !== undefined) {
    failed = rejected.reason instanceof WebMcpRegistrationError
      ? rejected.reason
      : new WebMcpRegistrationError('unknown', rejected.reason);
    controller.abort(failed);
    rejectReady(failed);
    throw failed;
  }
  active = true;
  resolveReady();
  return true;
}

/** Backward-compatible focused registration used by existing embedders and tests. */
export async function registerChatTool(
  displayMessage: BrowserGameToolOperations['displayMessage'],
  host: unknown = document,
): Promise<boolean> {
  const modelContext = modelContextFrom(host);
  if (modelContext === null) return false;
  try {
    await modelContext.registerTool(chatTool(displayMessage), {
      signal: new AbortController().signal,
    });
  } catch (error) {
    throw new WebMcpRegistrationError('chat', error);
  }
  return true;
}
