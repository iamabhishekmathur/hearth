import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { synthesizeForUser } from '../services/synthesis-service.js';

const QUEUE_NAME = 'memory-synthesis';
const connection = { url: env.REDIS_URL };

// Queue for scheduling synthesis jobs
export const synthesisQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 }, // 1min, 2min, 4min
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

/**
 * Creates the synthesis worker that processes per-user synthesis jobs.
 */
export function createSynthesisWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ userId: string }>) => {
      const { userId } = job.data;
      logger.info({ userId, jobId: job.id }, 'Starting synthesis for user');

      const result = await synthesizeForUser(userId);

      logger.info({ userId, jobId: job.id, ...result }, 'Synthesis completed');
      return result;
    },
    {
      connection,
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Synthesis job failed');
  });

  return worker;
}

/**
 * Schedules daily synthesis for all active users.
 * Call this on worker startup to set up the repeatable job.
 */
export async function scheduleDailySynthesis() {
  // Remove existing repeatable jobs to avoid duplicates
  const repeatable = await synthesisQueue.getRepeatableJobs();
  for (const job of repeatable) {
    await synthesisQueue.removeRepeatableByKey(job.key);
  }

  // Add a repeatable job that runs every 24 hours
  await synthesisQueue.add(
    'daily-synthesis-trigger',
    {},
    {
      repeat: { every: 24 * 60 * 60 * 1000 }, // 24 hours
    },
  );

  logger.info('Scheduled daily synthesis pipeline');
}

/**
 * Enqueues synthesis jobs for all active users (called by the daily trigger).
 */
export async function enqueueAllUsers() {
  const users = await prisma.user.findMany({
    where: { teamId: { not: null } },
    select: { id: true },
  });

  for (const user of users) {
    await synthesisQueue.add('synthesize-user', { userId: user.id }, {
      jobId: `synthesis-${user.id}-${Date.now()}`,
    });
  }

  logger.info({ userCount: users.length }, 'Enqueued synthesis for all active users');
}
