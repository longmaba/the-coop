import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';

interface BridgeState {
  phase: string;
  tick: number;
  doorOpen: boolean;
  nearPlatePressed: boolean;
  farPlatePressed: boolean;
  levelEpoch: number;
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
    ready: boolean;
    cameraElevation: number;
    cameraAzimuth: number;
    canvasCount: number;
    gateAnimations: Array<{
      time: number;
      duration: number;
      travel: number;
    }>;
  } | null;
  worldToScreen(point: { x: number; y: number }): { x: number; y: number };
  sendMoveTarget(point: { x: number; y: number }): void;
}

interface BrowserChatTool {
  name?: string;
  execute(input: unknown): unknown;
}

interface BrowserSiteTool {
  name: string;
  execute(input?: unknown): unknown | Promise<unknown>;
}

const CELL_SIZE = 48;
const center = (x: number, y: number) => ({
  x: (x + 0.5) * CELL_SIZE,
  y: (y + 0.5) * CELL_SIZE,
});

async function roomId(page: Page): Promise<string> {
  await page.waitForFunction(() =>
    typeof (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.roomId === 'string');
  const value = await page.evaluate(() =>
    (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.roomId);
  if (typeof value !== 'string') throw new Error('Room id was not assigned.');
  return value;
}

async function waitForState(page: Page, description: string, predicate: (state: BridgeState) => boolean): Promise<void> {
  await page.waitForFunction(
    ({ source }) => {
      const state = (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.state;
      if (state === undefined) return false;
      // The predicate is test-owned and receives only a cloned diagnostic state.
      return Function('state', `return (${source})(state)`)(state) === true;
    },
    { source: predicate.toString() },
    { timeout: 15_000 },
  ).catch((error: unknown) => {
    throw new Error(`Timed out waiting for ${description}`, { cause: error });
  });
}

async function clickWorld(page: Page, point: { x: number; y: number }): Promise<void> {
  const screen = await page.evaluate((target) =>
    (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.worldToScreen(target), point);
  if (screen === undefined) throw new Error('Scene diagnostics were not ready.');
  await page.mouse.click(screen.x, screen.y);
}

function collectPageErrors(page: Page, errors: string[]): void {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
}

async function joinSecondSeat(browser: Browser, id: string, errors: string[]): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  collectPageErrors(page, errors);
  await page.goto(`/?room=${encodeURIComponent(id)}&e2e=1`);
  await expect(page.getByTestId('game-shell')).toBeVisible();
  await waitForState(page, 'second player to enter the match', (state) =>
    state.phase === 'playing' && state.players.length === 2);
  return { page, close: () => context.close() };
}

async function verifyThirdSeatRejected(browser: Browser, id: string): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`/?room=${encodeURIComponent(id)}&e2e=1`);
    await expect(page.getByTestId('landing-shell')).toBeVisible();
    await expect(page.getByTestId('room-error')).not.toHaveText('');
  } finally {
    await context.close();
  }
}

async function captureFacility(page: Page, testInfo: TestInfo): Promise<void> {
  await page.screenshot({
    path: testInfo.outputPath('facility.png'),
    fullPage: true,
  });
}

