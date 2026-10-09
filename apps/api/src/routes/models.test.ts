import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CatalogModel, UserRole } from '@hearth/shared';

// Mock env + prisma BEFORE importing the module under test. The catalog itself
// is driven via its test seam (`__setCatalogForTests`), which is unaffected by
// these mocks (it never reads env/redis in the snapshot-only path).
const { envMock, prismaMock } = vi.hoisted(() => ({
  envMock: {} as Record<string, string | undefined>,
  prismaMock: { org: { findUnique: vi.fn() } },
}));
vi.mock('../config.js', () => ({ env: envMock }));
vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));
// The catalog module imports redis — stub it so nothing touches a real server.
vi.mock('../lib/redis.js', () => ({ redis: { get: vi.fn(), set: vi.fn() } }));

import {
  enabledProviderIds,
  costHintFor,
  isModelAllowedForRole,
  assertModelAllowed,
  buildModelPickerEntries,
  getOrgLlmSettings,
  ModelNotAllowedError,
  type OrgLlmSettings,
} from './models.js';
import {
  __setCatalogForTests,
  __resetCatalogForTests,
  UnknownModelError,
  ModelCapabilityError,
} from '../llm/model-catalog.js';

// ── Fixtures (mirror plans §6.2) ────────────────────────────────────────────

const OPUS: CatalogModel = {
  id: 'claude-opus-4-8',
  providerId: 'anthropic',
  contextWindow: 1_000_000,
  caps: { vision: true, tools: true, reasoning: true },
  pricing: { inputPer1M: 5, outputPer1M: 25 },
};
const SONNET: CatalogModel = {
  id: 'claude-sonnet-4-6',
  providerId: 'anthropic',
  contextWindow: 1_000_000,
  caps: { vision: true, tools: true, reasoning: true },
  pricing: { inputPer1M: 3, outputPer1M: 15 },
};
const HAIKU: CatalogModel = {
  id: 'claude-haiku-4-5-20251001',
  providerId: 'anthropic',
  contextWindow: 200_000,
  caps: { vision: true, tools: true, reasoning: false },
  pricing: { inputPer1M: 1, outputPer1M: 5 },
};
const GPT4O: CatalogModel = {
  id: 'gpt-4o',
  providerId: 'openai',
  contextWindow: 128_000,
  caps: { vision: true, tools: true, reasoning: false },
  pricing: { inputPer1M: 2.5, outputPer1M: 10 },
};
// A non-vision local model on a provider that is NOT enabled in most fixtures.
const LLAMA: CatalogModel = {
  id: 'llama3.1',
  providerId: 'ollama',
  contextWindow: 128_000,
  caps: { vision: false, tools: true, reasoning: false },
};

const ALL = [OPUS, SONNET, HAIKU, GPT4O, LLAMA];

/** Org settings: anthropic+openai enabled (keys present), allowlist from §6.2. */
function orgSettings(overrides: Partial<OrgLlmSettings> = {}): { llm: OrgLlmSettings } {
  return {
    llm: {
      encryptedKeys: { anthropic: 'enc', openai: 'enc' },
      allowlist: {
        member: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
        admin: '*',
      },
      ...overrides,
    },
  };
}

const NO_ENV = new Set<string>(); // no env-configured providers in tests

beforeEach(() => {
  __setCatalogForTests(ALL);
  prismaMock.org.findUnique.mockReset();
  for (const k of Object.keys(envMock)) delete envMock[k];
});
afterEach(() => __resetCatalogForTests());

// ── enabledProviderIds ───────────────────────────────────────────────────────

