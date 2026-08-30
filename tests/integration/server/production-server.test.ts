import { Client, type Room } from '@colyseus/sdk';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoopStateSchema } from '../../../src/server/index.ts';
import {
  isDirectModule,
  parseProductionPort,
  startProductionServer,
  type RunningProductionServer,
} from '../../../src/server/production.ts';

let root: string;
let endpoint: string;
let running: RunningProductionServer;

async function waitFor(check: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function leaveQuietly(room: Room | undefined): Promise<void> {
  if (room === undefined) return;
  try {
    await room.leave();
  } catch {
    // A shutdown or peer departure may already have closed the room.
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'the-coop-production-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Production fixture</title>');
  await writeFile(join(root, 'assets', 'app-deadbeef.js'), 'globalThis.fixture = true;');
  running = await startProductionServer({ hostname: '127.0.0.1', port: 0, staticRoot: root });
  endpoint = `http://127.0.0.1:${running.port}`;
});

afterAll(async () => {
  try {
    await running.gameServer.gracefullyShutdown(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe('production server', () => {
  it('validates configured production ports', () => {
    expect(parseProductionPort(undefined)).toBe(6_000);
    expect(parseProductionPort('4310')).toBe(4_310);
    expect(() => parseProductionPort('0')).toThrow(/between 1 and 65535/);
    expect(() => parseProductionPort('abc')).toThrow(/between 1 and 65535/);
  });

  it('recognizes the production module when invoked through its resolved path', () => {
    expect(isDirectModule(import.meta.url, fileURLToPath(import.meta.url))).toBe(true);
    expect(isDirectModule(import.meta.url, undefined)).toBe(false);
  });

  it('recognizes a PM2 entrypoint invoked through the current-release symlink', async () => {
    const releaseDirectory = join(root, 'release');
    const currentDirectory = join(root, 'current');
    const modulePath = join(releaseDirectory, 'production.ts');
    await mkdir(releaseDirectory);
    await writeFile(modulePath, 'export {};');
    await symlink(
      releaseDirectory,
      currentDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(isDirectModule(
      pathToFileURL(modulePath).href,
      join(currentDirectory, 'production.ts'),
    )).toBe(true);
  });

  it('serves the SPA and immutable build assets without replacing missing assets with HTML', async () => {
    const index = await fetch(`${endpoint}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(index.headers.get('cache-control')).toBe('no-store');
    await expect(index.text()).resolves.toContain('Production fixture');

    const asset = await fetch(`${endpoint}/assets/app-deadbeef.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    await expect(asset.text()).resolves.toContain('fixture = true');

    const route = await fetch(`${endpoint}/rooms/example`, {
      headers: { Accept: 'text/html' },
    });
    expect(route.status).toBe(200);
    await expect(route.text()).resolves.toContain('Production fixture');

    const missingAsset = await fetch(`${endpoint}/assets/missing.js`);
    expect(missingAsset.status).toBe(404);
  });

  it('keeps health, matchmaking, and WebSockets on the same origin', async () => {
    const health = await fetch(`${endpoint}/__healthcheck`);
    expect(health.status).toBe(200);
    await expect(health.text()).resolves.toBe('OK');

    let creator: Room | undefined;
    let guest: Room | undefined;
    try {
      creator = await new Client(endpoint).create('coop', {}, CoopStateSchema);
      guest = await new Client(endpoint).joinById(creator.roomId, {}, CoopStateSchema);
      await waitFor(
        () => creator?.state.phase === 'playing'
          && creator.state.players.length === 2
          && guest?.state.phase === 'playing',
        'two players on the production origin',
      );
      expect(creator.roomId).toBe(guest.roomId);
    } finally {
      await leaveQuietly(guest);
      await leaveQuietly(creator);
    }
  });
});
