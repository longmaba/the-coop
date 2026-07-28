import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  JSONRPCMessageSchema,
  LATEST_PROTOCOL_VERSION,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

const children = new Set<ChildProcessWithoutNullStreams>();

afterEach(async () => {
  await Promise.all([...children].map(async (child) => {
    if (child.exitCode !== null) return;
    child.kill();
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }));
  children.clear();
});

function idOf(message: JSONRPCMessage): string | number | null {
  return 'id' in message && (typeof message.id === 'string' || typeof message.id === 'number')
    ? message.id
    : null;
}

describe('stdio MCP protocol', () => {
  it('frames only JSON-RPC on stdout, lists the allowlisted tools, and reports an offline game server', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/mcp/server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        THE_COOP_GAME_SERVER_URL: 'http://127.0.0.1:1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.add(child);

    const messages: JSONRPCMessage[] = [];
    const waiters = new Set<() => void>();
    const stdoutLines: string[] = [];
    const stderr: string[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));
    createInterface({ input: child.stdout }).on('line', (line) => {
      stdoutLines.push(line);
      messages.push(JSONRPCMessageSchema.parse(JSON.parse(line)));
      for (const wake of waiters) wake();
      waiters.clear();
    });

    const send = (message: Record<string, unknown>): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const response = async (id: number): Promise<Record<string, unknown>> => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const found = messages.find((message) => idOf(message) === id);
        if (found !== undefined) return found as unknown as Record<string, unknown>;
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            waiters.delete(wake);
            resolve();
          }, 100);
          const wake = (): void => {
            clearTimeout(timeout);
            resolve();
          };
          waiters.add(wake);
        });
      }
      throw new Error(`Timed out waiting for MCP response ${id}. stderr: ${stderr.join('')}`);
    };

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'the-coop-test', version: '1.0.0' },
      },
    });
    const initialized = await response(1);
    const initResult = initialized.result as { instructions?: string };
    expect(initResult.instructions).toContain('Control only Player 2');
    expect(initResult.instructions).toContain('observe_game before');
    expect(initResult.instructions).toContain('Never claim arrival');
    expect(initResult.instructions).toContain('actual authoritative cell');
    expect(initResult.instructions).toContain('omits authored solution steps');
    expect(initResult.instructions).toContain('do not inspect repository source');

    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listed = await response(2);
    const tools = (listed.result as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools.map(({ name }) => name)).toEqual([
      'start_game',
      'observe_game',
      'move_player_two',
    ]);
    const moveTool = tools.find(({ name }) => name === 'move_player_two');
    expect(moveTool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['target'],
      properties: {
        target: expect.any(Object),
        waitUntil: expect.objectContaining({ enum: ['accepted', 'arrived'] }),
      },
    });
    const moveSchema = JSON.stringify(moveTool?.inputSchema);
    expect(moveSchema).toContain('observe_game');
    for (const id of [
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
    ]) {
      expect(moveSchema).not.toContain(id);
    }

    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'start_game', arguments: {} },
    });
    const called = await response(3);
    const callResult = called.result as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    expect(callResult.isError).toBe(true);
    expect(callResult.content?.[0]?.text).toContain('npm run dev');
    expect(callResult.content?.[0]?.text).toContain('127.0.0.1:1');

    expect(stdoutLines).not.toHaveLength(0);
    for (const line of stdoutLines) {
      expect(() => JSONRPCMessageSchema.parse(JSON.parse(line))).not.toThrow();
    }
  }, 20_000);
});
