import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { withJobContext } from '../lib/job-context.js';
import { runDailyDigest } from '../services/daily-digest.js';

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

/**
 * Hourly: deliver the daily digest to everyone whose local time is 9am.
 * The digest logic (activity summary + the knowledge-loop owner line,
 * reminder and admin weekly line) lives in services/daily-digest.ts.
 */
export async function processActivityDigestJob(job: Job<{ orgId?: string }>) {
  logger.info('Running activity digest job');
  const results = await runDailyDigest({ orgId: job.data?.orgId });
  return { processed: true, orgs: results.length };
}

export function createActivityDigestWorker() {
  const worker = new Worker(QUEUE_NAME, withJobContext(processActivityDigestJob), {
    connection,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Activity digest job failed');
  });

  return worker;
}

/**
 * Schedule hourly activity digest checks. Each run checks if it's 9am
 * in each user's timezone before delivering.
 */
export async function scheduleActivityDigest() {
  const existing = await activityDigestQueue.getRepeatableJobs();
  for (const job of existing) {
    await activityDigestQueue.removeRepeatableByKey(job.key);
  }

  // Run hourly to support timezone-aware delivery
  await activityDigestQueue.add('digest-check', {}, { repeat: { pattern: '0 * * * *' } });

  logger.info('Scheduled hourly activity digest checks');
}
