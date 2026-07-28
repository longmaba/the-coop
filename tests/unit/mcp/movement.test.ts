import { describe, expect, it } from 'vitest';
import {
  PlayerTwoMovementCoordinator,
  type MovementSnapshot,
  type MovementTimer,
} from '../../../src/mcp/movement.ts';

class FakeTimer implements MovementTimer {
  callback: (() => void) | null = null;
  schedule(callback: () => void): unknown { this.callback = callback; return callback; }
  cancel(): void { this.callback = null; }
  fire(): void { this.callback?.(); }
}

const snapshot = (
  overrides: Partial<MovementSnapshot['playerTwo']> = {},
  levelEpoch = 0,
): MovementSnapshot => ({
  levelEpoch,
  phase: 'playing',
  playerTwo: {
    connected: true,
    lastMoveSeq: -1,
    routeKind: 'none',
    grid: { x: 3, y: 7 },
    ...overrides,
  },
});

describe('PlayerTwoMovementCoordinator', () => {
  it('derives and rebases movement sequences from authoritative Player 2 state', async () => {
    const coordinator = new PlayerTwoMovementCoordinator(new FakeTimer());
    const first = coordinator.begin(snapshot({ lastMoveSeq: 4 }), { x: 8, y: 6 }, 'accepted');
    expect(first.seq).toBe(5);
    coordinator.handleMoveResult({
      seq: 5, accepted: true, routeKind: 'target', effectiveTarget: { x: 8, y: 6 },
    });
    await expect(first.outcome).resolves.toMatchObject({ status: 'accepted', seq: 5 });

    const rebased = coordinator.begin(snapshot({ lastMoveSeq: -1 }, 1), { x: 8, y: 6 }, 'accepted');
    expect(rebased.seq).toBe(0);
  });

  it('waits for accepted authoritative idle arrival', async () => {
    const coordinator = new PlayerTwoMovementCoordinator(new FakeTimer());
    const move = coordinator.begin(snapshot(), { x: 8, y: 6 });
    coordinator.handleMoveResult({
      seq: move.seq, accepted: true, routeKind: 'target', effectiveTarget: { x: 8, y: 6 },
    });
    coordinator.observe(snapshot({ lastMoveSeq: move.seq, routeKind: 'target', grid: { x: 8, y: 6 } }));
    coordinator.observe(snapshot({ lastMoveSeq: move.seq, routeKind: 'none', grid: { x: 8, y: 6 } }));
    await expect(move.outcome).resolves.toMatchObject({
      status: 'arrived',
      currentPosition: { x: 8, y: 6 },
    });
  });

  it('settles at the entry pad when teleporter power turns off en route', async () => {
    const coordinator = new PlayerTwoMovementCoordinator(new FakeTimer());
    const move = coordinator.begin(
      snapshot(),
      { x: 8, y: 5 },
      'arrived',
      [{ x: 8, y: 5 }, { x: 15, y: 5 }],
    );
    coordinator.handleMoveResult({
      seq: move.seq,
      accepted: true,
      routeKind: 'target',
      effectiveTarget: { x: 8, y: 5 },
    });

    coordinator.observe(snapshot({
      lastMoveSeq: move.seq,
      routeKind: 'none',
      grid: { x: 8, y: 5 },
    }));
    await expect(move.outcome).resolves.toMatchObject({
      status: 'arrived',
      target: { x: 8, y: 5 },
      effectiveTarget: { x: 8, y: 5 },
      currentPosition: { x: 8, y: 5 },
    });
  });

  it('settles at the paired pad when teleporter power turns on en route', async () => {
    const coordinator = new PlayerTwoMovementCoordinator(new FakeTimer());
    const move = coordinator.begin(
      snapshot(),
      { x: 8, y: 5 },
      'arrived',
      [{ x: 8, y: 5 }, { x: 15, y: 5 }],
    );
    coordinator.handleMoveResult({
      seq: move.seq,
      accepted: true,
      routeKind: 'target',
      effectiveTarget: { x: 8, y: 5 },
    });
    coordinator.observe(snapshot({
      lastMoveSeq: move.seq,
      routeKind: 'none',
      grid: { x: 15, y: 5 },
    }));
    await expect(move.outcome).resolves.toMatchObject({
      status: 'arrived',
      target: { x: 8, y: 5 },
      effectiveTarget: { x: 15, y: 5 },
      currentPosition: { x: 15, y: 5 },
    });
  });

  it('settles at the requested pad when an accepted command starts there', async () => {
    const coordinator = new PlayerTwoMovementCoordinator(new FakeTimer());
    const move = coordinator.begin(
      snapshot({ lastMoveSeq: 7, grid: { x: 8, y: 5 } }),
      { x: 8, y: 5 },
      'arrived',
      [{ x: 8, y: 5 }, { x: 15, y: 5 }],
    );
    coordinator.handleMoveResult({
      seq: move.seq,
      accepted: true,
      routeKind: 'none',
      effectiveTarget: { x: 8, y: 5 },
    });
    coordinator.observe(snapshot({
      lastMoveSeq: move.seq,
      routeKind: 'none',
      grid: { x: 8, y: 5 },
    }));
    await expect(move.outcome).resolves.toMatchObject({
      status: 'arrived',
      effectiveTarget: { x: 8, y: 5 },
      currentPosition: { x: 8, y: 5 },
    });
  });

  it('settles a semantic exit target at the actual authoritative exit cell', async () => {
    const coordinator = new PlayerTwoMovementCoordinator(new FakeTimer());
    const move = coordinator.begin(
      snapshot(),
      { x: 20, y: 6 },
      'arrived',
      [{ x: 19, y: 4 }, { x: 20, y: 6 }, { x: 21, y: 7 }],
    );
    coordinator.handleMoveResult({
      seq: move.seq,
      accepted: true,
      routeKind: 'target',
      effectiveTarget: { x: 20, y: 6 },
    });
    coordinator.observe({
      ...snapshot({
        lastMoveSeq: move.seq,
        routeKind: 'target',
        grid: { x: 19, y: 4 },
      }),
      phase: 'completed',
    });
    await expect(move.outcome).resolves.toMatchObject({
      status: 'arrived',
      target: { x: 20, y: 6 },
      effectiveTarget: { x: 19, y: 4 },
      currentPosition: { x: 19, y: 4 },
    });
  });

  it('ignores an idle pre-command snapshot until the authoritative sequence advances', async () => {
    const coordinator = new PlayerTwoMovementCoordinator(new FakeTimer());
    const move = coordinator.begin(
      snapshot(),
      { x: 8, y: 6 },
      'arrived',
      [{ x: 8, y: 6 }],
    );
    coordinator.handleMoveResult({
      seq: move.seq,
      accepted: true,
      routeKind: 'target',
      effectiveTarget: { x: 8, y: 6 },
    });

    let settled = false;
    void move.outcome.then(() => { settled = true; });
    coordinator.observe(snapshot({
      lastMoveSeq: move.seq - 1,
      routeKind: 'none',
      grid: { x: 8, y: 6 },
    }));
    await Promise.resolve();
    expect(settled).toBe(false);

    coordinator.observe(snapshot({
      lastMoveSeq: move.seq,
      routeKind: 'none',
      grid: { x: 8, y: 6 },
    }));
    await expect(move.outcome).resolves.toMatchObject({ status: 'arrived' });
  });

  it('reports threshold stops at the authoritative effective destination', async () => {
    const coordinator = new PlayerTwoMovementCoordinator(new FakeTimer());
    const move = coordinator.begin(snapshot(), { x: 14, y: 6 });
    coordinator.handleMoveResult({
      seq: move.seq,
      accepted: true,
      routeKind: 'threshold-stop',
      effectiveTarget: { x: 10, y: 6 },
    });
    coordinator.observe(snapshot({
      lastMoveSeq: move.seq,
      routeKind: 'none',
      grid: { x: 10, y: 6 },
    }));
    await expect(move.outcome).resolves.toMatchObject({
      status: 'threshold_stopped',
      effectiveTarget: { x: 10, y: 6 },
    });
  });

  it('uses a threshold stop instead of a projected teleporter arrival', async () => {
    const coordinator = new PlayerTwoMovementCoordinator(new FakeTimer());
    const move = coordinator.begin(
      snapshot(),
      { x: 15, y: 5 },
      'arrived',
      [{ x: 15, y: 5 }, { x: 8, y: 5 }],
    );
    coordinator.handleMoveResult({
      seq: move.seq,
      accepted: true,
      routeKind: 'threshold-stop',
      effectiveTarget: { x: 10, y: 6 },
    });
    coordinator.observe(snapshot({
      lastMoveSeq: move.seq,
      routeKind: 'none',
      grid: { x: 10, y: 6 },
    }));
    await expect(move.outcome).resolves.toMatchObject({
      status: 'threshold_stopped',
      effectiveTarget: { x: 10, y: 6 },
      currentPosition: { x: 10, y: 6 },
    });
  });

  it('supersedes older waits and settles timeout and unavailable outcomes', async () => {
    const timer = new FakeTimer();
    const coordinator = new PlayerTwoMovementCoordinator(timer);
    const older = coordinator.begin(snapshot(), { x: 8, y: 6 });
    const newer = coordinator.begin(snapshot(), { x: 9, y: 6 });
    await expect(older.outcome).resolves.toMatchObject({ status: 'superseded' });
    timer.fire();
    await expect(newer.outcome).resolves.toMatchObject({ status: 'timed_out' });

    const unavailable = coordinator.begin({
      levelEpoch: 0,
      phase: 'reconnectGrace',
      playerTwo: { ...snapshot().playerTwo!, connected: false },
    }, { x: 8, y: 6 });
    await expect(unavailable.outcome).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('supersedes a pending wait before rebasing to a new level epoch', async () => {
    const coordinator = new PlayerTwoMovementCoordinator(new FakeTimer());
    const pending = coordinator.begin(
      snapshot({ lastMoveSeq: 6 }, 2),
      { x: 8, y: 6 },
      'arrived',
      [{ x: 8, y: 6 }],
    );
    coordinator.handleMoveResult({
      seq: pending.seq,
      accepted: true,
      routeKind: 'target',
      effectiveTarget: { x: 8, y: 6 },
    });

    coordinator.observe(snapshot({ lastMoveSeq: 3 }, 3));
    await expect(pending.outcome).resolves.toMatchObject({
      status: 'superseded',
      reason: 'The level changed before this movement command settled.',
    });

    const rebased = coordinator.begin(
      snapshot({ lastMoveSeq: 3 }, 3),
      { x: 8, y: 6 },
      'accepted',
    );
    expect(rebased.seq).toBe(4);
    coordinator.dispose();
  });

  it('returns structured game rejection without treating it as infrastructure failure', async () => {
    const coordinator = new PlayerTwoMovementCoordinator(new FakeTimer());
    const move = coordinator.begin(snapshot(), { x: 0, y: 0 });
    coordinator.handleMoveResult({
      seq: move.seq,
      accepted: false,
      reason: 'invalid-target',
      routeKind: 'none',
      effectiveTarget: { x: 0, y: 0 },
    });
    await expect(move.outcome).resolves.toMatchObject({
      status: 'rejected',
      reason: 'invalid-target',
    });
  });

  it('settles an active wait as unavailable when Player 2 disconnects', async () => {
    const coordinator = new PlayerTwoMovementCoordinator(new FakeTimer());
    const move = coordinator.begin(snapshot(), { x: 8, y: 6 });
    coordinator.observe({
      levelEpoch: 0,
      phase: 'abandoned',
      playerTwo: { ...snapshot().playerTwo!, connected: false },
    });
    await expect(move.outcome).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'Player 2 is no longer available.',
    });
  });
});
