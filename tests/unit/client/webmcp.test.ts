import { describe, expect, it, vi } from 'vitest';
import { CHAT_DISMISS_AFTER_MS } from '../../../src/client/transient-chat.ts';
import { PlayerTwoMovementCoordinator } from '../../../src/mcp/movement.ts';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  browserGameUnavailable,
  browserMovementUnavailableReason,
  registerChatTool,
  registerWebMcpTools,
  type BrowserGameToolOperations,
  type BrowserMovementTarget,
  type WebMcpRegistrationError,
} from '../../../src/client/webmcp.ts';

interface CapturedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input?: unknown): unknown | Promise<unknown>;
}

function fakeHost(): { host: object; registered: CapturedTool[] } {
  const registered: CapturedTool[] = [];
  return {
    host: {
      modelContext: {
        async registerTool(tool: CapturedTool, options?: { signal?: AbortSignal }) {
          registered.push(tool);
          options?.signal?.addEventListener('abort', () => {
            const index = registered.indexOf(tool);
            if (index >= 0) registered.splice(index, 1);
          }, { once: true });
        },
      },
    },
    registered,
  };
}

function operations(): BrowserGameToolOperations {
  return {
    displayMessage: vi.fn(() => true),
    joinGame: vi.fn(async (code: string) => ({ joined: true as const, roomId: code, playerId: 'player-2' as const })),
    observeGame: vi.fn(() => ({ tick: 1 })),
    movePlayerTwo: vi.fn(async (target: BrowserMovementTarget) => ({
      status: 'arrived' as const,
      seq: 1,
      target: target.kind === 'grid' ? target : { x: 1, y: 1 },
      effectiveTarget: { x: 1, y: 1 },
      currentPosition: { x: 1, y: 1 },
      phase: 'playing',
    })),
  };
}

