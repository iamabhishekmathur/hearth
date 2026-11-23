import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { generateDigest } from '../services/activity-feed-service.js';
import * as notificationService from '../services/notification-service.js';
import * as emailService from '../services/email-service.js';

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
 * Get the current hour (0-23) in a user's timezone. Defaults to UTC.
 */
function getUserLocalHour(preferences: unknown): number {
  const prefs = preferences as Record<string, unknown> | null;
  const tz = (prefs?.timezone as string) || 'UTC';
  try {
    const now = new Date();
    const formatted = now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
    return parseInt(formatted, 10);
  } catch {
    return new Date().getUTCHours();
  }
}

export function createActivityDigestWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ orgId?: string }>) => {
      logger.info('Running activity digest job');

      const orgs = job.data.orgId
        ? [await prisma.org.findUnique({ where: { id: job.data.orgId } })]
        : await prisma.org.findMany();

      for (const org of orgs) {
        if (!org) continue;

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const digest = await generateDigest(org.id, since);

        if (digest.eventCount === 0) continue;

        // Deliver to all org members (not just admins) where local time is 9am
        const members = await prisma.user.findMany({
          where: {
            team: { orgId: org.id },
          },
          select: { id: true, email: true, name: true, preferences: true },
        });

        const digestUrl = env.WEB_URL ? `${env.WEB_URL}/activity` : '';
        const emailReady = emailService.isEmailConfigured();
        let delivered = 0;

        for (const member of members) {
          const localHour = getUserLocalHour(member.preferences);
          if (localHour !== 9) continue;

          const title = `Daily Activity Digest — ${org.name}`;

          // (1) Persist a real Notification row so the digest reaches the bell
          // even when the user is offline. notify() is best-effort and never
          // throws — failures here must not abort the digest job.
          await notificationService.notify({
            orgId: org.id,
            userId: member.id,
            type: 'digest',
            title,
            body: digest.summary,
            entityType: 'org',
            entityId: org.id,
          });

          // (2) Gated re-engagement email (only when SMTP/RESEND configured).
          if (emailReady && member.email) {
            try {
              const linkHtml = digestUrl
                ? `<p><a href="${digestUrl}">Open Hearth</a></p>`
                : '';
              const linkText = digestUrl ? `\n\nOpen Hearth: ${digestUrl}` : '';
              await emailService.sendEmail({
                to: member.email,
                subject: title,
                text: `${digest.summary}${linkText}`,
                html: `<h2>${title}</h2><p>${digest.summary.replace(/\n/g, '<br/>')}</p>${linkHtml}<br/><small><em>Powered by Hearth</em></small>`,
              });
            } catch (err) {
              // Email is best-effort; never break the digest job.
              logger.error({ err, userId: member.id }, 'Digest email failed');
            }
          }

          delivered += 1;
        }

        logger.info(
          { orgId: org.id, eventCount: digest.eventCount, delivered },
          'Activity digest delivered',
        );
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
 * Schedule hourly activity digest checks. Each run checks if it's 9am
 * in each user's timezone before delivering.
 */
export async function scheduleActivityDigest() {
  const existing = await activityDigestQueue.getRepeatableJobs();
  for (const job of existing) {
    await activityDigestQueue.removeRepeatableByKey(job.key);
  }

  // Run hourly to support timezone-aware delivery
  await activityDigestQueue.add(
    'digest-check',
    {},
    { repeat: { pattern: '0 * * * *' } },
  );

  logger.info('Scheduled hourly activity digest checks');
}
