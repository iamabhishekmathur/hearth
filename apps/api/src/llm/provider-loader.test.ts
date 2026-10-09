/**
 * W1 provider-loader wiring: AI SDK provider registered BY DEFAULT; the legacy
 * hand-rolled providers register ONLY when HEARTH_LEGACY_PROVIDERS=true (§5.1
 * decommission kill-switch, J13).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { envMock, refreshCatalogMock, registerMock, setDefaultMock } = vi.hoisted(() => ({
  envMock: {} as {
    ANTHROPIC_API_KEY?: string;
    OPENAI_API_KEY?: string;
    OLLAMA_BASE_URL?: string;
    HEARTH_LEGACY_PROVIDERS?: boolean;
    HEARTH_MODEL_CATALOG_REFRESH?: boolean;
  },
  refreshCatalogMock: vi.fn().mockResolvedValue(undefined),
  registerMock: vi.fn(),
  setDefaultMock: vi.fn(),
}));
vi.mock('../config.js', () => ({ env: envMock }));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/prisma.js', () => ({ prisma: { org: { findFirst: vi.fn().mockResolvedValue(null) } } }));
vi.mock('../mcp/token-store.js', () => ({ decrypt: (s: string) => s }));
// Avoid any network / redis from the catalog refresh.
vi.mock('./model-catalog.js', () => ({ refreshCatalog: refreshCatalogMock }));
// Spy on the registry.
vi.mock('./provider-registry.js', () => ({
  providerRegistry: { register: registerMock, setDefault: setDefaultMock },
}));

import { AiSdkProvider } from './ai-sdk-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import { loadProviders } from './provider-loader.js';

beforeEach(() => {
  registerMock.mockReset();
  setDefaultMock.mockReset();
  refreshCatalogMock.mockClear();
  for (const k of Object.keys(envMock)) delete (envMock as Record<string, unknown>)[k];
});

async function load() {
  await loadProviders();
}

describe('provider-loader default (AI SDK) path', () => {
  it('registers AiSdkProvider for each env-configured provider, not the legacy ones', async () => {
    envMock.ANTHROPIC_API_KEY = 'sk-ant';
    envMock.OPENAI_API_KEY = 'sk-oai';
    envMock.OLLAMA_BASE_URL = 'http://localhost:11434';
    envMock.HEARTH_LEGACY_PROVIDERS = false;

    await load();

    const registered = registerMock.mock.calls.map((c) => c[0]);
    expect(registered.length).toBe(3);
    for (const p of registered) {
      expect(p).toBeInstanceOf(AiSdkProvider);
      expect(p).not.toBeInstanceOf(AnthropicProvider);
      expect(p).not.toBeInstanceOf(OpenAIProvider);
      expect(p).not.toBeInstanceOf(OllamaProvider);
    }
    expect(registered.map((p) => p.id).sort()).toEqual(['anthropic', 'ollama', 'openai']);
    // Catalog refresh is kicked off at load.
    expect(refreshCatalogMock).toHaveBeenCalledOnce();
  });

  it('maps Ollama onto the openai-compatible family (local path) by default', async () => {
    envMock.OLLAMA_BASE_URL = 'http://localhost:11434/';
    await load();
    const ollama = registerMock.mock.calls.map((c) => c[0]).find((p) => p.id === 'ollama');
    expect(ollama).toBeInstanceOf(AiSdkProvider);
  });
});

describe('legacy kill-switch (HEARTH_LEGACY_PROVIDERS=true)', () => {
  it('registers the four hand-rolled providers instead of the AI SDK provider', async () => {
    envMock.ANTHROPIC_API_KEY = 'sk-ant';
    envMock.OPENAI_API_KEY = 'sk-oai';
    envMock.OLLAMA_BASE_URL = 'http://localhost:11434';
    envMock.HEARTH_LEGACY_PROVIDERS = true;

    await load();

    const registered = registerMock.mock.calls.map((c) => c[0]);
    expect(registered.some((p) => p instanceof AnthropicProvider)).toBe(true);
    expect(registered.some((p) => p instanceof OpenAIProvider)).toBe(true);
    expect(registered.some((p) => p instanceof OllamaProvider)).toBe(true);
    expect(registered.some((p) => p instanceof AiSdkProvider)).toBe(false);
  });
});
