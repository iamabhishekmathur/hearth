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
import { logger } from '../lib/logger.js';
import type { InvitationContext, UserRole } from '@hearth/shared';
import { markStepComplete } from './onboarding-service.js';
import { notify } from './notification-service.js';
import { createInvite } from './invitation-service.js';

/**
 * Thrown when a concurrent status transition lost the compare-and-set race:
 * another transaction already moved the task off the status we validated
 * against. Carries `status = 409` so the global error handler maps it to a
 * Conflict response (the route does not need to special-case it).
 */
export class TaskTransitionConflictError extends Error {
  readonly status = 409;
  readonly code = 'task_transition_conflict';
  constructor(message = 'Task was modified concurrently; status transition no longer valid') {
    super(message);
    this.name = 'TaskTransitionConflictError';
  }
}

export async function createTask(
  orgId: string,
  userId: string,
  data: {
    title: string;
    description?: string;
    source: TaskSource;
    status?: TaskStatus;
    priority?: number;
    parentTaskId?: string;
    sourceSessionId?: string;
    sourceMessageId?: string;
    sourceRef?: Record<string, unknown>;
  },
) {
  const task = await prisma.task.create({
    data: {
      orgId,
      userId,
      title: data.title,
      description: data.description ?? null,
      source: data.source,
      status: data.status ?? 'auto_detected',
      priority: data.priority ?? 0,
      parentTaskId: data.parentTaskId ?? null,
      sourceSessionId: data.sourceSessionId ?? null,
      sourceMessageId: data.sourceMessageId ?? null,
      ...(data.sourceRef !== undefined ? { sourceRef: data.sourceRef as Prisma.InputJsonValue } : {}),
      context: {},
    },
    include: { subTasks: true, comments: true },
  });

  // Onboarding: the user's first task (whether created by hand or surfaced by
  // detection on their behalf) completes the first_task step. Real server-side
  // signal — best-effort + non-blocking + idempotent. Never fail task creation
  // on an onboarding write.
  void markStepComplete(userId, 'first_task').catch((err) => {
    logger.error({ err, userId, taskId: task.id }, 'Failed to mark first_task onboarding step (non-fatal)');
  });

  return task;
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
      contextItems: { orderBy: { sortOrder: 'asc' } },
      sourceSession: { select: { id: true, title: true } },
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

  const isStatusChange = data.status !== undefined && data.status !== task.status;

  // Validate status transition against the status we just observed. The same
  // status is enforced atomically below via a compare-and-set, so the rule we
  // check here is the rule that actually commits.
  if (isStatusChange) {
    const allowed = VALID_STATUS_TRANSITIONS[task.status as TaskStatus];
    if (!allowed.includes(data.status as TaskStatus)) {
      throw new Error(
        `Invalid status transition from ${task.status} to ${data.status}`,
      );
    }
  }

  const fieldData: Prisma.TaskUpdateInput = {};
  if (data.title !== undefined) fieldData.title = data.title;
  if (data.description !== undefined) fieldData.description = data.description;
  if (data.priority !== undefined) fieldData.priority = data.priority;

  if (isStatusChange) {
    // Atomic compare-and-set: only flip the status if it is *still* the value
    // we validated the transition from. Under two racing PATCHes (e.g. both
    // reading `executing` and one trying `review`, the other `archived`), only
    // the first updateMany matches `status: task.status`; the loser sees
    // count===0 and is rejected with a 409 instead of silently overwriting a
    // now-terminal/illegal state.
    const res = await prisma.task.updateMany({
      where: { id, userId, status: task.status },
      data: { ...fieldData, status: data.status as TaskStatus },
    });
    if (res.count === 0) {
      throw new TaskTransitionConflictError(
        `Task ${id} changed concurrently; transition from ${task.status} to ${data.status} no longer valid`,
      );
    }
  } else if (Object.keys(fieldData).length > 0) {
    // No status change — plain field update (title/description/priority).
    await prisma.task.updateMany({ where: { id, userId }, data: fieldData });
  }

  // Re-read so the caller (and emitted WS event) reflects the committed row,
  // including the status the winning transition actually set.
  return prisma.task.findFirst({
    where: { id, userId },
    include: { subTasks: true },
  });
}

export async function deleteTask(id: string, userId: string) {
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) return null;

  await prisma.task.delete({ where: { id } });
  return task;
}

// ── Invitation integration (Track A primitives) ──
//
// invitation-service (Track A) owns createInvite + the Invitation schema; we
// CALL it. A "contextual" invite carries an artifact reference so the accepted
// invitee lands directly in it (here: the task or chat session that triggered
// the invite). All invite creation is best-effort and must never fail the
// primary action (task assignment / message send).

/**
 * Create a contextual invite for a not-yet-a-member email. Returns the accept
 * URL on success, or null when invite creation fails. Never throws. Sending any
 * invite advances the inviter past the invite_teammate onboarding step
 * (idempotent, fire-and-forget).
 */
