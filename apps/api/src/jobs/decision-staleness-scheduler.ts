import { Queue, Worker } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

const QUEUE_NAME = 'decision-staleness';
const connection = { url: env.REDIS_URL };

export const decisionStalenessQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  },
});

export function createDecisionStalenessWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      await checkStaleness();
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Decision staleness check failed');
  });

  return worker;
}

export async function scheduleDecisionStalenessCheck() {
  const existing = await decisionStalenessQueue.getRepeatableJobs();
  for (const job of existing) {
    await decisionStalenessQueue.removeRepeatableByKey(job.key);
  }

  await decisionStalenessQueue.add(
    'staleness-check',
    {},
    {
      repeat: { pattern: '0 3 * * *' }, // 3am UTC daily
      jobId: 'daily-staleness-check',
    },
  );

  logger.info('Scheduled daily decision staleness check at 3am UTC');
}

async function checkStaleness() {
  // Flag decisions older than 180 days with no outcomes
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

  const staleDecisions = await prisma.decision.findMany({
    where: {
      status: 'active',
      createdAt: { lt: sixMonthsAgo },
      outcomes: { none: {} },
    },
    select: { id: true, orgId: true },
  });

  if (staleDecisions.length > 0) {
    logger.info({ count: staleDecisions.length }, 'Found stale decisions needing review');
  }

  // Flag decisions where a dependent has negative outcome
  const negativeOutcomes = await prisma.$queryRawUnsafe<Array<{ from_decision_id: string }>>(
    `SELECT DISTINCT dl.from_decision_id
     FROM decision_links dl
     JOIN decision_outcomes do2 ON do2.decision_id = dl.to_decision_id
     JOIN decisions d ON d.id = dl.from_decision_id AND d.status = 'active'
     WHERE dl.relationship = 'depends_on'
       AND do2.verdict = 'negative'`,
  );

  logger.info(
    { staleCount: staleDecisions.length, negativeDepCount: negativeOutcomes.length },
    'Decision staleness check complete',
  );
}
