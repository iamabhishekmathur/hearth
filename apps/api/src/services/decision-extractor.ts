import { providerRegistry } from '../llm/provider-registry.js';
import { logger } from '../lib/logger.js';

export interface ExtractedDecision {
  title: string;
  reasoning: string;
  alternatives: Array<{ label: string; pros?: string; cons?: string }>;
  stakeholders: string[];
  domain: string;
  reversibility: 'easily_reversible' | 'costly_to_reverse' | 'irreversible';
  timeHorizon: string;
  confidence: number;
  relatedTopics: string[];
}

const EXTRACTION_PROMPT = `Extract the decision from this conversation text. Return a JSON object:

{
  "title": "Short, clear decision title (max 100 chars)",
  "reasoning": "Why this decision was made — the rationale",
  "alternatives": [{"label": "Alternative A", "pros": "...", "cons": "..."}],
  "stakeholders": ["person or role involved"],
  "domain": "engineering|product|hiring|design|operations|marketing|finance|legal|strategy|other",
  "reversibility": "easily_reversible|costly_to_reverse|irreversible",
  "timeHorizon": "short-term|medium-term|long-term",
  "confidence": 0.0-1.0,
  "relatedTopics": ["topic1", "topic2"]
}

Rules:
- Title should be a clear statement of what was decided
- Reasoning should capture the WHY, not just the WHAT
- Include alternatives that were considered (even if rejected)
- Stakeholders are people who participated in or are affected by the decision
- Domain should be one of the listed categories
- Confidence reflects how certain the decision appears in context

Respond with ONLY the JSON object.`;

/**
 * Extract decision details from text using LLM.
 */
export async function extractDecision(text: string): Promise<ExtractedDecision | null> {
  try {
    const messages = [
      { role: 'user' as const, content: `${EXTRACTION_PROMPT}\n\nText:\n${text.slice(0, 4000)}` },
    ];

    let result = '';
    const stream = providerRegistry.chatWithFallback({
      model: 'claude-haiku-4-5',
      messages,
      maxTokens: 500,
    });

    for await (const event of stream) {
      if (event.type === 'text_delta') result += event.content;
    }

    // Clean up response (remove markdown fences if present)
    const cleaned = result.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);

    return {
      title: parsed.title ?? 'Untitled Decision',
      reasoning: parsed.reasoning ?? '',
      alternatives: parsed.alternatives ?? [],
      stakeholders: parsed.stakeholders ?? [],
      domain: parsed.domain ?? 'other',
      reversibility: parsed.reversibility ?? 'easily_reversible',
      timeHorizon: parsed.timeHorizon ?? 'medium-term',
      confidence: parsed.confidence ?? 0.5,
      relatedTopics: parsed.relatedTopics ?? [],
    };
  } catch (err) {
    logger.debug({ err }, 'Decision extraction failed');
    return null;
  }
}

/**
 * Extract multiple decisions from a meeting transcript.
 */
export async function extractDecisionsFromTranscript(
  transcript: string,
): Promise<ExtractedDecision[]> {
  try {
    const messages = [
      {
        role: 'user' as const,
        content: `Extract ALL decisions from this meeting transcript. Return a JSON array of decision objects.

Each decision:
{
  "title": "Clear decision statement",
  "reasoning": "Why this was decided",
  "alternatives": [{"label": "Alt", "pros": "...", "cons": "..."}],
  "stakeholders": ["person"],
  "domain": "engineering|product|hiring|design|operations|marketing|finance|legal|strategy|other",
  "reversibility": "easily_reversible|costly_to_reverse|irreversible",
  "timeHorizon": "short-term|medium-term|long-term",
  "confidence": 0.0-1.0,
  "relatedTopics": []
}

Respond with ONLY a JSON array. If no decisions found, return [].

Transcript:
${transcript.slice(0, 8000)}`,
      },
    ];

    let result = '';
    const stream = providerRegistry.chatWithFallback({
      model: 'claude-haiku-4-5',
      messages,
      maxTokens: 2000,
    });

    for await (const event of stream) {
      if (event.type === 'text_delta') result += event.content;
    }

    const cleaned = result.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
    return JSON.parse(cleaned);
  } catch (err) {
    logger.debug({ err }, 'Transcript decision extraction failed');
    return [];
  }
}
