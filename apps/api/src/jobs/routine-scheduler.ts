import { Queue, Worker, type Job } from 'bullmq';
import type { NormalizedEvent, RoutineParameter } from '@hearth/shared';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { buildAgentContext } from '../agent/context-builder.js';
import { agentLoop } from '../agent/agent-runtime.js';
import { emitToUser } from '../ws/socket-manager.js';
import * as routineService from '../services/routine-service.js';
import { deliver } from '../services/delivery-service.js';
import { buildRoutineRunContext } from '../services/routine-context-service.js';
import { evaluateDeliveryRules, applyTemplate } from '../services/delivery-rule-engine.js';
import { resolveDefaults, resolvePromptTemplate, validateParameterValues } from '../services/routine-parameter-service.js';
import { getDownstreamChains } from '../services/chain-service.js';
import { createPipelineRun, addRunToPipeline } from '../services/pipeline-service.js';
import type { DeliveryRule, DeliveryTarget } from '@hearth/shared';

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
  // Feature 2: Event trigger fields
  triggerId?: string;
  triggerEvent?: NormalizedEvent;
  // Feature 4: Parameter values
  parameterValues?: Record<string, unknown>;
  triggeredBy?: 'schedule' | 'manual' | 'event' | 'chain';
  // Feature 7: Pipeline tracking
  pipelineId?: string;
}

