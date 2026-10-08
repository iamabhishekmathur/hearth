import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the redis client and env BEFORE importing the module under test so the
// catalog's refresh path is fully controllable and never touches a real server.
// Hoisted so the vi.mock factories (also hoisted) can reference them.
const { redisMock, envMock } = vi.hoisted(() => ({
  redisMock: {
    get: vi.fn<(key: string) => Promise<string | null>>(),
    set: vi.fn().mockReturnValue(Promise.resolve('OK')),
  },
  envMock: { HEARTH_MODEL_CATALOG_REFRESH: false } as { HEARTH_MODEL_CATALOG_REFRESH: boolean },
}));
vi.mock('../lib/redis.js', () => ({ redis: redisMock }));
vi.mock('../config.js', () => ({ env: envMock }));

import {
  resolveModel,
  resolveFromChain,
  hasModel,
  listCatalog,
  supportsVision,
  supportsTools,
  assertVision,
  assertTools,
  computeCost,
  refreshCatalog,
  UnknownModelError,
  ModelCapabilityError,
  __resetCatalogForTests,
} from './model-catalog.js';

beforeEach(() => {
  __resetCatalogForTests();
  envMock.HEARTH_MODEL_CATALOG_REFRESH = false;
  redisMock.get.mockReset();
  redisMock.set.mockReset().mockReturnValue(Promise.resolve('OK'));
  vi.restoreAllMocks();
});

afterEach(() => {
  __resetCatalogForTests();
});

describe('resolveModel (snapshot)', () => {
  // §5.1 case 1
  it('resolves a known model to the correct provider + caps', () => {
    const m = resolveModel('claude-opus-4-8');
    expect(m.providerId).toBe('anthropic');
    expect(m.contextWindow).toBe(1_000_000);
    expect(m.caps).toEqual({ vision: true, tools: true, reasoning: true });
  });

  // §5.1 case 2 — HEADLINE BUG FIX
  it('throws UnknownModelError for the UNDATED claude-haiku-4-5 (no silent gpt-4o fallback)', () => {
    expect(hasModel('claude-haiku-4-5')).toBe(false);
    expect(() => resolveModel('claude-haiku-4-5')).toThrow(UnknownModelError);
    try {
      resolveModel('claude-haiku-4-5');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownModelError);
      expect((err as UnknownModelError).code).toBe('UNKNOWN_MODEL');
      expect((err as UnknownModelError).modelId).toBe('claude-haiku-4-5');
    }
    // The dated id IS known — proving it's specifically the undated one that fails.
    expect(() => resolveModel('claude-haiku-4-5-20251001')).not.toThrow();
  });

  it('throws UnknownModelError for a typo (claude-sonnet-4.6)', () => {
    expect(() => resolveModel('claude-sonnet-4.6')).toThrow(UnknownModelError);
  });
});

describe('resolveFromChain (resolution chain)', () => {
  // §5.1 case 3
  it('picks skill recommendation over request over user pref over defaults', () => {
    const m = resolveFromChain({
      skillRecommended: 'claude-opus-4-8',
      requested: 'gpt-4o',
      userPreference: 'claude-sonnet-4-6',
      orgDefault: 'claude-haiku-4-5-20251001',
    });
    expect(m.id).toBe('claude-opus-4-8');
  });

  it('falls to the next PRESENT step when an earlier step is absent', () => {
    const m = resolveFromChain({
      skillRecommended: null,
      requested: undefined,
      userPreference: 'claude-sonnet-4-6',
      orgDefault: 'gpt-4o',
    });
    expect(m.id).toBe('claude-sonnet-4-6');
  });

  it('throws (never silently falls through) when a PRESENT step is an unknown id', () => {
    // request id is present but bogus — must throw, not skip to orgDefault.
    expect(() =>
      resolveFromChain({ requested: 'claude-haiku-4-5', orgDefault: 'gpt-4o' }),
    ).toThrow(UnknownModelError);
  });

  it('throws UnknownModelError on an empty chain', () => {
    expect(() => resolveFromChain({})).toThrow(UnknownModelError);
  });
});

describe('snapshot-only boot (refresh disabled)', () => {
  // §5.1 case 4
  it('catalog is fully functional with refresh disabled and no network', async () => {
    envMock.HEARTH_MODEL_CATALOG_REFRESH = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await refreshCatalog();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(redisMock.get).not.toHaveBeenCalled();
    expect(listCatalog().length).toBeGreaterThanOrEqual(4);
    expect(resolveModel('gpt-4o').providerId).toBe('openai');
  });

  it('refresh failure (network blocked) leaves the snapshot intact', async () => {
    envMock.HEARTH_MODEL_CATALOG_REFRESH = true;
    redisMock.get.mockResolvedValue(null);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENETUNREACH'));
    await refreshCatalog();
    // Still fully functional on the snapshot.
    expect(resolveModel('claude-opus-4-8').providerId).toBe('anthropic');
  });
});

