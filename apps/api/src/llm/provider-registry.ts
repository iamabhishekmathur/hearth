import type { ChatParams, ChatEvent } from '@hearth/shared';
import type { LLMProvider } from './types.js';

export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private defaultId: string | null = null;

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
   * Chat with fallback: tries the preferred provider first, then falls back
   * to other registered providers in registration order.
   */
  async *chatWithFallback(
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
