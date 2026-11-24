/**
 * Knowledge loop, Phase 4 — routines as factories (`/api/v1/routines/:id/…`).
 *
 *   GET    /:id/ownership             who owns it; may I restore / change owner?
 *   POST   /:id/dry-run               run on the last input, deliver nothing (202)
 *   GET    /:id/dry-runs/:dryRunId    poll a dry run (only its requester, 24 h)
 *   GET    /:id/test-cases            the routine's test cases + last results
 *   POST   /:id/test-cases            add one (owners)
 *   PATCH  /:id/test-cases/:caseId    edit one (owners)
 *   DELETE /:id/test-cases/:caseId    delete one (owners)
 *   POST   /:id/test-cases/run        dry run + check every case (owners, 202)
 *
 * All behind the org flag `knowledgeLoop`: with it off every route answers
 * 404. A routine the caller cannot view answers 404 (other orgs, other teams,
 * someone else's personal routine). Changing things and dry runs need an
 * OWNER of the routine (knowledge-owner.isRoutineOwner): the person for a
 * personal routine; admins and that team's leads for a team routine; admins
 * for an org routine; plus an explicitly named owner. Members and viewers may
 * read test cases but get 403 for the rest.
 */
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import type { Routine } from '@prisma/client';
import type { RoutineOwnership } from '@hearth/shared';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { isFeatureEnabled } from '../lib/feature-flags.js';
import { logAudit } from '../services/audit-service.js';
import * as routineService from '../services/routine-service.js';
import { isRoutineOwner, type KnowledgeActor } from '../services/knowledge-owner.js';
import {
  MAX_DESCRIPTION_CHARS,
  MAX_PHRASES,
  MAX_PHRASE_CHARS,
  MAX_CASES_PER_ROUTINE,
  createTestCase,
  deleteTestCase,
  listTestCases,
  updateTestCase,
} from '../services/routine-test-cases.js';
import {
  MAX_ACTIVE_DRY_RUNS_PER_USER,
  MAX_DRY_RUN_PROMPT_CHARS,
  getDryRun,
  startDryRun,
  type StartResult,
} from '../services/routine-dry-run.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PermCtx = (req: Request) => KnowledgeActor;

async function flagOn(orgId: string | null): Promise<boolean> {
  if (!orgId) return false;
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
  return isFeatureEnabled(org?.settings, 'knowledgeLoop');
}

function notFound(res: Response, what = 'Routine not found'): void {
  res.status(404).json({ error: what });
}

interface Loaded {
  routine: Routine;
  actor: KnowledgeActor;
  orgId: string;
  isOwner: boolean;
}

/**
 * Flag → visibility → (optionally) ownership. Answers the request itself and
 * returns null when the caller may not go on.
 */
async function load(
  req: Request,
  res: Response,
  permCtx: PermCtx,
  opts: { owner: boolean; ownerError?: string },
): Promise<Loaded | null> {
  const actor = permCtx(req);
  if (!(await flagOn(actor.orgId))) {
    notFound(res, 'Not found');
    return null;
  }
  const routine = await routineService.getRoutine(req.params.id as string, actor);
  if (!routine) {
    notFound(res);
    return null;
  }
  const isOwner = isRoutineOwner(actor, routine);
  if (opts.owner && !isOwner) {
    res.status(403).json({ error: opts.ownerError ?? 'Only an owner of this routine can do this' });
    return null;
  }
  return { routine, actor, orgId: (routine.orgId ?? actor.orgId)!, isOwner };
}

function sendStart(res: Response, result: StartResult): void {
  switch (result.status) {
    case 'ok':
      res.status(202).json({ data: result.dryRun });
      return;
    case 'no_past_run':
      res.status(409).json({
        error:
          'This routine has not run yet, so there is no input to replay. Run it once, then try a dry run.',
        code: 'no_past_run',
      });
      return;
    case 'no_test_cases':
      res.status(409).json({
        error: 'This routine has no test cases yet. Add one first.',
        code: 'no_test_cases',
      });
      return;
    case 'too_many':
      res.status(429).json({
        error: `You already have ${MAX_ACTIVE_DRY_RUNS_PER_USER} dry runs going. Wait for one to finish.`,
        code: 'too_many_dry_runs',
      });
      return;
  }
}

