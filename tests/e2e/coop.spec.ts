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

    // Exercise automatic SDK retry immediately after join (before its former
    // five-second minimum uptime would have elapsed).
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await waitForState(second.page, 'early connection drop', (state) =>
      state.phase === 'reconnectGrace' && state.players[0]?.connected === false);
    await expect(page.getByTestId('reconnect-overlay')).toBeVisible();
    await waitForState(second.page, 'automatic early reconnection', (state) =>
      state.phase === 'playing' && state.players.every((player) => player.connected));
    await expect(page.getByTestId('reconnect-overlay')).toBeHidden();

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

    await second.page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await waitForState(page, 'completed-round reconnect grace', (state) =>
      state.phase === 'reconnectGrace' && state.players[1]?.connected === false);
    await waitForState(page, 'completed round restored after reconnect', (state) =>
      state.phase === 'completed' && state.players.every((player) => player.connected));

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
