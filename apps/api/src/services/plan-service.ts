import type { AgentPlan } from '../agent/types.js';
import { prisma } from '../lib/prisma.js';

/**
 * Plan → Build approval contract (W4).
 *
 * `approvePlanForBuild` is the single source of truth for the "Approve & Build"
 * decision + the idempotent approval flip. It is kept pure of HTTP so the route
 * can map its discriminated result to status codes and the contract (409 no
 * plan, 403 non-owner, idempotent single-build) is unit-testable without a
 * server harness.
 *
 * Ownership: the plan's owner is the human who sent the request that produced
 * the plan (`chat_messages.respondingTo.createdBy`), falling back to the session
 * owner when the plan message isn't linked to a request.
 *
 * Idempotency: the approval flips `metadata.plan.approved` false → true via a
 * guarded `updateMany` whose predicate excludes rows already `approved: true`.
 * Exactly one concurrent caller matches, so a double-approve / double-click
 * yields `already_approved` for the losers and a single `approved` winner — the
 * route starts the Build run ONLY for the winner.
 */

export type ApprovePlanResult =
  | { status: 'not_found' }
  | { status: 'no_plan' }
  | { status: 'forbidden' }
  | { status: 'already_approved' }
  | { status: 'approved'; plan: AgentPlan; orgId: string };

export interface ApprovePlanInput {
  sessionId: string;
  messageId: string;
  /** The user attempting to approve. */
  userId: string;
  /** The session's owner (used as the ownership fallback). */
  sessionOwnerId: string;
}

/** Narrow unknown metadata to a plan with an `approved` flag, if present. */
function readPlan(metadata: unknown): (AgentPlan & { approved?: boolean }) | null {
  const meta = (metadata as Record<string, unknown> | null) ?? {};
  const plan = meta.plan as (AgentPlan & { approved?: boolean }) | undefined;
  if (!plan || !Array.isArray(plan.steps)) return null;
  return plan;
}

/** True when a plan has at least one actionable step. */
export function isActionablePlan(plan: AgentPlan | null | undefined): boolean {
  return !!plan && Array.isArray(plan.steps) && plan.steps.length > 0;
}

export async function approvePlanForBuild(input: ApprovePlanInput): Promise<ApprovePlanResult> {
  const planMessage = await prisma.chatMessage.findFirst({
    where: { id: input.messageId, sessionId: input.sessionId },
    select: {
      id: true,
      orgId: true,
      metadata: true,
      respondingTo: { select: { createdBy: true } },
    },
  });
  if (!planMessage) return { status: 'not_found' };

  const plan = readPlan(planMessage.metadata);
  // Empty / degenerate / absent plan → nothing to build (→ 409).
  if (!isActionablePlan(plan)) return { status: 'no_plan' };

  // Owner gate (→ 403 for non-owners).
  const ownerId = planMessage.respondingTo?.createdBy ?? input.sessionOwnerId;
  if (ownerId !== input.userId) return { status: 'forbidden' };

  const meta = (planMessage.metadata as Record<string, unknown> | null) ?? {};
  // Idempotent flip: only the row not-yet-approved matches.
  const flip = await prisma.chatMessage.updateMany({
    where: {
      id: input.messageId,
      NOT: { metadata: { path: ['plan', 'approved'], equals: true } },
    },
    data: { metadata: { ...meta, plan: { ...plan!, approved: true } } as never },
  });

  if (flip.count === 0) return { status: 'already_approved' };

  return { status: 'approved', plan: plan!, orgId: planMessage.orgId };
}
