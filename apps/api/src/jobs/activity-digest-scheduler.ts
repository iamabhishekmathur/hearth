import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { generateDigest } from '../services/activity-feed-service.js';
import { deliver } from '../services/delivery-service.js';

const QUEUE_NAME = 'activity-digest';
const connection = { url: env.REDIS_URL };

export const activityDigestQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 25 },
  },
});

export function createActivityDigestWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ orgId?: string }>) => {
      logger.info('Running activity digest job');

      // Get all orgs
      const orgs = job.data.orgId
        ? [await prisma.org.findUnique({ where: { id: job.data.orgId } })]
        : await prisma.org.findMany();

      for (const org of orgs) {
        if (!org) continue;

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const digest = await generateDigest(org.id, since);

        if (digest.eventCount === 0) continue;

        // Deliver to org admins
        const admins = await prisma.user.findMany({
          where: {
            team: { orgId: org.id },
            role: 'admin',
          },
          select: { id: true },
        });

        for (const admin of admins) {
          await deliver({
            userId: admin.id,
            title: `Daily Activity Digest — ${org.name}`,
            body: digest.summary,
            entityType: 'org',
            entityId: org.id,
            channels: ['in_app'],
            metadata: { eventCount: digest.eventCount },
          });
        }

        logger.info({ orgId: org.id, eventCount: digest.eventCount }, 'Activity digest delivered');
      }

      return { processed: true };
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Activity digest job failed');
  });

  return worker;
}

/**
 * Schedule daily activity digest.
 */
export async function scheduleActivityDigest() {
  const existing = await activityDigestQueue.getRepeatableJobs();
  for (const job of existing) {
    await activityDigestQueue.removeRepeatableByKey(job.key);
  }

  // Run daily at 9am
  await activityDigestQueue.add(
    'daily-digest',
    {},
    { repeat: { pattern: '0 9 * * *' } },
  );

  logger.info('Scheduled daily activity digest');
}