describe('enabledProviderIds', () => {
  it('derives enabled providers from encryptedKeys + env', () => {
    const llm = getOrgLlmSettings(orgSettings());
    const ids = enabledProviderIds(llm, NO_ENV);
    expect([...ids].sort()).toEqual(['anthropic', 'openai']);
  });

  it('honours an explicit providers[] config (only enabled:true count)', () => {
    const llm: OrgLlmSettings = {
      providers: [
        { provider: 'anthropic', enabled: true, models: [] },
        { provider: 'openai', enabled: false, models: [] },
        { provider: 'ollama', enabled: false, models: [] },
      ],
    };
    expect([...enabledProviderIds(llm, NO_ENV)]).toEqual(['anthropic']);
  });

  it('unions env-configured providers when no explicit config', () => {
    const llm: OrgLlmSettings = { encryptedKeys: { anthropic: 'enc' } };
    const ids = enabledProviderIds(llm, new Set(['openai']));
    expect([...ids].sort()).toEqual(['anthropic', 'openai']);
  });
});

// ── costHint ─────────────────────────────────────────────────────────────────

describe('costHintFor', () => {
  it('maps frontier models to $$$ and cheap ones to $ (undefined if unpriced)', () => {
    expect(costHintFor('claude-opus-4-8')).toBe('$$$'); // 5+25 = 30
    expect(costHintFor('claude-sonnet-4-6')).toBe('$$$'); // 3+15 = 18 (>= 18)
    expect(costHintFor('gpt-4o')).toBe('$$'); // 2.5+10 = 12.5
    expect(costHintFor('claude-haiku-4-5-20251001')).toBe('$'); // 1+5 = 6
    expect(costHintFor('llama3.1')).toBeUndefined(); // no pricing
  });
});

// ── allowlist + role gating ────────────────────────────────────────────────

describe('isModelAllowedForRole', () => {
  const llm = getOrgLlmSettings(orgSettings());

  it('member allowed only for allowlisted ids', () => {
    expect(isModelAllowedForRole(llm, 'member', 'claude-sonnet-4-6')).toBe(true);
    expect(isModelAllowedForRole(llm, 'member', 'claude-opus-4-8')).toBe(false);
  });

  it("admin '*' is allowed everything", () => {
    expect(isModelAllowedForRole(llm, 'admin', 'claude-opus-4-8')).toBe(true);
  });

  it('defaults to allowed when no allowlist entry for the role', () => {
    const open = getOrgLlmSettings(orgSettings({ allowlist: {} }));
    expect(isModelAllowedForRole(open, 'member', 'claude-opus-4-8')).toBe(true);
  });
});

// ── §5.1 case 31: GET /models returns enabled + allowlisted with caps/cost ──

describe('buildModelPickerEntries (API case 31)', () => {
  it('omits disabled-provider models, flags allowlist, attaches caps + cost', () => {
    const entries = buildModelPickerEntries({
      catalog: ALL,
      settings: orgSettings(),
      role: 'member',
    });
    // ollama is NOT enabled → llama3.1 omitted entirely.
    expect(entries.map((e) => e.id).sort()).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'gpt-4o',
    ]);

    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    // Allowlisted for member.
    expect(byId['claude-sonnet-4-6'].allowedForRole).toBe(true);
    // In-catalog + enabled provider but NOT allowlisted → shown, not allowed.
    expect(byId['claude-opus-4-8'].allowedForRole).toBe(false);
    expect(byId['gpt-4o'].allowedForRole).toBe(false);
    // Caps + cost hint are carried through.
    expect(byId['claude-opus-4-8'].caps.vision).toBe(true);
    expect(byId['claude-opus-4-8'].costHint).toBe('$$$');
  });

  it('role gating: admin sees everything allowed (API case 33)', () => {
    const entries = buildModelPickerEntries({
      catalog: ALL,
      settings: orgSettings(),
      role: 'admin',
    });
    expect(entries.every((e) => e.allowedForRole)).toBe(true);
  });

  it('empty catalog / all providers disabled → empty list (J4 empty state)', () => {
    const entries = buildModelPickerEntries({
      catalog: ALL,
      settings: { llm: { providers: [] } }, // explicit = nothing enabled
      role: 'member',
    });
    expect(entries).toEqual([]);
  });
});

// ── §5.1 case 32 + J4: assertModelAllowed rejections ────────────────────────

