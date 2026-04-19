import { Queue, Worker } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { checkRoutineHealth } from '../services/routine-health-service.js';

const QUEUE_NAME = 'routine-health-check';
const connection = { url: env.REDIS_URL };

export const healthCheckQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 20 },
  },
});

export function createHealthCheckerWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      logger.info('Running routine health checks');

      // Get all orgs that have routines
      const orgs = await prisma.org.findMany({
        where: {
          OR: [
            { routines: { some: {} } },
            { routineHealthAlerts: { some: { enabled: true } } },
          ],
        },
        select: { id: true },
      });

      for (const org of orgs) {
        try {
          await checkRoutineHealth(org.id);
        } catch (err) {
          logger.error({ err, orgId: org.id }, 'Failed to check routine health for org');
        }
      }

      logger.info({ orgCount: orgs.length }, 'Routine health checks complete');
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Routine health check job failed');
  });

  return worker;
}

/**
 * Schedule the health checker to run every 15 minutes.
 */
export async function scheduleHealthChecks() {
  // Remove existing repeatable jobs
  const existing = await healthCheckQueue.getRepeatableJobs();
  for (const job of existing) {
    await healthCheckQueue.removeRepeatableByKey(job.key);
  }

  await healthCheckQueue.add(
    'health-check',
    {},
    {
      repeat: { pattern: '*/15 * * * *' }, // every 15 minutes
      jobId: 'routine-health-check',
    },
  );

  logger.info('Scheduled routine health checks (every 15 min)');
}
