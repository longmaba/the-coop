import { createReadStream, realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import type {
  IncomingMessage,
  RequestListener,
  Server as HttpServer,
  ServerResponse,
} from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server as ColyseusServer } from '@colyseus/core';
import { createGameServer } from './index.ts';

const DEFAULT_HOSTNAME = '127.0.0.1';
const DEFAULT_PORT = 6_000;

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

export interface ProductionServerOptions {
  hostname?: string;
  port?: number;
  staticRoot?: string;
}

export interface RunningProductionServer {
  gameServer: ColyseusServer;
  httpServer: HttpServer;
  hostname: string;
  port: number;
  staticRoot: string;
}

function requestPath(request: IncomingMessage): string | null {
  try {
    return decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    return null;
  }
}

function isColyseusRequest(pathname: string): boolean {
  return pathname === '/__healthcheck' || pathname.startsWith('/matchmake/');
}

function safeFilePath(staticRoot: string, pathname: string): string | null {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, '');
  const candidate = resolve(staticRoot, requested);
  const relativePath = relative(staticRoot, candidate);
  return relativePath.startsWith('..') || isAbsolute(relativePath) ? null : candidate;
}

async function existingFile(pathname: string): Promise<string | null> {
  try {
    const details = await stat(pathname);
    return details.isFile() ? pathname : null;
  } catch {
    return null;
  }
}

function sendStatus(response: ServerResponse, statusCode: number, message: string): void {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(message);
}

async function serveStatic(
  staticRoot: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    sendStatus(response, 405, 'Method Not Allowed');
    return;
  }

  const pathname = requestPath(request);
  if (pathname === null) {
    sendStatus(response, 400, 'Bad Request');
    return;
  }

  const candidate = safeFilePath(staticRoot, pathname);
  if (candidate === null) {
    sendStatus(response, 403, 'Forbidden');
    return;
  }

  let filePath = await existingFile(candidate);
  if (filePath === null && request.headers.accept?.includes('text/html') === true) {
    filePath = await existingFile(resolve(staticRoot, 'index.html'));
  }
  if (filePath === null) {
    sendStatus(response, 404, 'Not Found');
    return;
  }

  const details = await stat(filePath);
  const extension = extname(filePath).toLowerCase();
  const isIndex = filePath === resolve(staticRoot, 'index.html');
  const isHashedAsset = pathname.startsWith('/assets/') && !isIndex;
  response.writeHead(200, {
    'Cache-Control': isIndex
      ? 'no-store'
      : isHashedAsset
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
    'Content-Length': details.size,
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'Last-Modified': details.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  });
  if (method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filePath)
    .on('error', () => {
      if (!response.headersSent) sendStatus(response, 500, 'Internal Server Error');
      else response.destroy();
    })
    .pipe(response);
}

function installProductionRequestHandler(httpServer: HttpServer, staticRoot: string): void {
  const colyseusListeners = httpServer.listeners('request') as RequestListener[];
  if (colyseusListeners.length === 0) {
    throw new Error('Colyseus did not install its HTTP request handler.');
  }

  httpServer.removeAllListeners('request');
  httpServer.on('request', (request, response) => {
    const pathname = requestPath(request);
    if (pathname !== null && isColyseusRequest(pathname)) {
      for (const listener of colyseusListeners) listener.call(httpServer, request, response);
      return;
    }
    void serveStatic(staticRoot, request, response).catch(() => {
      if (!response.headersSent) sendStatus(response, 500, 'Internal Server Error');
      else response.destroy();
    });
  });
}

export function parseProductionPort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('THE_COOP_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

export async function startProductionServer(
  options: ProductionServerOptions = {},
): Promise<RunningProductionServer> {
  const hostname = options.hostname ?? DEFAULT_HOSTNAME;
  const port = options.port ?? DEFAULT_PORT;
  const staticRoot = resolve(
    options.staticRoot ?? fileURLToPath(new URL('../../dist/', import.meta.url)),
  );
  const staticDetails = await stat(staticRoot);
  if (!staticDetails.isDirectory()) throw new Error(`Static root is not a directory: ${staticRoot}`);
  if (await existingFile(resolve(staticRoot, 'index.html')) === null) {
    throw new Error(`Static root has no index.html: ${staticRoot}`);
  }

  const gameServer = createGameServer();
  await gameServer.listen(port, hostname);
  const httpServer = gameServer.transport.server;
  if (httpServer === undefined) {
    await gameServer.gracefullyShutdown(false);
    throw new Error('The game transport does not expose an HTTP server.');
  }

  try {
    installProductionRequestHandler(httpServer, staticRoot);
  } catch (error) {
    await gameServer.gracefullyShutdown(false);
    throw error;
  }

  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  return { gameServer, httpServer, hostname, port: boundPort, staticRoot };
}

export function isDirectModule(moduleUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
  } catch {
    return moduleUrl === pathToFileURL(argvPath).href;
  }
}

const isDirectEntry = isDirectModule(import.meta.url, process.argv[1]);
if (isDirectEntry) {
  const run = async (): Promise<void> => {
    const running = await startProductionServer({
      hostname: process.env.THE_COOP_HOST ?? DEFAULT_HOSTNAME,
      port: parseProductionPort(process.env.THE_COOP_PORT),
      ...(process.env.THE_COOP_STATIC_ROOT === undefined
        ? {}
        : { staticRoot: process.env.THE_COOP_STATIC_ROOT }),
    });
    console.log(`The Coop is listening on http://${running.hostname}:${running.port}`);

    let shuttingDown = false;
    const shutdown = (): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      void running.gameServer.gracefullyShutdown(false).then(
        () => process.exit(0),
        (error: unknown) => {
          console.error(error);
          process.exit(1);
        },
      );
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  };
  void run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
