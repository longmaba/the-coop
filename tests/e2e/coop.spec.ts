import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';

interface BridgeState {
  phase: string;
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

test('two isolated clients solve, reconnect, and restart the authoritative puzzle', async ({ browser, page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  collectPageErrors(page, errors);

  await page.goto('/?e2e=1');
  await expect(page.getByRole('heading', { name: 'THE COOP' })).toBeVisible();
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('game-shell')).toBeVisible();
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

    // A closed-door click beyond the divider stops at the threshold and clears.
    await clickWorld(page, center(14, 6));
    await waitForState(page, 'threshold-stop route', (state) =>
      state.players[0]?.routeKind === 'threshold-stop');
    await waitForState(page, 'first player at the closed-door threshold', (state) => {
      const player = state.players[0];
      return player !== undefined
        && player.routeKind === 'none'
        && Math.abs(player.worldX - 10.5 * 48) < 2
        && Math.abs(player.worldY - 6.5 * 48) < 2;
    });

    // Re-click the near plate, then the second player can cross to the far plate.
    await clickWorld(page, center(8, 6));
    await waitForState(page, 'near pressure plate', (state) =>
      state.nearPlatePressed && state.doorOpen);
    await second.page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(14, 6));
    await waitForState(second.page, 'far pressure plate', (state) =>
      state.farPlatePressed && state.doorOpen);

    if (testInfo.project.name === 'chrome') await captureFacility(page, testInfo);

    // Player two now holds the far plate while player one crosses; both finish.
    await page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(20, 5));
    await waitForState(page, 'first player in the exit', (state) =>
      (state.players[0]?.worldX ?? 0) >= 19 * 48);
    await second.page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(20, 6));
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
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(8, 6));
    await waitForState(page, 'second-round near plate', (state) =>
      state.nearPlatePressed && state.doorOpen);
    await second.page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(14, 6));
    await waitForState(second.page, 'second-round far plate', (state) =>
      state.farPlatePressed && state.doorOpen);
    await page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(20, 5));
    await waitForState(page, 'second-round first exit', (state) =>
      (state.players[0]?.worldX ?? 0) >= 19 * 48);
    await second.page.evaluate((target) =>
      (window as Window & { __THE_COOP_E2E__?: Diagnostics }).__THE_COOP_E2E__?.sendMoveTarget(target), center(20, 6));
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
