import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { startGameServer } from '../../src/server/index.ts';

const CLIENT_URL = 'http://127.0.0.1:5173';
const GAME_SERVER_URL = 'http://127.0.0.1:2567';

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

  const root = fileURLToPath(new URL('../..', import.meta.url));
  const gameServer = await startGameServer(2567, '127.0.0.1');
  const viteServer = await createViteServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 5173,
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
