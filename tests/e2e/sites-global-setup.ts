import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

function portFromEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer port between 1 and 65535.`);
  }
  return port;
}

const SITE_PORT = portFromEnvironment('THE_COOP_E2E_SITE_PORT', 5174);
const SITE_URL = `http://127.0.0.1:${SITE_PORT}`;

async function verifyRunningSite(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(SITE_URL, { signal: AbortSignal.timeout(3_000) });
  } catch (error) {
    throw new Error(
      `THE_COOP_E2E_REUSE_SITE=1 requires the current Sites preview at ${SITE_URL}. Start \`npm run dev:site\` first.`,
      { cause: error },
    );
  }

  const body = await response.text();
  if (!response.ok || !body.includes('<title>The Coop</title>') || !body.includes('<div id="app"></div>')) {
    throw new Error(`An unexpected service is running at ${SITE_URL}.`);
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.env.THE_COOP_E2E_REUSE_SITE === '1') {
    await verifyRunningSite();
    return async () => undefined;
  }

  const root = fileURLToPath(new URL('../..', import.meta.url));
  const viteServer = await createViteServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    mode: 'sites',
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: SITE_PORT,
      strictPort: true,
    },
  });
  await viteServer.listen();
  return async () => viteServer.close();
}