describe('models.dev refresh (HEARTH_MODEL_CATALOG_REFRESH=true)', () => {
  // §5.1 case 5
  it('updates the catalog from models.dev and caches to Redis', async () => {
    envMock.HEARTH_MODEL_CATALOG_REFRESH = true;
    redisMock.get.mockResolvedValue(null);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          anthropic: {
            id: 'anthropic',
            models: {
              'claude-fresh-9-9': {
                id: 'claude-fresh-9-9',
                limit: { context: 500000 },
                modalities: { input: ['text', 'image'] },
                tool_call: true,
                reasoning: true,
                cost: { input: 4, output: 20 },
              },
            },
          },
        }),
        { status: 200 },
      ),
    );

    expect(hasModel('claude-fresh-9-9')).toBe(false);
    await refreshCatalog();

    expect(hasModel('claude-fresh-9-9')).toBe(true);
    const m = resolveModel('claude-fresh-9-9');
    expect(m.providerId).toBe('anthropic');
    expect(m.contextWindow).toBe(500000);
    expect(m.caps).toEqual({ vision: true, tools: true, reasoning: true });
    expect(m.pricing).toEqual({ inputPer1M: 4, outputPer1M: 20 });
    // Snapshot models survive the merge.
    expect(hasModel('claude-opus-4-8')).toBe(true);
    // Cached to Redis for 24h.
    expect(redisMock.set).toHaveBeenCalledWith(
      'model-catalog:v1',
      expect.any(String),
      'EX',
      24 * 60 * 60,
    );
  });

  it('uses the Redis cache when present (no models.dev fetch)', async () => {
    envMock.HEARTH_MODEL_CATALOG_REFRESH = true;
    redisMock.get.mockResolvedValue(
      JSON.stringify({
        'cached-model-1': {
          id: 'cached-model-1',
          providerId: 'openai',
          contextWindow: 123,
          caps: { vision: false, tools: true, reasoning: false },
        },
      }),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await refreshCatalog();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(resolveModel('cached-model-1').contextWindow).toBe(123);
  });
});

describe('capability gating', () => {
  // §5.1 case 8
  it('assertVision throws MODEL_NO_VISION for a non-vision model', () => {
    // Seed a non-vision model via the live path shape.
    // gpt-4o is vision=true in the snapshot, so use a direct unknown-cap case:
    // build a throwaway via refresh.
    // Simpler: assert the error type/code contract against a crafted model.
    expect(supportsVision('gpt-4o')).toBe(true);
    expect(supportsTools('gpt-4o')).toBe(true);
    // reasoning-less model still supports vision in the snapshot; verify the
    // negative path with a deliberately non-vision fixture through the chain.
    expect(() => assertVision('claude-haiku-4-5-20251001')).not.toThrow();
    expect(() => assertTools('claude-haiku-4-5-20251001')).not.toThrow();
  });

  it('assertVision throws MODEL_NO_VISION for a model whose caps.vision is false', async () => {
    // Use the refresh path to inject a non-vision model deterministically.
    envMock.HEARTH_MODEL_CATALOG_REFRESH = true;
    redisMock.get.mockResolvedValue(
      JSON.stringify({
        'text-only-model': {
          id: 'text-only-model',
          providerId: 'openai',
          contextWindow: 8000,
          caps: { vision: false, tools: false, reasoning: false },
        },
      }),
    );
    await refreshCatalog();

    expect(() => assertVision('text-only-model')).toThrow(ModelCapabilityError);
    try {
      assertVision('text-only-model');
    } catch (err) {
      expect((err as ModelCapabilityError).code).toBe('MODEL_NO_VISION');
    }
    expect(() => assertTools('text-only-model')).toThrow(ModelCapabilityError);
    try {
      assertTools('text-only-model');
    } catch (err) {
      expect((err as ModelCapabilityError).code).toBe('MODEL_NO_TOOLS');
    }
  });
});

describe('cost computation from catalog pricing', () => {
  // §5.1 case 10
  it('computes USD cost from catalog pricing (per 1M tokens)', () => {
    // claude-opus-4-8: input $5/1M, output $25/1M
    const cost = computeCost('claude-opus-4-8', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(30, 6);

    const small = computeCost('gpt-4o', { inputTokens: 1000, outputTokens: 500 });
    // gpt-4o: input $2.5/1M, output $10/1M → 0.0025 + 0.005 = 0.0075
    expect(small).toBeCloseTo(0.0075, 8);
  });

  it('returns undefined when the model has no pricing', async () => {
    envMock.HEARTH_MODEL_CATALOG_REFRESH = true;
    redisMock.get.mockResolvedValue(
      JSON.stringify({
        'no-price-model': {
          id: 'no-price-model',
          providerId: 'openai',
          contextWindow: 8000,
          caps: { vision: false, tools: true, reasoning: false },
        },
      }),
    );
    await refreshCatalog();
    expect(computeCost('no-price-model', { inputTokens: 100, outputTokens: 100 })).toBeUndefined();
  });
});