const dryRunSchema = z
  .object({ prompt: z.string().trim().min(1).max(MAX_DRY_RUN_PROMPT_CHARS).optional() })
  .strict();

const phrasesSchema = z
  .array(z.string().trim().min(1).max(MAX_PHRASE_CHARS))
  .min(1)
  .max(MAX_PHRASES);

const createCaseSchema = z
  .object({
    description: z.string().trim().min(1).max(MAX_DESCRIPTION_CHARS),
    mustContain: phrasesSchema,
  })
  .strict();

const updateCaseSchema = z
  .object({
    description: z.string().trim().min(1).max(MAX_DESCRIPTION_CHARS).optional(),
    mustContain: phrasesSchema.optional(),
  })
  .strict()
  .refine((v) => v.description !== undefined || v.mustContain !== undefined, {
    message: 'Nothing to change',
  });

const CASE_ERROR = `description must be 1–${MAX_DESCRIPTION_CHARS} characters; mustContain 1–${MAX_PHRASES} phrases of 1–${MAX_PHRASE_CHARS} characters`;

async function defaultOwnerLabel(r: Routine): Promise<string> {
  if (r.scope === 'org') return 'Admins';
  if (r.scope === 'team') {
    const team = r.teamId
      ? await prisma.team.findUnique({ where: { id: r.teamId }, select: { name: true } })
      : null;
    return `${team?.name ?? 'Team'} leads and admins`;
  }
  const u = await prisma.user.findUnique({ where: { id: r.userId }, select: { name: true } });
  return u?.name ?? 'Its creator';
}