describe('browser WebMCP tools', () => {
  it('does nothing when document.modelContext is unsupported', async () => {
    expect(await registerWebMcpTools(operations(), {})).toBe(false);
  });

  it('registers chat and the three game tools once with strict schemas', async () => {
    const { host, registered } = fakeHost();
    expect(await registerWebMcpTools(operations(), host)).toBe(true);
    expect(registered.map(({ name }) => name)).toEqual([
      'chat', 'join_game', 'observe_game', 'move_player_two',
    ]);
    expect(registered.find(({ name }) => name === 'join_game')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        code: { type: 'string', minLength: 4, maxLength: 128 },
      },
      required: ['code'],
      additionalProperties: false,
    });
    expect(registered.find(({ name }) => name === 'observe_game')?.inputSchema).toEqual({
      type: 'object', properties: {}, additionalProperties: false,
    });
    expect(registered.find(({ name }) => name === 'move_player_two')?.inputSchema).toMatchObject({
      required: ['target'],
      additionalProperties: false,
      properties: { waitUntil: { enum: ['accepted', 'arrived'], default: 'arrived' } },
    });
  });

  it('reads fresh lifecycle operations on every call', async () => {
    const { host, registered } = fakeHost();
    const state = operations();
    await registerWebMcpTools(state, host);
    const observe = registered.find(({ name }) => name === 'observe_game')!;

    expect(await observe.execute({})).toEqual({ tick: 1 });
    state.observeGame = vi.fn(() => ({ tick: 2 }));
    expect(await observe.execute()).toEqual({ tick: 2 });
  });

  it('rolls back every tool when one registration fails and identifies that tool', async () => {
    const registered: CapturedTool[] = [];
    const host = {
      modelContext: {
        async registerTool(tool: CapturedTool, options?: { signal?: AbortSignal }) {
          if (tool.name === 'observe_game') throw new Error('browser rejected schema');
          registered.push(tool);
          options?.signal?.addEventListener('abort', () => {
            const index = registered.indexOf(tool);
            if (index >= 0) registered.splice(index, 1);
          }, { once: true });
        },
      },
    };

    const registration = registerWebMcpTools(operations(), host);
    await expect(registration).rejects.toMatchObject({
      name: 'WebMcpRegistrationError',
      toolName: 'observe_game',
      message: 'WebMCP registration failed for observe_game.',
    } satisfies Partial<WebMcpRegistrationError>);
    expect(registered).toEqual([]);
  });

  it('fails closed for stale playing snapshots in error and terminal lifecycles', () => {
    const seated = {
      phase: 'playing',
      hasNetwork: true,
      seat: 1,
      playerId: 'player-2',
      roomId: 'room-1',
      terminal: false,
    };
    expect(browserGameUnavailable({ ...seated, status: 'playing' })).toBeNull();
    expect(browserGameUnavailable({ ...seated, status: 'error' })).toMatchObject({
      status: 'unavailable',
    });
    expect(browserGameUnavailable({ ...seated, status: 'abandoned' })).toMatchObject({
      status: 'unavailable',
    });
    expect(browserGameUnavailable({
      ...seated,
      status: 'playing',
      phase: 'abandoned',
    })).toMatchObject({ status: 'unavailable' });
    expect(browserGameUnavailable({
      ...seated,
      status: 'playing',
      terminal: true,
    })).toMatchObject({ status: 'unavailable' });
  });

  it('fails closed while reconnecting and settles pending movement unavailable', async () => {
    const seated = {
      status: 'reconnecting',
      phase: 'playing',
      hasNetwork: true,
      seat: 1,
      playerId: 'player-2',
      roomId: 'room-1',
      terminal: false,
    };
    expect(browserGameUnavailable(seated)).toEqual({
      status: 'unavailable',
      reason: 'The Player 2 browser session is reconnecting.',
    });
    expect(browserGameUnavailable({
      ...seated,
      status: 'waiting',
      phase: 'reconnectGrace',
    })).toMatchObject({ status: 'unavailable' });

    const coordinator = new PlayerTwoMovementCoordinator(undefined, 1_000);
    const pending = coordinator.begin({
      levelEpoch: 0,
      phase: 'playing',
      playerTwo: {
        connected: true,
        lastMoveSeq: 0,
        routeKind: 'none',
        grid: { x: 3, y: 10 },
      },
    }, { x: 5, y: 8 });
    const reason = browserMovementUnavailableReason('reconnecting');
    expect(reason).toBe('The Player 2 browser session is reconnecting.');
    coordinator.markUnavailable(reason!);
    await expect(pending.outcome).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'The Player 2 browser session is reconnecting.',
    });

    expect(browserGameUnavailable({
      ...seated,
      status: 'playing',
      phase: 'playing',
    })).toBeNull();
  });

  it('validates join and movement at runtime in addition to JSON Schema', async () => {
    const { host, registered } = fakeHost();
    const state = operations();
    await registerWebMcpTools(state, host);
    const join = registered.find(({ name }) => name === 'join_game')!;
    const move = registered.find(({ name }) => name === 'move_player_two')!;

    await expect(join.execute({ code: '  room_123  ' })).resolves.toMatchObject({
      joined: true, roomId: 'room_123', playerId: 'player-2',
    });
    expect(state.joinGame).toHaveBeenCalledWith('room_123');
    for (const invalid of [undefined, {}, { code: 'bad!' }, { code: 'valid', extra: true }]) {
      expect(() => join.execute(invalid)).toThrow(TypeError);
    }
    for (const invalid of [
      {},
      { target: { kind: 'grid', x: 16, y: 0 } },
      { target: { kind: 'grid', x: 1, y: 1 }, waitUntil: 'sent' },
      { target: { kind: 'interactable', id: 'plate_a', extra: true } },
    ]) expect(() => move.execute(invalid)).toThrow(TypeError);

    await move.execute({ target: { kind: 'grid', x: 1, y: 2 } });
    expect(state.movePlayerTwo).toHaveBeenCalledWith(
      { kind: 'grid', x: 1, y: 2 },
      'arrived',
    );
  });
});

describe('chat compatibility', () => {
  it('preserves active/inactive behavior and Unicode validation', async () => {
    const { host, registered } = fakeHost();
    const display = vi.fn((message: string) => message === 'Show this');
    expect(await registerChatTool(display, host)).toBe(true);
    const tool = registered[0]!;

    expect(tool.execute({ message: 'Show this' })).toEqual({
      displayed: true,
      dismissAfterMs: CHAT_DISMISS_AFTER_MS,
    });
    expect(tool.execute({ message: 'No game' })).toMatchObject({
      displayed: false, error: { code: 'NO_ACTIVE_GAME' },
    });
    expect(() => tool.execute({
      message: '🐣'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1),
    })).toThrow(TypeError);
    expect(() => tool.execute({ message: 'valid', extra: true })).toThrow(TypeError);
  });
});
