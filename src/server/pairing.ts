import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const PAIRING_TOKEN_TTL_MS = 10 * 60 * 1_000;

export interface CreatedPairingToken {
  token: string;
  tokenHash: string;
  expiresAt: number;
}

export type PairingGateResult =
  | { accepted: true }
  | {
    accepted: false;
    reason:
      | 'missing'
      | 'expired'
      | 'reused'
      | 'invalid'
      | 'already-claimed'
      | 'claim-mismatch'
      | 'not-claimed';
  };

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function createPairingToken(now = Date.now()): CreatedPairingToken {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashToken(token).toString('hex'),
    expiresAt: now + PAIRING_TOKEN_TTL_MS,
  };
}

/**
 * Single-use, synchronous claim gate. The room keeps this hash-only object and
 * never needs to retain the browser-facing pairing token.
 */
export class PairingTokenGate {
  readonly #tokenHash: Buffer;
  readonly #expiresAt: number;
  #claimantId: string | null = null;
  #consumed = false;

  constructor(tokenHash: string, expiresAt: number) {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) {
      throw new TypeError('Pairing token hash must be a lowercase SHA-256 hex digest.');
    }
    if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) {
      throw new TypeError('Pairing token expiry must be a non-negative integer timestamp.');
    }
    this.#tokenHash = Buffer.from(tokenHash, 'hex');
    this.#expiresAt = expiresAt;
  }

  get expiresAt(): number {
    return this.#expiresAt;
  }

  get consumed(): boolean {
    return this.#consumed;
  }

  /**
   * Reserves a valid token for exactly one join attempt during authorization.
   * Calling this again for the same claimant is idempotent.
   */
  claim(token: unknown, claimantId: string, now = Date.now()): PairingGateResult {
    if (typeof token !== 'string' || token.length === 0) {
      return { accepted: false, reason: 'missing' };
    }
    if (claimantId.length === 0) return { accepted: false, reason: 'claim-mismatch' };
    if (this.#consumed) return { accepted: false, reason: 'reused' };
    if (now >= this.#expiresAt) return { accepted: false, reason: 'expired' };
    if (this.#claimantId !== null) {
      return this.#claimantId === claimantId
        ? { accepted: true }
        : { accepted: false, reason: 'already-claimed' };
    }

    const candidateHash = hashToken(token);
    if (
      candidateHash.length !== this.#tokenHash.length
      || !timingSafeEqual(candidateHash, this.#tokenHash)
    ) {
      return { accepted: false, reason: 'invalid' };
    }

    this.#claimantId = claimantId;
    return { accepted: true };
  }

  /** Consumes the reserved token only after the authorized seat is assigned. */
  consumeClaim(claimantId: string, now = Date.now()): PairingGateResult {
    if (this.#consumed) return { accepted: false, reason: 'reused' };
    if (now >= this.#expiresAt) return { accepted: false, reason: 'expired' };
    if (this.#claimantId === null) return { accepted: false, reason: 'not-claimed' };
    if (this.#claimantId !== claimantId) {
      return { accepted: false, reason: 'claim-mismatch' };
    }

    this.#consumed = true;
    this.#claimantId = null;
    return { accepted: true };
  }
}
