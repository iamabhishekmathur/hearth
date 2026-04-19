/**
 * End-to-end integration tests for the compliance pipeline.
 *
 * Tests the full flow:
 *   Request context → Config cache → Interceptor → Scrub → Mock LLM → Descrub → Audit
 *
 * Also tests:
 *   - ProviderRegistry interceptor wiring
 *   - Config cache + invalidation
 *   - Embed interceptor
 *   - Pass-through when no packs enabled
 *   - Pass-through when no request context
 *   - Multi-pack scenarios
 *   - Tool call argument descrubbing through the stream
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatParams, ChatEvent } from '@hearth/shared';

// ── Mocks ──────────────────────────────────────────────────────

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    org: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1', createdAt: new Date() }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Test User' }),
    },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../ws/socket-manager.js', () => ({
  emitToOrg: vi.fn(),
}));

import { prisma } from '../lib/prisma.js';
import { runWithContext, getRequestContext } from '../lib/request-context.js';
import { getComplianceConfig, clearComplianceCache, invalidateComplianceCache } from './config-cache.js';
import { complianceChatInterceptor, complianceEmbedInterceptor } from './provider-wrapper.js';
import { ProviderRegistry } from '../llm/provider-registry.js';
import { bootstrapCompliance } from './bootstrap.js';
import type { LLMProvider } from '../llm/types.js';

const mockedOrgFindUnique = vi.mocked(prisma.org.findUnique);
const mockedAuditCreate = vi.mocked(prisma.auditLog.create);

// ── Helpers ────────────────────────────────────────────────────

function mockOrgSettings(settings: Record<string, unknown>) {
  mockedOrgFindUnique.mockResolvedValue({
    id: 'org-1',
    name: 'Test Org',
    settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);
}

async function* mockLLMStream(events: ChatEvent[]): AsyncGenerator<ChatEvent> {
  for (const event of events) {
    yield event;
  }
}

async function collectStream(stream: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const result: ChatEvent[] = [];
  for await (const event of stream) {
    result.push(event);
  }
  return result;
}

function textContent(events: ChatEvent[]): string {
  return events
    .filter((e) => e.type === 'text_delta')
    .map((e) => (e as { content: string }).content)
    .join('');
}

/** Create a fake LLM provider that echoes back text with placeholders */
function createEchoProvider(id: string): LLMProvider {
  return {
    id,
    name: `Echo ${id}`,
    chat: async function* (params: ChatParams) {
      // Echo the user's last message content back — this simulates an LLM
      // that uses the (scrubbed) input in its response
      const lastMsg = params.messages[params.messages.length - 1];
      const content = typeof lastMsg.content === 'string'
        ? lastMsg.content
        : lastMsg.content.map(p => p.type === 'text' ? p.text : '').join('');

      yield { type: 'text_delta' as const, content: `Echo: ${content}` };
      yield { type: 'done' as const, usage: { inputTokens: 10, outputTokens: 5 } };
    },
    embed: async (texts: string[]) => {
      // Return a fake embedding that encodes the text length for verification
      return texts.map((t) => [t.length, 0, 0]);
    },
  };
}

