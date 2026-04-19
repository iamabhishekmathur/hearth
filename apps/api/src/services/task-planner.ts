import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import * as taskService from './task-service.js';
import { buildAgentContext } from '../agent/context-builder.js';
import { agentLoop } from '../agent/agent-runtime.js';
import { emitToTask } from '../ws/socket-manager.js';
import { enqueueExecution } from './task-executor.js';
import { serializeTaskContext } from './task-context-service.js';

const QUEUE_NAME = 'task-planning';
const connection = { url: env.REDIS_URL };

export const taskPlanningQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

interface TaskPlanningJobData {
  taskId: string;
  userId: string;
  /** When set, this is a re-plan triggered from a review's "request changes". */
  reviewFeedback?: string;
}

interface PlannedSubtask {
  title: string;
  description?: string;
}

/**
 * Extracts a JSON array of subtask objects from a free-form agent response.
 * Tolerates markdown code fences, leading/trailing prose, and malformed JSON.
 */
function parseSubtasks(raw: string): PlannedSubtask[] {
  if (!raw) return [];

  // Strip fenced code blocks
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;

  // Find the first [ ... ] block
  const arrayMatch = candidate.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];

  try {
    const parsed: unknown = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): PlannedSubtask | null => {
        if (!item || typeof item !== 'object') return null;
        const rec = item as Record<string, unknown>;
        const title =
          typeof rec.title === 'string'
            ? rec.title
            : typeof rec.name === 'string'
              ? rec.name
              : null;
        if (!title) return null;
        const description =
          typeof rec.description === 'string'
            ? rec.description
            : typeof rec.details === 'string'
              ? rec.details
              : undefined;
        return { title: title.slice(0, 200), description };
      })
      .filter((s): s is PlannedSubtask => s !== null);
  } catch {
    return [];
  }
}

async function buildPlanningPrompt(
  task: { id: string; title: string; description: string | null; context: unknown },
  reviewFeedback?: string,
): Promise<string> {
  const parts = [
    'You are a planning agent decomposing a task into concrete subtasks.',
    '',
    `Task: ${task.title}`,
  ];
  if (task.description) parts.push(`Description: ${task.description}`);

  // Rich context (links, PDFs, files, text blocks, MCP data) with token budgeting
  const contextStr = await serializeTaskContext(task.id, {
    maxTokens: 4000,
    query: task.title + ' ' + (task.description ?? ''),
  });
  if (contextStr) {
    parts.push('');
    parts.push(contextStr);
  }

  if (reviewFeedback) {
    parts.push('');
    parts.push('The previous attempt was sent back for changes. Reviewer feedback:');
    parts.push(reviewFeedback);
  }
  parts.push(
    '',
    'Decompose this task into concrete subtasks. Use as many or as few subtasks as the task genuinely requires — a simple task might need 2, a complex one might need 10+. Each subtask should be a meaningful, independently executable unit of work.',
    '',
    'Output a JSON array of subtask objects. Each object must have a "title" (short, imperative) and optional "description". Example:',
    '[{"title":"Fetch recent emails","description":"Pull the last 50 messages from Gmail"}, {"title":"Summarize by sender","description":"Group and summarize per contact"}]',
    '',
    'Respond ONLY with the JSON array.',
  );
  return parts.join('\n');
}

/**
 * Creates the task planning worker. Decomposes a task into subtasks via an LLM,
 * records the planning steps, then auto-advances the task into `executing`.
 */
export function createTaskPlanningWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<TaskPlanningJobData>) => {
      const { taskId, userId, reviewFeedback } = job.data;
      logger.info({ taskId, userId, jobId: job.id }, 'Starting task planning');

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) throw new Error(`Task ${taskId} not found`);

      // Start planning step
      const planningStep = await taskService.addExecutionStep(taskId, {
        description: `Planning: decompose "${task.title}" into subtasks`,
        phase: 'planning',
      });
      emitToTask(taskId, { type: 'task:step', step: planningStep });

      const startedAt = Date.now();

      try {
        const context = await buildAgentContext(userId, taskId);
        const prompt = await buildPlanningPrompt(
          { id: taskId, title: task.title, description: task.description, context: task.context },
          reviewFeedback,
        );

        let raw = '';
        for await (const event of agentLoop(context, [
          { role: 'user', content: prompt },
        ])) {
          if (event.type === 'text_delta') raw += event.content;
          emitToTask(taskId, { type: 'task:agent_event', event });
        }

        const subtasks = parseSubtasks(raw);

        // Persist subtasks — clear stale ones from any prior planning round first
        await prisma.task.deleteMany({
          where: { parentTaskId: taskId, status: { in: ['auto_detected', 'backlog'] } },
        });

        for (const sub of subtasks) {
          const created = await taskService.createSubtask(taskId, userId, sub);
          emitToTask(taskId, { type: 'task:subtask', subtask: created });
        }

        await taskService.updateExecutionStep(planningStep.id, {
          status: 'completed',
          output: { subtasks, raw: raw.slice(0, 2000) },
          durationMs: Date.now() - startedAt,
        });

        // Auto-advance to executing
        await taskService.updateTask(taskId, userId, { status: 'executing' });
        emitToTask(taskId, { type: 'task:updated', status: 'executing' });

        // Enqueue execution for the parent task itself
        await enqueueExecution(taskId, userId);

        return { taskId, subtaskCount: subtasks.length };
      } catch (err) {
        logger.error({ err, taskId }, 'Task planning failed');

        await taskService.updateExecutionStep(planningStep.id, {
          status: 'failed',
          output: { error: err instanceof Error ? err.message : 'Unknown error' },
          durationMs: Date.now() - startedAt,
        });

        await taskService.updateTask(taskId, userId, { status: 'backlog' });
        emitToTask(taskId, { type: 'task:updated', status: 'backlog' });

        await taskService.addComment(
          taskId,
          null,
          `Planning failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          true,
        );

        throw err;
      }
    },
    {
      connection,
      concurrency: 3,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Task planning job failed');
  });

  return worker;
}

/**
 * Enqueues a task for planning. Called when a task moves backlog → planning,
 * or when a reviewer requests changes (re-plan with feedback).
 */
export async function enqueuePlanning(
  taskId: string,
  userId: string,
  reviewFeedback?: string,
) {
  await taskPlanningQueue.add(
    'plan-task',
    { taskId, userId, reviewFeedback },
    { jobId: `task-plan-${taskId}-${Date.now()}` },
  );
  logger.info({ taskId, userId, hasFeedback: !!reviewFeedback }, 'Task planning enqueued');
}
