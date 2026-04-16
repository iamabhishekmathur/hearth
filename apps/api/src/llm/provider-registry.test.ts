import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRegistry } from './provider-registry.js';
import type { LLMProvider } from './types.js';
import type { ChatParams, ChatEvent } from '@hearth/shared';

function createMockProvider(
  id: string,
  events: ChatEvent[] = [{ type: 'done', usage: { inputTokens: 10, outputTokens: 5 } }],
  shouldThrow = false,
): LLMProvider {
  return {
    id,
    name: `Provider ${id}`,
    chat: shouldThrow
      ? // eslint-disable-next-line require-yield
        async function* () {
          throw new Error(`${id} failed`);
        }
      : async function* () {
          for (const event of events) {
            yield event;
          }
        },
    listModels: vi.fn().mockResolvedValue(['model-1']),
  };
}

const defaultParams: ChatParams = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'hello' }],
};

async function collectEvents(iter: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of iter) {
    events.push(event);
  }
  return events;
}

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('register', () => {
    it('adds a provider', () => {
      const provider = createMockProvider('openai');
      registry.register(provider);
      expect(registry.get('openai')).toBe(provider);
    });

    it('first registered provider becomes default', () => {
      const provider = createMockProvider('openai');
      registry.register(provider);
      expect(registry.getDefault()).toBe(provider);
    });

    it('second provider does not override default', () => {
      const p1 = createMockProvider('openai');
      const p2 = createMockProvider('anthropic');
      registry.register(p1);
      registry.register(p2);
      expect(registry.getDefault()).toBe(p1);
    });

    it('second provider becomes default if isDefault=true', () => {
      const p1 = createMockProvider('openai');
      const p2 = createMockProvider('anthropic');
      registry.register(p1);
      registry.register(p2, true);
      expect(registry.getDefault()).toBe(p2);
    });
  });

  describe('get', () => {
    it('returns registered provider', () => {
      const provider = createMockProvider('openai');
      registry.register(provider);
      expect(registry.get('openai')).toBe(provider);
    });

    it('returns undefined for unknown provider', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  describe('getDefault', () => {
    it('returns undefined when no providers registered', () => {
      expect(registry.getDefault()).toBeUndefined();
    });

    it('returns first registered provider', () => {
      const p1 = createMockProvider('openai');
      registry.register(p1);
      expect(registry.getDefault()).toBe(p1);
    });

    it('returns overridden default after setDefault', () => {
      const p1 = createMockProvider('openai');
      const p2 = createMockProvider('anthropic');
      registry.register(p1);
      registry.register(p2);
      registry.setDefault('anthropic');
      expect(registry.getDefault()).toBe(p2);
    });
  });

  describe('setDefault', () => {
    it('throws for unknown provider', () => {
      expect(() => registry.setDefault('unknown')).toThrow(
        'Provider "unknown" is not registered',
      );
    });

    it('sets the default provider', () => {
      const p1 = createMockProvider('openai');
      const p2 = createMockProvider('anthropic');
      registry.register(p1);
      registry.register(p2);
      registry.setDefault('anthropic');
      expect(registry.getDefault()?.id).toBe('anthropic');
    });
  });

  describe('list', () => {
    it('returns empty array when no providers registered', () => {
      expect(registry.list()).toEqual([]);
    });

    it('returns all registered providers', () => {
      const p1 = createMockProvider('openai');
      const p2 = createMockProvider('anthropic');
      registry.register(p1);
      registry.register(p2);
      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list).toContain(p1);
      expect(list).toContain(p2);
    });
  });

  describe('chatWithFallback', () => {
    it('yields events from preferred provider', async () => {
      const events: ChatEvent[] = [
        { type: 'text_delta', content: 'hello' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ];
      const provider = createMockProvider('openai', events);
      registry.register(provider);

      const result = await collectEvents(registry.chatWithFallback(defaultParams, 'openai'));
      expect(result).toEqual(events);
    });

    it('falls back to next provider on error', async () => {
      const failProvider = createMockProvider('openai', [], true);
      const successEvents: ChatEvent[] = [
        { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
      ];
      const successProvider = createMockProvider('anthropic', successEvents);

      registry.register(failProvider);
      registry.register(successProvider);

      const result = await collectEvents(
        registry.chatWithFallback(defaultParams, 'openai'),
      );
      expect(result).toEqual(successEvents);
    });

    it('yields error event if all providers fail', async () => {
      const p1 = createMockProvider('openai', [], true);
      const p2 = createMockProvider('anthropic', [], true);
      registry.register(p1);
      registry.register(p2);

      const result = await collectEvents(registry.chatWithFallback(defaultParams));
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('error');
      expect((result[0] as { type: 'error'; message: string }).message).toContain(
        'All providers failed',
      );
    });

    it('yields error event when no providers registered', async () => {
      const result = await collectEvents(registry.chatWithFallback(defaultParams));
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'error',
        message: 'No LLM providers registered',
      });
    });
  });
});
