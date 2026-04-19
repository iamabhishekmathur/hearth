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

export async function resolveApproval(
  requestId: string,
  reviewerId: string,
  decision: 'approved' | 'rejected' | 'edited',
  opts?: { comment?: string; editedOutput?: string },
) {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: { run: { select: { id: true, routineId: true } } },
  });

  if (!request || request.status !== 'pending') {
    return null;
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

export async function getApprovalRequest(id: string) {
  return prisma.approvalRequest.findUnique({
    where: { id },
    include: {
      checkpoint: true,
      run: {
        select: {
          id: true,
          status: true,
          output: true,
          routine: { select: { id: true, name: true, userId: true } },
        },
      },
      reviewer: { select: { id: true, name: true } },
    },
  });
}
