import { Queue, Worker } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { extractAllPatterns } from '../services/decision-pattern-service.js';
import { distillAllPrinciples } from '../services/org-principle-service.js';

const QUEUE_NAME = 'decision-pattern-synthesis';
const connection = { url: env.REDIS_URL };

export const decisionPatternQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  },
});

export function createDecisionPatternWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      await runPatternSynthesis();
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Decision pattern synthesis failed');
  });

  return worker;
}

export async function schedulePatternSynthesis() {
  const existing = await decisionPatternQueue.getRepeatableJobs();
  for (const job of existing) {
    await decisionPatternQueue.removeRepeatableByKey(job.key);
  }

  await decisionPatternQueue.add(
    'pattern-synthesis',
    {},
    {
      repeat: { pattern: '0 2 * * *' }, // 2am UTC nightly
      jobId: 'nightly-pattern-synthesis',
    },
  );

  logger.info('Scheduled nightly decision pattern synthesis at 2am UTC');
}

async function runPatternSynthesis() {
  const orgs = await prisma.org.findMany({ select: { id: true } });

  for (const org of orgs) {
    try {
      await extractAllPatterns(org.id);
      await distillAllPrinciples(org.id);
    } catch (err) {
      logger.error({ err, orgId: org.id }, 'Pattern synthesis failed for org');
    }
  }

  logger.info({ orgCount: orgs.length }, 'Pattern synthesis cycle complete');
}
