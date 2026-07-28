import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PAIRING_TOKEN_TTL_MS,
  PairingTokenGate,
  createPairingToken,
} from '../../../src/server/pairing.ts';

describe('pairing token gate', () => {
  it('creates a random 32-byte token with a ten-minute hash-only gate contract', () => {
    const first = createPairingToken(1_000);
    const second = createPairingToken(1_000);

    expect(Buffer.from(first.token, 'base64url')).toHaveLength(32);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(
      createHash('sha256').update(first.token, 'utf8').digest('hex'),
    );
    expect(first.expiresAt).toBe(1_000 + PAIRING_TOKEN_TTL_MS);
  });

  it('atomically reserves one claimant and consumes only after seat assignment', () => {
    const created = createPairingToken(1_000);
    const gate = new PairingTokenGate(created.tokenHash, created.expiresAt);

    expect(gate.claim(created.token, 'session-a', 1_001)).toEqual({ accepted: true });
    expect(gate.claim(created.token, 'session-a', 1_001)).toEqual({ accepted: true });
    expect(gate.claim(created.token, 'session-b', 1_001)).toEqual({
      accepted: false,
      reason: 'already-claimed',
    });
    expect(gate.consumed).toBe(false);
    expect(gate.consumeClaim('session-b', 1_001)).toEqual({
      accepted: false,
      reason: 'claim-mismatch',
    });
    expect(gate.consumeClaim('session-a', 1_001)).toEqual({ accepted: true });
    expect(gate.consumed).toBe(true);
    expect(gate.consumeClaim('session-a', 1_001)).toEqual({
      accepted: false,
      reason: 'reused',
    });
  });

  it('does not consume missing, invalid, or expired claims', () => {
    const created = createPairingToken(1_000);
    const gate = new PairingTokenGate(created.tokenHash, created.expiresAt);
    expect(gate.claim(undefined, 'session-a', 1_001)).toEqual({
      accepted: false,
      reason: 'missing',
    });
    expect(gate.claim('wrong-token', 'session-a', 1_001)).toEqual({
      accepted: false,
      reason: 'invalid',
    });
    expect(gate.claim(created.token, 'session-a', created.expiresAt)).toEqual({
      accepted: false,
      reason: 'expired',
    });
    expect(gate.consumeClaim('session-a', 1_001)).toEqual({
      accepted: false,
      reason: 'not-claimed',
    });
    expect(gate.consumed).toBe(false);
  });

  it('expires a successful reservation before it can be consumed', () => {
    const created = createPairingToken(1_000);
    const gate = new PairingTokenGate(created.tokenHash, created.expiresAt);
    expect(gate.claim(created.token, 'session-a', 1_001)).toEqual({ accepted: true });
    expect(gate.consumeClaim('session-a', created.expiresAt)).toEqual({
      accepted: false,
      reason: 'expired',
    });
    expect(gate.consumed).toBe(false);
  });
});
