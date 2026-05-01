import { Queue, Worker, type Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import * as taskService from './task-service.js';
import { buildAgentContext } from '../agent/context-builder.js';
import { agentLoop } from '../agent/agent-runtime.js';
import { emitToTask } from '../ws/socket-manager.js';
import { enqueueSkillProposal } from '../jobs/skill-proposal-job.js';
import { serializeTaskContext } from './task-context-service.js';

const QUEUE_NAME = 'task-execution';
const connection = { url: env.REDIS_URL };

export const taskExecutionQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

interface TaskExecutionJobData {
  taskId: string;
  userId: string;
}

/**
 * Creates the task execution worker that runs isolated agent loops for tasks.
 */
export function createTaskExecutionWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<TaskExecutionJobData>) => {
      const { taskId, userId } = job.data;
      logger.info({ taskId, userId, jobId: job.id }, 'Starting task execution');

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      // Transition to executing
      await taskService.updateTask(taskId, userId, { status: 'executing' });
      emitToTask(taskId, { type: 'task:updated', status: 'executing' });

      try {
        // Build agent context for the task
        const context = await buildAgentContext(userId, taskId);

        // Create the initial execution step
        const step = await taskService.addExecutionStep(taskId, {
          description: `Executing: ${task.title}`,
          phase: 'execution',
        });
        emitToTask(taskId, { type: 'task:step', step });

        // Run the agent loop with task as the prompt
        const richContext = await serializeTaskContext(taskId, {
          maxTokens: 6000,
          query: task.title,
        });
        const prompt = [
          task.title,
          task.description ?? '',
          richContext,
        ]
          .filter(Boolean)
          .join('\n');

        let output = '';
        // Track per-tool-call steps so each tool invocation gets its own row
        const toolSteps = new Map<string, string>(); // tool_call_id → step.id
        const toolInputs = new Map<string, string>(); // tool_call_id → accumulated JSON
        const toolStart = new Map<string, number>(); // tool_call_id → startedAt ms

        for await (const event of agentLoop(context, [{ role: 'user', content: prompt }])) {
          if (event.type === 'text_delta') {
            output += event.content;
          } else if (event.type === 'tool_call_start') {
            const toolStep = await taskService.addExecutionStep(taskId, {
              description: `Tool: ${event.tool}`,
              toolUsed: event.tool,
              phase: 'execution',
            });
            toolSteps.set(event.id, toolStep.id);
            toolInputs.set(event.id, '');
            toolStart.set(event.id, Date.now());
            emitToTask(taskId, { type: 'task:step', step: toolStep });
          } else if (event.type === 'tool_call_delta') {
            toolInputs.set(event.id, (toolInputs.get(event.id) ?? '') + event.input);
          } else if (event.type === 'tool_call_end') {
            const stepId = toolSteps.get(event.id);
            if (stepId) {
              let parsedInput: Record<string, unknown> = {};
              try {
                parsedInput = JSON.parse(toolInputs.get(event.id) ?? '{}');
              } catch {
                /* leave empty on parse fail */
              }
              const startedAt = toolStart.get(event.id) ?? Date.now();
              const updated = await prisma.taskExecutionStep.update({
                where: { id: stepId },
                data: {
                  status: 'completed',
                  input: parsedInput as Prisma.InputJsonValue,
                  durationMs: Date.now() - startedAt,
                },
              });
              emitToTask(taskId, { type: 'task:step', step: updated });
              toolSteps.delete(event.id);
              toolInputs.delete(event.id);
              toolStart.delete(event.id);
            }
          }
          emitToTask(taskId, { type: 'task:agent_event', event });
        }

        // Complete the top-level execution step
        await taskService.updateExecutionStep(step.id, {
          status: 'completed',
          output: { result: output },
        });

        // Store agent output
        await prisma.task.update({
          where: { id: taskId },
          data: { agentOutput: { result: output } },
        });

        // Move to review
        await taskService.updateTask(taskId, userId, { status: 'review' });
        emitToTask(taskId, { type: 'task:updated', status: 'review' });

        // If this task originated from a chat session, post a milestone.
        try {
          const fullTask = await taskService.getTask(taskId, userId);
          if (fullTask?.sourceSessionId) {
            const chatService = await import('./chat-service.js');
            await chatService.postTaskProgress({
              sessionId: fullTask.sourceSessionId,
              taskId,
              milestone: 'review',
              taskTitle: fullTask.title,
              taskStatus: 'review',
            });
          }
        } catch (progressErr) {
          logger.warn({ err: progressErr, taskId }, 'postTaskProgress(review) failed');
        }

        // Enqueue skill proposal evaluation
        const user = await prisma.user.findUnique({
          where: { id: userId },
          include: { team: { select: { orgId: true } } },
        });
        if (user?.team?.orgId) {
          enqueueSkillProposal(taskId, userId, user.team.orgId).catch((err) => {
            logger.error({ err, taskId }, 'Failed to enqueue skill proposal');
          });
        }

        // Handle subtasks — execute any that are in backlog
        const subtasks = await prisma.task.findMany({
          where: { parentTaskId: taskId, status: 'backlog' },
        });

        for (const subtask of subtasks) {
          await enqueueExecution(subtask.id, userId);
        }

        return { taskId, output: output.slice(0, 500) };
      } catch (err) {
        logger.error({ err, taskId }, 'Task execution failed');

        await taskService.updateTask(taskId, userId, { status: 'failed' });
        emitToTask(taskId, { type: 'task:updated', status: 'failed' });

        // Add error comment
        await taskService.addComment(
          taskId,
          null,
          `Execution failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
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
    logger.error({ jobId: job?.id, err }, 'Task execution job failed');
  });

  return worker;
}

/**
 * Enqueues a task for execution.
 */
export async function enqueueExecution(taskId: string, userId: string) {
  await taskExecutionQueue.add(
    'execute-task',
    { taskId, userId },
    { jobId: `task-exec-${taskId}-${Date.now()}` },
  );

  logger.info({ taskId, userId }, 'Task execution enqueued');
}
