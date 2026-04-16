import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { detectAndCreateTask } from '../services/task-detector.js';

const QUEUE_NAME = 'work-intake';
const connection = { url: env.REDIS_URL };

export const workIntakeQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

interface IntakeJobData {
  type: 'poll_email' | 'slack_message';
  userId: string;
  message?: {
    text: string;
    from: string;
    messageId: string;
    channel?: string;
  };
}

export function createWorkIntakeWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<IntakeJobData>) => {
      const { type, userId, message } = job.data;

      switch (type) {
        case 'slack_message': {
          if (!message) return { skipped: true };

          const result = await detectAndCreateTask({
            source: 'slack',
            text: message.text,
            from: message.from,
            messageId: message.messageId,
            channel: message.channel,
            userId,
          });

          return result;
        }

        case 'poll_email': {
          // Email polling: check Gmail for new messages via integration
          // This is a placeholder — requires Gmail connector (Slice 5 dependency)
          logger.info({ userId }, 'Email polling not yet implemented');
          return { skipped: true, reason: 'Email polling pending Gmail connector' };
        }

        default:
          return { skipped: true };
      }
    },
    { connection, concurrency: 3 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Work intake job failed');
  });

  return worker;
}

/**
 * Enqueue a Slack message for work intake processing.
 */
export async function enqueueSlackMessage(
  userId: string,
  message: { text: string; from: string; messageId: string; channel?: string },
) {
  await workIntakeQueue.add(
    'slack-intake',
    { type: 'slack_message' as const, userId, message },
    { jobId: `slack-intake-${message.messageId}` },
  );
}

/**
 * Schedule periodic email polling for a user.
 */
export async function scheduleEmailPolling() {
  // Remove existing
  const existing = await workIntakeQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name === 'email-poll-trigger') {
      await workIntakeQueue.removeRepeatableByKey(job.key);
    }
  }

  // Poll every 5 minutes
  await workIntakeQueue.add(
    'email-poll-trigger',
    { type: 'poll_email' as const, userId: '' },
    { repeat: { every: 5 * 60 * 1000 } },
  );

  logger.info('Scheduled email polling (every 5 min)');
}
