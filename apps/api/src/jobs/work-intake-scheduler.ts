import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { detectAndCreateTask } from '../services/task-detector.js';
import { synthesizeForUser } from '../services/synthesis-service.js';
import { mcpGateway } from '../mcp/gateway.js';
import type { TaskSource } from '@hearth/shared';

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
  type: 'poll_email' | 'slack_message' | 'connect_backfill';
  userId: string;
  /** For connect_backfill: which freshly-connected integration to pull from. */
  integrationId?: string;
  message?: {
    text: string;
    from: string;
    messageId: string;
    channel?: string;
  };
}

/**
 * A single pull tool used by connect_backfill: which tool to call on the
 * integration, the task source it maps to, and how to turn the tool output
 * into candidate actionable messages.
 */
interface BackfillPull {
  toolName: string;
  source: TaskSource;
  buildInput: () => Record<string, unknown>;
  toMessages: (
    output: Record<string, unknown>,
  ) => Array<{ text: string; from: string; messageId: string; channel?: string }>;
}

function yesterdayDateStr(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Pull strategies for the on-connect task-detection backfill. We probe each
 * tool; the connector only answers for the ones it exposes. Slack messages,
 * Gmail snippets, and Granola transcript segments all become candidate tasks.
 */
const BACKFILL_PULLS: BackfillPull[] = [
  {
    toolName: 'slack_search_messages',
    source: 'slack' as TaskSource,
    buildInput: () => ({ query: `after:${yesterdayDateStr()}`, limit: 50 }),
    toMessages: (output) => {
      const messages = (output.messages as Array<Record<string, unknown>>) ?? [];
      return messages
        .filter((m) => typeof m.text === 'string' && (m.text as string).length > 0)
        .map((m, i) => ({
          text: m.text as string,
          from: (m.username as string) ?? (m.user as string) ?? 'unknown',
          messageId: (m.ts as string) ?? `slack-${i}`,
          channel: (m.channel as string) ?? undefined,
        }));
    },
  },
  {
    toolName: 'gmail_search',
    source: 'email' as TaskSource,
    buildInput: () => ({ query: 'newer_than:1d', maxResults: 20 }),
    toMessages: (output) => {
      const messages = (output.messages as Array<Record<string, unknown>>) ?? [];
      return messages
        .filter((m) => typeof m.snippet === 'string' && (m.snippet as string).length > 0)
        .map((m, i) => ({
          text: m.snippet as string,
          from: (m.from as string) ?? 'unknown',
          messageId: (m.id as string) ?? `gmail-${i}`,
        }));
    },
  },
  {
    toolName: 'granola_get_recent_transcripts',
    source: 'meeting' as TaskSource,
    buildInput: () => ({ since: yesterdayDateStr(), limit: 20 }),
    toMessages: (output) => {
      const meetings = (output.meetings as Array<Record<string, unknown>>) ?? [];
      const out: Array<{ text: string; from: string; messageId: string; channel?: string }> = [];
      for (const m of meetings) {
        const meetingId = (m.id as string) ?? 'meeting';
        const title = (m.title as string) ?? 'Meeting';
        const segments = Array.isArray(m.transcript)
          ? (m.transcript as Array<Record<string, unknown>>)
          : [];
        segments.forEach((seg, i) => {
          const text = (seg.text as string) ?? '';
          if (!text) return;
          out.push({
            text,
            from: (seg.speaker as string) ?? 'unknown',
            messageId: `${meetingId}-${i}`,
            channel: title,
          });
        });
        // If the transcript is a single string, treat the whole thing as one item.
        if (segments.length === 0 && typeof m.transcript === 'string' && m.transcript) {
          out.push({ text: m.transcript, from: title, messageId: meetingId, channel: title });
        }
      }
      return out;
    },
  },
];

export function createWorkIntakeWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<IntakeJobData>) => {
      const { type, userId, message, integrationId } = job.data;

      // Resolve orgId from the user's team. Skip job if user has no org.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { team: { select: { orgId: true } } },
      });
      const orgId = user?.team?.orgId;
      if (!orgId) {
        logger.warn({ userId, type }, 'Skipping intake job: user has no org');
        return { skipped: true, reason: 'User has no org' };
      }

      switch (type) {
        case 'connect_backfill': {
          if (!integrationId) return { skipped: true, reason: 'No integrationId' };

          // Memory synthesis SCOPED to the just-connected integration. Runs in
          // this worker (which owns the cross-process ensureConnected pull),
          // pulling THIS integration's content into the user's memory layer.
          const synthesis = await synthesizeForUser(userId, integrationId);

          // Task-detection backfill from the same source.
          const backfill = await runConnectBackfill(userId, orgId, integrationId);

          return { synthesis, backfill };
        }

        case 'slack_message': {
          if (!message) return { skipped: true };

          const result = await detectAndCreateTask({
            source: 'slack',
            text: message.text,
            from: message.from,
            messageId: message.messageId,
            channel: message.channel,
            userId,
            orgId,
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
 * On-connect task-detection backfill. Pulls recent content from a
 * freshly-connected integration via the MCP gateway and runs each candidate
 * through the task detector, so connecting a source immediately surfaces tasks
 * instead of waiting for the next webhook or daily sweep.
 *
 * Idempotent at the task layer: detectAndCreateTask dedups by title, and the
 * job itself is enqueued under a stable jobId so a repeated connect coalesces.
 */
async function runConnectBackfill(
  userId: string,
  orgId: string,
  integrationId: string,
): Promise<{ scanned: number; created: number }> {
  // The connect happened in the API process; this backfill runs in the WORKER
  // process whose gateway has no live connection for the just-connected
  // integration. Self-heal: connect it on-demand (loads + decrypts the row).
  const connected = await mcpGateway.ensureConnected(integrationId);
  if (!connected) {
    logger.info({ integrationId }, 'Connect backfill: integration not connectable, skipping');
    return { scanned: 0, created: 0 };
  }

  const availableTools = new Set((await mcpGateway.listTools(integrationId)).map((t) => t.name));
  let scanned = 0;
  let created = 0;

  for (const pull of BACKFILL_PULLS) {
    if (availableTools.size > 0 && !availableTools.has(pull.toolName)) continue;

    let result;
    try {
      result = await mcpGateway.executeTool(integrationId, pull.toolName, pull.buildInput());
    } catch (err) {
      logger.warn({ integrationId, tool: pull.toolName, err }, 'Connect backfill: tool call threw');
      continue;
    }
    if (result.error) {
      logger.warn({ integrationId, tool: pull.toolName, error: result.error }, 'Connect backfill: tool error');
      continue;
    }

    const messages = pull.toMessages(result.output);
    for (const m of messages) {
      scanned++;
      try {
        const detection = await detectAndCreateTask({
          source: pull.source,
          text: m.text,
          from: m.from,
          messageId: m.messageId,
          channel: m.channel,
          userId,
          orgId,
        });
        if (detection.created) created++;
      } catch (err) {
        logger.warn({ integrationId, tool: pull.toolName, err }, 'Connect backfill: detection failed');
      }
    }
  }

  logger.info({ userId, integrationId, scanned, created }, 'Connect backfill completed');
  return { scanned, created };
}

/**
 * Enqueue an on-connect backfill for a freshly-connected integration.
 * Fire-and-forget from the connect path. Stable jobId so a re-connect coalesces.
 */
export async function enqueueConnectBackfill(userId: string, integrationId: string): Promise<void> {
  await workIntakeQueue.add(
    'connect-backfill',
    { type: 'connect_backfill' as const, userId, integrationId },
    { jobId: `connect-backfill-${integrationId}` },
  );
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
