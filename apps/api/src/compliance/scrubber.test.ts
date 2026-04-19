import { describe, it, expect } from 'vitest';
import {
  createTokenMap,
  detectEntities,
  scrubText,
  scrubChatParams,
  descrubText,
  descrubStream,
  scrubTextsForEmbed,
  processSafeBlocks,
} from './scrubber.js';
import { resolveDetectors } from './packs/index.js';
import type { ChatEvent, ChatParams } from '@hearth/shared';
import type { OrgComplianceConfig } from './types.js';

// ── Helpers ──

function makeConfig(packs: string[]): OrgComplianceConfig {
  return { enabledPacks: packs, auditLevel: 'summary', allowUserOverride: false };
}

async function collectStream(stream: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function* mockStream(events: ChatEvent[]): AsyncGenerator<ChatEvent> {
  for (const event of events) {
    yield event;
  }
}

// ── Token Map ──

describe('createTokenMap', () => {
  it('creates an empty token map', () => {
    const tm = createTokenMap();
    expect(tm.toOriginal.size).toBe(0);
    expect(tm.toPlaceholder.size).toBe(0);
    expect(tm.counters.size).toBe(0);
  });
});

// ── Detection ──

describe('detectEntities', () => {
  it('detects SSNs', () => {
    const detectors = resolveDetectors(['pii']);
    const entities = detectEntities('My SSN is 123-45-6789.', detectors);
    const ssn = entities.find((e) => e.entityType === 'SSN');
    expect(ssn).toBeDefined();
    expect(ssn!.originalValue).toBe('123-45-6789');
  });

  it('rejects invalid SSNs', () => {
    const detectors = resolveDetectors(['pii']);
    // Area 000 is invalid
    const entities = detectEntities('SSN: 000-12-3456', detectors);
    const ssn = entities.find((e) => e.entityType === 'SSN');
    expect(ssn).toBeUndefined();
  });

  it('detects email addresses', () => {
    const detectors = resolveDetectors(['pii']);
    const entities = detectEntities('Contact me at john@example.com please.', detectors);
    const email = entities.find((e) => e.entityType === 'EMAIL');
    expect(email).toBeDefined();
    expect(email!.originalValue).toBe('john@example.com');
  });

  it('detects phone numbers', () => {
    const detectors = resolveDetectors(['pii']);
    const entities = detectEntities('Call me at (555) 123-4567.', detectors);
    const phone = entities.find((e) => e.entityType === 'PHONE');
    expect(phone).toBeDefined();
  });

  it('detects person names with title', () => {
    const detectors = resolveDetectors(['pii']);
    const entities = detectEntities('Please contact Dr. Jane Smith about this.', detectors);
    const name = entities.find((e) => e.entityType === 'PERSON_NAME');
    expect(name).toBeDefined();
    expect(name!.originalValue).toContain('Jane Smith');
  });

  it('detects street addresses', () => {
    const detectors = resolveDetectors(['pii']);
    const entities = detectEntities('I live at 123 Main Street in Springfield.', detectors);
    const addr = entities.find((e) => e.entityType === 'ADDRESS');
    expect(addr).toBeDefined();
    expect(addr!.originalValue).toContain('123 Main Street');
  });

  it('handles no detections gracefully', () => {
    const detectors = resolveDetectors(['pii']);
    const entities = detectEntities('Just a normal message with no PII.', detectors);
    expect(entities.length).toBe(0);
  });

  it('removes overlapping entities', () => {
    const detectors = resolveDetectors(['pii']);
    // A message where email and name might overlap
    const text = 'Dr. John Smith emailed at john@example.com';
    const entities = detectEntities(text, detectors);
    // Ensure no overlaps: each entity's range should not overlap
    for (let i = 1; i < entities.length; i++) {
      expect(entities[i].startIndex).toBeGreaterThanOrEqual(entities[i - 1].endIndex);
    }
  });
});

// ── Text Scrubbing ──

describe('scrubText', () => {
  it('replaces SSN with placeholder', () => {
    const detectors = resolveDetectors(['pii']);
    const tokenMap = createTokenMap();
    const result = scrubText('SSN: 123-45-6789', detectors, tokenMap);
    expect(result.scrubbedText).toContain('[SSN_1]');
    expect(result.scrubbedText).not.toContain('123-45-6789');
    expect(result.entities.length).toBeGreaterThan(0);
  });

  it('uses consistent placeholders for same value', () => {
    const detectors = resolveDetectors(['pii']);
    const tokenMap = createTokenMap();
    scrubText('SSN is 123-45-6789', detectors, tokenMap);
    const result2 = scrubText('Again: 123-45-6789', detectors, tokenMap);
    expect(result2.scrubbedText).toContain('[SSN_1]');
  });

  it('increments counters for different values', () => {
    const detectors = resolveDetectors(['pii']);
    const tokenMap = createTokenMap();
    const result = scrubText('SSN: 123-45-6789 and 234-56-7890', detectors, tokenMap);
    expect(result.scrubbedText).toContain('[SSN_1]');
    expect(result.scrubbedText).toContain('[SSN_2]');
  });

  it('returns unchanged text when no entities found', () => {
    const detectors = resolveDetectors(['pii']);
    const tokenMap = createTokenMap();
    const result = scrubText('Nothing sensitive here.', detectors, tokenMap);
    expect(result.scrubbedText).toBe('Nothing sensitive here.');
    expect(result.entities.length).toBe(0);
  });
});

// ── Chat Params Scrubbing ──

describe('scrubChatParams', () => {
  it('scrubs messages and system prompt', () => {
    const params: ChatParams = {
      model: 'test',
      messages: [
        { role: 'user', content: 'My SSN is 123-45-6789' },
      ],
      systemPrompt: 'Dr. John Smith is the patient.',
    };
    const config = makeConfig(['pii']);
    const result = scrubChatParams(params, config);
    const userMsg = result.scrubbedParams.messages[0];
    expect(typeof userMsg.content === 'string' ? userMsg.content : '').toContain('[SSN_1]');
    expect(result.totalEntities).toBeGreaterThan(0);
  });

  it('adds compliance notice to system prompt when entities found', () => {
    const params: ChatParams = {
      model: 'test',
      messages: [{ role: 'user', content: 'SSN: 123-45-6789' }],
      systemPrompt: 'You are a helpful assistant.',
    };
    const config = makeConfig(['pii']);
    const result = scrubChatParams(params, config);
    expect(result.scrubbedParams.systemPrompt).toContain('placeholders');
  });

  it('passes through when no packs enabled', () => {
    const params: ChatParams = {
      model: 'test',
      messages: [{ role: 'user', content: 'SSN: 123-45-6789' }],
    };
    const config = makeConfig([]);
    const result = scrubChatParams(params, config);
    expect(result.scrubbedParams).toBe(params);
    expect(result.totalEntities).toBe(0);
  });

  it('handles ContentPart[] messages', () => {
    const params: ChatParams = {
      model: 'test',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'My SSN is 123-45-6789' },
            { type: 'image', mimeType: 'image/png', data: 'base64data' },
          ],
        },
      ],
    };
    const config = makeConfig(['pii']);
    const result = scrubChatParams(params, config);
    const content = result.scrubbedParams.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      const textPart = content.find((p) => p.type === 'text');
      expect(textPart && 'text' in textPart ? textPart.text : '').toContain('[SSN_1]');
      const imgPart = content.find((p) => p.type === 'image');
      expect(imgPart).toBeDefined();
    }
  });
});

