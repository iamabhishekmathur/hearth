import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import * as taskService from './task-service.js';
import { emitToUser } from '../ws/socket-manager.js';
import { checkDuplicate } from './intake-deduplicator.js';
import { providerRegistry } from '../llm/provider-registry.js';
import type { TaskSource } from '@hearth/shared';

interface DetectedMessage {
  source: TaskSource;
  text: string;
  from: string;
  messageId: string;
  channel?: string;
  snippet?: string;
  userId: string;
  orgId: string;
}

// ── Fast pre-filter (skip obvious non-actionable messages) ──────────────

const SKIP_PATTERNS = [
  /^(lol|haha|nice|thanks|thx|ty|ok|k|👍|🙏|💯|🎉|✅)+[.!]?$/i,
  /^(gm|good morning|good night|gn|brb|afk)$/i,
];

const MIN_LENGTH = 10; // Messages shorter than this are rarely actionable

/**
 * Quick keyword check — returns true if the message is obviously NOT actionable,
 * so we can skip the LLM call entirely. Conservative: when in doubt, returns false
 * (i.e. let the LLM decide).
 */
function isObviouslyNotActionable(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_LENGTH) return true;
  return SKIP_PATTERNS.some((p) => p.test(trimmed));
}

// ── LLM classification ──────────────────────────────────────────────────

const CLASSIFICATION_MODEL = 'claude-haiku-4-5-20251001';

const CLASSIFICATION_SYSTEM_PROMPT = `You classify messages from team communication tools (Slack, email, meeting notes) as actionable or not.

A message is ACTIONABLE if it contains a task, request, action item, or something someone needs to do. Examples:
- "Can you review the PR for the auth refactor?" → actionable
- "We need to update the deploy config before Friday" → actionable
- "The login page is broken on mobile" → actionable (implicit request to fix)
- "Action item from standup: migrate the analytics" → actionable

A message is NOT actionable if it's purely informational, social, or status-sharing. Examples:
- "FYI the build passed" → not actionable
- "Just shipped the hotfix, all good now" → not actionable
- "Happy Friday everyone!" → not actionable
- "Can you believe how good this sunset is?" → not actionable

Respond ONLY with valid JSON. No other text.`;

interface ClassificationResult {
  actionable: boolean;
  confidence: number;
  title: string;
  description: string;
}

/**
 * Classify a message using an LLM. Returns actionability, confidence,
 * and a clean title + description extracted from the message.
 */
async function classifyWithLLM(
  text: string,
  context?: { channel?: string; from?: string; source?: string },
): Promise<ClassificationResult> {
  const contextParts: string[] = [];
  if (context?.source) contextParts.push(`Source: ${context.source}`);
  if (context?.channel) contextParts.push(`Channel: ${context.channel}`);
  if (context?.from) contextParts.push(`From: ${context.from}`);
  const contextStr = contextParts.length > 0 ? `\n${contextParts.join(', ')}\n` : '';

  const userPrompt = `${contextStr}Message: "${text}"

Classify this message and respond with JSON:
{
  "actionable": true/false,
  "confidence": 0.0-1.0,
  "title": "short imperative title if actionable, empty string if not",
  "description": "one-line description of what needs to be done, empty string if not actionable"
}`;

  const stream = providerRegistry.chatWithFallback({
    model: CLASSIFICATION_MODEL,
    messages: [{ role: 'user', content: userPrompt }],
    systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
    maxTokens: 256,
  });

  let raw = '';
  for await (const event of stream) {
    if (event.type === 'text_delta') raw += event.content;
    if (event.type === 'error') {
      throw new Error(`Classification LLM error: ${event.message}`);
    }
  }

  // Parse — tolerate markdown fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1] : raw;

  try {
    const parsed = JSON.parse(jsonStr.trim()) as Record<string, unknown>;
    return {
      actionable: parsed.actionable === true,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      title: typeof parsed.title === 'string' ? parsed.title.slice(0, 200) : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
    };
  } catch {
    logger.warn({ raw }, 'Failed to parse LLM classification response');
    return { actionable: false, confidence: 0, title: '', description: '' };
  }
}

// ── Backward-compatible exported classifier (used by tests) ─────────────

/**
 * Classify whether a message is actionable.
 * Uses LLM for nuanced understanding, with a fast pre-filter to skip
 * trivially non-actionable messages.
 */
export async function classifyMessage(
  text: string,
  context?: { channel?: string; from?: string; source?: string },
): Promise<{ actionable: boolean; confidence: number; title: string; description: string }> {
  if (isObviouslyNotActionable(text)) {
    return { actionable: false, confidence: 0, title: '', description: '' };
  }

  return classifyWithLLM(text, context);
}

// ── Main detection pipeline ──────────────────────────────────────────────

/**
 * Process a message for task detection.
 * Classifies via LLM, deduplicates, and creates tasks for actionable messages.
 */
export async function detectAndCreateTask(
  message: DetectedMessage,
): Promise<{ created: boolean; taskId?: string; reason?: string }> {
  const classification = await classifyMessage(message.text, {
    channel: message.channel,
    from: message.from,
    source: message.source,
  });

  if (!classification.actionable) {
    return {
      created: false,
      reason: `Not actionable (confidence: ${classification.confidence.toFixed(2)})`,
    };
  }

  // Check for duplicates
  const isDuplicate = await checkDuplicate(message.userId, classification.title);
  if (isDuplicate) {
    return { created: false, reason: 'Duplicate detected' };
  }

  try {
    const task = await taskService.createTask(message.orgId, message.userId, {
      title: classification.title,
      description: classification.description || message.text,
      source: message.source,
    });

    // Update with sourceRef metadata
    await prisma.task.update({
      where: { id: task.id },
      data: {
        sourceRef: {
          messageId: message.messageId,
          channel: message.channel,
          from: message.from,
          snippet: message.snippet ?? message.text.slice(0, 200),
          classificationConfidence: classification.confidence,
        },
      },
    });

    // Notify user via WebSocket
    emitToUser(message.userId, 'notification', {
      type: 'task_auto_detected',
      title: 'New task detected',
      body: classification.title,
      entityType: 'task',
      entityId: task.id,
      source: message.source,
    });

    logger.info(
      { taskId: task.id, source: message.source, confidence: classification.confidence },
      'Auto-detected task created',
    );
    return { created: true, taskId: task.id };
  } catch (err) {
    logger.error({ err, source: message.source }, 'Failed to create auto-detected task');
    return { created: false, reason: 'Creation failed' };
  }
}
