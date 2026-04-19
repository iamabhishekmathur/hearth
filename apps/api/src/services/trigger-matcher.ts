import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

interface TriggerFilter {
  field: string;
  operator: '$eq' | '$contains' | '$not' | '$in';
  value: unknown;
}

/**
 * Finds matching triggers for a given webhook endpoint and event type.
 * Evaluates filter conditions against the event payload.
 */
export async function findMatchingTriggers(
  webhookEndpointId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  // Query triggers that match the endpoint and event type pattern
  const triggers = await prisma.routineTrigger.findMany({
    where: {
      webhookEndpointId,
      status: 'active',
    },
    include: {
      routine: { select: { id: true, userId: true, enabled: true, prompt: true, parameters: true } },
    },
  });

  return triggers.filter((trigger) => {
    // Match event type — support exact match and wildcard prefix (e.g., "pull_request.*")
    if (!matchesEventType(trigger.eventType, eventType)) return false;

    // Evaluate filter conditions
    const filters = trigger.filters as Record<string, unknown>;
    if (!filters || Object.keys(filters).length === 0) return true;

    return evaluateFilters(filters, payload);
  });
}

function matchesEventType(pattern: string, actual: string): boolean {
  if (pattern === actual) return true;
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return actual.startsWith(prefix);
  }
  return false;
}

function evaluateFilters(filters: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(filters)) {
    const value = getNestedValue(payload, key);
    if (!evaluateCondition(value, condition)) return false;
  }
  return true;
}

/**
 * Gets a nested value from an object using dot notation.
 * e.g., getNestedValue({ a: { b: 1 } }, 'a.b') => 1
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateCondition(value: unknown, condition: unknown): boolean {
  if (condition === null || condition === undefined) return true;

  // Simple equality check
  if (typeof condition !== 'object') {
    return value === condition;
  }

  const cond = condition as Record<string, unknown>;

  if ('$eq' in cond) return value === cond.$eq;
  if ('$not' in cond) return value !== cond.$not;
  if ('$contains' in cond) {
    return typeof value === 'string' && value.includes(String(cond.$contains));
  }
  if ('$in' in cond) {
    return Array.isArray(cond.$in) && (cond.$in as unknown[]).includes(value);
  }

  return true;
}
