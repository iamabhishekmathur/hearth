import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../llm/provider-registry.js', () => ({
  providerRegistry: { chatWithFallback: vi.fn() },
}));
vi.mock('../lib/logger.js', () => ({ logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { providerRegistry } from '../llm/provider-registry.js';
import { classifyDecision, fastFilter } from './decision-detector.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** Make the classifier LLM return `text` verbatim. */
function mockLLM(text: string) {
  async function* stream() {
    yield { type: 'text_delta' as const, content: text };
    yield { type: 'done' as const, usage: { input_tokens: 1, output_tokens: 1 } };
  }
  asMock(providerRegistry.chatWithFallback).mockReturnValue(stream());
}

beforeEach(() => vi.clearAllMocks());

describe('classifyDecision — robust JSON parsing', () => {
  it('parses a bare JSON object', async () => {
    mockLLM('{"isDecision": true, "confidence": 0.95, "type": "explicit"}');
    const r = await classifyDecision('We decided to adopt Postgres.');
    expect(r.isDecision).toBe(true);
    expect(r.confidence).toBe(0.95);
  });

  it('parses a ```json fenced response (the real-world failure that silently dropped decisions)', async () => {
    mockLLM('```json\n{"isDecision": true, "confidence": 0.99, "type": "explicit"}\n```');
    const r = await classifyDecision('Decision: we will standardize on gRPC.');
    expect(r.isDecision).toBe(true);
    expect(r.confidence).toBe(0.99);
  });

  it('parses JSON wrapped in prose', async () => {
    mockLLM('Sure! Here is the classification:\n{"isDecision": true, "confidence": 0.8, "type": "implicit"}\nHope that helps.');
    const r = await classifyDecision('Let\'s go with the queue-backed approach.');
    expect(r.isDecision).toBe(true);
  });

  it('treats a provider stream error as non-fatal (no decision), not a crash', async () => {
    async function* errStream() {
      yield { type: 'error' as const, message: 'provider down' };
    }
    asMock(providerRegistry.chatWithFallback).mockReturnValue(errStream());
    const r = await classifyDecision('We decided to adopt Postgres.');
    expect(r.isDecision).toBe(false);
  });
});

describe('fastFilter', () => {
  it('passes explicit decision language', () => {
    expect(fastFilter('Decision: we decided to standardize on Postgres.')).toBe(true);
  });
  it('rejects a question about deciding', () => {
    expect(fastFilter('what did we decide on the datastore?')).toBe(false);
  });
});
