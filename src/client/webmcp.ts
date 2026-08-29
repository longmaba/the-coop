import { CHAT_DISMISS_AFTER_MS } from './transient-chat.ts';

export const CHAT_MESSAGE_MAX_LENGTH = 500;

interface SiteToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: {
      message: {
        type: 'string';
        minLength: number;
        maxLength: number;
      };
    };
    required: ['message'];
    additionalProperties: false;
  };
  execute(input: unknown): ChatToolResult;
}

interface ModelContext {
  registerTool(tool: SiteToolDefinition): void;
}

export type ChatToolResult =
  | { displayed: true; dismissAfterMs: typeof CHAT_DISMISS_AFTER_MS }
  | {
    displayed: false;
    error: {
      code: 'NO_ACTIVE_GAME';
      message: string;
    };
  };

type DisplayChatMessage = (message: string) => boolean;

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

function parseMessage(input: unknown): string {
  if (!isRecord(input)
    || Object.keys(input).length !== 1
    || !Object.hasOwn(input, 'message')
    || typeof input.message !== 'string') {
    throw new TypeError('chat requires exactly one string property named message.');
  }

  if (input.message.trim().length === 0) {
    throw new TypeError('chat message must not be empty or whitespace-only.');
  }
  if ([...input.message].length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new TypeError(`chat message must be at most ${CHAT_MESSAGE_MAX_LENGTH} characters.`);
  }
  return input.message;
}

export function registerChatTool(
  displayMessage: DisplayChatMessage,
  host: unknown = document,
): boolean {
  const modelContext = modelContextFrom(host);
  if (modelContext === null) return false;

  modelContext.registerTool({
    name: 'chat',
    description: 'Display a transient message in the active game page for 5 seconds.',
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
    execute(input): ChatToolResult {
      const message = parseMessage(input);
      if (!displayMessage(message)) {
        return {
          displayed: false,
          error: {
            code: 'NO_ACTIVE_GAME',
            message: 'No game shell is active in this page.',
          },
        };
      }
      return { displayed: true, dismissAfterMs: CHAT_DISMISS_AFTER_MS };
    },
  });
  return true;
}
