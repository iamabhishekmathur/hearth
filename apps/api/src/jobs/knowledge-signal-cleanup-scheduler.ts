import { Queue, Worker } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { cleanupOldSignals, SIGNAL_RETENTION_DAYS } from '../services/knowledge-signals.js';

/**
 * Knowledge loop, Phase 1: removes gap signals older than the retention window
 * (90 days) once a day.
 */
const QUEUE_NAME = 'knowledge-signal-cleanup';
const connection = { url: env.REDIS_URL };

export const knowledgeSignalCleanupQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  },
});

export function createKnowledgeSignalCleanupWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const removed = await cleanupOldSignals();
      logger.info(
        { removed, retentionDays: SIGNAL_RETENTION_DAYS },
        'Knowledge signal cleanup done',
      );
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Knowledge signal cleanup failed');
  });

  return worker;
}

export async function scheduleKnowledgeSignalCleanup() {
  const existing = await knowledgeSignalCleanupQueue.getRepeatableJobs();
  for (const job of existing) {
    await knowledgeSignalCleanupQueue.removeRepeatableByKey(job.key);
  }

  await knowledgeSignalCleanupQueue.add(
    'signal-cleanup',
    {},
    {
      repeat: { pattern: '30 4 * * *' }, // 4:30am UTC daily, after the other nightly jobs
      jobId: 'daily-knowledge-signal-cleanup',
    },
  );

  logger.info('Scheduled daily knowledge signal cleanup at 4:30am UTC');
}
