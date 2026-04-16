import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { buildAgentContext } from '../agent/context-builder.js';
import { agentLoop } from '../agent/agent-runtime.js';
import { emitToUser } from '../ws/socket-manager.js';
import * as routineService from '../services/routine-service.js';
import { deliver } from '../services/delivery-service.js';

const QUEUE_NAME = 'routine-execution';
const connection = { url: env.REDIS_URL };

export const routineQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

interface RoutineJobData {
  routineId: string;
  userId: string;
}

export function createRoutineWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<RoutineJobData>) => {
      const { routineId, userId } = job.data;
      logger.info({ routineId, userId, jobId: job.id }, 'Starting routine execution');

      const routine = await prisma.routine.findUnique({ where: { id: routineId } });
      if (!routine || !routine.enabled) {
        logger.warn({ routineId }, 'Routine not found or disabled, skipping');
        return;
      }

      const run = await routineService.createRun(routineId);
      const startTime = Date.now();

      try {
        // Build agent context
        const context = await buildAgentContext(userId, routineId);

        // Run agent loop
        let output = '';
        for await (const event of agentLoop(context, [{ role: 'user', content: routine.prompt }])) {
          if (event.type === 'text_delta') {
            output += event.content;
          }
        }

        const durationMs = Date.now() - startTime;

        // Complete the run
        await routineService.completeRun(run.id, {
          status: 'success',
          output: { result: output },
          durationMs,
        });

        // Update routine last run info
        await prisma.routine.update({
          where: { id: routineId },
          data: { lastRunAt: new Date(), lastRunStatus: 'success' },
        });

        // Deliver results
        const delivery = routine.delivery as Record<string, unknown>;
        const channels = (delivery.channels as string[]) ?? ['in_app'];
        await deliver({
          userId,
          title: `Routine completed: ${routine.name}`,
          body: output.slice(0, 500),
          entityType: 'routine',
          entityId: routineId,
          channels: channels as ('in_app' | 'slack' | 'email')[],
          metadata: { runId: run.id },
        });

        return { routineId, runId: run.id };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        logger.error({ err, routineId }, 'Routine execution failed');

        await routineService.completeRun(run.id, {
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
          durationMs,
        });

        await prisma.routine.update({
          where: { id: routineId },
          data: { lastRunAt: new Date(), lastRunStatus: 'failed' },
        });

        // Notify user of failure
        emitToUser(userId, 'notification', {
          type: 'routine_failed',
          title: `Routine failed: ${routine.name}`,
          routineId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });

        throw err;
      }
    },
    { connection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Routine execution job failed');
  });

  return worker;
}

/**
 * Syncs all enabled routines as repeatable BullMQ jobs.
 * Call on worker startup.
 */
export async function syncRoutineSchedules() {
  // Remove existing repeatable jobs
  const existing = await routineQueue.getRepeatableJobs();
  for (const job of existing) {
    await routineQueue.removeRepeatableByKey(job.key);
  }

  // Add repeatable jobs for all enabled routines
  const routines = await prisma.routine.findMany({ where: { enabled: true } });
  for (const routine of routines) {
    await routineQueue.add(
      'execute-routine',
      { routineId: routine.id, userId: routine.userId },
      {
        repeat: { pattern: routine.schedule },
        jobId: `routine-${routine.id}`,
      },
    );
  }

  logger.info({ count: routines.length }, 'Synced routine schedules');
}

/**
 * Enqueues an immediate one-off execution of a routine.
 */
export async function enqueueRoutineNow(routineId: string, userId: string) {
  await routineQueue.add(
    'execute-routine',
    { routineId, userId },
    { jobId: `routine-now-${routineId}-${Date.now()}` },
  );
  logger.info({ routineId, userId }, 'Routine immediate execution enqueued');
}

/**
 * Updates the repeatable job for a single routine (after create/update/toggle).
 * Removes all matching repeatable jobs first, then re-creates if enabled.
 */
export async function updateRoutineSchedule(routineId: string) {
  // Remove all existing repeatable jobs for this routine.
  // Use try/catch to handle race conditions where the job was already removed.
  const existing = await routineQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.id === `routine-${routineId}`) {
      try {
        await routineQueue.removeRepeatableByKey(job.key);
      } catch {
        // Job already removed by concurrent operation — safe to ignore
      }
    }
  }

  const routine = await prisma.routine.findUnique({ where: { id: routineId } });
  if (!routine || !routine.enabled) return;

  try {
    await routineQueue.add(
      'execute-routine',
      { routineId: routine.id, userId: routine.userId },
      {
        repeat: { pattern: routine.schedule },
        jobId: `routine-${routine.id}`,
      },
    );
  } catch (err) {
    logger.error({ err, routineId }, 'Failed to add repeatable routine job');
  }
}
