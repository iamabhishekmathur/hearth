/**
 * §5.1 case 9 — the compliance scrubber still wraps the AI SDK provider.
 *
 * Drives a real `AiSdkProvider` (with the `ai` SDK's streamText mocked to echo
 * the scrubbed input it receives) through the real compliance chat interceptor
 * + ProviderRegistry wiring. Asserts: (a) the provider sees SCRUBBED text (PII
 * replaced by a placeholder), and (b) the placeholder is DESCRUBBED back to the
 * original value in the streamed response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatParams } from '@hearth/shared';

vi.mock('../lib/prisma.js', () => ({
  prisma: { org: { findUnique: vi.fn() }, auditLog: { create: vi.fn().mockResolvedValue({ id: 'a1', createdAt: new Date() }) }, user: { findUnique: vi.fn().mockResolvedValue({ name: 'Test User' }) } },
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Capture what the SDK actually receives, and echo the scrubbed input back as text.
const streamTextMock = vi.fn();
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamText: (opts: unknown) => streamTextMock(opts), embedMany: vi.fn() };
});

import { prisma } from '../lib/prisma.js';
import { runWithContext } from '../lib/request-context.js';
import { clearComplianceCache } from '../compliance/config-cache.js';
import { complianceChatInterceptor } from '../compliance/provider-wrapper.js';
import { ProviderRegistry } from './provider-registry.js';
import { AiSdkProvider } from './ai-sdk-provider.js';
import type { ChatEvent } from '@hearth/shared';

const mockedOrgFindUnique = vi.mocked(prisma.org.findUnique);

function mockOrgSettings(settings: Record<string, unknown>) {
  mockedOrgFindUnique.mockResolvedValue({
    id: 'org-1', name: 'Test Org', settings, createdAt: new Date(), updatedAt: new Date(),
  } as never);
}

async function collect(stream: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearComplianceCache();
  streamTextMock.mockReset();
});

describe('compliance wrapper around AiSdkProvider (case 9)', () => {
  it('scrubs outbound PII to the AI SDK and descrubs the response', async () => {
    // Enable the PII pack for the org.
    mockOrgSettings({ compliance: { enabledPacks: ['pii'], auditLevel: 'summary' } });

    // The mocked SDK echoes the scrubbed user text straight back as a text delta,
    // simulating a model that reflects its (scrubbed) input.
    streamTextMock.mockImplementation((opts: { messages: Array<{ role: string; content: unknown }> }) => {
      const last = opts.messages[opts.messages.length - 1];
      const text = typeof last.content === 'string'
        ? last.content
        : (last.content as Array<{ type: string; text?: string }>).map((p) => (p.type === 'text' ? p.text ?? '' : '')).join('');
      return {
        fullStream: (async function* () {
          yield { type: 'text-delta', id: 't', text: `Echo: ${text}` };
          yield { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 3, outputTokens: 4 } };
        })(),
      };
    });

    const registry = new ProviderRegistry();
    registry.register(new AiSdkProvider({ id: 'anthropic', name: 'Anthropic', kind: 'anthropic', apiKey: 'sk' }));
    registry.setChatInterceptor(complianceChatInterceptor);

    const params: ChatParams = {
      model: 'claude-opus-4-8',
      sessionId: 'sess-compliance',
      messages: [{ role: 'user', content: 'My email is alice@example.com, help me.' }],
    };

    const events = await runWithContext({ orgId: 'org-1', userId: 'u1', sessionId: 'sess-compliance' }, async () =>
      collect(registry.chatWithFallback(params, 'anthropic')),
    );

    // 1. The AI SDK must have received SCRUBBED text (no raw email).
    const sentMessages = (streamTextMock.mock.calls[0][0] as { messages: Array<{ content: unknown }> }).messages;
    const sentText = JSON.stringify(sentMessages);
    expect(sentText).not.toContain('alice@example.com');
    expect(sentText).toMatch(/\[EMAIL_\d+\]/);

    // 2. The streamed response must be DESCRUBBED back to the original email.
    const outText = events
      .filter((e): e is Extract<ChatEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.content)
      .join('');
    expect(outText).toContain('alice@example.com');
    expect(outText).not.toMatch(/\[EMAIL_\d+\]/);
  });

  it('passes through unchanged when no compliance packs are enabled', async () => {
    mockOrgSettings({ compliance: { enabledPacks: [] } });
    streamTextMock.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', id: 't', text: 'hello alice@example.com' };
        yield { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 1 } };
      })(),
    });

    const registry = new ProviderRegistry();
    registry.register(new AiSdkProvider({ id: 'anthropic', name: 'Anthropic', kind: 'anthropic', apiKey: 'sk' }));
    registry.setChatInterceptor(complianceChatInterceptor);

    const events = await runWithContext({ orgId: 'org-1', userId: 'u1' }, async () =>
      collect(
        registry.chatWithFallback(
          { model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi alice@example.com' }] },
          'anthropic',
        ),
      ),
    );
    const outText = events.filter((e) => e.type === 'text_delta').map((e) => (e as { content: string }).content).join('');
    expect(outText).toContain('alice@example.com');
  });
});
