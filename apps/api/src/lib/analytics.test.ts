import { describe, it, expect } from 'vitest';
import { analyticsEnabled, capture, shutdownAnalytics } from './analytics.js';

// POSTHOG_API_KEY is unset in the test env, so server analytics must be a fully
// inert no-op: no posthog-node client constructed, no throws, no flush.
describe('server analytics (no key configured)', () => {
  it('reports disabled', () => {
    expect(analyticsEnabled).toBe(false);
  });

  it('capture is a safe no-op', async () => {
    await expect(
      capture('user_123', 'invite_accepted', { inviteId: 'inv_1' }),
    ).resolves.toBeUndefined();
  });

  it('shutdownAnalytics is a safe no-op', async () => {
    await expect(shutdownAnalytics()).resolves.toBeUndefined();
  });
});