export function registerRoutineKnowledgeRoutes(router: Router, permCtx: PermCtx): void {
  for (const name of ['dryRunId', 'caseId']) {
    router.param(name, (_req, res, next, value: string) => {
      if (!UUID_RE.test(value)) {
        res.status(400).json({ error: 'Invalid ID format' });
        return;
      }
      next();
    });
  }

  /** GET /:id/ownership — default owners, the named owner, and what the caller may do. */
  router.get('/:id/ownership', requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res, permCtx, { owner: false });
      if (!ctx) return;
      const { routine, actor, isOwner } = ctx;
      const owner = routine.ownerId
        ? await prisma.user.findUnique({
            where: { id: routine.ownerId },
            select: { id: true, name: true },
          })
        : null;
      const canChangeOwner = actor.role === 'admin' && routine.scope !== 'personal';
      const body: RoutineOwnership = {
        scope: routine.scope as RoutineOwnership['scope'],
        defaultOwnerLabel: await defaultOwnerLabel(routine),
        owner,
        isOwner,
        canChangeOwner,
      };
      if (canChangeOwner) {
        // Same rule as validateOwner: in the org, not a viewer, and on the
        // team for a team routine.
        const users = await prisma.user.findMany({
          where: {
            role: { not: 'viewer' },
            ...(routine.scope === 'team'
              ? { teamId: routine.teamId ?? '__none__' }
              : { team: { orgId: ctx.orgId } }),
          },
          select: { id: true, name: true, role: true },
          orderBy: { name: 'asc' },
          take: 500,
        });
        body.candidates = users.map((u) => ({ id: u.id, name: u.name, role: u.role }));
      }
      res.json({ data: body });
    } catch (err) {
      next(err);
    }
  });

  /** POST /:id/dry-run — replay the last run's input with the saved or a candidate prompt. */
  router.post('/:id/dry-run', requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res, permCtx, {
        owner: true,
        ownerError: 'Only an owner of this routine can dry run it',
      });
      if (!ctx) return;
      const parsed = dryRunSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: `prompt must be non-empty text of at most ${MAX_DRY_RUN_PROMPT_CHARS} characters`,
        });
        return;
      }
      const result = await startDryRun({
        routine: ctx.routine,
        orgId: ctx.orgId,
        userId: ctx.actor.userId,
        candidatePrompt: parsed.data.prompt ?? null,
      });
      sendStart(res, result);
    } catch (err) {
      next(err);
    }
  });

  /** GET /:id/dry-runs/:dryRunId — poll a dry run. Only the person who started it. */
  router.get('/:id/dry-runs/:dryRunId', requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res, permCtx, { owner: false });
      if (!ctx) return;
      const dryRun = await getDryRun({
        id: req.params.dryRunId as string,
        routineId: ctx.routine.id,
        orgId: ctx.orgId,
        userId: ctx.actor.userId,
      });
      if (!dryRun) return notFound(res, 'Dry run not found');
      res.json({ data: dryRun });
    } catch (err) {
      next(err);
    }
  });

  /** GET /:id/test-cases — anyone who can view the routine. */
  router.get('/:id/test-cases', requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res, permCtx, { owner: false });
      if (!ctx) return;
      res.json({ data: await listTestCases(ctx.routine.id), canEdit: ctx.isOwner });
    } catch (err) {
      next(err);
    }
  });

  /** POST /:id/test-cases — owners add a case by hand. */
  router.post('/:id/test-cases', requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res, permCtx, {
        owner: true,
        ownerError: 'Only an owner of this routine can change its test cases',
      });
      if (!ctx) return;
      const parsed = createCaseSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: CASE_ERROR });
        return;
      }
      const result = await createTestCase({
        orgId: ctx.orgId,
        routineId: ctx.routine.id,
        description: parsed.data.description,
        mustContain: parsed.data.mustContain,
        createdById: ctx.actor.userId,
      });
      if (result.status === 'too_many') {
        res
          .status(409)
          .json({ error: `A routine can have at most ${MAX_CASES_PER_ROUTINE} test cases` });
        return;
      }
      void logAudit({
        orgId: ctx.orgId,
        userId: ctx.actor.userId,
        action: 'routine_test_case_created',
        entityType: 'routine',
        entityId: ctx.routine.id,
        details: { testCaseId: result.testCase.id },
      });
      res.status(201).json({ data: result.testCase });
    } catch (err) {
      next(err);
    }
  });

  /** PATCH /:id/test-cases/:caseId — owners. Changing the phrases clears the last result. */
  router.patch('/:id/test-cases/:caseId', requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res, permCtx, {
        owner: true,
        ownerError: 'Only an owner of this routine can change its test cases',
      });
      if (!ctx) return;
      const parsed = updateCaseSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: CASE_ERROR });
        return;
      }
      const updated = await updateTestCase(
        ctx.routine.id,
        req.params.caseId as string,
        parsed.data,
      );
      if (!updated) return notFound(res, 'Test case not found');
      void logAudit({
        orgId: ctx.orgId,
        userId: ctx.actor.userId,
        action: 'routine_test_case_updated',
        entityType: 'routine',
        entityId: ctx.routine.id,
        details: { testCaseId: updated.id },
      });
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /:id/test-cases/:caseId — owners. */
  router.delete('/:id/test-cases/:caseId', requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res, permCtx, {
        owner: true,
        ownerError: 'Only an owner of this routine can change its test cases',
      });
      if (!ctx) return;
      const ok = await deleteTestCase(ctx.routine.id, req.params.caseId as string);
      if (!ok) return notFound(res, 'Test case not found');
      void logAudit({
        orgId: ctx.orgId,
        userId: ctx.actor.userId,
        action: 'routine_test_case_deleted',
        entityType: 'routine',
        entityId: ctx.routine.id,
        details: { testCaseId: req.params.caseId },
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  /** POST /:id/test-cases/run — dry run (saved or candidate prompt) and check every case. */
  router.post('/:id/test-cases/run', requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res, permCtx, {
        owner: true,
        ownerError: 'Only an owner of this routine can run its tests',
      });
      if (!ctx) return;
      const parsed = dryRunSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: `prompt must be non-empty text of at most ${MAX_DRY_RUN_PROMPT_CHARS} characters`,
        });
        return;
      }
      const result = await startDryRun({
        routine: ctx.routine,
        orgId: ctx.orgId,
        userId: ctx.actor.userId,
        candidatePrompt: parsed.data.prompt ?? null,
        kind: 'tests',
      });
      sendStart(res, result);
    } catch (err) {
      next(err);
    }
  });
}
