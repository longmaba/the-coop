import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test, type Page } from '@playwright/test';
import { COOPERATIVE_DISCOVERY_GOAL } from '../../src/game/index.ts';

interface BridgeState {
  phase: string;
  tick: number;
  levelId: string;
  levelNumber: number;
  levelEpoch: number;
  collectedKeycardIds: string[];
  latchedGateIds: string[];
  teleporters: Array<{
    id: string;
    powered: boolean;
  }>;
  keycards: Array<{
    id: string;
    collected: boolean;
  }>;
  relayButtons: Array<{
    id: string;
    occupiedBy: string | null;
  }>;
  players: Array<{
    id: string;
    connected: boolean;
    worldX: number;
    worldY: number;
    routeKind: string;
    lastMoveSeq: number;
  }>;
}

interface Diagnostics {
  state: BridgeState;
  roomId: string | null;
  playerId: string | null;
  assetReady: boolean;
  renderer: {
    cameraElevation: number;
    cameraAzimuth: number;
  } | null;
  worldToScreen(point: { x: number; y: number }): { x: number; y: number };
  sendMoveTarget(point: { x: number; y: number }): void;
}

interface GridPoint {
  x: number;
  y: number;
}

interface ObservedInteractable {
  id: string;
  kind: string;
  grid: GridPoint;
  occupied?: boolean;
  powered?: boolean;
  active?: boolean;
  collected?: boolean;
  occupiedBy?: string | null;
}

interface ToolResult {
  [key: string]: unknown;
  status?: string;
  roomId?: string;
  humanJoinUrl?: string;
  currentPosition?: GridPoint | null;
  level?: {
    id: string;
    number: number;
    count: number;
    name: string;
  };
  gate?: {
    id: string;
    open: boolean;
  };
  objective?: {
    summary: string;
    complete: boolean;
  };
  interactables?: ObservedInteractable[];
  players?: Array<{
    id: string;
    grid: { x: number; y: number } | null;
    routeState: string;
  }>;
  session?: {
    roomId?: string;
    tick?: number;
    levelEpoch?: number;
  };
}

const CELL_SIZE = 48;
const center = (x: number, y: number) => ({
  x: (x + 0.5) * CELL_SIZE,
  y: (y + 0.5) * CELL_SIZE,
});

function collectPageErrors(page: Page, errors: string[]): void {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
}

async function waitForState(
  page: Page,
  description: string,
  predicate: (state: BridgeState) => boolean,
): Promise<void> {
  await page.waitForFunction(
    ({ source }) => {
      const state = (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.state;
      return state !== undefined
        && Function('state', `return (${source})(state)`)(state) === true;
    },
    { source: predicate.toString() },
    { timeout: 20_000 },
  ).catch((error: unknown) => {
    throw new Error(`Timed out waiting for ${description}`, { cause: error });
  });
}

async function waitForTick(page: Page, minimumTick: number): Promise<void> {
  await page.waitForFunction(
    ({ minimum }) => {
      const state = (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.state;
      return state !== undefined && state.tick >= minimum;
    },
    { minimum: minimumTick },
    { timeout: 20_000 },
  );
}

async function moveBrowserPlayer(
  page: Page,
  target: GridPoint,
  expected: GridPoint,
  description: string,
  physicalClick = false,
): Promise<void> {
  const worldTarget = center(target.x, target.y);
  if (physicalClick) {
    const screenTarget = await page.evaluate((targetPoint) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics })
        .__THE_COOP_E2E__?.worldToScreen(targetPoint),
    worldTarget);
    if (screenTarget === undefined) throw new Error('Three.js projection diagnostics were not ready.');
    await page.mouse.click(screenTarget.x, screenTarget.y);
  } else {
    await page.evaluate((targetPoint) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics })
        .__THE_COOP_E2E__?.sendMoveTarget(targetPoint),
    worldTarget);
  }
  await page.waitForFunction(
    ({ x, y }) => {
      const player = (window as Window & { __THE_COOP_E2E__?: Diagnostics })
        .__THE_COOP_E2E__?.state.players[0];
      return player?.routeKind === 'none'
        && Math.floor(player.worldX / 48) === x
        && Math.floor(player.worldY / 48) === y;
    },
    expected,
    { timeout: 20_000 },
  ).catch((error: unknown) => {
    throw new Error(`Timed out waiting for ${description}`, { cause: error });
  });
}

async function completeWithBrowserPlayer(
  page: Page,
  target: GridPoint,
  description: string,
): Promise<void> {
  await page.evaluate((worldTarget) =>
    (window as Window & { __THE_COOP_E2E__?: Diagnostics })
      .__THE_COOP_E2E__?.sendMoveTarget(worldTarget),
  center(target.x, target.y));
  await waitForState(page, description, (state) => state.phase === 'completed');
}