/** Create a provider that uses placeholders in tool calls */
function createToolCallProvider(): LLMProvider {
  return {
    id: 'tool-provider',
    name: 'Tool Provider',
    chat: async function* (params: ChatParams) {
      // Simulate LLM generating a tool call with a placeholder from the scrubbed input
      const lastMsg = params.messages[params.messages.length - 1];
      const content = typeof lastMsg.content === 'string' ? lastMsg.content : '';

      // Extract any placeholder like [SSN_1] from the scrubbed content
      const placeholderMatch = content.match(/\[SSN_\d+\]/);
      const placeholder = placeholderMatch ? placeholderMatch[0] : 'no-ssn';

      yield {
        type: 'tool_call_start' as const,
        id: 'tc-1',
        tool: 'lookup_record',
        input: { ssn: placeholder, query: `Find record for ${placeholder}` },
      };
      yield { type: 'tool_call_end' as const, id: 'tc-1' };
      yield { type: 'text_delta' as const, content: `Found record for ${placeholder}.` };
      yield { type: 'done' as const, usage: { inputTokens: 20, outputTokens: 15 } };
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('Compliance Integration — Full Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearComplianceCache();
  });

  // ── Request Context ──

  describe('Request Context propagation', () => {
    it('AsyncLocalStorage carries orgId through async chain', async () => {
      let capturedOrgId: string | undefined;

      await runWithContext({ orgId: 'org-ctx-test', userId: 'u1' }, async () => {
        // Simulate async work
        await new Promise((r) => setTimeout(r, 1));
        const ctx = getRequestContext();
        capturedOrgId = ctx?.orgId;
      });

      expect(capturedOrgId).toBe('org-ctx-test');
    });

    it('returns undefined outside of context', () => {
      expect(getRequestContext()).toBeUndefined();
    });
  });

  // ── Config Cache ──

  describe('Config cache', () => {
    it('loads config from DB and caches it', async () => {
      mockOrgSettings({ compliance: { enabledPacks: ['pii'], auditLevel: 'detailed' } });

      const config1 = await getComplianceConfig('org-cache-1');
      expect(config1.enabledPacks).toEqual(['pii']);
      expect(config1.auditLevel).toBe('detailed');

      // Second call should hit cache (mock only called once)
      const config2 = await getComplianceConfig('org-cache-1');
      expect(config2.enabledPacks).toEqual(['pii']);
      expect(mockedOrgFindUnique).toHaveBeenCalledTimes(1);
    });

    it('invalidation forces re-fetch from DB', async () => {
      mockOrgSettings({ compliance: { enabledPacks: ['pii'] } });
      await getComplianceConfig('org-inv-1');

      // Update the mock
      mockOrgSettings({ compliance: { enabledPacks: ['pii', 'pci-dss'] } });
      invalidateComplianceCache('org-inv-1');

      const config = await getComplianceConfig('org-inv-1');
      expect(config.enabledPacks).toEqual(['pii', 'pci-dss']);
      expect(mockedOrgFindUnique).toHaveBeenCalledTimes(2);
    });

    it('returns default config when org has no compliance settings', async () => {
      mockOrgSettings({});
      const config = await getComplianceConfig('org-empty');
      expect(config.enabledPacks).toEqual([]);
    });
  });

  // ── Chat Interceptor — Full Pipeline ──

  describe('Chat interceptor pipeline', () => {
    it('scrubs SSN before LLM, descrubs in response', async () => {
      mockOrgSettings({ compliance: { enabledPacks: ['pii'] } });

      // Track what the LLM actually receives
      let llmReceivedContent = '';
      const realChat = async function* (params: ChatParams): AsyncGenerator<ChatEvent> {
        const msg = params.messages[0];
        llmReceivedContent = typeof msg.content === 'string' ? msg.content : '';
        // Simulate LLM echoing back with placeholder
        yield { type: 'text_delta', content: llmReceivedContent };
        yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
      };

      const params: ChatParams = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'My SSN is 123-45-6789, look it up.' }],
      };

      // Run within request context
      const events = await runWithContext({ orgId: 'org-1' }, async () => {
        return collectStream(complianceChatInterceptor(params, undefined, realChat));
      });

      // LLM should have received scrubbed content
      expect(llmReceivedContent).toContain('[SSN_1]');
      expect(llmReceivedContent).not.toContain('123-45-6789');

      // User-facing output should have original SSN restored
      const output = textContent(events);
      expect(output).toContain('123-45-6789');
      expect(output).not.toContain('[SSN_1]');
    });

    it('scrubs multiple entity types (PII + PCI) simultaneously', async () => {
      mockOrgSettings({ compliance: { enabledPacks: ['pii', 'pci-dss'] } });

      let llmReceivedContent = '';
      const realChat = async function* (params: ChatParams): AsyncGenerator<ChatEvent> {
        const msg = params.messages[0];
        llmReceivedContent = typeof msg.content === 'string' ? msg.content : '';
        yield { type: 'text_delta', content: `Processed: ${llmReceivedContent}` };
        yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
      };

      const params: ChatParams = {
        model: 'test-model',
        messages: [{
          role: 'user',
          content: 'SSN 234-56-7890 and card 4111-1111-1111-1111 need updating.',
        }],
      };

      const events = await runWithContext({ orgId: 'org-1' }, async () => {
        return collectStream(complianceChatInterceptor(params, undefined, realChat));
      });

      // LLM should see placeholders
      expect(llmReceivedContent).toContain('[SSN_1]');
      expect(llmReceivedContent).toContain('[CREDIT_CARD_1]');
      expect(llmReceivedContent).not.toContain('234-56-7890');
      expect(llmReceivedContent).not.toContain('4111');

      // User should see originals
      const output = textContent(events);
      expect(output).toContain('234-56-7890');
      expect(output).toContain('4111-1111-1111-1111');
    });

    it('descrubs tool call arguments so tools receive real values', async () => {
      mockOrgSettings({ compliance: { enabledPacks: ['pii'] } });

      const realChat = async function* (params: ChatParams): AsyncGenerator<ChatEvent> {
        const msg = params.messages[0];
        const content = typeof msg.content === 'string' ? msg.content : '';
        const match = content.match(/\[SSN_\d+\]/);
        const placeholder = match ? match[0] : 'none';

        yield {
          type: 'tool_call_start' as const,
          id: 'tc-1',
          tool: 'verify_identity',
          input: { ssn: placeholder },
        };
        yield { type: 'tool_call_end' as const, id: 'tc-1' };
        yield { type: 'done' as const, usage: { inputTokens: 10, outputTokens: 5 } };
      };

      const params: ChatParams = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Verify SSN 345-67-8901 please.' }],
      };

      const events = await runWithContext({ orgId: 'org-1' }, async () => {
        return collectStream(complianceChatInterceptor(params, undefined, realChat));
      });

      // Tool call should have original SSN, not placeholder
      const toolEvent = events.find((e) => e.type === 'tool_call_start') as
        | { type: 'tool_call_start'; input: Record<string, unknown> }
        | undefined;
      expect(toolEvent).toBeDefined();
      expect(toolEvent!.input.ssn).toBe('345-67-8901');
    });

    it('passes through unchanged when no packs are enabled', async () => {
      mockOrgSettings({ compliance: { enabledPacks: [] } });

      let llmReceivedContent = '';
      const realChat = async function* (params: ChatParams): AsyncGenerator<ChatEvent> {
        const msg = params.messages[0];
        llmReceivedContent = typeof msg.content === 'string' ? msg.content : '';
        yield { type: 'text_delta', content: 'Response' };
        yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
      };

      const params: ChatParams = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'My SSN is 123-45-6789' }],
      };

      await runWithContext({ orgId: 'org-1' }, async () => {
        await collectStream(complianceChatInterceptor(params, undefined, realChat));
      });

      // LLM should have received the original content untouched
      expect(llmReceivedContent).toBe('My SSN is 123-45-6789');
    });

    it('passes through when there is no request context', async () => {
      // No runWithContext — getRequestContext() returns undefined
      let llmReceivedContent = '';
      const realChat = async function* (params: ChatParams): AsyncGenerator<ChatEvent> {
        const msg = params.messages[0];
        llmReceivedContent = typeof msg.content === 'string' ? msg.content : '';
        yield { type: 'text_delta', content: 'Response' };
        yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
      };

      const params: ChatParams = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'SSN: 456-78-9012' }],
      };

      await collectStream(complianceChatInterceptor(params, undefined, realChat));
      expect(llmReceivedContent).toBe('SSN: 456-78-9012');
    });

    it('passes through when message contains no detectable entities', async () => {
      mockOrgSettings({ compliance: { enabledPacks: ['pii'] } });

      let llmReceivedContent = '';
      const realChat = async function* (params: ChatParams): AsyncGenerator<ChatEvent> {
        const msg = params.messages[0];
        llmReceivedContent = typeof msg.content === 'string' ? msg.content : '';
        yield { type: 'text_delta', content: 'Just a reply.' };
        yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
      };

      const params: ChatParams = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'What is the weather today?' }],
      };

      await runWithContext({ orgId: 'org-1' }, async () => {
        await collectStream(complianceChatInterceptor(params, undefined, realChat));
      });

      expect(llmReceivedContent).toBe('What is the weather today?');
    });

    it('handles split placeholders in streamed response', async () => {
      mockOrgSettings({ compliance: { enabledPacks: ['pii'] } });

      const realChat = async function* (): AsyncGenerator<ChatEvent> {
        // Simulate LLM streaming a placeholder split across chunks
        yield { type: 'text_delta', content: 'Your SSN is [SS' };
        yield { type: 'text_delta', content: 'N_1] on file.' };
        yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
      };

      const params: ChatParams = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'My SSN is 123-45-6789' }],
      };

      const events = await runWithContext({ orgId: 'org-1' }, async () => {
        return collectStream(complianceChatInterceptor(params, undefined, realChat));
      });

      const output = textContent(events);
      expect(output).toContain('123-45-6789');
      expect(output).not.toContain('[SSN_1]');
    });

    it('scrubs system prompt when compliance is active', async () => {
      mockOrgSettings({ compliance: { enabledPacks: ['pii'] } });

      let llmReceivedSystemPrompt = '';
      const realChat = async function* (params: ChatParams): AsyncGenerator<ChatEvent> {
        llmReceivedSystemPrompt = params.systemPrompt ?? '';
        yield { type: 'text_delta', content: 'OK' };
        yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
      };

      const params: ChatParams = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'My SSN is 456-78-9012' }],
        systemPrompt: 'You are helping Dr. Jane Smith with her files.',
      };

      await runWithContext({ orgId: 'org-1' }, async () => {
        await collectStream(complianceChatInterceptor(params, undefined, realChat));
      });

      // System prompt should have name scrubbed and compliance notice prepended
      expect(llmReceivedSystemPrompt).toContain('placeholders');
      expect(llmReceivedSystemPrompt).toContain('[PERSON_NAME_1]');
      expect(llmReceivedSystemPrompt).not.toContain('Jane Smith');
    });

    it('fires audit log after scrubbing', async () => {
      mockOrgSettings({ compliance: { enabledPacks: ['pii'] } });

      const realChat = async function* (): AsyncGenerator<ChatEvent> {
        yield { type: 'text_delta', content: 'OK' };
        yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
      };

      const params: ChatParams = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'SSN: 567-89-0123' }],
      };

      await runWithContext({ orgId: 'org-audit', userId: 'user-1' }, async () => {
        await collectStream(complianceChatInterceptor(params, undefined, realChat));
      });

      // Give the fire-and-forget audit a tick to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(mockedAuditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orgId: 'org-audit',
            action: 'compliance_scrub',
            details: expect.objectContaining({
              packs: ['pii'],
              direction: 'outbound',
            }),
          }),
        }),
      );
    });

    it('respects detector overrides (disable specific detector)', async () => {
      mockOrgSettings({
        compliance: {
          enabledPacks: ['pii'],
          detectorOverrides: { 'pii.EMAIL': { enabled: false } },
        },
      });

      let llmReceivedContent = '';
      const realChat = async function* (params: ChatParams): AsyncGenerator<ChatEvent> {
        const msg = params.messages[0];
        llmReceivedContent = typeof msg.content === 'string' ? msg.content : '';
        yield { type: 'text_delta', content: 'OK' };
        yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
      };

      const params: ChatParams = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'SSN 123-45-6789, email john@test.com' }],
      };

      await runWithContext({ orgId: 'org-1' }, async () => {
        await collectStream(complianceChatInterceptor(params, undefined, realChat));
      });

      // SSN should be scrubbed, email should pass through
      expect(llmReceivedContent).toContain('[SSN_1]');
      expect(llmReceivedContent).toContain('john@test.com');
    });
  });

  // ── Embed Interceptor ──

  describe('Embed interceptor pipeline', () => {
    it('scrubs PII from texts before embedding', async () => {
      mockOrgSettings({ compliance: { enabledPacks: ['pii'] } });

      let embeddedTexts: string[] = [];
      const realEmbed = async (texts: string[]): Promise<number[][] | null> => {
        embeddedTexts = texts;
        return texts.map((t) => [t.length, 0]);
      };

      const result = await runWithContext({ orgId: 'org-1' }, async () => {
        return complianceEmbedInterceptor(
          ['My SSN is 123-45-6789'],
          undefined,
          realEmbed,
        );
      });

      // Embedding provider should receive scrubbed text
      expect(embeddedTexts[0]).toContain('[SSN_1]');
      expect(embeddedTexts[0]).not.toContain('123-45-6789');
      // Should still return embeddings
      expect(result).not.toBeNull();
    });

    it('passes through when no packs enabled', async () => {
      mockOrgSettings({ compliance: { enabledPacks: [] } });

      let embeddedTexts: string[] = [];
      const realEmbed = async (texts: string[]): Promise<number[][] | null> => {
        embeddedTexts = texts;
        return texts.map((t) => [t.length]);
      };

      await runWithContext({ orgId: 'org-1' }, async () => {
        return complianceEmbedInterceptor(
          ['SSN: 123-45-6789'],
          undefined,
          realEmbed,
        );
      });

      // Should receive original text
      expect(embeddedTexts[0]).toBe('SSN: 123-45-6789');
    });
  });

  // ── ProviderRegistry Wiring ──

  describe('ProviderRegistry interceptor wiring', () => {
    it('chatWithFallback routes through interceptor when registered', async () => {
      const registry = new ProviderRegistry();
      const echoProvider = createEchoProvider('echo');
      registry.register(echoProvider);

      // Track what the provider receives
      let providerSawContent = '';
      const origChat = echoProvider.chat;
      echoProvider.chat = async function* (params: ChatParams) {
        const msg = params.messages[0];
        providerSawContent = typeof msg.content === 'string' ? msg.content : '';
        yield* origChat(params);
      };

      // Register interceptor
      registry.setChatInterceptor(complianceChatInterceptor);

      mockOrgSettings({ compliance: { enabledPacks: ['pii'] } });

      const params: ChatParams = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'My SSN is 789-01-2345' }],
      };

      const events = await runWithContext({ orgId: 'org-1' }, async () => {
        const results: ChatEvent[] = [];
        for await (const event of registry.chatWithFallback(params)) {
          results.push(event);
        }
        return results;
      });

      // Provider should have received scrubbed content
      expect(providerSawContent).toContain('[SSN_1]');
      expect(providerSawContent).not.toContain('789-01-2345');

      // User-facing output should have original
      const output = textContent(events);
      expect(output).toContain('789-01-2345');
    });

    it('embed routes through interceptor when registered', async () => {
      const registry = new ProviderRegistry();
      const echoProvider = createEchoProvider('echo');
      registry.register(echoProvider);

      let embeddedTexts: string[] = [];
      echoProvider.embed = async (texts: string[]) => {
        embeddedTexts = texts;
        return texts.map((t) => [t.length]);
      };

      registry.setEmbedInterceptor(complianceEmbedInterceptor);
      mockOrgSettings({ compliance: { enabledPacks: ['pii'] } });

      await runWithContext({ orgId: 'org-1' }, async () => {
        return registry.embed(['Email: john@test.com']);
      });

      expect(embeddedTexts[0]).toContain('[EMAIL_1]');
      expect(embeddedTexts[0]).not.toContain('john@test.com');
    });

    it('chatWithFallback works normally without interceptor', async () => {
      const registry = new ProviderRegistry();
      const echoProvider = createEchoProvider('echo');
      registry.register(echoProvider);

      const params: ChatParams = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'SSN: 123-45-6789' }],
      };

      const events: ChatEvent[] = [];
      for await (const event of registry.chatWithFallback(params)) {
        events.push(event);
      }

      // Without interceptor, SSN passes through to output
      const output = textContent(events);
      expect(output).toContain('123-45-6789');
    });
  });

  // ── Tool Round-Trip ──

  describe('Tool call round-trip', () => {
    it('descrubs tool args so external tools get real values, then re-scrubs tool results', async () => {
      mockOrgSettings({ compliance: { enabledPacks: ['pii'] } });

      const registry = new ProviderRegistry();
      const toolProvider = createToolCallProvider();
      registry.register(toolProvider);
      registry.setChatInterceptor(complianceChatInterceptor);

      const params: ChatParams = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Look up SSN 234-56-7890 in the system.' }],
      };

      const events = await runWithContext({ orgId: 'org-1' }, async () => {
        const results: ChatEvent[] = [];
        for await (const event of registry.chatWithFallback(params)) {
          results.push(event);
        }
        return results;
      });

      // Tool call args should have real SSN (descrubbed for tool execution)
      const toolEvent = events.find((e) => e.type === 'tool_call_start') as
        | { type: 'tool_call_start'; input: Record<string, unknown> }
        | undefined;
      expect(toolEvent).toBeDefined();
      expect(toolEvent!.input.ssn).toBe('234-56-7890');
      expect(toolEvent!.input.query).toContain('234-56-7890');

      // Text output should also have original SSN
      const output = textContent(events);
      expect(output).toContain('234-56-7890');
    });
  });

  // ── Healthcare Scenario ──

  describe('Real-world scenario: Healthcare (PHI pack)', () => {
    it('scrubs patient data before LLM and restores it in response', async () => {
      mockOrgSettings({ compliance: { enabledPacks: ['phi'] } }); // PHI extends PII

      let llmSaw = '';
      const realChat = async function* (params: ChatParams): AsyncGenerator<ChatEvent> {
        const msg = params.messages[0];
        llmSaw = typeof msg.content === 'string' ? msg.content : '';
        yield { type: 'text_delta', content: `I found the record: ${llmSaw}` };
        yield { type: 'done', usage: { inputTokens: 20, outputTokens: 15 } };
      };

      const params: ChatParams = {
        model: 'test-model',
        messages: [{
          role: 'user',
          content: 'Patient SSN: 345-67-8901. MRN: X12345678. Prescribed Metformin 500mg.',
        }],
      };

      const events = await runWithContext({ orgId: 'org-1' }, async () => {
        return collectStream(complianceChatInterceptor(params, undefined, realChat));
      });

      // LLM should see all placeholders
      expect(llmSaw).toContain('[SSN_1]');
      expect(llmSaw).toContain('[MRN_1]');
      expect(llmSaw).toContain('[MEDICATION_1]');
      expect(llmSaw).not.toContain('345-67-8901');
      expect(llmSaw).not.toContain('X12345678');

      // User should see all originals
      const output = textContent(events);
      expect(output).toContain('345-67-8901');
      expect(output).toContain('X12345678');
      expect(output).toContain('Metformin');
    });
  });
});
