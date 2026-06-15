import { describe, it, expect, vi } from 'vitest';
import { analyticsEnabled, track, identify, reset, initAnalytics } from '../analytics';
import { trackEvent, AnalyticsEvent } from '../analytics-events';

// In the test environment VITE_POSTHOG_KEY is unset, so analytics must be a
// fully inert no-op: no throws, no posthog-js load, no network. This guards the
// "nothing breaks without keys" contract dev/CI relies on.
describe('analytics (no key configured)', () => {
  it('reports disabled', () => {
    expect(analyticsEnabled).toBe(false);
  });

  it('track / identify / reset are safe no-ops', () => {
    expect(() => track('some_event', { a: 1 })).not.toThrow();
    expect(() => identify('user_123', { email: 'x@y.z' })).not.toThrow();
    expect(() => reset()).not.toThrow();
  });

  it('initAnalytics resolves without importing posthog-js', async () => {
    await expect(initAnalytics()).resolves.toBeUndefined();
  });

  it('does not touch the network', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    track(AnalyticsEvent.FIRST_MESSAGE_SENT, { sessionId: 's1', length: 5 });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('typed event taxonomy', () => {
  it('defines every funnel event with stable names', () => {
    expect(AnalyticsEvent.USER_SIGNED_UP).toBe('user_signed_up');
    expect(AnalyticsEvent.FIRST_MESSAGE_SENT).toBe('first_message_sent');
    expect(AnalyticsEvent.AHA_REACHED).toBe('aha_reached');
    expect(AnalyticsEvent.INTEGRATION_CONNECTED).toBe('integration_connected');
    expect(AnalyticsEvent.FIRST_TASK_CREATED).toBe('first_task_created');
    expect(AnalyticsEvent.ROUTINE_CREATED).toBe('routine_created');
    expect(AnalyticsEvent.ONBOARDING_STEP_COMPLETED).toBe('onboarding_step_completed');
    expect(AnalyticsEvent.INVITE_SENT).toBe('invite_sent');
    expect(AnalyticsEvent.INVITE_ACCEPTED).toBe('invite_accepted');
  });

  it('trackEvent is a safe no-op without a key', () => {
    expect(() =>
      trackEvent(AnalyticsEvent.INTEGRATION_CONNECTED, {
        provider: 'slack',
        kind: 'builtin',
      }),
    ).not.toThrow();
  });
});