// ── Descrub ──

describe('descrubText', () => {
  it('replaces placeholders with original values', () => {
    const tokenMap = createTokenMap();
    tokenMap.toOriginal.set('[SSN_1]', '123-45-6789');
    tokenMap.toPlaceholder.set('123-45-6789', '[SSN_1]');

    const result = descrubText('Your SSN is [SSN_1].', tokenMap);
    expect(result).toBe('Your SSN is 123-45-6789.');
  });

  it('handles multiple placeholders', () => {
    const tokenMap = createTokenMap();
    tokenMap.toOriginal.set('[SSN_1]', '123-45-6789');
    tokenMap.toOriginal.set('[EMAIL_1]', 'john@example.com');

    const result = descrubText('[SSN_1] belongs to [EMAIL_1]', tokenMap);
    expect(result).toBe('123-45-6789 belongs to john@example.com');
  });

  it('leaves unknown placeholders unchanged', () => {
    const tokenMap = createTokenMap();
    const result = descrubText('Unknown [FOO_99]', tokenMap);
    expect(result).toBe('Unknown [FOO_99]');
  });
});

// ── Stream Descrubbing ──

describe('descrubStream', () => {
  it('descrubs text_delta events', async () => {
    const tokenMap = createTokenMap();
    tokenMap.toOriginal.set('[SSN_1]', '123-45-6789');

    const events: ChatEvent[] = [
      { type: 'text_delta', content: 'Your SSN is [SSN_1].' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ];

    const result = await collectStream(descrubStream(mockStream(events), tokenMap));
    const textEvents = result.filter((e) => e.type === 'text_delta');
    const fullText = textEvents.map((e) => (e as { content: string }).content).join('');
    expect(fullText).toContain('123-45-6789');
  });

  it('handles split placeholders across chunks', async () => {
    const tokenMap = createTokenMap();
    tokenMap.toOriginal.set('[SSN_1]', '123-45-6789');

    const events: ChatEvent[] = [
      { type: 'text_delta', content: 'SSN is [SS' },
      { type: 'text_delta', content: 'N_1] ok.' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ];

    const result = await collectStream(descrubStream(mockStream(events), tokenMap));
    const textEvents = result.filter((e) => e.type === 'text_delta');
    const fullText = textEvents.map((e) => (e as { content: string }).content).join('');
    expect(fullText).toContain('123-45-6789');
  });

  it('passes through when token map is empty', async () => {
    const tokenMap = createTokenMap();
    const events: ChatEvent[] = [
      { type: 'text_delta', content: 'Hello world' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ];

    const result = await collectStream(descrubStream(mockStream(events), tokenMap));
    expect(result).toEqual(events);
  });

  it('descrubs tool_call_start input', async () => {
    const tokenMap = createTokenMap();
    tokenMap.toOriginal.set('[PERSON_NAME_1]', 'John Smith');

    const events: ChatEvent[] = [
      { type: 'tool_call_start', id: '1', tool: 'send_email', input: { to: '[PERSON_NAME_1]' } },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ];

    const result = await collectStream(descrubStream(mockStream(events), tokenMap));
    const toolEvent = result.find((e) => e.type === 'tool_call_start') as { input: Record<string, unknown> };
    expect(toolEvent.input.to).toBe('John Smith');
  });
});

// ── Embed Scrubbing ──

describe('scrubTextsForEmbed', () => {
  it('scrubs PII from embedding texts', () => {
    const config = makeConfig(['pii']);
    const result = scrubTextsForEmbed(['My SSN is 123-45-6789'], config);
    expect(result[0]).toContain('[SSN_1]');
    expect(result[0]).not.toContain('123-45-6789');
  });

  it('passes through when no packs enabled', () => {
    const config = makeConfig([]);
    const texts = ['My SSN is 123-45-6789'];
    const result = scrubTextsForEmbed(texts, config);
    expect(result).toEqual(texts);
  });
});

// ── Safe Blocks ──

describe('processSafeBlocks', () => {
  it('strips safe tags when allowed', () => {
    const result = processSafeBlocks('Hello <safe>john@example.com</safe> world', true);
    expect(result.processedText).toBe('Hello john@example.com world');
    expect(result.safeBlocks).toEqual(['john@example.com']);
  });

  it('ignores safe tags when not allowed', () => {
    const result = processSafeBlocks('Hello <safe>john@example.com</safe>', false);
    expect(result.processedText).toBe('Hello <safe>john@example.com</safe>');
    expect(result.safeBlocks).toEqual([]);
  });
});

// ── Multi-pack ──

describe('multi-pack scrubbing', () => {
  it('scrubs SSN and credit card with PII + PCI packs', () => {
    const detectors = resolveDetectors(['pii', 'pci-dss']);
    const tokenMap = createTokenMap();
    const result = scrubText(
      'SSN: 123-45-6789, Card: 4111-1111-1111-1111',
      detectors,
      tokenMap,
    );
    expect(result.scrubbedText).toContain('[SSN_1]');
    expect(result.scrubbedText).toContain('[CREDIT_CARD_1]');
    expect(result.scrubbedText).not.toContain('123-45-6789');
    expect(result.scrubbedText).not.toContain('4111');
  });

  it('PHI pack includes PII detectors', () => {
    const detectors = resolveDetectors(['phi']);
    const tokenMap = createTokenMap();
    const result = scrubText(
      'Patient SSN: 123-45-6789, MRN: MRN12345',
      detectors,
      tokenMap,
    );
    expect(result.scrubbedText).toContain('[SSN_1]');
    expect(result.scrubbedText).toContain('[MRN_1]');
  });
});
