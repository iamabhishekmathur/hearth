import { Router } from 'express';
import express from 'express';
import { logger } from '../../lib/logger.js';
import { getWebhookEndpointByToken } from '../../services/webhook-service.js';
import { verifyWebhookSignature } from '../../services/webhook-verifier.js';
import { normalizeEvent } from '../../services/event-normalizer.js';
import { findMatchingTriggers } from '../../services/trigger-matcher.js';
import { isDuplicate } from '../../services/event-dedup.js';
import { enqueueRoutineForEvent } from '../../jobs/routine-scheduler.js';
import { prisma } from '../../lib/prisma.js';

const router: ReturnType<typeof Router> = Router();

// Raw body for signature verification
router.use(express.raw({ type: '*/*', limit: '1mb' }));

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

  const rawBody = typeof req.body === 'string' ? req.body : req.body.toString();

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
});

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
