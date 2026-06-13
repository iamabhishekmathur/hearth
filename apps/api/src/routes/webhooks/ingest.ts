import { Router } from 'express';
import express from 'express';
import { logger } from '../../lib/logger.js';
import { getWebhookEndpointByToken } from '../../services/webhook-service.js';
import { verifyWebhookSignature } from '../../services/webhook-verifier.js';
import { normalizeEvent } from '../../services/event-normalizer.js';
import { findMatchingTriggers } from '../../services/trigger-matcher.js';
import { isDuplicate } from '../../services/event-dedup.js';
import { enqueueRoutineForEvent } from '../../jobs/routine-scheduler.js';
import { detectAndCreateTask, type FromHandle, type ThreadRef } from '../../services/task-detector.js';
import type { TaskSource } from '@hearth/shared';
import { prisma } from '../../lib/prisma.js';

const router: ReturnType<typeof Router> = Router();

// Raw body for signature verification. The global express.json() (mounted
// before this router) already consumes the request stream and stashes the
// exact bytes on req.rawBody via its verify hook; we read those below. This
// express.raw() is kept as a fallback for any path that bypasses global JSON
// parsing (e.g. non-JSON content types).
router.use(express.raw({ type: '*/*', limit: '1mb' }));

/** Recover the exact raw request body for HMAC verification. */
function getRawBody(req: { rawBody?: Buffer; body?: unknown }): string {
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  // Last resort: a parsed object with no captured raw bytes. Re-stringify so
  // signatureless/generic verification still works; HMAC providers require the
  // verify-hook raw bytes above.
  return req.body != null ? JSON.stringify(req.body) : '';
}

/**
 * POST /webhooks/ingest/:urlToken — generic webhook receiver
 * Verifies signature, normalizes event, matches triggers, enqueues routines.
 */
router.post('/:urlToken', async (req, res) => {
  const { urlToken } = req.params;

  const endpoint = await getWebhookEndpointByToken(urlToken);
  if (!endpoint || !endpoint.enabled) {
    res.status(404).json({ error: 'Webhook endpoint not found' });
    return;
  }

  const rawBody = getRawBody(req as { rawBody?: Buffer; body?: unknown });

  // Verify signature
  const headers: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(val) ? val[0] : val;
  }

  if (!verifyWebhookSignature(endpoint.provider, endpoint.secret, headers, rawBody)) {
    logger.warn({ provider: endpoint.provider, urlToken }, 'Webhook signature verification failed');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Parse payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  // Deduplicate
  const deliveryId = extractDeliveryId(endpoint.provider, headers, payload);
  if (deliveryId && await isDuplicate(endpoint.provider, deliveryId)) {
    logger.info({ provider: endpoint.provider, deliveryId }, 'Duplicate webhook event, skipping');
    res.status(200).json({ status: 'duplicate' });
    return;
  }

  // Determine event type from headers/payload
  const eventType = extractEventType(endpoint.provider, headers, payload);

  // Normalize event
  const normalizedEvent = normalizeEvent(endpoint.provider, eventType, payload);

  // Acknowledge immediately
  res.status(200).json({ status: 'accepted' });

  // Match triggers and enqueue
  try {
    const triggers = await findMatchingTriggers(endpoint.id, normalizedEvent.eventType, payload);
    logger.info(
      { provider: endpoint.provider, eventType: normalizedEvent.eventType, matchedTriggers: triggers.length },
      'Webhook event processed',
    );

    for (const trigger of triggers) {
      if (!trigger.routine.enabled) continue;

      // Map event fields to parameters
      const parameterMapping = trigger.parameterMapping as Record<string, string>;
      const parameterValues: Record<string, unknown> = {};
      for (const [paramName, eventPath] of Object.entries(parameterMapping)) {
        parameterValues[paramName] = getNestedValue(payload, eventPath);
      }

      // Update trigger last fired time
      await prisma.routineTrigger.update({
        where: { id: trigger.id },
        data: { lastTriggeredAt: new Date() },
      });

      await enqueueRoutineForEvent(
        trigger.routine.id,
        trigger.routine.userId,
        trigger.id,
        normalizedEvent,
        Object.keys(parameterValues).length > 0 ? parameterValues : undefined,
      );
    }
  } catch (err) {
    logger.error({ err, provider: endpoint.provider, eventType }, 'Failed to process webhook triggers');
  }

  // ── Work intake: actionable message → Task + navigation graph ──────────────
  // The generic ingest path is the canonical external entry point. For
  // message-shaped events we run the SAME detection pipeline the work-intake
  // worker runs (detectAndCreateTask), carrying fromHandle/threadRef so
  // landEdges() can populate Person + produced_by + discussed_in. This is what
  // makes an external signal become a navigable task node.
  try {
    const detected = extractMessageSignal(endpoint.provider, payload);
    if (detected) {
      const ownerUserId = await resolveIntakeOwner(endpoint.orgId);
      if (!ownerUserId) {
        logger.warn({ orgId: endpoint.orgId, provider: endpoint.provider }, 'Ingest detection skipped: org has no user to own intake');
      } else {
        const result = await detectAndCreateTask({
          source: detected.source,
          text: detected.text,
          from: detected.from,
          messageId: detected.messageId,
          channel: detected.channel,
          userId: ownerUserId,
          orgId: endpoint.orgId,
          fromHandle: detected.fromHandle,
          threadRef: detected.threadRef,
        });
        logger.info(
          { provider: endpoint.provider, created: result.created, taskId: result.taskId, reason: result.reason },
          'Ingest work-intake detection complete',
        );
      }
    }
  } catch (err) {
    logger.error({ err, provider: endpoint.provider, eventType }, 'Ingest work-intake detection failed');
  }
});