export async function createContextualInvite(input: {
  orgId: string;
  email: string;
  invitedByUserId: string;
  role?: UserRole;
  context?: InvitationContext;
}): Promise<string | null> {
  try {
    const { acceptUrl } = await createInvite(input);
    void markStepComplete(input.invitedByUserId, 'invite_teammate').catch((err) => {
      logger.error(
        { err, userId: input.invitedByUserId },
        'Failed to mark invite_teammate onboarding step (non-fatal)',
      );
    });
    return acceptUrl;
  } catch (err) {
    logger.error({ err, email: input.email }, 'createContextualInvite failed (non-fatal)');
    return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Find an active member of `orgId` by exact (case-insensitive) email. */
export async function findOrgUserByEmail(orgId: string, email: string) {
  return prisma.user.findFirst({
    where: { team: { orgId }, email: { equals: email.trim(), mode: 'insensitive' } },
    select: { id: true, name: true, email: true },
  });
}

// ── Assignment ──
//
// Assigning a task to someone in the org notifies them; assigning to an email
// that is not yet a member sends a CONTEXTUAL invite carrying the task, so the
// accepted invitee lands on it. `assigneeId` (Track A's column) is always a real
// org user id; an emailed invite leaves the task unassigned until the invitee
// accepts (Track A's accept flow back-fills the assignee from the invite).

export interface AssignResult {
  task: { id: string; orgId: string; userId: string; title: string } | null;
  /** Set when an existing org user was assigned and notified. */
  assignedUserId?: string;
  /** Set when a non-user email was invited with the task as context. */
  invitedEmail?: string;
  notFound?: boolean;
}

/**
 * Assign a task to either an existing org user (by id or email) or a not-yet-a-
 * member email (which triggers a contextual invite). Caller must own the task
 * (mirrors updateTask's `{ id, userId }` scoping). All side effects after the
 * assignee resolves are best-effort and never throw.
 */
export async function assignTask(
  taskId: string,
  callerUserId: string,
  assignee: { userId?: string; email?: string },
): Promise<AssignResult> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId: callerUserId },
    select: { id: true, orgId: true, userId: true, title: true },
  });
  if (!task) return { task: null, notFound: true };

  // Resolve the target org user, if any. An explicit userId wins; otherwise an
  // email is matched against org membership.
  let targetUser: { id: string; name: string; email: string } | null = null;
  if (assignee.userId) {
    targetUser = await prisma.user.findFirst({
      where: { id: assignee.userId, team: { orgId: task.orgId } },
      select: { id: true, name: true, email: true },
    });
    if (!targetUser) {
      // userId given but not a member of this org → treat as not found.
      return { task, notFound: true };
    }
  } else if (assignee.email && EMAIL_RE.test(assignee.email.trim())) {
    targetUser = await findOrgUserByEmail(task.orgId, assignee.email);
  }

  if (targetUser) {
    // Existing org user → set assigneeId + notify.
    await prisma.task.update({
      where: { id: task.id },
      data: { assigneeId: targetUser.id },
    });

    if (targetUser.id !== callerUserId) {
      void notify({
        orgId: task.orgId,
        userId: targetUser.id,
        type: 'task_assigned',
        title: 'You were assigned a task',
        body: task.title,
        entityType: 'task',
        entityId: task.id,
      }).catch((err) => {
        logger.error({ err, taskId: task.id }, 'task_assigned notify failed (non-fatal)');
      });
    }
    return { task, assignedUserId: targetUser.id };
  }

  // Not yet a member → contextual invite carrying the task.
  if (assignee.email && EMAIL_RE.test(assignee.email.trim())) {
    await createContextualInvite({
      orgId: task.orgId,
      email: assignee.email.trim(),
      invitedByUserId: callerUserId,
      context: { type: 'task', id: task.id },
    });
    return { task, invitedEmail: assignee.email.trim() };
  }

  // Neither a resolvable user nor a valid email.
  return { task };
}

// ── Comments ──

export async function addComment(
  taskId: string,
  userId: string | null,
  content: string,
  isAgent = false,
) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { orgId: true } });
  if (!task) throw new Error(`Task ${taskId} not found`);
  return prisma.taskComment.create({
    data: { orgId: task.orgId, taskId, userId, content, isAgent },
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
  const [task, lastStep] = await Promise.all([
    prisma.task.findUnique({ where: { id: taskId }, select: { orgId: true } }),
    prisma.taskExecutionStep.findFirst({
      where: { taskId },
      orderBy: { stepNumber: 'desc' },
    }),
  ]);
  if (!task) throw new Error(`Task ${taskId} not found`);

  return prisma.taskExecutionStep.create({
    data: {
      orgId: task.orgId,
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
  const parent = await prisma.task.findUnique({
    where: { id: parentTaskId },
    select: { orgId: true },
  });
  if (!parent) throw new Error(`Parent task ${parentTaskId} not found`);
  return prisma.task.create({
    data: {
      orgId: parent.orgId,
      userId,
      title: data.title,
      description: data.description ?? null,
      // Subtasks are created ready-to-run: the executor picks up 'backlog'
      // subtasks. Defaulting to 'auto_detected' left planner subtasks orphaned.
      status: 'backlog',
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
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { orgId: true, title: true, sourceSessionId: true },
  });
  if (!task) throw new Error(`Task ${taskId} not found`);
  const review = await prisma.taskReview.create({
    data: {
      orgId: task.orgId,
      taskId,
      reviewerId,
      decision: data.decision,
      feedback: data.feedback ?? null,
    },
    include: { reviewer: { select: { id: true, name: true } } },
  });

  // An approval transitions the task to 'done'. If the task originated from a
  // chat session, post a 'done' milestone so the chat story doesn't dangle at
  // "Awaiting review". Best-effort: never fail the review on a side effect.
  if (data.decision === 'approved' && task.sourceSessionId) {
    const sessionId = task.sourceSessionId;
    void import('./chat-service.js')
      .then((chatService) =>
        chatService.postTaskProgress({
          sessionId,
          taskId,
          milestone: 'done',
          taskTitle: task.title,
          taskStatus: 'done',
        }),
      )
      .catch((err) =>
        logger.error({ err, taskId }, 'postTaskProgress(done) failed'),
      );
  }

  return review;
}

export async function listReviews(taskId: string) {
  return prisma.taskReview.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    include: { reviewer: { select: { id: true, name: true } } },
  });
}
