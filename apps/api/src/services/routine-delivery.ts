/**
 * Routine delivery + approval-gate completion.
 *
 * Extracts the "what happens to a routine's produced output" logic so it can be
 * shared between two callers that must behave identically:
 *
 *   1. the routine worker, when a run finishes with NO approval gate, and
 *   2. the approvals route, when a gated run is APPROVED and must resume.
 *
 * Before this module the worker delivered inline and the resume path only
 * flipped the run back to `running` — so an approved routine never delivered
 * its output and the run hung in `running` forever. Routing both paths through
 * `deliverRoutineOutput` + `finalizeRunSuccess` closes that loop.
 */
import type { Prisma } from '@prisma/client';
import type { DeliveryRule, DeliveryTarget } from '@hearth/shared';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { deliver } from './delivery-service.js';
import { evaluateDeliveryRules, applyTemplate } from './delivery-rule-engine.js';
import { createApprovalRequest } from './approval-service.js';

type RoutineRow = {
  id: string;
  name: string;
  userId: string;
  delivery: unknown;
  state: unknown;
};

/**
 * Deliver a routine run's output through the routine's configured channels,
 * honoring conditional delivery rules (Feature 6) with a channel fallback.
 * Mirrors the logic that previously lived inline in the worker.
 */
export async function deliverRoutineOutput(
  routine: RoutineRow,
  runId: string,
  output: string,
): Promise<void> {
  const userId = routine.userId;
  const deliveryConfig = (routine.delivery as Record<string, unknown>) ?? {};
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
        entityId: routine.id,
        channels: [target.channel as 'in_app' | 'slack' | 'email'],
        metadata: { runId, ...target.config },
      });
    }

    if (tags.length > 0) {
      const cleanState = { ...routineState };
      delete cleanState._delivery_tags;
      await prisma.routine.update({
        where: { id: routine.id },
        data: { state: cleanState as Prisma.InputJsonValue },
      });
    }
  } else {
    const channels = (deliveryConfig.channels as string[]) ?? ['in_app'];
    await deliver({
      userId,
      title: `Routine completed: ${routine.name}`,
      body: output.slice(0, 500),
      entityType: 'routine',
      entityId: routine.id,
      channels: channels as ('in_app' | 'slack' | 'email')[],
      metadata: { runId },
    });
  }
}

/**
 * Return the approval gate (checkpoint) a routine's run must pass before its
 * output is delivered, or null if the routine is ungated.
 *
 * Checkpoints are authored on the routine as a `checkpoints` JSON array (the
 * routine create/update API), but an ApprovalRequest needs a real
 * ApprovalCheckpoint row to reference (FK). So the gate is resolved in two
 * steps: prefer an existing ApprovalCheckpoint row; otherwise MATERIALIZE one
 * from the first JSON checkpoint def. This bridges the authoring shape (JSON)
 * to the runtime shape (row) — without it, JSON-authored gates never fired.
 */
export async function findApprovalGate(routineId: string) {
  const existing = await prisma.approvalCheckpoint.findFirst({
    where: { routineId },
    orderBy: { position: 'asc' },
  });
  if (existing) return existing;

  const routine = await prisma.routine.findUnique({
    where: { id: routineId },
    select: { checkpoints: true },
  });
  const defs = (routine?.checkpoints as Array<Record<string, unknown>> | null) ?? [];
  if (!Array.isArray(defs) || defs.length === 0) return null;

  // Materialize the earliest checkpoint def into a row. Defensive about the def
  // shape (the authoring UI may omit position/approverPolicy/timeout).
  const first = [...defs].sort(
    (a, b) => (Number(a.position) || 0) - (Number(b.position) || 0),
  )[0];
  return prisma.approvalCheckpoint.create({
    data: {
      routineId,
      name: typeof first.name === 'string' ? first.name : 'Approval gate',
      description: typeof first.description === 'string' ? first.description : null,
      position: Number(first.position) || 0,
      approverPolicy: (first.approverPolicy as Prisma.InputJsonValue) ?? {},
      timeoutMinutes: typeof first.timeoutMinutes === 'number' ? first.timeoutMinutes : null,
      timeoutAction: typeof first.timeoutAction === 'string' ? (first.timeoutAction as string) : null,
    },
  });
}

/**
 * Pause a run at an approval gate: stash the produced output on the run, flip
 * its status to `awaiting_approval`, and open a pending ApprovalRequest carrying
 * the output for the reviewer. The run is NOT delivered or completed until a
 * reviewer resolves the request (see finalizeApprovedRun / the approvals route).
 */
export async function pauseRunForApproval(
  runId: string,
  checkpoint: { id: string; timeoutMinutes?: number | null },
  output: string,
): Promise<void> {
  const timeoutAt =
    checkpoint.timeoutMinutes != null
      ? new Date(Date.now() + checkpoint.timeoutMinutes * 60_000)
      : undefined;

  await prisma.routineRun.update({
    where: { id: runId },
    data: {
      status: 'awaiting_approval',
      pausedState: { output } as Prisma.InputJsonValue,
    },
  });

  await createApprovalRequest({
    runId,
    checkpointId: checkpoint.id,
    agentOutput: output,
    timeoutAt,
  });

  logger.info({ runId, checkpointId: checkpoint.id }, 'Routine run paused for approval');
}

/** Mark a run finished successfully and record its delivered output. */
export async function finalizeRunSuccess(runId: string, output: string): Promise<void> {
  await prisma.routineRun.update({
    where: { id: runId },
    data: {
      status: 'success',
      output: { result: output } as Prisma.InputJsonValue,
      summary: output.length > 0 ? output.slice(0, 200) : null,
      completedAt: new Date(),
    },
  });
}

/**
 * Resume a run whose approval was granted: take the reviewer-edited output if
 * present (else the original agent output), deliver it, and finalize the run as
 * a success. Idempotent-ish: a run that is no longer awaiting approval is left
 * untouched. Returns the delivered output (or null if nothing to resume).
 */
export async function finalizeApprovedRun(runId: string): Promise<string | null> {
  const run = await prisma.routineRun.findUnique({
    where: { id: runId },
    include: {
      routine: { select: { id: true, name: true, userId: true, delivery: true, state: true } },
      approvalRequests: {
        where: { status: { in: ['approved', 'edited', 'auto_approved'] } },
        orderBy: { resolvedAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!run) return null;
  if (run.status !== 'awaiting_approval' && run.status !== 'running') return null;

  const approval = run.approvalRequests[0];
  const pausedOutput = (run.pausedState as { output?: string } | null)?.output;
  const output = approval?.editedOutput ?? approval?.agentOutput ?? pausedOutput ?? '';

  await deliverRoutineOutput(run.routine, run.id, output);
  await finalizeRunSuccess(run.id, output);
  await prisma.routine.update({
    where: { id: run.routine.id },
    data: { lastRunAt: new Date(), lastRunStatus: 'success' },
  });

  logger.info({ runId, routineId: run.routine.id }, 'Approved routine run finalized + delivered');
  return output;
}