export interface MessageSignal {
  source: TaskSource;
  text: string;
  from: string;
  messageId: string;
  channel?: string;
  fromHandle?: FromHandle;
  threadRef?: ThreadRef;
}

/**
 * Extract a message-shaped work signal (text + author + thread) from a raw
 * provider payload, if the event looks like a human message. Returns null for
 * non-message events (the routine-trigger path above still handles those).
 */
export function extractMessageSignal(provider: string, payload: Record<string, unknown>): MessageSignal | null {
  if (provider === 'slack') {
    const event = payload.event as Record<string, unknown> | undefined;
    if (!event || event.type !== 'message') return null;
    // Ignore bot/system messages and edits — same guard as the slack route.
    if (event.bot_id || event.subtype) return null;
    const text = typeof event.text === 'string' ? event.text : '';
    if (!text.trim()) return null;

    const user = typeof event.user === 'string' ? event.user : undefined;
    const ts = typeof event.ts === 'string' ? event.ts : undefined;
    const threadTs = typeof event.thread_ts === 'string' ? event.thread_ts : ts;
    const channel = typeof event.channel === 'string' ? event.channel : undefined;
    const clientMsgId = typeof event.client_msg_id === 'string' ? event.client_msg_id : undefined;

    return {
      source: 'slack',
      text,
      from: user ?? 'unknown',
      messageId: clientMsgId ?? ts ?? `slack:${Date.now()}`,
      channel,
      fromHandle: user ? { provider: 'slack', externalId: user } : undefined,
      threadRef: threadTs ? { provider: 'slack', externalId: threadTs } : undefined,
    };
  }

  if (provider === 'email') {
    // Inbound-email shape (forwarding/parse services like SendGrid, Postmark,
    // Mailgun, or a Granola/Gmail forward). We accept the common header fields
    // and prefer plain text over HTML. Threading uses the RFC-822 message-id
    // family (References/In-Reply-To → conversation root) so replies on the same
    // email thread land on the same task node.
    const fromRaw = firstString(payload.from, payload.sender, payload.From);
    const subject = firstString(payload.subject, payload.Subject) ?? '';
    const bodyText =
      firstString(payload.text, payload.body, payload.plain, payload['body-plain'], payload.TextBody) ??
      stripHtml(firstString(payload.html, payload.HtmlBody, payload['body-html']));
    // The actionable signal is subject + body — a one-line subject is often the
    // whole ask ("Please update the SOC2 evidence doc").
    const text = [subject, bodyText].filter(Boolean).join('\n\n').trim();
    if (!fromRaw || !text) return null;

    const fromEmail = extractEmailAddress(fromRaw);
    const messageId =
      firstString(payload.messageId, payload['message-id'], payload.MessageID, payload.Message_Id) ??
      `email:${fromEmail}:${subject}`;
    // Conversation root: the first id in References, else In-Reply-To, else this
    // message stands alone (its own id is the thread root).
    const references = firstString(payload.references, payload.References);
    const inReplyTo = firstString(payload.inReplyTo, payload['in-reply-to'], payload.InReplyTo);
    const threadRoot =
      (references ? references.trim().split(/\s+/)[0] : undefined) ?? inReplyTo ?? messageId;

    return {
      source: 'email',
      text,
      from: fromEmail,
      messageId,
      channel: firstString(payload.to, payload.To, payload.recipient),
      fromHandle: { provider: 'email', externalId: fromEmail },
      threadRef: { provider: 'email', externalId: threadRoot },
    };
  }

  return null;
}

/** First argument that is a non-empty string, else undefined. */
function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

/** Pull the bare address out of an RFC-822 From header ("Alice <a@x.com>"). */
function extractEmailAddress(from: string): string {
  const angle = from.match(/<([^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  return from.trim().toLowerCase();
}

/** Crude HTML→text fallback for emails that only carry an HTML body. */
function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve which Hearth user should own tasks auto-created from this org's
 * webhook. Prefers an ADMIN (deterministic, stable), falling back to the
 * earliest-created user in the org. Returns null if the org has no users.
 */
async function resolveIntakeOwner(orgId: string): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { team: { orgId }, role: 'admin' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (admin) return admin.id;

  const anyUser = await prisma.user.findFirst({
    where: { team: { orgId } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return anyUser?.id ?? null;
}

function extractDeliveryId(
  provider: string,
  headers: Record<string, string | undefined>,
  payload: Record<string, unknown>,
): string | undefined {
  switch (provider) {
    case 'github':
      return headers['x-github-delivery'];
    case 'slack':
      return (payload.event_id as string) ?? undefined;
    case 'email':
      return (
        (payload.messageId as string) ??
        (payload['message-id'] as string) ??
        (payload.MessageID as string) ??
        undefined
      );
    default:
      return headers['x-delivery-id'] ?? headers['x-request-id'] ?? undefined;
  }
}

function extractEventType(
  provider: string,
  headers: Record<string, string | undefined>,
  payload: Record<string, unknown>,
): string {
  switch (provider) {
    case 'github':
      return headers['x-github-event'] ?? 'unknown';
    case 'jira':
      return (payload.webhookEvent as string) ?? 'unknown';
    case 'slack': {
      const event = payload.event as Record<string, unknown> | undefined;
      return event?.type as string ?? payload.type as string ?? 'unknown';
    }
    default:
      return (payload.type as string) ?? (payload.event_type as string) ?? 'unknown';
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export default router;