async function waitForLevel(
  page: Page,
  expected: { id: string; number: number; epoch: number; name: string },
): Promise<void> {
  await page.waitForFunction(
    ({ id, number, epoch }) => {
      const state = (window as Window & { __THE_COOP_E2E__?: Diagnostics })
        .__THE_COOP_E2E__?.state;
      return state?.phase === 'playing'
        && state.levelId === id
        && state.levelNumber === number
        && state.levelEpoch === epoch;
    },
    expected,
    { timeout: 20_000 },
  ).catch((error: unknown) => {
    throw new Error(`Timed out waiting for authoritative transition to ${expected.name}`, {
      cause: error,
    });
  });
}

interface McpHarness {
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

async function createMcpClient(): Promise<McpHarness> {
  const clientPort = process.env.THE_COOP_E2E_CLIENT_PORT ?? '5173';
  const gameServerPort = process.env.THE_COOP_E2E_GAME_SERVER_PORT ?? '2567';
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/mcp/server.ts'],
    cwd: process.cwd(),
    env: {
      ...getDefaultEnvironment(),
      THE_COOP_GAME_SERVER_URL: `http://127.0.0.1:${gameServerPort}`,
      THE_COOP_HUMAN_ORIGIN: `http://127.0.0.1:${clientPort}`,
    },
    stderr: 'pipe',
  });
  const client = new McpClient(
    { name: 'the-coop-playwright', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  return {
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) {
        const content = Array.isArray(result.content)
          ? result.content as Array<{ type?: unknown; text?: unknown }>
          : [];
        const text = content
          .filter((entry): entry is { type: 'text'; text: string } =>
            entry.type === 'text' && typeof entry.text === 'string')
          .map(({ text }) => text)
          .join('\n');
        throw new Error(text || `${name} failed`);
      }
      return (result.structuredContent ?? {}) as ToolResult;
    },
    async close() {
      await client.close();
    },
  };
}

async function moveMcpPlayer(
  mcp: McpHarness,
  interactableId: string,
  expected: GridPoint,
): Promise<ToolResult> {
  const result = await mcp.call('move_player_two', {
    target: { kind: 'interactable', id: interactableId },
    waitUntil: 'arrived',
  });
  expect(result).toMatchObject({
    status: 'arrived',
    currentPosition: expected,
  });
  return result;
}

function observedInteractable(observation: ToolResult, id: string): ObservedInteractable {
  const interactable = observation.interactables?.find((entry) => entry.id === id);
  if (interactable === undefined) throw new Error(`Missing observed interactable ${id}.`);
  return interactable;
}

