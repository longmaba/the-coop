export const MAX_MOVEMENT_WAIT_MS = 15_000;

export interface MovementGridPoint {
  x: number;
  y: number;
}

export interface MovementPlayerTwoSnapshot {
  connected: boolean;
  lastMoveSeq: number;
  routeKind: 'none' | 'target' | 'threshold-stop';
  grid: MovementGridPoint | null;
}

export interface MovementSnapshot {
  levelEpoch: number;
  phase: string;
  playerTwo: MovementPlayerTwoSnapshot | null;
}

export interface MoveAcceptance {
  seq: number;
  accepted: boolean;
  reason?: string;
  routeKind: 'none' | 'target' | 'threshold-stop';
  effectiveTarget: MovementGridPoint | null;
}

export type MovementOutcomeStatus =
  | 'accepted'
  | 'arrived'
  | 'threshold_stopped'
  | 'rejected'
  | 'timed_out'
  | 'unavailable'
  | 'superseded';

export interface MovementOutcome {
  status: MovementOutcomeStatus;
  seq: number;
  target: MovementGridPoint;
  effectiveTarget: MovementGridPoint | null;
  currentPosition: MovementGridPoint | null;
  phase: string;
  reason?: string;
}

export interface MovementTimer {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const systemTimer: MovementTimer = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface PendingMove {
  seq: number;
  target: MovementGridPoint;
  validArrivals: readonly MovementGridPoint[];
  waitUntil: 'accepted' | 'arrived';
  accepted: MoveAcceptance | null;
  resolve: (outcome: MovementOutcome) => void;
  timeout: unknown;
}

function samePoint(a: MovementGridPoint | null, b: MovementGridPoint | null): boolean {
  return a !== null && b !== null && a.x === b.x && a.y === b.y;
}

export class PlayerTwoMovementCoordinator {
  readonly #timer: MovementTimer;
  readonly #maxWaitMs: number;
  #snapshot: MovementSnapshot = { levelEpoch: -1, phase: 'unavailable', playerTwo: null };
  #epoch = -1;
  #lastIssuedSeq = -1;
  #pending: PendingMove | null = null;

  constructor(timer: MovementTimer = systemTimer, maxWaitMs = MAX_MOVEMENT_WAIT_MS) {
    this.#timer = timer;
    this.#maxWaitMs = Math.min(MAX_MOVEMENT_WAIT_MS, Math.max(0, maxWaitMs));
  }

  begin(
    snapshot: MovementSnapshot,
    target: MovementGridPoint,
    waitUntil: 'accepted' | 'arrived' = 'arrived',
    validArrivals: readonly MovementGridPoint[] = [],
  ): { seq: number; outcome: Promise<MovementOutcome> } {
    this.observe(snapshot);
    this.#settlePending('superseded', 'A newer movement command replaced this route.');
    const authoritative = snapshot.playerTwo?.lastMoveSeq ?? -1;
    const seq = Math.max(authoritative, this.#lastIssuedSeq) + 1;
    this.#lastIssuedSeq = seq;

    if (
      snapshot.playerTwo === null
      || !snapshot.playerTwo.connected
      || snapshot.phase !== 'playing'
    ) {
      return {
        seq,
        outcome: Promise.resolve(this.#outcome(
          'unavailable',
          seq,
          target,
          target,
          'Player 2 is not connected to a playing session.',
        )),
      };
    }

    let resolveOutcome!: (outcome: MovementOutcome) => void;
    const outcome = new Promise<MovementOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    const pending: PendingMove = {
      seq,
      target,
      validArrivals,
      waitUntil,
      accepted: null,
      resolve: resolveOutcome,
      timeout: undefined,
    };
    pending.timeout = this.#timer.schedule(() => {
      if (this.#pending !== pending) return;
      this.#pending = null;
      pending.resolve(this.#outcome(
        'timed_out',
        seq,
        target,
        pending.accepted?.effectiveTarget ?? target,
        'Movement did not settle within 15 seconds.',
      ));
    }, this.#maxWaitMs);
    this.#pending = pending;
    return { seq, outcome };
  }

  handleMoveResult(result: MoveAcceptance): boolean {
    const pending = this.#pending;
    if (pending === null || result.seq !== pending.seq) return false;
    if (!result.accepted) {
      this.#settlePending('rejected', result.reason ?? 'The game rejected the movement command.', result);
      return true;
    }
    pending.accepted = result;
    if (pending.waitUntil === 'accepted') this.#settlePending('accepted', undefined, result);
    return true;
  }

  observe(snapshot: MovementSnapshot): void {
    this.#snapshot = snapshot;
    if (snapshot.levelEpoch !== this.#epoch) {
      this.#settlePending(
        'superseded',
        'The level changed before this movement command settled.',
      );
      this.#epoch = snapshot.levelEpoch;
      this.#lastIssuedSeq = snapshot.playerTwo?.lastMoveSeq ?? -1;
    } else {
      this.#lastIssuedSeq = Math.max(
        this.#lastIssuedSeq,
        snapshot.playerTwo?.lastMoveSeq ?? -1,
      );
    }

    const pending = this.#pending;
    const player = snapshot.playerTwo;
    if (
      pending !== null
      && (snapshot.phase === 'abandoned' || player === null || !player.connected)
    ) {
      this.#settlePending('unavailable', 'Player 2 is no longer available.');
      return;
    }
    if (
      pending === null
      || pending.accepted === null
      || pending.waitUntil !== 'arrived'
      || player === null
      || (player.routeKind !== 'none' && snapshot.phase !== 'completed')
      || player.lastMoveSeq < pending.seq
    ) return;

    const destination = pending.accepted.routeKind === 'threshold-stop'
      ? pending.accepted.effectiveTarget
      : pending.validArrivals.find((candidate) => samePoint(player.grid, candidate))
        ?? (
          pending.validArrivals.length === 0
            ? pending.accepted.effectiveTarget ?? pending.target
            : null
        );
    if (!samePoint(player.grid, destination)) return;
    this.#settlePending(
      pending.accepted.routeKind === 'threshold-stop' ? 'threshold_stopped' : 'arrived',
      undefined,
      pending.accepted,
      destination,
    );
  }

  markUnavailable(reason = 'The Player 2 session became unavailable.'): void {
    this.#settlePending('unavailable', reason);
  }

  dispose(): void {
    this.markUnavailable('The Player 2 movement coordinator was disposed.');
  }

  #settlePending(
    status: MovementOutcomeStatus,
    reason?: string,
    acceptance?: MoveAcceptance,
    actualArrival?: MovementGridPoint | null,
  ): void {
    const pending = this.#pending;
    if (pending === null) return;
    this.#pending = null;
    this.#timer.cancel(pending.timeout);
    pending.resolve(this.#outcome(
      status,
      pending.seq,
      pending.target,
      status === 'arrived' && actualArrival !== undefined
        ? actualArrival
        : acceptance?.effectiveTarget ?? pending.accepted?.effectiveTarget ?? pending.target,
      reason,
    ));
  }

  #outcome(
    status: MovementOutcomeStatus,
    seq: number,
    target: MovementGridPoint,
    effectiveTarget: MovementGridPoint | null,
    reason?: string,
  ): MovementOutcome {
    return {
      status,
      seq,
      target,
      effectiveTarget,
      currentPosition: this.#snapshot.playerTwo?.grid ?? null,
      phase: this.#snapshot.phase,
      ...(reason === undefined ? {} : { reason }),
    };
  }
}
