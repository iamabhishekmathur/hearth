import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Pin env so the org-provider check is deterministic regardless of the ambient
// shell (a real ANTHROPIC/OPENAI key exported locally would otherwise satisfy
// configure_llm and skew the role-gating assertions).
vi.mock('../config.js', () => ({
  env: { ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, OLLAMA_BASE_URL: undefined },
}));

import { prisma } from '../lib/prisma.js';
import {
  normalizeState,
  computeNextStep,
  computeNeedsOnboarding,
  toStatus,
  getState,
  getStatus,
  startOnboarding,
  setWelcome,
  markStepComplete,
  dismiss,
} from './onboarding-service.js';
import { ONBOARDING_STEPS, type OnboardingState } from '@hearth/shared';

const findUnique = prisma.user.findUnique as ReturnType<typeof vi.fn>;
const update = prisma.user.update as ReturnType<typeof vi.fn>;

const USER = 'user_1';

/**
 * Wire the prisma mock to an in-memory onboardingState so service helpers
 * exercise the full load → merge → persist cycle. Returns a getter for the
 * current stored value. `role`/`orgSettings` back the role-scoped getStatus
 * computation; defaults model an admin whose org has no provider yet (so the
 * admin-only `configure_llm` step leads the funnel).
 */
function withStoredState(
  initial: unknown,
  opts: { role?: string; orgSettings?: unknown } = {},
) {
  const { role = 'admin', orgSettings = {} } = opts;
  let stored: unknown = initial;
  findUnique.mockImplementation(async () => ({
    onboardingState: stored,
    role,
    team: { org: { settings: orgSettings } },
  }));
  update.mockImplementation(async ({ data }: { data: { onboardingState: unknown } }) => {
    stored = data.onboardingState;
    return { id: USER, onboardingState: stored };
  });
  return () => stored as OnboardingState;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('normalizeState', () => {
  it('treats empty object as not-started with empty completedSteps', () => {
    expect(normalizeState({})).toEqual({ completedSteps: [] });
  });

  it('treats null / non-object / array as empty', () => {
    expect(normalizeState(null)).toEqual({ completedSteps: [] });
    expect(normalizeState('nope')).toEqual({ completedSteps: [] });
    expect(normalizeState(['x'])).toEqual({ completedSteps: [] });
  });

  it('drops unknown steps and dedupes known ones', () => {
    const state = normalizeState({
      completedSteps: ['first_chat', 'bogus', 'first_chat', 'first_task'],
    });
    expect(state.completedSteps).toEqual(['first_chat', 'first_task']);
  });

  it('preserves startedAt, dismissedAt, and welcome.goal', () => {
    const state = normalizeState({
      startedAt: '2026-06-15T00:00:00.000Z',
      dismissedAt: '2026-06-16T00:00:00.000Z',
      welcome: { goal: 'ship faster' },
      completedSteps: [],
    });
    expect(state.startedAt).toBe('2026-06-15T00:00:00.000Z');
    expect(state.dismissedAt).toBe('2026-06-16T00:00:00.000Z');
    expect(state.welcome).toEqual({ goal: 'ship faster' });
  });
});

describe('computeNextStep', () => {
  it('returns the first step when nothing is complete', () => {
    expect(computeNextStep({ completedSteps: [] })).toBe(ONBOARDING_STEPS[0]);
  });

  it('returns the first incomplete step in taxonomy order', () => {
    // Complete the first step; next should be the second.
    expect(computeNextStep({ completedSteps: [ONBOARDING_STEPS[0]] })).toBe(ONBOARDING_STEPS[1]);
  });

  it('returns null when every step is complete', () => {
    expect(computeNextStep({ completedSteps: [...ONBOARDING_STEPS] })).toBeNull();
  });
});

describe('computeNeedsOnboarding', () => {
  it('is true with incomplete steps and no dismissal', () => {
    expect(computeNeedsOnboarding({ completedSteps: [] })).toBe(true);
  });

  it('is false once dismissed even with incomplete steps', () => {
    expect(
      computeNeedsOnboarding({ completedSteps: [], dismissedAt: '2026-06-15T00:00:00.000Z' }),
    ).toBe(false);
  });

  it('is false when all steps complete and not dismissed', () => {
    expect(computeNeedsOnboarding({ completedSteps: [...ONBOARDING_STEPS] })).toBe(false);
  });
});

describe('toStatus', () => {
  it('bundles normalized state with computed fields', () => {
    expect(toStatus({})).toEqual({
      state: { completedSteps: [] },
      nextStep: ONBOARDING_STEPS[0],
      needsOnboarding: true,
    });
  });
});

describe('getState / getStatus', () => {
  it('getState normalizes the stored value', async () => {
    withStoredState({ completedSteps: ['first_chat', 'junk'] });
    const state = await getState(USER);
    expect(state.completedSteps).toEqual(['first_chat']);
  });

  it('getStatus returns computed nextStep + needsOnboarding', async () => {
    withStoredState({});
    const status = await getStatus(USER);
    expect(status.nextStep).toBe(ONBOARDING_STEPS[0]);
    expect(status.needsOnboarding).toBe(true);
  });

  it('for an admin with no provider, configure_llm leads the funnel', async () => {
    withStoredState({}, { role: 'admin', orgSettings: {} });
    const status = await getStatus(USER);
    expect(status.nextStep).toBe('configure_llm');
  });

  it('hides the admin-only configure_llm step from members', async () => {
    withStoredState({}, { role: 'member', orgSettings: {} });
    const status = await getStatus(USER);
    expect(status.nextStep).toBe('connect_integration');
    expect(status.needsOnboarding).toBe(true);
  });

  it('folds out configure_llm for an admin whose org already has a key', async () => {
    withStoredState(
      {},
      { role: 'admin', orgSettings: { llm: { encryptedKeys: { anthropic: 'enc' } } } },
    );
    const status = await getStatus(USER);
    expect(status.nextStep).toBe('connect_integration');
  });

  it('throws when the user does not exist', async () => {
    findUnique.mockResolvedValue(null);
    await expect(getState(USER)).rejects.toThrow('User not found');
  });
});

describe('startOnboarding', () => {
  it('sets startedAt on first call', async () => {
    const read = withStoredState({});
    await startOnboarding(USER);
    expect(typeof read().startedAt).toBe('string');
  });

  it('is idempotent — does not reset startedAt on repeat', async () => {
    const read = withStoredState({});
    await startOnboarding(USER);
    const first = read().startedAt;
    await startOnboarding(USER);
    expect(read().startedAt).toBe(first);
  });
});

describe('setWelcome', () => {
  it('captures the goal and implicitly starts onboarding', async () => {
    const read = withStoredState({});
    await setWelcome(USER, { goal: 'automate standups' });
    expect(read().welcome).toEqual({ goal: 'automate standups' });
    expect(typeof read().startedAt).toBe('string');
  });

  it('does not clobber completed steps', async () => {
    const read = withStoredState({ completedSteps: ['first_chat'] });
    await setWelcome(USER, { goal: 'x' });
    expect(read().completedSteps).toEqual(['first_chat']);
  });
});

describe('markStepComplete', () => {
  it('adds a step and starts onboarding implicitly', async () => {
    const read = withStoredState({});
    await markStepComplete(USER, 'first_chat');
    expect(read().completedSteps).toEqual(['first_chat']);
    expect(typeof read().startedAt).toBe('string');
  });

  it('is idempotent — no duplicate entries', async () => {
    const read = withStoredState({ completedSteps: ['first_chat'] });
    await markStepComplete(USER, 'first_chat');
    expect(read().completedSteps).toEqual(['first_chat']);
  });

  it('accumulates distinct steps without losing prior progress', async () => {
    const read = withStoredState({ completedSteps: ['first_chat'] });
    await markStepComplete(USER, 'first_task');
    expect(read().completedSteps).toEqual(['first_chat', 'first_task']);
  });

  it('rejects an invalid step', async () => {
    withStoredState({});
    // @ts-expect-error — intentionally passing an invalid step
    await expect(markStepComplete(USER, 'not_a_step')).rejects.toThrow('Invalid onboarding step');
  });
});

describe('dismiss', () => {
  it('sets dismissedAt and flips needsOnboarding to false', async () => {
    const read = withStoredState({ completedSteps: [] });
    await dismiss(USER);
    expect(typeof read().dismissedAt).toBe('string');
    expect(computeNeedsOnboarding(read())).toBe(false);
  });

  it('preserves progress when dismissing', async () => {
    const read = withStoredState({ completedSteps: ['first_chat', 'first_task'] });
    await dismiss(USER);
    expect(read().completedSteps).toEqual(['first_chat', 'first_task']);
  });

  it('is idempotent — does not overwrite an existing dismissal', async () => {
    const read = withStoredState({
      completedSteps: [],
      dismissedAt: '2026-06-01T00:00:00.000Z',
    });
    await dismiss(USER);
    expect(read().dismissedAt).toBe('2026-06-01T00:00:00.000Z');
  });
});