async function captureCompactFacility(page: Page, testInfo: TestInfo): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('game-shell')).toBeVisible();
  const framing = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#facility-root canvas');
    if (canvas === null) return null;
    const bounds = canvas.getBoundingClientRect();
    const diagnostics = (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__;
    const boardCorners = [
      { x: 0, y: 0 },
      { x: 16 * 48, y: 0 },
      { x: 0, y: 16 * 48 },
      { x: 16 * 48, y: 16 * 48 },
    ].map((point) => diagnostics?.worldToScreen(point));
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      canvas: {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
      },
      boardCorners,
    };
  });
  expect(framing).not.toBeNull();
  expect(framing!.scrollWidth).toBeLessThanOrEqual(framing!.viewportWidth);
  expect(framing!.canvas.left).toBeGreaterThanOrEqual(0);
  expect(framing!.canvas.right).toBeLessThanOrEqual(framing!.viewportWidth);
  for (const corner of framing!.boardCorners) {
    expect(corner).toBeDefined();
    expect(corner!.x).toBeGreaterThanOrEqual(framing!.canvas.left);
    expect(corner!.x).toBeLessThanOrEqual(framing!.canvas.right);
    expect(corner!.y).toBeGreaterThanOrEqual(framing!.canvas.top);
    expect(corner!.y).toBeLessThanOrEqual(framing!.canvas.bottom);
  }
  await page.screenshot({
    path: testInfo.outputPath('facility-compact.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function captureGate(
  page: Page,
  testInfo: TestInfo,
  state: 'closed' | 'transition' | 'open',
): Promise<void> {
  const clip = await page.evaluate(() => {
    const diagnostics = (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__;
    const canvas = document.querySelector<HTMLCanvasElement>('#facility-root canvas');
    if (diagnostics === undefined || canvas === null) return null;
    const center = diagnostics.worldToScreen({
      x: 7.5 * 48,
      y: 8 * 48,
    });
    const bounds = canvas.getBoundingClientRect();
    const left = Math.max(bounds.left, center.x - 120);
    const top = Math.max(bounds.top, center.y - 170);
    return {
      x: left,
      y: top,
      width: Math.min(240, bounds.right - left),
      height: Math.min(230, bounds.bottom - top),
    };
  });
  if (clip === null) throw new Error('Could not locate the rendered gate.');
  await page.screenshot({
    path: testInfo.outputPath(`gate-${state}.png`),
    clip,
  });
}

test('browser chat tool composes with the active game popup lifecycle', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome', 'The browser API composition path runs once.');
  test.setTimeout(20_000);
  await page.addInitScript(() => {
    const browserWindow = window as Window & {
      __CHAT_TOOL__?: BrowserChatTool;
      __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool>;
    };
    browserWindow.__WEBMCP_TOOLS__ = {};
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        async registerTool(tool: BrowserSiteTool) {
          browserWindow.__WEBMCP_TOOLS__![tool.name] = tool;
          if (tool.name === 'chat') browserWindow.__CHAT_TOOL__ = tool;
        },
      },
    });
  });
  await page.goto('/?e2e=1');

  const inactiveResult = await page.evaluate(() =>
    (window as Window & { __CHAT_TOOL__?: BrowserChatTool }).__CHAT_TOOL__?.execute({ message: 'Too early' }));
  expect(inactiveResult).toMatchObject({ displayed: false, error: { code: 'NO_ACTIVE_GAME' } });

  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('game-shell')).toBeVisible();
  const firstResult = await page.evaluate(() =>
    (window as Window & { __CHAT_TOOL__?: BrowserChatTool }).__CHAT_TOOL__?.execute({ message: '<b>Meet at the gate</b>' }));
  expect(firstResult).toEqual({ displayed: true, dismissAfterMs: 5_000 });
  await expect(page.getByTestId('chat-popup')).toBeVisible();
  await expect(page.getByTestId('chat-message')).toHaveText('<b>Meet at the gate</b>');
  await expect(page.getByTestId('chat-message').locator('b')).toHaveCount(0);

  await page.waitForTimeout(250);
  await page.evaluate(() =>
    (window as Window & { __CHAT_TOOL__?: BrowserChatTool }).__CHAT_TOOL__?.execute({ message: 'Hold Plate A' }));
  await expect(page.getByTestId('chat-message')).toHaveText('Hold Plate A');
  await page.waitForTimeout(4_800);
  await expect(page.getByTestId('chat-popup')).toBeVisible();
  await expect(page.getByTestId('chat-popup')).toBeHidden({ timeout: 1_000 });
});

