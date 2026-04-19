import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { extractCognitivePatterns, rebuildCognitiveProfile, isCognitiveEnabledForOrg } from '../services/cognitive-profile-service.js';
import { prisma } from '../lib/prisma.js';

const QUEUE_NAME = 'cognitive-extraction';
const connection = { url: env.REDIS_URL };

export const cognitiveExtractionQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

interface ExtractionJobData {
  sessionId: string;
  userId: string;
  orgId: string;
}

interface RebuildJobData {
  type: 'rebuild';
}

export function createCognitiveExtractionWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<ExtractionJobData | RebuildJobData>) => {
      if (job.name === 'daily-profile-rebuild') {
        await runDailyProfileRebuild();
        return { processed: true };
      }

      // Session extraction job
      const data = job.data as ExtractionJobData;
      await extractCognitivePatterns(data);
      return { processed: true };
    },
    { connection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Cognitive extraction job failed');
  });

  return worker;
}

/**
 * Enqueue a cognitive extraction job for a completed session.
 */
export async function enqueueCognitiveExtraction(input: ExtractionJobData): Promise<void> {
  await cognitiveExtractionQueue.add('extract-patterns', input);
}

/**
 * Schedule daily profile rebuild (piggybacked on synthesis schedule).
 */
export async function scheduleCognitiveProfileRebuild() {
  const existing = await cognitiveExtractionQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name === 'daily-profile-rebuild') {
      await cognitiveExtractionQueue.removeRepeatableByKey(job.key);
    }
  }

  // Run daily at 3am UTC
  await cognitiveExtractionQueue.add(
    'daily-profile-rebuild',
    { type: 'rebuild' },
    { repeat: { pattern: '0 3 * * *' } },
  );

  logger.info('Scheduled daily cognitive profile rebuild');
}

/**
 * Rebuilds cognitive profiles for all users in orgs that have the feature enabled.
 */
async function runDailyProfileRebuild(): Promise<void> {
  const orgs = await prisma.org.findMany({ select: { id: true, settings: true } });

  for (const org of orgs) {
    const enabled = await isCognitiveEnabledForOrg(org.id);
    if (!enabled) continue;

    const users = await prisma.user.findMany({
      where: { team: { orgId: org.id } },
      select: { id: true },
    });

    for (const user of users) {
      try {
        await rebuildCognitiveProfile(user.id, org.id);
      } catch (err) {
        logger.error({ err, userId: user.id, orgId: org.id }, 'Profile rebuild failed for user');
      }
    }
  }

  logger.info('Daily cognitive profile rebuild complete');
}
