import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { getUserCadence, shouldSendPrepNow, generateMeetingPrep, deliverPrepNudge } from '../services/meeting-prep-service.js';

const QUEUE_NAME = 'meeting-prep';
const connection = { url: env.REDIS_URL };

export const meetingPrepQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

interface MeetingPrepJobData {
  type: 'hourly_scan' | 'generate_prep';
  userId?: string;
  event?: {
    id: string;
    summary: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
    attendees?: Array<{ email: string; displayName?: string }>;
    description?: string;
    location?: string;
  };
}

export function createMeetingPrepWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<MeetingPrepJobData>) => {
      const { type } = job.data;

      switch (type) {
        case 'hourly_scan': {
          // Scan integrations in batches to avoid unbounded queries
          const BATCH_SIZE = 10;
          let skip = 0;
          let scannedUsers = 0;

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const integrations = await prisma.integration.findMany({
              where: { provider: 'gcalendar', enabled: true, status: 'active' },
              take: BATCH_SIZE,
              skip,
              select: { orgId: true },
            });

            if (integrations.length === 0) break;

            for (const integration of integrations) {
              // Fetch users in this org in batches
              const users = await prisma.user.findMany({
                where: { team: { orgId: integration.orgId } },
                select: { id: true, preferences: true },
                take: 100,
              });

              for (const user of users) {
                const prefs = (user.preferences ?? {}) as Record<string, unknown>;
                const cadence = getUserCadence(prefs);
                if (cadence === 'off') continue;

                // Fetch upcoming events via Calendar API
                // In production, this would use the GCalendarConnector
                logger.info(
                  { userId: user.id, cadence },
                  'Meeting prep scan for user (calendar API integration pending)',
                );
                scannedUsers++;
              }
            }

            skip += BATCH_SIZE;
            if (integrations.length < BATCH_SIZE) break;
          }

          return { scanned: true, scannedUsers };
        }

        case 'generate_prep': {
          const { userId, event } = job.data;
          if (!userId || !event) return { skipped: true };

          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { preferences: true },
          });
          if (!user) return { skipped: true };

          const prefs = (user.preferences ?? {}) as Record<string, unknown>;
          const cadence = getUserCadence(prefs);
          const meetingStart = new Date(event.start.dateTime ?? event.start.date ?? '');

          if (!shouldSendPrepNow(meetingStart, cadence)) {
            return { skipped: true, reason: 'Not time yet for cadence' };
          }

          const prep = await generateMeetingPrep(userId, event);
          await deliverPrepNudge(userId, event, prep);

          logger.info({ userId, eventId: event.id }, 'Meeting prep delivered');
          return { delivered: true };
        }

        default:
          return { skipped: true };
      }
    },
    { connection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Meeting prep job failed');
  });

  return worker;
}

/**
 * Schedule hourly meeting prep scan.
 */
export async function scheduleMeetingPrepScan() {
  const existing = await meetingPrepQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name === 'hourly-meeting-scan') {
      await meetingPrepQueue.removeRepeatableByKey(job.key);
    }
  }

  await meetingPrepQueue.add(
    'hourly-meeting-scan',
    { type: 'hourly_scan' as const },
    { repeat: { every: 60 * 60 * 1000 } }, // hourly
  );

  logger.info('Scheduled hourly meeting prep scan');
}
