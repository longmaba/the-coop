import { describe, expect, it, vi } from 'vitest';
import {
  cleanupOwnedBrowserLifecycle,
  ownsBrowserLifecycle,
} from '../../../src/client/lifecycle.ts';

describe('browser lifecycle ownership', () => {
  it('rejects stale callbacks by generation and exact network identity', () => {
    const current = {};
    const stale = {};
    expect(ownsBrowserLifecycle(3, current, 3, current)).toBe(true);
    expect(ownsBrowserLifecycle(4, current, 3, current)).toBe(false);
    expect(ownsBrowserLifecycle(3, current, 3, stale)).toBe(false);
  });

  it('does not let a stale failure clean up a newer lifecycle', () => {
    const current = {};
    const stale = {};
    const cleanup = vi.fn();

    expect(cleanupOwnedBrowserLifecycle(7, current, 6, stale, cleanup)).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
    expect(cleanupOwnedBrowserLifecycle(7, current, 7, current, cleanup)).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
