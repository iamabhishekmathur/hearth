import { providerRegistry } from '../llm/provider-registry.js';
import { logger } from '../lib/logger.js';

interface DetectionResult {
  isDecision: boolean;
  confidence: number;
  type: 'explicit' | 'implicit' | 'referenced' | 'none';
}

// Fast filter patterns
const POSITIVE_PATTERNS = [
  /\bwe decided\b/i,
  /\blet'?s go with\b/i,
  /\bagreed to\b/i,
  /\bfinal call\b/i,
  /\bapproved\b/i,
  /\bwe chose\b/i,
  /\bprioritize .+ over\b/i,
  /\bthe decision is\b/i,
  /\bwe'?re going (to|with)\b/i,
  /\bgoing forward,? we\b/i,
  /\bwe'?ll (go|use|adopt|switch|migrate|implement)\b/i,
  /\bdecided (to|on|that)\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bshould we decide\b/i,
  /\bcan'?t decide\b/i,
  /\bwhat did we decide\b/i,
  /\bhaven'?t decided\b/i,
  /\bneed to decide\b/i,
  /\bhelp (me|us) decide\b/i,
];

/**
 * Fast regex-based pre-filter. Returns true if the text contains decision language.
 */
export function fastFilter(text: string): boolean {
  // Check negatives first
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  // Check positives
  for (const pattern of POSITIVE_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

/**
 * LLM-based classification for decision detection.
 * Only called if fastFilter returns true.
 */
export async function classifyDecision(text: string): Promise<DetectionResult> {
  try {
    const messages = [
      {
        role: 'user' as const,
        content: `Analyze whether this text contains a decision being made (not a question about decisions).

Text: "${text.slice(0, 2000)}"

Respond with ONLY a JSON object:
{"isDecision": boolean, "confidence": 0.0-1.0, "type": "explicit"|"implicit"|"referenced"|"none"}

- explicit: clear decision statement ("we decided to...")
- implicit: decision implied by action ("let's go with X")
- referenced: referring to a past decision ("as we agreed...")
- none: no decision`,
      },
    ];

    let result = '';
    const stream = providerRegistry.chatWithFallback({
      model: 'claude-haiku-4-5',
      messages,
      maxTokens: 100,
    });

    for await (const event of stream) {
      if (event.type === 'text_delta') result += event.content;
    }

    const parsed = JSON.parse(result.trim());
    return {
      isDecision: parsed.isDecision ?? false,
      confidence: parsed.confidence ?? 0,
      type: parsed.type ?? 'none',
    };
  } catch (err) {
    logger.debug({ err }, 'Decision classification failed');
    return { isDecision: false, confidence: 0, type: 'none' };
  }
}

/**
 * Full detection pipeline: fast filter → LLM classification.
 */
export async function detectDecision(text: string): Promise<DetectionResult> {
  if (!fastFilter(text)) {
    return { isDecision: false, confidence: 0, type: 'none' };
  }
  return classifyDecision(text);
}