describe('assertModelAllowed', () => {
  const settings = orgSettings();

  it('allows an allowlisted, enabled model', () => {
    const m = assertModelAllowed(settings, 'member', 'claude-sonnet-4-6');
    expect(m.id).toBe('claude-sonnet-4-6');
  });

  it('rejects a non-allowlisted model for a member → 403 (case 32/33)', () => {
    let err: unknown;
    try {
      assertModelAllowed(settings, 'member', 'claude-opus-4-8');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ModelNotAllowedError);
    expect((err as ModelNotAllowedError).status).toBe(403);
    expect((err as ModelNotAllowedError).code).toBe('MODEL_NOT_ALLOWLISTED');
  });

  it('rejects a model whose provider is disabled (J4 provider-disabled)', () => {
    // ollama not enabled → llama3.1 blocked even though it is in catalog.
    expect(() => assertModelAllowed(settings, 'admin', 'llama3.1')).toThrow(ModelNotAllowedError);
    try {
      assertModelAllowed(settings, 'admin', 'llama3.1');
    } catch (e) {
      expect((e as ModelNotAllowedError).code).toBe('MODEL_PROVIDER_DISABLED');
    }
  });

  it('throws UnknownModelError for an unknown id (no silent fallback)', () => {
    expect(() => assertModelAllowed(settings, 'admin', 'claude-haiku-4-5')).toThrow(UnknownModelError);
  });

  it('throws MODEL_NO_VISION when an image is present + model lacks vision (J4 vision gate)', () => {
    // Enable ollama so provider+allowlist pass and only the vision gate fires.
    const withOllama = orgSettings({
      encryptedKeys: { anthropic: 'enc', openai: 'enc', ollama: 'enc' },
      allowlist: { admin: '*' },
    });
    let err: unknown;
    try {
      assertModelAllowed(withOllama, 'admin', 'llama3.1', { requireVision: true });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ModelCapabilityError);
    expect((err as ModelCapabilityError).code).toBe('MODEL_NO_VISION');
  });

  it('does NOT throw vision error for a vision-capable model with an image', () => {
    expect(() =>
      assertModelAllowed(settings, 'member', 'claude-sonnet-4-6', { requireVision: true }),
    ).not.toThrow();
  });
});

// ── GET /api/v1/models route (feature-flag gate + shape) ─────────────────────

describe('GET /api/v1/models route', () => {
  // Import express + the router lazily so the config/prisma mocks are in effect.
  async function mountApp(user: { orgId: string; role: UserRole } | null) {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const { default: router } = await import('./models.js');
    const app = express();
    app.use(express.json());
    // Stub auth: inject req.user then delegate to the router.
    app.use((req, _res, next) => {
      if (user) (req as unknown as { user: unknown }).user = user;
      next();
    });
    app.use('/api/v1/models', router);
    return request(app);
  }

  it('404s when the modelPicker flag is off', async () => {
    prismaMock.org.findUnique.mockResolvedValue({ settings: { ...orgSettings() } });
    const agent = await mountApp({ orgId: 'org1', role: 'member' });
    const res = await agent.get('/api/v1/models');
    expect(res.status).toBe(404);
  });

  it('401s when unauthenticated', async () => {
    const agent = await mountApp(null);
    const res = await agent.get('/api/v1/models');
    expect(res.status).toBe(401);
  });

  it('returns ModelPickerEntry[] filtered to enabled+flagged with caps/cost', async () => {
    prismaMock.org.findUnique.mockResolvedValue({
      settings: { features: { modelPicker: true }, ...orgSettings() },
    });
    const agent = await mountApp({ orgId: 'org1', role: 'member' });
    const res = await agent.get('/api/v1/models');
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: string }>).map((e) => e.id).sort();
    expect(ids).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'gpt-4o',
    ]);
    const opus = (res.body.data as Array<{ id: string; allowedForRole: boolean; costHint?: string }>)
      .find((e) => e.id === 'claude-opus-4-8')!;
    expect(opus.allowedForRole).toBe(false);
    expect(opus.costHint).toBe('$$$');
  });
});
