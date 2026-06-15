import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ONBOARDING_STEPS } from '@hearth/shared';
import { STEP_META, runStepAction } from '../steps';

// These guard the load-bearing onboarding presentation logic without needing a
// React renderer (none is installed in web's test env): (1) every taxonomy step
// has presentation metadata, (2) connect_integration leads with aha copy, (3)
// runStepAction navigates for real steps and no-ops for the placeholder.

describe('onboarding step metadata', () => {
  it('covers every step in the shared taxonomy', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(STEP_META[step], `missing meta for ${step}`).toBeTruthy();
      expect(STEP_META[step].title).not.toEqual('');
      expect(STEP_META[step].cta).not.toEqual('');
    }
  });

  it('leads with the aha: connect_integration nudges pulling tasks + context', () => {
    const meta = STEP_META.connect_integration;
    expect(meta.action).toEqual({ kind: 'navigate', hash: '/integrations' });
    expect(meta.description.toLowerCase()).toContain('pull');
  });

  it('renders invite_teammate as a placeholder (P2 wires real invites)', () => {
    expect(STEP_META.invite_teammate.action.kind).toBe('placeholder');
  });
});

describe('runStepAction', () => {
  beforeEach(() => {
    window.location.hash = '';
    vi.useFakeTimers();
  });

  it('navigates via hash for a real step and reports navigated=true', () => {
    const navigated = runStepAction('set_preferences');
    expect(navigated).toBe(true);
    expect(window.location.hash).toBe('#/settings/profile');
  });

  it('fires the page event for steps that declare one', () => {
    const handler = vi.fn();
    window.addEventListener('hearth:focus-composer', handler);
    const navigated = runStepAction('first_chat');
    expect(navigated).toBe(true);
    expect(window.location.hash).toBe('#/chat');
    // Event is dispatched on a short delay so the target page is mounted.
    vi.runAllTimers();
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('hearth:focus-composer', handler);
  });

  it('does not navigate for the placeholder step', () => {
    const navigated = runStepAction('invite_teammate');
    expect(navigated).toBe(false);
    expect(window.location.hash).toBe('');
  });
});
