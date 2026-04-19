import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { emitToOrg } from '../ws/socket-manager.js';
import { FEED_WORTHY_ACTIONS } from '@hearth/shared';

export type AuditAction =
  | 'llm_call'
  | 'tool_call'
  | 'auth_login'
  | 'auth_register'
  | 'auth_logout'
  | 'task_status_change'
  | 'task_completed'
  | 'skill_install'
  | 'skill_uninstall'
  | 'skill_published'
  | 'integration_connect'
  | 'integration_disconnect'
  | 'routine_run'
  | 'session_created'
  | 'compliance_scrub'
  | 'governance_violation'
  | 'governance_policy_change'
  | 'decision_captured'
  | 'decision_outcome_updated'
  | 'pattern_extracted'
  | 'principle_proposed';

export type AuditEntityType =
  | 'session'
  | 'task'
  | 'routine'
  | 'skill'
  | 'memory'
  | 'integration'
  | 'user'
  | 'governance_policy'
  | 'governance_violation'
  | 'decision';

interface AuditLogInput {
  orgId: string;
  userId?: string;
  action: AuditAction;
  entityType?: AuditEntityType;
  entityId?: string;
  details: Record<string, unknown>;
}

/**
 * Log an audit event. Fire-and-forget — errors are logged but not thrown.
 * Feed-worthy actions are also emitted via WebSocket to the org room.
 */
export async function logAudit(input: AuditLogInput): Promise<void> {
  try {
    const record = await prisma.auditLog.create({
      data: {
        orgId: input.orgId,
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        details: input.details as Prisma.InputJsonValue,
      },
    });

    // Emit to org room for activity feed
    if ((FEED_WORTHY_ACTIONS as readonly string[]).includes(input.action) && input.orgId) {
      let userName: string | null = null;
      if (input.userId) {
        const user = await prisma.user.findUnique({
          where: { id: input.userId },
          select: { name: true },
        });
        userName = user?.name ?? null;
      }

      emitToOrg(input.orgId, 'activity:event', {
        id: record.id,
        userId: input.userId,
        userName,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        details: input.details,
        createdAt: record.createdAt.toISOString(),
      });
    }
  } catch (err) {
    logger.error({ err, audit: input }, 'Failed to write audit log');
  }
}

/**
 * Log an LLM call.
 */
export async function logLLMCall(params: {
  orgId: string;
  userId: string;
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}): Promise<void> {
  await logAudit({
    orgId: params.orgId,
    userId: params.userId,
    action: 'llm_call',
    entityType: 'session',
    entityId: params.sessionId,
    details: {
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      durationMs: params.durationMs,
    },
  });
}

/**
 * Log a tool call.
 */
export async function logToolCall(params: {
  orgId: string;
  userId: string;
  sessionId: string;
  toolName: string;
  durationMs: number;
  success: boolean;
}): Promise<void> {
  await logAudit({
    orgId: params.orgId,
    userId: params.userId,
    action: 'tool_call',
    entityType: 'session',
    entityId: params.sessionId,
    details: {
      toolName: params.toolName,
      durationMs: params.durationMs,
      success: params.success,
    },
  });
}

/**
 * Log an auth event.
 */
export async function logAuthEvent(params: {
  orgId?: string;
  userId?: string;
  action: 'auth_login' | 'auth_register' | 'auth_logout';
  email: string;
  success: boolean;
}): Promise<void> {
  await logAudit({
    orgId: params.orgId || '',
    userId: params.userId,
    action: params.action,
    entityType: 'user',
    entityId: params.userId,
    details: {
      email: params.email,
      success: params.success,
    },
  });
}

/**
 * Log a compliance scrub event.
 */
export async function logComplianceScrub(params: {
  orgId: string;
  userId?: string;
  sessionId?: string;
  packs: string[];
  entityCounts: Record<string, number>;
  direction: 'outbound' | 'inbound';
  auditLevel: 'summary' | 'detailed';
}): Promise<void> {
  const details: Record<string, unknown> = {
    packs: params.packs,
    entityCounts: params.entityCounts,
    direction: params.direction,
    totalEntities: Object.values(params.entityCounts).reduce((a, b) => a + b, 0),
  };

  await logAudit({
    orgId: params.orgId,
    userId: params.userId,
    action: 'compliance_scrub',
    entityType: 'session',
    entityId: params.sessionId,
    details,
  });
}

export interface AuditLogFilters {
  orgId: string;
  userId?: string;
  action?: AuditAction;
  entityType?: AuditEntityType;
  page?: number;
  pageSize?: number;
}

/**
 * Query audit logs with pagination and filtering.
 */
export async function queryAuditLogs(filters: AuditLogFilters) {
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 50;
  const skip = (page - 1) * pageSize;

  const where = {
    orgId: filters.orgId,
    ...(filters.userId && { userId: filters.userId }),
    ...(filters.action && { action: filters.action }),
    ...(filters.entityType && { entityType: filters.entityType }),
  };

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { data, total, page, pageSize };
}
