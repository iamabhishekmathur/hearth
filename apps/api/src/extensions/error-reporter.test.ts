import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('error-reporter extension hook', () => {
  // The reporter slot is a module-level singleton. Reset modules between
  // tests so each spec starts from the pristine `null` default.
  beforeEach(() => {
    vi.resetModules();
  });

  it('captureError is a no-op when no reporter is registered', async () => {
    const { captureError, getErrorReporter } = await import('./error-reporter.js');
    expect(getErrorReporter()).toBeNull();
    // Should not throw.
    expect(() => captureError(new Error('boom'), { url: '/x' })).not.toThrow();
  });

  it('dispatches the error and context to the registered reporter', async () => {
    const { setErrorReporter, captureError } = await import('./error-reporter.js');
    const spy = vi.fn();
    setErrorReporter(spy);

    const err = new Error('kaboom');
    const ctx = { url: '/api/v1/foo', method: 'POST', userId: 'u1', orgId: 'o1' };
    captureError(err, ctx);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(err, ctx);
  });

  it('swallows reporter exceptions so app paths are never disrupted', async () => {
    const { setErrorReporter, captureError } = await import('./error-reporter.js');
    const throwing = vi.fn(() => {
      throw new Error('reporter exploded');
    });
    setErrorReporter(throwing);

    expect(() => captureError(new Error('original'))).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
  });
});