export function createRoutineWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<RoutineJobData>) => {
      const { routineId, userId, triggerId, triggerEvent, parameterValues, triggeredBy, pipelineId } = job.data;
      logger.info({ routineId, userId, jobId: job.id, triggeredBy }, 'Starting routine execution');

      const routine = await prisma.routine.findUnique({ where: { id: routineId } });
      if (!routine || !routine.enabled) {
        logger.warn({ routineId }, 'Routine not found or disabled, skipping');
        return;
      }

      // Feature 4: Resolve parameters
      const parameters = (routine.parameters as unknown as RoutineParameter[]) ?? [];
      let resolvedValues = parameterValues ?? {};
      if (parameters.length > 0) {
        resolvedValues = resolveDefaults(parameters, resolvedValues);
        // Validate for scheduled runs
        if (triggeredBy === 'schedule') {
          const validation = validateParameterValues(parameters, resolvedValues);
          if (!validation.valid) {
            logger.error({ routineId, error: validation.error }, 'Parameter validation failed for scheduled run');
            const run = await routineService.createRun(routineId, { triggeredBy: 'schedule' });
            await routineService.completeRun(run.id, {
              status: 'failed',
              error: `Parameter validation failed: ${validation.error}`,
            });
            await prisma.routine.update({
              where: { id: routineId },
              data: { lastRunAt: new Date(), lastRunStatus: 'failed' },
            });
            return;
          }
        }
      }

      const run = await routineService.createRun(routineId, {
        triggerId,
        triggerEvent: triggerEvent as Record<string, unknown> | undefined,
        parameterValues: Object.keys(resolvedValues).length > 0 ? resolvedValues : undefined,
        triggeredBy: triggeredBy ?? 'schedule',
      });

      // Feature 7: Track in pipeline
      if (pipelineId) {
        await addRunToPipeline(pipelineId, run.id).catch((err) =>
          logger.warn({ err, pipelineId }, 'Failed to add run to pipeline'),
        );
      }

      const startTime = Date.now();

      try {
        // Feature 1: Build routine run context (state + previous runs)
        const routineRunContext = await buildRoutineRunContext(routineId);

        // Feature 4: Interpolate prompt template with parameter values
        let prompt = routine.prompt;
        if (Object.keys(resolvedValues).length > 0) {
          prompt = resolvePromptTemplate(prompt, resolvedValues);
        }

        // Build agent context with routine-specific additions
        const context = await buildAgentContext(userId, routineId, undefined, undefined, {
          routineRunContext,
          triggerEvent,
          routineId,
        });

        // Run agent loop
        let output = '';
        for await (const event of agentLoop(context, [{ role: 'user', content: prompt }])) {
          if (event.type === 'text_delta') {
            output += event.content;
          }
        }

        const durationMs = Date.now() - startTime;

        // Feature 1: Generate summary (first 200 chars of output)
        const summary = output.length > 0 ? output.slice(0, 200) : undefined;

        // Complete the run
        await routineService.completeRun(run.id, {
          status: 'success',
          output: { result: output },
          durationMs,
          summary,
        });

        // Update routine last run info
        await prisma.routine.update({
          where: { id: routineId },
          data: { lastRunAt: new Date(), lastRunStatus: 'success' },
        });

        // Feature 6: Conditional delivery routing
        const deliveryConfig = routine.delivery as Record<string, unknown>;
        const deliveryRules = deliveryConfig.rules as DeliveryRule[] | undefined;

        if (deliveryRules && deliveryRules.length > 0) {
          const routineState = (routine.state as Record<string, unknown>) ?? {};
          const tags = (routineState._delivery_tags as string[]) ?? [];
          const targets = evaluateDeliveryRules(deliveryRules, output, tags);

          const fallbackChannels = (deliveryConfig.channels as string[]) ?? ['in_app'];
          for (const channel of fallbackChannels) {
            if (!targets.some((t) => t.channel === channel)) {
              targets.push({ channel: channel as DeliveryTarget['channel'], config: {} });
            }
          }

          for (const target of targets) {
            const body = applyTemplate(target.template, output.slice(0, 500));
            await deliver({
              userId,
              title: `Routine completed: ${routine.name}`,
              body,
              entityType: 'routine',
              entityId: routineId,
              channels: [target.channel as 'in_app' | 'slack' | 'email'],
              metadata: { runId: run.id, ...target.config },
            });
          }

          // Clear delivery tags after use
          if (tags.length > 0) {
            const cleanState = { ...routineState };
            delete cleanState._delivery_tags;
            await prisma.routine.update({
              where: { id: routineId },
              data: { state: cleanState as never },
            });
          }
        } else {
          const channels = (deliveryConfig.channels as string[]) ?? ['in_app'];
          await deliver({
            userId,
            title: `Routine completed: ${routine.name}`,
            body: output.slice(0, 500),
            entityType: 'routine',
            entityId: routineId,
            channels: channels as ('in_app' | 'slack' | 'email')[],
            metadata: { runId: run.id },
          });
        }

        // Feature 7: Trigger downstream chains
        await triggerDownstream(routineId, run.id, 'success', output, pipelineId);

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

        emitToUser(userId, 'notification', {
          type: 'routine_failed',
          title: `Routine failed: ${routine.name}`,
          routineId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });

        // Feature 7: Trigger on_failure chains
        await triggerDownstream(routineId, run.id, 'failed', '', pipelineId);

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
 * Feature 7: Trigger downstream chained routines after a run completes.
 */
async function triggerDownstream(
  routineId: string,
  runId: string,
  status: 'success' | 'failed',
  output: string,
  pipelineId?: string,
) {
  try {
    const chains = await getDownstreamChains(routineId, status);
    if (chains.length === 0) return;

    let currentPipelineId = pipelineId;
    if (!currentPipelineId) {
      const pipeline = await createPipelineRun(runId);
      currentPipelineId = pipeline.id;
    }

    for (const chain of chains) {
      if (!chain.targetRoutine.enabled) continue;

      const parameterMapping = chain.parameterMapping as Record<string, string>;
      const parameterValues: Record<string, unknown> = {};
      for (const [targetParam, sourceKey] of Object.entries(parameterMapping)) {
        if (sourceKey === '$output') {
          parameterValues[targetParam] = output;
        } else if (sourceKey === '$status') {
          parameterValues[targetParam] = status;
        }
      }

      await routineQueue.add(
        'execute-routine',
        {
          routineId: chain.targetRoutine.id,
          userId: chain.targetRoutine.userId,
          parameterValues: Object.keys(parameterValues).length > 0 ? parameterValues : undefined,
          triggeredBy: 'chain' as const,
          pipelineId: currentPipelineId,
        },
        { jobId: `routine-chain-${chain.id}-${Date.now()}` },
      );

      logger.info(
        { sourceRoutineId: routineId, targetRoutineId: chain.targetRoutine.id, condition: chain.condition },
        'Triggered downstream routine via chain',
      );
    }
  } catch (err) {
    logger.error({ err, routineId }, 'Failed to trigger downstream chains');
  }
}

/**
 * Syncs all enabled routines with schedules as repeatable BullMQ jobs.
 * Skips event-only routines (schedule: null).
 */
export async function syncRoutineSchedules() {
  const existing = await routineQueue.getRepeatableJobs();
  for (const job of existing) {
    await routineQueue.removeRepeatableByKey(job.key);
  }

  const routines = await prisma.routine.findMany({
    where: { enabled: true, schedule: { not: null } },
  });

  for (const routine of routines) {
    if (!routine.schedule) continue;
    await routineQueue.add(
      'execute-routine',
      { routineId: routine.id, userId: routine.userId, triggeredBy: 'schedule' },
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
export async function enqueueRoutineNow(routineId: string, userId: string, opts?: {
  parameterValues?: Record<string, unknown>;
}) {
  await routineQueue.add(
    'execute-routine',
    {
      routineId,
      userId,
      triggeredBy: 'manual' as const,
      parameterValues: opts?.parameterValues,
    },
    { jobId: `routine-now-${routineId}-${Date.now()}` },
  );
  logger.info({ routineId, userId }, 'Routine immediate execution enqueued');
}

/**
 * Feature 2: Enqueues a routine execution triggered by an event.
 */
export async function enqueueRoutineForEvent(
  routineId: string,
  userId: string,
  triggerId: string,
  triggerEvent: NormalizedEvent,
  parameterValues?: Record<string, unknown>,
) {
  await routineQueue.add(
    'execute-routine',
    {
      routineId,
      userId,
      triggerId,
      triggerEvent,
      triggeredBy: 'event' as const,
      parameterValues,
    },
    { jobId: `routine-event-${routineId}-${Date.now()}` },
  );
  logger.info({ routineId, triggerId, eventType: triggerEvent.eventType }, 'Routine event execution enqueued');
}

/**
 * Updates the repeatable job for a single routine (after create/update/toggle).
 */
export async function updateRoutineSchedule(routineId: string) {
  const existing = await routineQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.id === `routine-${routineId}`) {
      try {
        await routineQueue.removeRepeatableByKey(job.key);
      } catch {
        // Job already removed — safe to ignore
      }
    }
  }

  const routine = await prisma.routine.findUnique({ where: { id: routineId } });
  if (!routine || !routine.enabled || !routine.schedule) return;

  try {
    await routineQueue.add(
      'execute-routine',
      { routineId: routine.id, userId: routine.userId, triggeredBy: 'schedule' },
      {
        repeat: { pattern: routine.schedule },
        jobId: `routine-${routine.id}`,
      },
    );
  } catch (err) {
    logger.error({ err, routineId }, 'Failed to add repeatable routine job');
  }
}
