import { describe, expect, it } from 'vitest';
import {
  resolveDevPorts,
  serverWatchArguments,
} from '../../../scripts/dev-runtime.ts';
import { parseDirectServerPort } from '../../../src/server/index.ts';

describe('local development runtime', () => {
  it('launches the authoritative server under dependency-aware watch mode', () => {
    expect(serverWatchArguments(2567)).toEqual([
      '--watch',
      '--watch-preserve-output',
      '--import',
      'tsx',
      'src/server/index.ts',
      '2567',
    ]);
  });

  it('uses stable defaults and accepts isolated verification ports', () => {
    expect(resolveDevPorts({})).toEqual({
      clientPort: 5173,
      gameServerPort: 2567,
    });
    expect(resolveDevPorts({
      THE_COOP_DEV_CLIENT_PORT: '5188',
      THE_COOP_DEV_GAME_SERVER_PORT: '2582',
    })).toEqual({
      clientPort: 5188,
      gameServerPort: 2582,
    });
  });

  it('rejects invalid ports before either process starts', () => {
    expect(() => resolveDevPorts({
      THE_COOP_DEV_CLIENT_PORT: '0',
    })).toThrow('THE_COOP_DEV_CLIENT_PORT');
    expect(() => parseDirectServerPort('not-a-port')).toThrow(
      'game server port',
    );
  });
});
