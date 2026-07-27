import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { startGameServer } from '../../src/server/index.ts';

export default async function globalSetup(): Promise<() => Promise<void>> {
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
