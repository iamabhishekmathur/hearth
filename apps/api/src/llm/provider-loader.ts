import { prisma } from '../lib/prisma.js';
import { decrypt } from '../mcp/token-store.js';
import { providerRegistry } from './provider-registry.js';
import { AiSdkProvider, type AiSdkProviderConfig } from './ai-sdk-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import { refreshCatalog } from './model-catalog.js';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Loads LLM providers from env vars and DB-stored encrypted keys.
 *
 * W1: by default each configured provider is registered as an `AiSdkProvider`
 * (Vercel AI SDK + models.dev catalog). The four legacy hand-rolled providers
 * are registered ONLY when `HEARTH_LEGACY_PROVIDERS=true` — a one-release
 * kill-switch for the deprecation window (§7). The legacy files are NOT deleted
 * here; decommission is a later gated step.
 *
 * DB keys take precedence over env vars for the same provider. Safe to call
 * multiple times (re-registers providers in place).
 */
export async function loadProviders(): Promise<void> {
  const useLegacy = env.HEARTH_LEGACY_PROVIDERS === true;

  // Kick off a catalog refresh (no-op unless HEARTH_MODEL_CATALOG_REFRESH=true).
  // Fire-and-forget: the snapshot is already authoritative, so boot never blocks.
  refreshCatalog().catch((err) => logger.warn({ err }, 'Model catalog refresh failed'));

  // ── Register from env vars ──
  if (env.ANTHROPIC_API_KEY) {
    registerAnthropic(env.ANTHROPIC_API_KEY, 'env', useLegacy);
  }
  if (env.OPENAI_API_KEY) {
    registerOpenAI(env.OPENAI_API_KEY, 'env', useLegacy);
  }
  if (env.OLLAMA_BASE_URL) {
    registerOllama(env.OLLAMA_BASE_URL, 'env', useLegacy);
  }

  // ── Register from DB (overrides env for that provider) ──
  try {
    const org = await prisma.org.findFirst({ select: { settings: true } });
    if (!org) return;

    const settings = org.settings as Record<string, unknown>;
    const llm = (settings?.llm ?? {}) as Record<string, unknown>;
    const encryptedKeys = (llm.encryptedKeys ?? {}) as Record<string, string>;

    if (encryptedKeys.anthropic) {
      try {
        registerAnthropic(decrypt(encryptedKeys.anthropic), 'DB', useLegacy);
      } catch (err) {
        logger.warn({ err }, 'Failed to register Anthropic provider from DB');
      }
    }
    if (encryptedKeys.openai) {
      try {
        registerOpenAI(decrypt(encryptedKeys.openai), 'DB', useLegacy);
      } catch (err) {
        logger.warn({ err }, 'Failed to register OpenAI provider from DB');
      }
    }
    if (encryptedKeys.ollama) {
      try {
        registerOllama(decrypt(encryptedKeys.ollama), 'DB', useLegacy);
      } catch (err) {
        logger.warn({ err }, 'Failed to register Ollama provider from DB');
      }
    }

    // Apply default provider from DB settings
    const defaultProvider = llm.defaultProvider as string | undefined;
    if (defaultProvider) {
      try {
        providerRegistry.setDefault(defaultProvider);
      } catch {
        // Provider not registered yet — ignore
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load providers from DB');
  }
}

// ── Registration helpers ────────────────────────────────────────────────────────

function register(config: AiSdkProviderConfig, legacyFactory: () => void, useLegacy: boolean, source: string): void {
  try {
    if (useLegacy) {
      legacyFactory();
      logger.info({ provider: config.id, source }, 'Registered legacy provider (HEARTH_LEGACY_PROVIDERS)');
    } else {
      providerRegistry.register(new AiSdkProvider(config));
      logger.info({ provider: config.id, source }, 'Registered AI SDK provider');
    }
  } catch (err) {
    logger.warn({ err, provider: config.id, source }, 'Failed to register provider');
  }
}

function registerAnthropic(apiKey: string, source: string, useLegacy: boolean): void {
  register(
    { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', apiKey },
    () => providerRegistry.register(new AnthropicProvider(apiKey)),
    useLegacy,
    source,
  );
}

function registerOpenAI(apiKey: string, source: string, useLegacy: boolean): void {
  register(
    {
      id: 'openai',
      name: 'OpenAI',
      kind: 'openai',
      apiKey,
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
    },
    () => providerRegistry.register(new OpenAIProvider({ apiKey })),
    useLegacy,
    source,
  );
}

function registerOllama(baseUrl: string, source: string, useLegacy: boolean): void {
  // Ollama exposes an OpenAI-compatible API at /v1 — the AI SDK path drives it
  // via @ai-sdk/openai-compatible. The legacy OllamaProvider talks to the native
  // /api endpoints and stays available behind the kill-switch.
  const normalized = baseUrl.replace(/\/$/, '');
  register(
    {
      id: 'ollama',
      name: 'Ollama',
      kind: 'openai-compatible',
      baseURL: `${normalized}/v1`,
      embeddingModel: 'nomic-embed-text',
    },
    () => providerRegistry.register(new OllamaProvider(baseUrl)),
    useLegacy,
    source,
  );
}
