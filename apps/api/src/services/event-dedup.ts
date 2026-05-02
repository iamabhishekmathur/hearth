import { Redis } from 'ioredis';
import { env } from '../config.js';
import { globalKey } from '../lib/redis-keys.js';

const redis = new Redis(env.REDIS_URL);
const DEDUP_TTL = 3600; // 1 hour

/**
 * Checks if a webhook event has already been processed (idempotency check).
 * Returns true if the event is a duplicate.
 *
 * Webhook dedup is intentionally global, not tenant-scoped: external
 * providers send the same delivery ID once regardless of which tenant
 * the webhook ultimately belongs to. The (provider, deliveryId) pair
 * is unique across all tenants by definition.
 */
export async function isDuplicate(provider: string, deliveryId: string): Promise<boolean> {
  if (!deliveryId) return false;
  const key = globalKey('webhook:dedup', provider, deliveryId);
  const result = await redis.set(key, '1', 'EX', DEDUP_TTL, 'NX');
  return result === null; // NX returns null if key already exists
}