test('browser Player 1 and MCP Player 2 complete the authoritative puzzle', async ({ page }) => {
  test.setTimeout(100_000);
  const errors: string[] = [];
  collectPageErrors(page, errors);
  const mcp = await createMcpClient();

  try {
    const started = await mcp.call('start_game');
    expect(started.status).toBe('waiting_for_player_one');
    expect(started.humanJoinUrl).toEqual(expect.stringContaining('#room='));
    const repeatedWaiting = await mcp.call('start_game');
    expect(repeatedWaiting).toMatchObject({
      status: 'waiting_for_player_one',
      roomId: started.roomId,
      humanJoinUrl: started.humanJoinUrl,
    });
    const invite = new URL(started.humanJoinUrl!);
    invite.searchParams.set('e2e', '1');

    await page.goto(invite.toString());
    await expect(page.getByTestId('game-shell')).toBeVisible();
    await waitForState(page, 'human-AI session to start', (state) =>
      state.phase === 'playing' && state.players.every((player) => player.connected));
    await expect(page.getByTestId('local-player')).toHaveText('Explorer 1');
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    const repeatedActive = await mcp.call('start_game');
    expect(repeatedActive).toMatchObject({ status: 'active', roomId: started.roomId });
    expect(repeatedActive.humanJoinUrl).toBeUndefined();

    const initial = await mcp.call('observe_game');
    expect(initial.players?.find(({ id }) => id === 'player-1')?.grid).toEqual({ x: 3, y: 6 });
    expect(initial.players?.find(({ id }) => id === 'player-2')?.grid).toEqual({ x: 3, y: 10 });
    expect(initial.level).not.toHaveProperty('objective');
    expect(initial.gate).not.toHaveProperty('rule');
    expect(initial.gate).not.toHaveProperty('unlocked');
    expect(initial.objective).toEqual({
      summary: COOPERATIVE_DISCOVERY_GOAL,
      complete: false,
    });
    const initialObservation = JSON.stringify(initial);
    expect(initialObservation).not.toContain('requiredPlateIds');
    expect(initialObservation).not.toContain('requiredKeycardIds');
    expect(initialObservation).not.toContain('requiredRelayButtonIds');
    expect(initialObservation).not.toContain('pairedWith');

    const threshold = await mcp.call('move_player_two', {
      target: { kind: 'interactable', id: 'plate_b' },
      waitUntil: 'arrived',
    });
    expect(threshold).toMatchObject({
      status: 'threshold_stopped',
      currentPosition: { x: 6, y: 8 },
    });
    let observed = await mcp.call('observe_game');
    expect(observed.players?.find(({ id }) => id === 'player-1')?.grid).toEqual({ x: 3, y: 6 });

    const held = await mcp.call('move_player_two', {
      target: { kind: 'interactable', id: 'plate_a' },
    });
    expect(held).toMatchObject({ status: 'arrived', currentPosition: { x: 5, y: 8 } });
    const firstHoldObservation = await mcp.call('observe_game');
    await waitForTick(page, (firstHoldObservation.session?.tick ?? 0) + 5);
    const secondHoldObservation = await mcp.call('observe_game');
    expect(secondHoldObservation.players?.find(({ id }) => id === 'player-2')).toMatchObject({
      grid: { x: 5, y: 8 },
      routeState: 'none',
    });
    expect((secondHoldObservation.session?.tick ?? 0)).toBeGreaterThan(
      firstHoldObservation.session?.tick ?? -1,
    );

    await page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target),
    center(5, 8));
    await waitForState(page, 'Player 1 to hold Plate A', (state) => {
      const player = state.players[0];
      return player?.routeKind === 'none'
        && Math.floor(player.worldX / 48) === 5
        && Math.floor(player.worldY / 48) === 8;
    });

    const farPlate = await mcp.call('move_player_two', {
      target: { kind: 'interactable', id: 'plate_b' },
    });
    expect(farPlate).toMatchObject({ status: 'arrived', currentPosition: { x: 10, y: 8 } });

    // Move Player 1 safely through the held gate first, but stop short of the
    // exit so Player 2 can reach the canonical exit target before completion
    // freezes both routes.
    await page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target),
    center(11, 5));
    await waitForState(page, 'Player 1 to cross the held gate', (state) => {
      const player = state.players[0];
      return player?.routeKind === 'none'
        && Math.floor(player.worldX / 48) === 11
        && Math.floor(player.worldY / 48) === 5;
    });

    const completed = await mcp.call('move_player_two', {
      target: { kind: 'interactable', id: 'exit_zone' },
    });
    expect(completed).toMatchObject({ status: 'arrived', currentPosition: { x: 13, y: 8 } });

    await page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target),
    center(13, 7));
    await waitForState(page, 'cooperative completion', (state) => state.phase === 'completed');
    await expect(page.getByTestId('completion-overlay')).toBeVisible();

    observed = await mcp.call('observe_game');
    expect(observed.players?.find(({ id }) => id === 'player-2')?.grid).toEqual({ x: 13, y: 8 });
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await mcp.close();
  }
});

