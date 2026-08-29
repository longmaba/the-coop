import { describe, expect, it, vi } from 'vitest';
import { CHAT_DISMISS_AFTER_MS } from '../../../src/client/transient-chat.ts';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  registerChatTool,
  type ChatToolResult,
} from '../../../src/client/webmcp.ts';

interface CapturedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown): ChatToolResult;
}

function fakeHost(): { host: object; registered: CapturedTool[] } {
  const registered: CapturedTool[] = [];
  return {
    host: {
      modelContext: {
        registerTool(tool: CapturedTool) { registered.push(tool); },
      },
    },
    registered,
  };
}

describe('registerChatTool', () => {
  it('does nothing when document.modelContext is unsupported', () => {
    const display = vi.fn(() => true);

    expect(registerChatTool(display, {})).toBe(false);
    expect(display).not.toHaveBeenCalled();
  });

  it('registers the canonical top-level chat contract', () => {
    const { host, registered } = fakeHost();

    expect(registerChatTool(() => true, host)).toBe(true);
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      name: 'chat',
      description: expect.stringMatching(/transient.*5 seconds/i),
      inputSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            minLength: 1,
            maxLength: CHAT_MESSAGE_MAX_LENGTH,
          },
        },
        required: ['message'],
        additionalProperties: false,
      },
    });
  });

  it('returns an honest structured result for active and inactive pages', () => {
    const { host, registered } = fakeHost();
    const display = vi.fn((message: string) => message === 'Show this');
    registerChatTool(display, host);
    const tool = registered[0]!;

    expect(tool.execute({ message: 'Show this' })).toEqual({
      displayed: true,
      dismissAfterMs: CHAT_DISMISS_AFTER_MS,
    });
    expect(tool.execute({ message: 'No game' })).toEqual({
      displayed: false,
      error: {
        code: 'NO_ACTIVE_GAME',
        message: 'No game shell is active in this page.',
      },
    });
  });

  it('measures the documented limit in Unicode code points', () => {
    const { host, registered } = fakeHost();
    registerChatTool(() => true, host);

    expect(registered[0]!.execute({ message: '🐣'.repeat(CHAT_MESSAGE_MAX_LENGTH) })).toMatchObject({ displayed: true });
    expect(() => registered[0]!.execute({
      message: '🐣'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1),
    })).toThrow(TypeError);
  });

  it.each([
    undefined,
    {},
    { message: 42 },
    { message: '   ' },
    { message: 'valid', extra: true },
    { message: 'x'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1) },
  ])('rejects invalid input %#', (input) => {
    const { host, registered } = fakeHost();
    registerChatTool(() => true, host);

    expect(() => registered[0]!.execute(input)).toThrow(TypeError);
  });
});
