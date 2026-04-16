import Redis from 'ioredis';
import { env } from '../config.js';
import { logger } from './logger.js';

const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}