test('browser Player 1 and MCP Player 2 complete all four levels and wrap in one room', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome', 'The full campaign smoke runs once; Level 1 remains cross-browser.');
  test.setTimeout(240_000);
  const errors: string[] = [];
  collectPageErrors(page, errors);
  const mcp = await createMcpClient();

  try {
    const started = await mcp.call('start_game');
    const invite = new URL(started.humanJoinUrl!);
    invite.searchParams.set('e2e', '1');
    await page.goto(invite.toString());
    await expect(page.getByTestId('game-shell')).toBeVisible();
    await waitForState(page, 'campaign session to start on Level 1', (state) =>
      state.phase === 'playing'
      && state.levelId === 'level_1'
      && state.levelNumber === 1
      && state.players.every((player) => player.connected));
    await page.waitForFunction(() =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.assetReady === true);
    const renderer = await page.evaluate(() =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.renderer);
    expect(renderer).toMatchObject({ cameraAzimuth: 45 });
    expect(renderer?.cameraElevation).toBeCloseTo(35.264, 3);
    const originalRoomId = started.roomId;
    expect(originalRoomId).toEqual(expect.any(String));
    await expect(page.getByTestId('level-indicator')).toHaveText('LEVEL 1 OF 4');
    await expect(page.getByTestId('level-name')).toHaveText('Pressure Lock');
    await expect(page.getByTestId('local-player')).toHaveText('Explorer 1');
    const captureFacilityEvidence = (levelNumber: number) => page.screenshot({
      path: testInfo.outputPath(`facility-level-${levelNumber}.png`),
      fullPage: true,
    });
    await captureFacilityEvidence(1);

    const advanceTo = async (
      levelId: string,
      levelNumber: number,
      levelName: string,
      levelEpoch: number,
      actionLabel: 'Next Level' | 'Play Again' = 'Next Level',
    ): Promise<ToolResult> => {
      await expect(page.getByTestId('completion-overlay')).toBeVisible();
      await expect(page.getByTestId('advance-level')).toHaveText(actionLabel);
      await page.getByTestId('advance-level').click();
      await waitForLevel(page, {
        id: levelId,
        number: levelNumber,
        epoch: levelEpoch,
        name: levelName,
      });
      await expect(page.getByTestId('level-indicator')).toHaveText(`LEVEL ${levelNumber} OF 4`);
      await expect(page.getByTestId('level-name')).toHaveText(levelName);
      if (levelEpoch <= 3) await captureFacilityEvidence(levelNumber);
      expect(await page.evaluate(() =>
        (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.roomId))
        .toBe(originalRoomId);
      const observation = await mcp.call('observe_game');
      expect(observation).toMatchObject({
        level: {
          id: levelId,
          number: levelNumber,
          count: 4,
          name: levelName,
        },
        session: {
          roomId: originalRoomId,
          levelEpoch,
        },
      });
      return observation;
    };

    // Level 1: hold Plate A, exchange the hold on Plate B, and cross together.
    await moveBrowserPlayer(page, { x: 5, y: 8 }, { x: 5, y: 8 }, 'Player 1 to hold Plate A', true);
    await waitForState(page, 'Level 1 gate to open', (state) =>
      state.levelId === 'level_1' && state.players[0]?.routeKind === 'none');
    await moveMcpPlayer(mcp, 'plate_b', { x: 10, y: 8 });
    await moveBrowserPlayer(page, { x: 11, y: 5 }, { x: 11, y: 5 }, 'Player 1 to cross Level 1 gate');
    await moveMcpPlayer(mcp, 'exit_zone', { x: 13, y: 8 });
    await completeWithBrowserPlayer(page, { x: 13, y: 7 }, 'Level 1 completion');

    await advanceTo('level_2', 2, 'Powered Transit', 1);

    // Level 2: Player 1 powers Alpha while Player 2 teleports and gets Card Alpha.
    await moveBrowserPlayer(page, { x: 4, y: 11 }, { x: 4, y: 11 }, 'Player 1 to power Alpha', true);
    await waitForState(page, 'Alpha teleporter to become powered', (state) =>
      state.teleporters.some(({ id, powered }) => id === 'teleporter_alpha' && powered));
    await moveMcpPlayer(mcp, 'teleporter_alpha_home', { x: 10, y: 5 });
    let observed = await mcp.call('observe_game');
    expect(observedInteractable(observed, 'teleporter_alpha_home')).toMatchObject({
      active: true,
    });
    expect(observedInteractable(
      observed,
      'teleporter_alpha_home',
    )).not.toHaveProperty('pairedWith');
    await moveMcpPlayer(mcp, 'keycard_alpha', { x: 13, y: 3 });
    observed = await mcp.call('observe_game');
    expect(observedInteractable(observed, 'keycard_alpha')).toMatchObject({ collected: true });
    expect(observed.gate).toMatchObject({ id: 'gate_main', open: true });
    expect(observed.gate).not.toHaveProperty('unlocked');

    const levelTwoHold = observed.players?.find(({ id }) => id === 'player-2');
    await moveBrowserPlayer(page, { x: 11, y: 5 }, { x: 11, y: 5 }, 'Player 1 to cross Level 2 gate');
    const afterLevelTwoBrowserMove = await mcp.call('observe_game');
    expect(afterLevelTwoBrowserMove.players?.find(({ id }) => id === 'player-2')).toMatchObject({
      grid: levelTwoHold?.grid,
      routeState: 'none',
    });
    await moveMcpPlayer(mcp, 'exit_zone', { x: 13, y: 8 });
    await completeWithBrowserPlayer(page, { x: 13, y: 7 }, 'Level 2 completion');

    await advanceTo('level_3', 3, 'Security Handshake', 2);

    // Level 3: return from Alpha with the card, then use two distinct relay occupants.
    await moveBrowserPlayer(page, { x: 4, y: 12 }, { x: 4, y: 12 }, 'Player 1 to power Level 3 Alpha', true);
    await moveMcpPlayer(mcp, 'teleporter_alpha_home', { x: 10, y: 5 });
    await moveMcpPlayer(mcp, 'keycard_alpha', { x: 13, y: 3 });
    await moveMcpPlayer(mcp, 'teleporter_alpha_annex', { x: 5, y: 5 });
    await moveBrowserPlayer(page, { x: 5, y: 3 }, { x: 5, y: 3 }, 'Player 1 to hold Gate Button A');
    await moveMcpPlayer(mcp, 'gate_button_b', { x: 5, y: 12 });
    observed = await mcp.call('observe_game');
    expect(observedInteractable(observed, 'gate_button_a')).toMatchObject({
      occupied: true,
      occupiedBy: 'player-1',
    });
    expect(observedInteractable(observed, 'gate_button_b')).toMatchObject({
      occupied: true,
      occupiedBy: 'player-2',
    });
    expect(observed.gate).toMatchObject({ open: true });
    await moveBrowserPlayer(page, { x: 9, y: 5 }, { x: 9, y: 5 }, 'Player 1 to cross Level 3 gate');
    await moveMcpPlayer(mcp, 'exit_zone', { x: 13, y: 8 });
    await completeWithBrowserPlayer(page, { x: 13, y: 7 }, 'Level 3 completion');

    await advanceTo('level_4', 4, 'Crossed Circuits', 3);

    // Level 4: alternate power duties across Alpha and Beta, then latch the final gate.
    await moveBrowserPlayer(page, { x: 4, y: 11 }, { x: 4, y: 11 }, 'Player 1 to power Level 4 Alpha', true);
    await moveMcpPlayer(mcp, 'teleporter_alpha_home', { x: 10, y: 5 });
    await moveMcpPlayer(mcp, 'keycard_alpha', { x: 12, y: 3 });
    await moveMcpPlayer(mcp, 'teleporter_beta_power', { x: 12, y: 11 });
    await moveBrowserPlayer(page, { x: 5, y: 11 }, { x: 13, y: 12 }, 'Player 1 to traverse Beta');
    await moveBrowserPlayer(page, { x: 14, y: 13 }, { x: 14, y: 13 }, 'Player 1 to collect Card Beta');
    await moveBrowserPlayer(page, { x: 13, y: 12 }, { x: 5, y: 11 }, 'Player 1 to return through Beta');

    const betaHoldObservation = await mcp.call('observe_game');
    expect(betaHoldObservation.players?.find(({ id }) => id === 'player-2')).toMatchObject({
      grid: { x: 12, y: 11 },
      routeState: 'none',
    });
    expect(observedInteractable(betaHoldObservation, 'teleporter_beta_power')).toMatchObject({
      occupied: true,
      powered: true,
    });
    expect(observedInteractable(betaHoldObservation, 'keycard_beta')).toMatchObject({
      collected: true,
    });

    await moveBrowserPlayer(page, { x: 4, y: 11 }, { x: 4, y: 11 }, 'Player 1 to repower Alpha');
    await moveMcpPlayer(mcp, 'teleporter_alpha_annex', { x: 5, y: 5 });
    await moveBrowserPlayer(page, { x: 5, y: 3 }, { x: 5, y: 3 }, 'Player 1 to hold final Gate Button A');
    await moveMcpPlayer(mcp, 'gate_button_b', { x: 5, y: 13 });
    observed = await mcp.call('observe_game');
    expect(observedInteractable(observed, 'keycard_alpha')).toMatchObject({ collected: true });
    expect(observedInteractable(observed, 'keycard_beta')).toMatchObject({ collected: true });
    expect(observedInteractable(observed, 'gate_button_a')).toMatchObject({
      occupiedBy: 'player-1',
    });
    expect(observedInteractable(observed, 'gate_button_b')).toMatchObject({
      occupiedBy: 'player-2',
    });
    expect(observed.gate).toMatchObject({ open: true });

    await moveBrowserPlayer(page, { x: 9, y: 4 }, { x: 9, y: 4 }, 'Player 1 to cross the final gate');
    await moveMcpPlayer(mcp, 'exit_zone', { x: 13, y: 8 });
    await completeWithBrowserPlayer(page, { x: 13, y: 7 }, 'Level 4 completion');

    const wrapped = await advanceTo('level_1', 1, 'Pressure Lock', 4, 'Play Again');
    expect(wrapped.players?.find(({ id }) => id === 'player-1')?.grid).toEqual({ x: 3, y: 6 });
    expect(wrapped.players?.find(({ id }) => id === 'player-2')?.grid).toEqual({ x: 3, y: 10 });
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await mcp.close();
  }
});
