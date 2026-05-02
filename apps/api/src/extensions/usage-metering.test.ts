import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UsageRecorder } from './usage-metering.js';

describe('usage-metering extension hook', () => {
  // The recorder slot is a module-level singleton. Reset modules between
  // tests so each spec starts from the pristine `null` default.
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null by default before any recorder is registered', async () => {
    const { getUsageRecorder } = await import('./usage-metering.js');
    expect(getUsageRecorder()).toBeNull();
  });

  it('returns the registered function after setUsageRecorder', async () => {
    const { setUsageRecorder, getUsageRecorder } = await import('./usage-metering.js');
    const fn: UsageRecorder = async () => {};
    setUsageRecorder(fn);
    expect(getUsageRecorder()).toBe(fn);
  });

  it('replaces the previously registered recorder on subsequent set', async () => {
    const { setUsageRecorder, getUsageRecorder } = await import('./usage-metering.js');
    const first: UsageRecorder = async () => {};
    const second: UsageRecorder = async () => {};
    setUsageRecorder(first);
    expect(getUsageRecorder()).toBe(first);
    setUsageRecorder(second);
    expect(getUsageRecorder()).toBe(second);
    expect(getUsageRecorder()).not.toBe(first);
  });
});
