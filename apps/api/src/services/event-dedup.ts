import { Redis } from 'ioredis';
import { env } from '../config.js';

const redis = new Redis(env.REDIS_URL);
const DEDUP_PREFIX = 'webhook:dedup:';
const DEDUP_TTL = 3600; // 1 hour

/**
 * Checks if a webhook event has already been processed (idempotency check).
 * Returns true if the event is a duplicate.
 */
export async function isDuplicate(provider: string, deliveryId: string): Promise<boolean> {
  if (!deliveryId) return false;
  const key = `${DEDUP_PREFIX}${provider}:${deliveryId}`;
  const result = await redis.set(key, '1', 'EX', DEDUP_TTL, 'NX');
  return result === null; // NX returns null if key already exists
}
