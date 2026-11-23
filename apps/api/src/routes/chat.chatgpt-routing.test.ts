import { describe, it, expect, vi, beforeEach } from 'vitest';

const svc = vi.hoisted(() => ({
  isChatGPTPlanEnabled: vi.fn(() => true),
  resolveChatRouting: vi.fn(),
  listPlanModels: vi.fn(),
}));
vi.mock('../services/chatgpt-plan-service.js', () => svc);

import { applyChatGPTPlanRouting } from './chat.js';

type Ctx = { model?: string; providerId?: string; llmUserId?: string };

beforeEach(() => {
  vi.clearAllMocks();
  svc.isChatGPTPlanEnabled.mockReturnValue(true);
  svc.resolveChatRouting.mockResolvedValue({ useChatGPTPlan: true, defaultModel: 'gpt-6.1-sol' });
  svc.listPlanModels.mockResolvedValue([{ id: 'first-model', displayName: 'First' }]);
});

describe('applyChatGPTPlanRouting', () => {
  it('routes to the sender’s plan when toggled on and no model was picked', async () => {
    const ctx: Ctx = {};
    await applyChatGPTPlanRouting(ctx, { payingUserId: 'sender' });
    expect(ctx).toEqual({ providerId: 'chatgpt-plan', llmUserId: 'sender', model: 'gpt-6.1-sol' });
    expect(svc.resolveChatRouting).toHaveBeenCalledWith('sender');
  });

  it('an explicit pick of another model always wins', async () => {
    const ctx: Ctx = { model: 'claude-sonnet', providerId: 'anthropic' };
    await applyChatGPTPlanRouting(ctx, {
      model: 'claude-sonnet',
      providerId: 'anthropic',
      payingUserId: 'u',
    });
    expect(ctx).toEqual({ model: 'claude-sonnet', providerId: 'anthropic' });
    expect(svc.resolveChatRouting).not.toHaveBeenCalled();
  });

  it('honors an explicit plan model', async () => {
    const ctx: Ctx = {};
    await applyChatGPTPlanRouting(ctx, {
      model: 'gpt-x',
      providerId: 'chatgpt-plan',
      payingUserId: 'u',
    });
    expect(ctx).toEqual({ providerId: 'chatgpt-plan', llmUserId: 'u', model: 'gpt-x' });
  });

  it('leaves the org default alone when the user has not opted in', async () => {
    svc.resolveChatRouting.mockResolvedValue({ useChatGPTPlan: false, defaultModel: null });
    const ctx: Ctx = {};
    await applyChatGPTPlanRouting(ctx, { payingUserId: 'u' });
    expect(ctx).toEqual({});
  });

  it('falls back to the first plan model when no default is saved', async () => {
    svc.resolveChatRouting.mockResolvedValue({ useChatGPTPlan: true, defaultModel: null });
    const ctx: Ctx = {};
    await applyChatGPTPlanRouting(ctx, { payingUserId: 'u' });
    expect(ctx.model).toBe('first-model');
  });

  it('strips a plan request when the feature is disabled on this server', async () => {
    svc.isChatGPTPlanEnabled.mockReturnValue(false);
    const ctx: Ctx = { providerId: 'chatgpt-plan', model: 'gpt-x' };
    await applyChatGPTPlanRouting(ctx, {
      model: 'gpt-x',
      providerId: 'chatgpt-plan',
      payingUserId: 'u',
    });
    expect(ctx).toEqual({});
  });
});
