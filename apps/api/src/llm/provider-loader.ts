import { prisma } from '../lib/prisma.js';
import { decrypt } from '../mcp/token-store.js';
import { providerRegistry } from './provider-registry.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Loads LLM providers from env vars and DB-stored encrypted keys.
 * DB keys take precedence over env vars for the same provider.
 * Safe to call multiple times (re-registers providers in place).
 */
export async function loadProviders(): Promise<void> {
  // Load from env vars
  if (env.ANTHROPIC_API_KEY) {
    try {
      providerRegistry.register(new AnthropicProvider(env.ANTHROPIC_API_KEY));
      logger.info('Registered Anthropic provider from env');
    } catch (err) {
      logger.warn({ err }, 'Failed to register Anthropic provider from env');
    }
  }

  if (env.OPENAI_API_KEY) {
    try {
      providerRegistry.register(new OpenAIProvider({ apiKey: env.OPENAI_API_KEY }));
      logger.info('Registered OpenAI provider from env');
    } catch (err) {
      logger.warn({ err }, 'Failed to register OpenAI provider from env');
    }
  }

  if (env.OLLAMA_BASE_URL) {
    try {
      providerRegistry.register(new OllamaProvider(env.OLLAMA_BASE_URL));
      logger.info('Registered Ollama provider from env');
    } catch (err) {
      logger.warn({ err }, 'Failed to register Ollama provider from env');
    }
  }

  // Load from DB (overrides env for that provider)
  try {
    const org = await prisma.org.findFirst({ select: { settings: true } });
    if (!org) return;

    const settings = org.settings as Record<string, unknown>;
    const llm = (settings?.llm ?? {}) as Record<string, unknown>;
    const encryptedKeys = (llm.encryptedKeys ?? {}) as Record<string, string>;

    if (encryptedKeys.anthropic) {
      try {
        const key = decrypt(encryptedKeys.anthropic);
        providerRegistry.register(new AnthropicProvider(key));
        logger.info('Registered Anthropic provider from DB');
      } catch (err) {
        logger.warn({ err }, 'Failed to register Anthropic provider from DB');
      }
    }

    if (encryptedKeys.openai) {
      try {
        const key = decrypt(encryptedKeys.openai);
        providerRegistry.register(new OpenAIProvider({ apiKey: key }));
        logger.info('Registered OpenAI provider from DB');
      } catch (err) {
        logger.warn({ err }, 'Failed to register OpenAI provider from DB');
      }
    }

    if (encryptedKeys.ollama) {
      try {
        const baseUrl = decrypt(encryptedKeys.ollama);
        providerRegistry.register(new OllamaProvider(baseUrl));
        logger.info('Registered Ollama provider from DB');
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
