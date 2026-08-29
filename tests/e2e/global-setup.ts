import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { startGameServer } from '../../src/server/index.ts';

function portFromEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer port between 1 and 65535.`);
  }
  return port;
}

const CLIENT_PORT = portFromEnvironment('THE_COOP_E2E_CLIENT_PORT', 5173);
const GAME_SERVER_PORT = portFromEnvironment('THE_COOP_E2E_GAME_SERVER_PORT', 2567);
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;
const GAME_SERVER_URL = `http://127.0.0.1:${GAME_SERVER_PORT}`;

async function verifyReusableEndpoint(
  name: string,
  url: string,
  isCurrent: (body: string) => boolean,
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(3_000),
    });
  } catch (error) {
    throw new Error(
      `THE_COOP_E2E_REUSE_SERVER=1 requires the current ${name} at ${url}, but it is unreachable. Start \`npm run dev\` from the repository root.`,
      { cause: error },
    );
  }

  const body = await response.text();
  if (!response.ok || !isCurrent(body)) {
    throw new Error(
      `THE_COOP_E2E_REUSE_SERVER=1 found an unexpected ${name} at ${url} (HTTP ${response.status}). Start the current repository with \`npm run dev\`.`,
    );
  }
}

async function reuseRunningServers(): Promise<() => Promise<void>> {
  await Promise.all([
    verifyReusableEndpoint(
      'Vite client',
      CLIENT_URL,
      (body) =>
        body.includes('<title>The Coop</title>') &&
        body.includes('<div id="app"></div>') &&
        body.includes('src="/src/client/main.ts'),
    ),
    verifyReusableEndpoint(
      'Colyseus game server',
      GAME_SERVER_URL,
      (body) => body.trim() === 'Colyseus 0.17.45',
    ),
  ]);

  return async () => undefined;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.env.THE_COOP_E2E_REUSE_SERVER === '1') {
    return reuseRunningServers();
  }

  process.env.VITE_GAME_SERVER_URL = GAME_SERVER_URL;
  process.env.THE_COOP_GAME_SERVER_URL = GAME_SERVER_URL;
  process.env.THE_COOP_HUMAN_ORIGIN = CLIENT_URL;
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const gameServer = await startGameServer(GAME_SERVER_PORT, '127.0.0.1');
  const viteServer = await createViteServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: CLIENT_PORT,
      strictPort: true,
    },
  });

  try {
    await viteServer.listen();
  } catch (error) {
    await gameServer.gracefullyShutdown(false);
    throw error;
  }

  return async () => {
    await Promise.allSettled([
      viteServer.close(),
      gameServer.gracefullyShutdown(false),
    ]);
  };
}
