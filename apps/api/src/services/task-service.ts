import type {
  TaskStatus,
  TaskSource,
  TaskStepStatus,
  TaskStepPhase,
  ReviewDecision,
} from '@hearth/shared';
import { VALID_STATUS_TRANSITIONS } from '@hearth/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export async function createTask(
  userId: string,
  data: {
    title: string;
    description?: string;
    source: TaskSource;
    priority?: number;
    parentTaskId?: string;
  },
) {
  return prisma.task.create({
    data: {
      userId,
      title: data.title,
      description: data.description ?? null,
      source: data.source,
      priority: data.priority ?? 0,
      parentTaskId: data.parentTaskId ?? null,
      context: {},
    },
    include: { subTasks: true, comments: true },
  });
}

export async function listTasks(
  userId: string,
  options?: {
    status?: TaskStatus;
    parentOnly?: boolean;
    page?: number;
    pageSize?: number;
  },
) {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 50;

  const where: Prisma.TaskWhereInput = { userId };
  if (options?.status) where.status = options.status;
  if (options?.parentOnly) where.parentTaskId = null;

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        subTasks: {
          orderBy: { createdAt: 'asc' as const },
          include: { executionSteps: { orderBy: { stepNumber: 'asc' as const } } },
        },
        _count: { select: { comments: true } },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
    }),
    prisma.task.count({ where }),
  ]);

  return { tasks, total, page, pageSize };
}

export async function getTask(id: string, userId: string) {
  return prisma.task.findFirst({
    where: { id, userId },
    include: {
      subTasks: {
        orderBy: { createdAt: 'asc' },
        include: {
          executionSteps: { orderBy: { stepNumber: 'asc' } },
        },
      },
      comments: { orderBy: { createdAt: 'asc' }, include: { user: { select: { id: true, name: true } } } },
      executionSteps: { orderBy: { stepNumber: 'asc' } },
      reviews: {
        orderBy: { createdAt: 'asc' },
        include: { reviewer: { select: { id: true, name: true } } },
      },
    },
  });
}

export async function updateTask(
  id: string,
  userId: string,
  data: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: number;
  },
) {
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) return null;

  // Validate status transition
  if (data.status && data.status !== task.status) {
    const allowed = VALID_STATUS_TRANSITIONS[task.status as TaskStatus];
    if (!allowed.includes(data.status)) {
      throw new Error(
        `Invalid status transition from ${task.status} to ${data.status}`,
      );
    }
  }

  const updateData: Prisma.TaskUpdateInput = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.priority !== undefined) updateData.priority = data.priority;

  return prisma.task.update({
    where: { id },
    data: updateData,
    include: { subTasks: true },
  });
}

export async function deleteTask(id: string, userId: string) {
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) return null;

  await prisma.task.delete({ where: { id } });
  return task;
}

// ── Comments ──

export async function addComment(
  taskId: string,
  userId: string | null,
  content: string,
  isAgent = false,
) {
  return prisma.taskComment.create({
    data: { taskId, userId, content, isAgent },
    include: { user: { select: { id: true, name: true } } },
  });
}

export async function listComments(taskId: string, limit = 200) {
  return prisma.taskComment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { user: { select: { id: true, name: true } } },
  });
}

// ── Execution Steps ──

export async function addExecutionStep(
  taskId: string,
  data: {
    description: string;
    toolUsed?: string;
    input?: Record<string, unknown>;
    phase?: TaskStepPhase;
    status?: TaskStepStatus;
  },
) {
  const lastStep = await prisma.taskExecutionStep.findFirst({
    where: { taskId },
    orderBy: { stepNumber: 'desc' },
  });

  return prisma.taskExecutionStep.create({
    data: {
      taskId,
      stepNumber: (lastStep?.stepNumber ?? 0) + 1,
      description: data.description,
      toolUsed: data.toolUsed ?? null,
      input: data.input ? (data.input as Prisma.InputJsonValue) : Prisma.DbNull,
      status: data.status ?? 'running',
      phase: data.phase ?? null,
    },
  });
}

export async function updateExecutionStep(
  stepId: string,
  data: {
    status?: TaskStepStatus;
    output?: Record<string, unknown>;
    durationMs?: number;
  },
) {
  const updateData: Prisma.TaskExecutionStepUpdateInput = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.output !== undefined) updateData.output = data.output as Prisma.InputJsonValue;
  if (data.durationMs !== undefined) updateData.durationMs = data.durationMs;

  return prisma.taskExecutionStep.update({
    where: { id: stepId },
    data: updateData,
  });
}

export async function listExecutionSteps(taskId: string, limit = 500) {
  return prisma.taskExecutionStep.findMany({
    where: { taskId },
    orderBy: { stepNumber: 'asc' },
    take: limit,
  });
}

// ── Subtask helpers ──

export async function createSubtask(
  parentTaskId: string,
  userId: string,
  data: { title: string; description?: string },
) {
  return prisma.task.create({
    data: {
      userId,
      title: data.title,
      description: data.description ?? null,
      source: 'sub_agent',
      parentTaskId,
      context: {},
    },
  });
}

// ── Context ──
// Merge a patch into task.context (JSON). Used for "+ Add context" UI and for
// the planner to persist review feedback so the next planning run has context.

export async function setContext(
  taskId: string,
  userId: string,
  patch: Record<string, unknown>,
) {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) return null;

  const current = (task.context as Record<string, unknown>) ?? {};
  const merged = { ...current, ...patch };

  return prisma.task.update({
    where: { id: taskId },
    data: { context: merged as Prisma.InputJsonValue },
  });
}

// ── Reviews (human-in-the-loop gate) ──

export async function createReview(
  taskId: string,
  reviewerId: string,
  data: { decision: ReviewDecision; feedback?: string },
) {
  return prisma.taskReview.create({
    data: {
      taskId,
      reviewerId,
      decision: data.decision,
      feedback: data.feedback ?? null,
    },
    include: { reviewer: { select: { id: true, name: true } } },
  });
}

export async function listReviews(taskId: string) {
  return prisma.taskReview.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    include: { reviewer: { select: { id: true, name: true } } },
  });
}
