import type { ChatParams, ChatEvent } from '@hearth/shared';
import type { LLMProvider } from './types.js';
import type { ChatInterceptor, EmbedInterceptor } from '../compliance/types.js';

export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private defaultId: string | null = null;
  private chatInterceptor: ChatInterceptor | null = null;
  private embedInterceptor: EmbedInterceptor | null = null;

  register(provider: LLMProvider, isDefault = false): void {
    this.providers.set(provider.id, provider);
    if (isDefault || this.providers.size === 1) {
      this.defaultId = provider.id;
    }
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  getDefault(): LLMProvider | undefined {
    if (!this.defaultId) return undefined;
    return this.providers.get(this.defaultId);
  }

  setDefault(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`Provider "${id}" is not registered`);
    }
    this.defaultId = id;
  }

  list(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Returns the first registered provider that supports embedding.
   * Prefers the given id if provided.
   */
  getEmbeddingProvider(preferredId?: string): LLMProvider | undefined {
    if (preferredId) {
      const preferred = this.providers.get(preferredId);
      if (preferred?.embed) return preferred;
    }

    // Try all providers in registration order
    for (const provider of this.providers.values()) {
      if (provider.embed) {
        // Anthropic's embed throws — skip it
        if (provider.id === 'anthropic') continue;
        return provider;
      }
    }
    return undefined;
  }

  /** Register a chat interceptor (for compliance scrubbing) */
  setChatInterceptor(interceptor: ChatInterceptor): void {
    this.chatInterceptor = interceptor;
  }

  /** Register an embed interceptor (for compliance scrubbing) */
  setEmbedInterceptor(interceptor: EmbedInterceptor): void {
    this.embedInterceptor = interceptor;
  }

  /**
   * Generate embeddings using the best available provider.
   * Returns null if no provider supports embedding.
   * If an embed interceptor is registered, it wraps the call.
   */
  async embed(texts: string[], preferredId?: string): Promise<number[][] | null> {
    const realEmbed = async (t: string[], pId?: string): Promise<number[][] | null> => {
      const provider = this.getEmbeddingProvider(pId);
      if (!provider?.embed) return null;
      return provider.embed(t);
    };

    if (this.embedInterceptor) {
      return this.embedInterceptor(texts, preferredId, realEmbed);
    }
    return realEmbed(texts, preferredId);
  }

  /**
   * Chat with fallback: tries the preferred provider first, then falls back
   * to other registered providers in registration order.
   * If a chat interceptor is registered, it wraps the call.
   */
  async *chatWithFallback(
    params: ChatParams,
    preferredId?: string,
  ): AsyncIterable<ChatEvent> {
    const realChat = (p: ChatParams, pId?: string): AsyncIterable<ChatEvent> => {
      return this.rawChatWithFallback(p, pId);
    };

    if (this.chatInterceptor) {
      yield* this.chatInterceptor(params, preferredId, realChat);
    } else {
      yield* this.rawChatWithFallback(params, preferredId);
    }
  }

  private async *rawChatWithFallback(
    params: ChatParams,
    preferredId?: string,
  ): AsyncIterable<ChatEvent> {
    const ordered = this.getFallbackOrder(preferredId);

    if (ordered.length === 0) {
      yield { type: 'error', message: 'No LLM providers registered' };
      return;
    }

    for (let i = 0; i < ordered.length; i++) {
      const provider = ordered[i];
      try {
        yield* provider.chat(params);
        return; // Success — stop trying
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown provider error';

        // If this is the last provider, yield the error
        if (i === ordered.length - 1) {
          yield {
            type: 'error',
            message: `All providers failed. Last error (${provider.id}): ${message}`,
          };
        }
        // Otherwise, silently try the next provider
      }
    }
  }

  private getFallbackOrder(preferredId?: string): LLMProvider[] {
    const all = Array.from(this.providers.values());

    if (preferredId) {
      const preferred = this.providers.get(preferredId);
      if (preferred) {
        return [preferred, ...all.filter((p) => p.id !== preferredId)];
      }
    }

    // Put default first
    if (this.defaultId) {
      const def = this.providers.get(this.defaultId);
      if (def) {
        return [def, ...all.filter((p) => p.id !== this.defaultId)];
      }
    }

    return all;
  }
}

/** Singleton registry */
export const providerRegistry = new ProviderRegistry();