test('browser WebMCP joins as Player 2, observes safely, and confirms arrival', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome', 'The experimental browser adapter composition path runs once.');
  test.setTimeout(35_000);
  const installWebMcpCapture = async (target: Page): Promise<void> => {
    await target.addInitScript(() => {
      const browserWindow = window as Window & { __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool> };
      browserWindow.__WEBMCP_TOOLS__ = {};
      Object.defineProperty(document, 'modelContext', {
        configurable: true,
        value: {
          async registerTool(tool: BrowserSiteTool) {
            browserWindow.__WEBMCP_TOOLS__![tool.name] = tool;
          },
        },
      });
    });
  };

  await installWebMcpCapture(page);
  await page.goto('/?e2e=1');
  await page.waitForFunction(() =>
    (window as Window & { __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool> })
      .__WEBMCP_TOOLS__?.observe_game !== undefined);
  const landingObservation = await page.evaluate(async () =>
    (window as Window & { __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool> })
      .__WEBMCP_TOOLS__!.observe_game!.execute({}));
  expect(landingObservation).toMatchObject({ status: 'unavailable' });
  await page.getByTestId('create-room').click();
  const id = await roomId(page);
  const playerOneObservation = await page.evaluate(async () =>
    (window as Window & { __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool> })
      .__WEBMCP_TOOLS__!.observe_game!.execute({}));
  expect(playerOneObservation).toMatchObject({ status: 'wrong_seat' });

  const staleContext = await browser.newContext();
  const stalePage = await staleContext.newPage();
  await stalePage.route('**/*.glb', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await installWebMcpCapture(stalePage);
  try {
    await stalePage.goto('/?e2e=1');
    await stalePage.waitForFunction(() =>
      (window as Window & { __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool> })
        .__WEBMCP_TOOLS__?.join_game !== undefined);
    const staleJoin = stalePage.evaluate(async (code) => {
      try {
        await (window as Window & { __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool> })
          .__WEBMCP_TOOLS__!.join_game!.execute({ code });
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, id);
    await stalePage.getByTestId('return-to-lobby').click();
    await expect(staleJoin).resolves.toMatch(/cancelled|stale/i);
    await expect(stalePage.getByTestId('landing-shell')).toBeVisible();
  } finally {
    await staleContext.close();
  }

  const agentContext = await browser.newContext();
  const agentPage = await agentContext.newPage();
  await installWebMcpCapture(agentPage);
  try {
    await agentPage.goto('/?e2e=1');
    await agentPage.waitForFunction(() =>
      Object.keys((window as Window & { __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool> })
        .__WEBMCP_TOOLS__ ?? {}).length === 4);
    const missingRoomError = await agentPage.evaluate(async () => {
      try {
        await (window as Window & { __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool> })
          .__WEBMCP_TOOLS__!.join_game!.execute({ code: 'missing_room' });
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(missingRoomError).not.toBe('');
    await expect(agentPage.getByTestId('landing-shell')).toBeVisible();

    const joinAttempt = await agentPage.evaluate(async (code) => {
      const tool = (window as Window & { __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool> })
        .__WEBMCP_TOOLS__!.join_game!;
      const first = tool.execute({ code });
      let concurrentError = '';
      try {
        await tool.execute({ code });
      } catch (error) {
        concurrentError = error instanceof Error ? error.message : String(error);
      }
      return { joined: await first, concurrentError };
    }, id);
    expect(joinAttempt).toEqual({
      joined: { joined: true, roomId: id, playerId: 'player-2' },
      concurrentError: 'join_game is available only from an unseated landing page.',
    });

    const observed = await agentPage.evaluate(async () =>
      (window as Window & { __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool> })
        .__WEBMCP_TOOLS__!.observe_game!.execute({})) as {
          session: { roomId: string; phase: string };
          interactables: Array<{ id: string }>;
          players: Array<{ id: string }>;
        };
    expect(observed.session).toMatchObject({ roomId: id, phase: 'playing' });
    expect(observed.players.map(({ id: playerId }) => playerId)).toEqual(['player-1', 'player-2']);
    expect(observed.interactables.some(({ id: interactableId }) => interactableId === 'plate_a')).toBe(true);
    const serialized = JSON.stringify(observed);
    expect(serialized).not.toContain('latchedGateIds');
    expect(serialized).not.toContain('pairedWith');
    expect(serialized).not.toContain('reconnectionToken');

    const moved = await agentPage.evaluate(async () =>
      (window as Window & { __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool> })
        .__WEBMCP_TOOLS__!.move_player_two!.execute({
          target: { kind: 'interactable', id: 'plate_a' },
          waitUntil: 'arrived',
        }));
    expect(moved).toMatchObject({
      status: 'arrived',
      target: { x: 5, y: 8 },
      effectiveTarget: { x: 5, y: 8 },
      currentPosition: { x: 5, y: 8 },
      phase: 'playing',
    });

    await page.getByTestId('return-to-lobby').click();
    await expect(agentPage.getByTestId('abandoned-overlay')).toBeVisible();
    const terminalResults = await agentPage.evaluate(async () => {
      const tools = (window as Window & { __WEBMCP_TOOLS__?: Record<string, BrowserSiteTool> })
        .__WEBMCP_TOOLS__!;
      return {
        observation: await tools.observe_game!.execute({}),
        movement: await tools.move_player_two!.execute({
          target: { kind: 'grid', x: 5, y: 8 },
          waitUntil: 'arrived',
        }),
      };
    });
    expect(terminalResults).toEqual({
      observation: {
        status: 'unavailable',
        reason: 'The Player 2 browser session is no longer available.',
      },
      movement: {
        status: 'unavailable',
        reason: 'The Player 2 browser session is no longer available.',
      },
    });
  } finally {
    await agentContext.close();
  }
});

test('two isolated clients solve, reconnect, and restart the authoritative puzzle', async ({ browser, page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto('/?e2e=1');
  await expect(page.getByRole('heading', { name: 'THE COOP' })).toBeVisible();
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('game-shell')).toBeVisible();
  await page.waitForFunction(() =>
    (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.assetReady === true);
  await expect(page.getByTestId('asset-loading-overlay')).toBeHidden();
  await expect(page.locator('#facility-root canvas')).toBeVisible();
  const renderer = await page.evaluate(() =>
    (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.renderer);
  expect(renderer).toMatchObject({
    ready: true,
    cameraAzimuth: 45,
    canvasCount: 1,
  });
  expect(renderer?.cameraElevation).toBeCloseTo(35.264, 3);
  const id = await roomId(page);
  await expect(page.getByTestId('hud-room-code')).toHaveText(id);

  const second = await joinSecondSeat(browser, id, errors);
  try {
    await waitForState(page, 'first player to enter the match', (state) =>
      state.phase === 'playing' && state.players.length === 2);
    await expect(page.getByTestId('local-player')).toHaveText('Explorer 1');
    await expect(second.page.getByTestId('local-player')).toHaveText('Explorer 2');

    // The synthetic offline event exercises Colyseus SDK retry behavior. The
    // Sites transport uses HTTP polling, while reload below covers its saved
    // seat reconnection path.
    if (!testInfo.project.name.endsWith('-sites')) {
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await waitForState(second.page, 'early connection drop', (state) =>
        state.phase === 'reconnectGrace' && state.players[0]?.connected === false);
      await expect(page.getByTestId('reconnect-overlay')).toBeVisible();
      await waitForState(second.page, 'automatic early reconnection', (state) =>
        state.phase === 'playing' && state.players.every((player) => player.connected));
      await expect(page.getByTestId('reconnect-overlay')).toBeHidden();
    }

    await verifyThirdSeatRejected(browser, id);

    const originalPlayerId = await page.evaluate(() =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.playerId);
    await page.reload();
    await expect(page.getByTestId('game-shell')).toBeVisible();
    await waitForState(page, 'creator reload reconnection', (state) =>
      state.phase === 'playing' && state.players.every((player) => player.connected));
    await page.waitForFunction((expected) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.playerId === expected,
    originalPlayerId);
    expect(await page.evaluate(() =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.playerId)).toBe(originalPlayerId);
    await page.waitForFunction(() => {
      const gates = (window as Window & { __THE_COOP_E2E__?: Diagnostics })
        .__THE_COOP_E2E__?.renderer?.gateAnimations;
      return gates !== undefined
        && gates.length > 0
        && gates.every(({ time, travel }) => time === 0 && travel < 0.001);
    });
    if (testInfo.project.name === 'chrome') {
      await captureGate(page, testInfo, 'closed');
    }

    // The top-right internal wall at 10,3 is present in both the visual plan
    // and authoritative catalog. A projected click on it must not create a
    // route or advance the accepted server command sequence.
    const beforeWallClick = await page.evaluate(() => {
      const state = (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__!.state;
      return {
        tick: state.tick,
        worldX: state.players[0]!.worldX,
        worldY: state.players[0]!.worldY,
        lastMoveSeq: state.players[0]!.lastMoveSeq,
      };
    });
    await clickWorld(page, center(10, 3));
    await page.waitForFunction((minimumTick) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics })
        .__THE_COOP_E2E__!.state.tick >= minimumTick,
    beforeWallClick.tick + 3);
    const afterWallClick = await page.evaluate(() => {
      const player = (window as Window & { __THE_COOP_E2E__?: Diagnostics })
        .__THE_COOP_E2E__!.state.players[0]!;
      return {
        worldX: player.worldX,
        worldY: player.worldY,
        routeKind: player.routeKind,
        lastMoveSeq: player.lastMoveSeq,
      };
    });
    expect(afterWallClick).toEqual({
      worldX: beforeWallClick.worldX,
      worldY: beforeWallClick.worldY,
      routeKind: 'none',
      lastMoveSeq: beforeWallClick.lastMoveSeq,
    });

    // A closed-door click beyond the divider stops at the threshold and clears.
    await clickWorld(page, center(10, 8));
    await waitForState(page, 'threshold-stop route', (state) =>
      state.players[0]?.routeKind === 'threshold-stop');
    await waitForState(page, 'first player at the closed-door threshold', (state) => {
      const player = state.players[0];
      return player !== undefined
        && player.routeKind === 'none'
        && Math.abs(player.worldX - 6.5 * 48) < 2
        && Math.abs(player.worldY - 8.5 * 48) < 2;
    });

    // Re-click the near plate, then the second player can cross to the far plate.
    await clickWorld(page, center(5, 8));
    await waitForState(page, 'near pressure plate', (state) =>
      state.nearPlatePressed && state.doorOpen);
    if (testInfo.project.name === 'chrome') {
      await page.waitForFunction(() => {
        const gate = (window as Window & { __THE_COOP_E2E__?: Diagnostics })
          .__THE_COOP_E2E__?.renderer?.gateAnimations[0];
        return gate !== undefined
          && gate.time >= gate.duration * 0.35
          && gate.time <= gate.duration * 0.8
          && gate.travel > 0.1;
      });
      await captureGate(page, testInfo, 'transition');
    }
    await page.waitForFunction(() => {
      const gates = (window as Window & { __THE_COOP_E2E__?: Diagnostics })
        .__THE_COOP_E2E__?.renderer?.gateAnimations;
      return gates !== undefined
        && gates.length > 0
        && gates.every(({ time, duration, travel }) =>
          Math.abs(time - duration) < 0.001 && travel > 0.1);
    });
    if (testInfo.project.name === 'chrome') {
      await captureGate(page, testInfo, 'open');
    }
    await second.page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(10, 8));
    await waitForState(second.page, 'far pressure plate', (state) =>
      state.farPlatePressed && state.doorOpen);

    if (testInfo.project.name === 'chrome') {
      await captureFacility(page, testInfo);
      await captureCompactFacility(page, testInfo);
    }

    // Player two now holds the far plate while player one crosses; both finish.
    await page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(13, 7));
    await waitForState(page, 'first player in the exit', (state) =>
      (state.players[0]?.worldX ?? 0) >= 12 * 48);
    await second.page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(13, 8));
    await waitForState(page, 'cooperative completion', (state) => state.phase === 'completed');
    await expect(page.getByTestId('completion-overlay')).toBeVisible();
    await expect(second.page.getByTestId('completion-overlay')).toBeVisible();

    const previousEpoch = await page.evaluate(() =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.state.levelEpoch ?? -1);
    await page.getByTestId('restart-level').click();
    await page.waitForFunction((epoch) => {
      const state = (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.state;
      return state?.phase === 'playing' && state.levelEpoch > epoch;
    }, previousEpoch);
    await expect(page.getByTestId('completion-overlay')).toBeHidden();

    // Complete a second round and let the other browser restart it. This proves
    // restart sequencing follows the shared epoch rather than a per-tab counter.
    await page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(5, 8));
    await waitForState(page, 'second-round near plate', (state) =>
      state.nearPlatePressed && state.doorOpen);
    await second.page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(10, 8));
    await waitForState(second.page, 'second-round far plate', (state) =>
      state.farPlatePressed && state.doorOpen);
    await page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(13, 7));
    await waitForState(page, 'second-round first exit', (state) =>
      (state.players[0]?.worldX ?? 0) >= 12 * 48);
    await second.page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(13, 8));
    await waitForState(page, 'second-round completion', (state) => state.phase === 'completed');

    if (!testInfo.project.name.endsWith('-sites')) {
      await second.page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await waitForState(page, 'completed-round reconnect grace', (state) =>
        state.phase === 'reconnectGrace' && state.players[1]?.connected === false);
      await waitForState(page, 'completed round restored after reconnect', (state) =>
        state.phase === 'completed' && state.players.every((player) => player.connected));
    }

    const secondEpoch = await page.evaluate(() =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.state.levelEpoch ?? -1);
    await second.page.getByTestId('restart-level').click();
    await page.waitForFunction((epoch) => {
      const state = (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.state;
      return state?.phase === 'playing' && state.levelEpoch > epoch;
    }, secondEpoch);

    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await second.close();
  }
});

test('asset loading fails closed before creating a room', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome', 'The deterministic loader failure runs once.');
  await page.route('**/*.glb', (route) => route.abort('failed'));
  await page.goto('/?e2e=1');
  await page.getByTestId('create-room').click();

  await expect(page.getByTestId('error-overlay')).toBeVisible();
  await expect(page.getByTestId('asset-loading-overlay')).toBeHidden();
  await expect(page.getByTestId('error-detail')).toContainText('Visual assets could not be loaded');
  expect(await page.evaluate(() =>
    (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.roomId)).toBeNull();
  await expect(page.locator('#facility-root canvas')).toHaveCount(0);
});
