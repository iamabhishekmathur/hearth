import { Queue, Worker } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { runCurator } from '../services/knowledge-curator.js';

/**
 * Knowledge loop, Phase 2: the nightly curator. Runs at 4:00am UTC, before
 * the 4:30am signal cleanup, for every org with the `knowledgeLoop` flag on.
 * Logs counts only — never signal text or proposed content.
 */
const QUEUE_NAME = 'knowledge-curator';
const connection = { url: env.REDIS_URL };

export const knowledgeCuratorQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  },
});

export function createKnowledgeCuratorWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const results = await runCurator();
      const total = results.reduce(
        (acc, r) => ({
          orgs: acc.orgs + 1,
          modelCalls: acc.modelCalls + r.modelCalls,
          proposed: acc.proposed + r.proposed,
          attached: acc.attached + r.attached,
          failed: acc.failed + r.failed,
        }),
        { orgs: 0, modelCalls: 0, proposed: 0, attached: 0, failed: 0 },
      );
      logger.info(total, 'Knowledge curator run done');
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, errName: err?.name }, 'Knowledge curator run failed');
  });

  return worker;
}

export async function scheduleKnowledgeCurator() {
  const existing = await knowledgeCuratorQueue.getRepeatableJobs();
  for (const job of existing) {
    await knowledgeCuratorQueue.removeRepeatableByKey(job.key);
  }

  await knowledgeCuratorQueue.add(
    'curator',
    {},
    {
      repeat: { pattern: '0 4 * * *' }, // 4:00am UTC daily, before the 4:30 signal cleanup
      jobId: 'daily-knowledge-curator',
    },
  );

  logger.info('Scheduled the nightly knowledge curator at 4:00am UTC');
}
