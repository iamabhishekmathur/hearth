import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { emitToUser } from '../ws/socket-manager.js';

export async function createApprovalRequest(data: {
  runId: string;
  checkpointId: string;
  agentOutput?: string;
  timeoutAt?: Date;
}) {
  const request = await prisma.approvalRequest.create({
    data: {
      runId: data.runId,
      checkpointId: data.checkpointId,
      status: 'pending',
      agentOutput: data.agentOutput ?? null,
      timeoutAt: data.timeoutAt ?? null,
    },
    include: {
      checkpoint: { select: { name: true, routineId: true } },
      run: { select: { routine: { select: { userId: true, name: true } } } },
    },
  });

  // Notify the routine owner about the pending approval
  const userId = request.run.routine.userId;
  emitToUser(userId, 'notification', {
    type: 'approval_requested',
    title: `Approval needed: ${request.run.routine.name}`,
    body: `Checkpoint "${request.checkpoint.name}" requires your approval`,
    entityType: 'approval',
    entityId: request.id,
    timestamp: new Date().toISOString(),
  });

  return request;
}

/**
 * Resolves the org an approval request belongs to, derived through
 * run → routine → (orgId | owner's team org). Returns null if it can't be
 * resolved (e.g. orphaned data).
 */
async function approvalOrgId(request: {
  run: { routine: { orgId: string | null; userId: string; user?: { team: { orgId: string } | null } | null } };
}): Promise<string | null> {
  const routine = request.run.routine;
  if (routine.orgId) return routine.orgId;
  return routine.user?.team?.orgId ?? null;
}

/** Thrown by resolveApproval when the caller is in-org but not a permitted approver. */
export class ApprovalForbiddenError extends Error {
  code = 'APPROVAL_FORBIDDEN' as const;
  constructor() {
    super('Not authorized to resolve this approval');
  }
}

export async function resolveApproval(
  requestId: string,
  reviewerId: string,
  decision: 'approved' | 'rejected' | 'edited',
  opts?: { comment?: string; editedOutput?: string; orgId?: string | null; callerRole?: string },
) {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: {
      run: {
        select: {
          id: true,
          routineId: true,
          routine: {
            select: {
              orgId: true,
              userId: true,
              user: { select: { team: { select: { orgId: true } } } },
            },
          },
        },
      },
    },
  });

  if (!request || request.status !== 'pending') {
    return null;
  }

  // Org isolation: a caller may only resolve approvals belonging to their own
  // org. Cross-org resolution is treated as not-found (null → 404).
  if (opts?.orgId !== undefined) {
    const orgId = await approvalOrgId(request);
    if (orgId && opts.orgId && orgId !== opts.orgId) {
      return null;
    }
  }

  // APPR-Z-01: in-org authorization. Only the routine owner or an org admin may
  // resolve an approval. A same-org non-owner non-admin is forbidden (→ 403),
  // which is distinct from the not-found/cross-org case above (→ 404).
  if (opts?.callerRole !== undefined) {
    const isOwner = reviewerId === request.run.routine.userId;
    const isAdmin = opts.callerRole === 'admin';
    if (!isOwner && !isAdmin) {
      throw new ApprovalForbiddenError();
    }
  }

  const updated = await prisma.approvalRequest.update({
    where: { id: requestId },
    data: {
      status: decision,
      reviewerId,
      reviewerComment: opts?.comment ?? null,
      editedOutput: opts?.editedOutput ?? null,
      resolvedAt: new Date(),
    },
    include: {
      run: { select: { id: true, routineId: true } },
      checkpoint: { select: { name: true } },
    },
  });

  return updated;
}

export async function handleApprovalTimeout(requestId: string, timeoutAction: 'approve' | 'reject') {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
  });

  if (!request || request.status !== 'pending') return null;

  const status = timeoutAction === 'approve' ? 'auto_approved' : 'auto_rejected';

  return prisma.approvalRequest.update({
    where: { id: requestId },
    data: {
      status,
      reviewerComment: `Auto-${timeoutAction}d after timeout`,
      resolvedAt: new Date(),
    },
  });
}

export async function getPendingApprovalsForUser(userId: string) {
  // Get user's org/team/role to determine which approvals they can see
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, teamId: true, team: { select: { orgId: true } } },
  });
  if (!user) return [];

  return prisma.approvalRequest.findMany({
    where: {
      status: 'pending',
      run: {
        routine: {
          OR: [
            { userId }, // own routines
            { orgId: user.team?.orgId ?? undefined }, // org-level routines
          ],
        },
      },
    },
    include: {
      checkpoint: { select: { name: true, description: true } },
      run: {
        select: {
          id: true,
          routine: { select: { id: true, name: true, userId: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getApprovalRequest(id: string, orgId?: string | null) {
  const request = await prisma.approvalRequest.findUnique({
    where: { id },
    include: {
      checkpoint: true,
      run: {
        select: {
          id: true,
          status: true,
          output: true,
          routine: {
            select: {
              id: true,
              name: true,
              userId: true,
              orgId: true,
              user: { select: { team: { select: { orgId: true } } } },
            },
          },
        },
      },
      reviewer: { select: { id: true, name: true } },
    },
  });

  if (!request) return null;

  // Org isolation: hide approvals from other orgs (cross-org read → 404).
  if (orgId !== undefined && orgId !== null) {
    const routine = request.run.routine;
    const requestOrgId = routine.orgId ?? routine.user?.team?.orgId ?? null;
    if (requestOrgId && requestOrgId !== orgId) return null;
  }

  return request;
}
