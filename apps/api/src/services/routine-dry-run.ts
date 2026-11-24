/**
 * Knowledge loop, Phase 4 — routine dry runs.
 *
 * A dry run replays a routine's LAST run input (its parameter values and
 * trigger event) with the saved prompt or a candidate prompt, and shows the
 * new output next to the last run's output. It is a test, so:
 *
 *   - nothing is delivered and no `routine_runs` row is written;
 *   - the routine row, its version and its state are not touched;
 *   - write / send / create tools are held back: the agent only gets tools
 *     whose name reads as a read (`isReadOnlyTool`), and anything else it
 *     asks for is answered "unknown tool" by the executor;
 *   - no knowledge-gap signals are recorded.
 *
 * The run is asynchronous: `startDryRun` writes a `running` row and returns
 * at once; the agent runs in this process and fills the row in. The caller
 * polls `getDryRun`. Rows are kept for 24 hours and readable only by the
 * person who started them. Expired rows are removed opportunistically when
 * someone in the org starts a new dry run (no background job).
 *
 * It runs as the person who asked (their integrations and access), not as
 * the routine's creator, so a dry run can never see more than its requester.
 */
import { Prisma, type RoutineDryRun as DryRunRow, type Routine } from '@prisma/client';
import type { RoutineDryRun, RoutineParameter, RoutineTestResult } from '@hearth/shared';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { buildAgentContext } from '../agent/context-builder.js';
import { agentLoop } from '../agent/agent-runtime.js';
import type { AgentTool } from '../agent/types.js';
import { buildRoutineRunContext } from './routine-context-service.js';
import { resolveDefaults, resolvePromptTemplate } from './routine-parameter-service.js';
import { checkOutput, recordTestResults } from './routine-test-cases.js';

export const DRY_RUN_TTL_MS = 24 * 60 * 60 * 1000;
export const DRY_RUN_TIMEOUT_MS = 5 * 60 * 1000;
/** Dry runs one person may have running at once (each costs an LLM run). */
export const MAX_ACTIVE_DRY_RUNS_PER_USER = 3;
export const MAX_DRY_RUN_PROMPT_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 100_000;

// ── Read-only tools ───────────────────────────────────────────────────────

const READ_VERBS = new Set([
  'get',
  'list',
  'search',
  'read',
  'recall',
  'fetch',
  'find',
  'lookup',
  'query',
  'view',
]);

/** Any of these in a tool name marks it as a write, whatever else it says. */
const WRITE_VERBS = new Set([
  'send',
  'post',
  'create',
  'publish',
  'write',
  'add',
  'update',
  'edit',
  'comment',
  'delete',
  'remove',
  'schedule',
  'invite',
  'transition',
  'move',
  'merge',
  'close',
  'reply',
  'save',
  'set',
  'put',
  'patch',
  'upload',
  'execute',
  'run',
  'delegate',
  'propose',
  'capture',
  'submit',
  'note',
  'approve',
  'reject',
  'assign',
  'archive',
  'share',
  'state',
  'react',
  'forward',
  'label',
  'trash',
  'draft',
]);

/**
 * Fail-closed: a tool is read-only only when its name has a read verb and no
 * write verb. Unknown tools (code execution, sub-agents, "clarify", …) are
 * held back. Examples: recall_memory, web_search, read_file, slack_list_channels and
 * jira_get_issue pass; slack_post_message, gmail_send_email,
 * jira_create_issue, create_routine, update_routine, save_memory and
 * routine_state do not.
 */
export function isReadOnlyTool(name: string): boolean {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.some((w) => WRITE_VERBS.has(w))) return false;
  return words.some((w) => READ_VERBS.has(w));
}

export function splitReadOnlyTools(tools: AgentTool[]): {
  allowed: AgentTool[];
  blocked: string[];
} {
  const allowed: AgentTool[] = [];
  const blocked: string[] = [];
  for (const t of tools) {
    if (isReadOnlyTool(t.name)) allowed.push(t);
    else blocked.push(t.name);
  }
  return { allowed, blocked };
}

const DRY_RUN_ADDENDUM = `

## Dry run

This is a DRY RUN of a routine, to preview its output. Tools that send, post,
create, save or change anything are switched off. Do not try to call them.
Where the routine would send or post something, write out what you would send
instead, as part of your answer.`;

// ── The run ───────────────────────────────────────────────────────────────

export interface DryRunInput {
  routineId: string;
  userId: string;
  prompt: string;
  triggerEvent: unknown;
  signal: AbortSignal;
}

export interface DryRunOutcome {
  output: string;
  blockedTools: string[];
}

/** Runs the agent once with read-only tools. Exported for tests. */
export async function runAgentDry(input: DryRunInput): Promise<DryRunOutcome> {
  const routineRunContext = await buildRoutineRunContext(input.routineId);
  const context = await buildAgentContext(input.userId, input.routineId, undefined, undefined, {
    routineRunContext,
    triggerEvent: input.triggerEvent as never,
    routineId: input.routineId,
  });
  const { allowed, blocked } = splitReadOnlyTools(context.tools ?? []);
  context.tools = allowed;
  context.dryRun = true;
  context.abortSignal = input.signal;
  context.systemPrompt = `${context.systemPrompt ?? ''}${DRY_RUN_ADDENDUM}`;

  let output = '';
  let error: string | null = null;
  for await (const event of agentLoop(context, [{ role: 'user', content: input.prompt }])) {
    if (event.type === 'text_delta') output += event.content;
    else if (event.type === 'error') error = event.message;
  }
  if (!output && error) throw new Error(error);
  return { output: output.slice(0, MAX_OUTPUT_CHARS), blockedTools: blocked };
}

/** In-flight runs, so tests (and shutdown) can wait for one to settle. */
const inFlight = new Map<string, Promise<void>>();

/** Resolves when the dry run has finished (or at once if it is not running here). */
export function dryRunSettled(id: string): Promise<void> {
  return inFlight.get(id) ?? Promise.resolve();
}

function lastOutputOf(run: { output: Prisma.JsonValue | null }): string | null {
  const o = run.output as Record<string, unknown> | null;
  return o && typeof o.result === 'string' ? o.result : null;
}

export type StartResult =
  | { status: 'ok'; dryRun: RoutineDryRun }
  | { status: 'no_past_run' }
  | { status: 'too_many' }
  | { status: 'no_test_cases' };

/**
 * Starts a dry run. `kind: 'tests'` also checks every test case against the
 * output when it finishes (and, for the saved prompt, stores each result on
 * its case).
 */
export async function startDryRun(input: {
  routine: Routine;
  orgId: string;
  userId: string;
  candidatePrompt?: string | null;
  kind?: 'dry_run' | 'tests';
  now?: Date;
}): Promise<StartResult> {
  const now = input.now ?? new Date();
  const kind = input.kind ?? 'dry_run';
  const routine = input.routine;

  const lastRun = await prisma.routineRun.findFirst({
    where: { routineId: routine.id, status: { not: 'running' } },
    orderBy: { startedAt: 'desc' },
  });
  if (!lastRun) return { status: 'no_past_run' };

  const cases =
    kind === 'tests'
      ? await prisma.routineTestCase.findMany({
          where: { routineId: routine.id },
          orderBy: { createdAt: 'asc' },
          select: { id: true, description: true, mustContain: true },
        })
      : [];
  if (kind === 'tests' && cases.length === 0) return { status: 'no_test_cases' };

  // Clean up this org's expired rows while we are here.
  await prisma.routineDryRun.deleteMany({ where: { orgId: input.orgId, expiresAt: { lte: now } } });

  const active = await prisma.routineDryRun.count({
    where: {
      orgId: input.orgId,
      requestedById: input.userId,
      status: 'running',
      createdAt: { gt: new Date(now.getTime() - DRY_RUN_TIMEOUT_MS - 60_000) },
    },
  });
  if (active >= MAX_ACTIVE_DRY_RUNS_PER_USER) return { status: 'too_many' };

  const candidate = input.candidatePrompt?.trim() ? input.candidatePrompt : null;
  const row = await prisma.routineDryRun.create({
    data: {
      orgId: input.orgId,
      routineId: routine.id,
      requestedById: input.userId,
      kind,
      status: 'running',
      candidatePrompt: candidate,
      routineVersion: routine.version,
      sourceRunId: lastRun.id,
      lastOutput: lastOutputOf(lastRun),
      createdAt: now,
      expiresAt: new Date(now.getTime() + DRY_RUN_TTL_MS),
    },
  });

  // The last run's input: its parameter values (with defaults) and trigger event.
  const parameters = (routine.parameters as unknown as RoutineParameter[]) ?? [];
  let values = (lastRun.parameterValues as Record<string, unknown> | null) ?? {};
  if (parameters.length > 0) values = resolveDefaults(parameters, values);
  let prompt = candidate ?? routine.prompt;
  if (Object.keys(values).length > 0) prompt = resolvePromptTemplate(prompt, values);

  const work = execute(row.id, {
    routineId: routine.id,
    userId: input.userId,
    prompt,
    triggerEvent: lastRun.triggerEvent ?? undefined,
    cases,
    recordOnCases: kind === 'tests' && candidate === null,
  }).finally(() => inFlight.delete(row.id));
  inFlight.set(row.id, work);

  return { status: 'ok', dryRun: await serializeDryRun(row) };
}

async function execute(
  id: string,
  job: {
    routineId: string;
    userId: string;
    prompt: string;
    triggerEvent: unknown;
    cases: Array<{ id: string; description: string; mustContain: unknown }>;
    recordOnCases: boolean;
  },
): Promise<void> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRY_RUN_TIMEOUT_MS);
  try {
    const outcome = await Promise.race([
      runAgentDry({
        routineId: job.routineId,
        userId: job.userId,
        prompt: job.prompt,
        triggerEvent: job.triggerEvent,
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () =>
          reject(new Error('The dry run took longer than 5 minutes and was stopped')),
        ),
      ),
    ]);
    const results: RoutineTestResult[] | null =
      job.cases.length > 0 ? checkOutput(job.cases, outcome.output) : null;
    const completedAt = new Date();
    await prisma.routineDryRun.update({
      where: { id },
      data: {
        status: 'success',
        output: outcome.output,
        blockedTools: outcome.blockedTools as Prisma.InputJsonValue,
        testResults: results ? (results as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        durationMs: Date.now() - started,
        completedAt,
      },
    });
    if (results && job.recordOnCases) await recordTestResults(results, id, completedAt);
  } catch (err) {
    // Log the error kind only: messages can carry routine content.
    logger.warn({ dryRunId: id, errName: (err as Error)?.name }, 'Routine dry run failed');
    await prisma.routineDryRun
      .update({
        where: { id },
        data: {
          status: 'failed',
          error: ((err as Error)?.message ?? 'The dry run failed').slice(0, 500),
          durationMs: Date.now() - started,
          completedAt: new Date(),
        },
      })
      .catch(() => {});
  } finally {
    clearTimeout(timer);
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────

/**
 * One dry run, for the person who started it, while it has not expired.
 * A row still "running" long after the timeout (the process restarted) is
 * shown as failed.
 */
export async function getDryRun(input: {
  id: string;
  routineId: string;
  orgId: string;
  userId: string;
  now?: Date;
}): Promise<RoutineDryRun | null> {
  const now = input.now ?? new Date();
  const row = await prisma.routineDryRun.findFirst({
    where: {
      id: input.id,
      routineId: input.routineId,
      orgId: input.orgId,
      requestedById: input.userId,
      expiresAt: { gt: now },
    },
  });
  if (!row) return null;
  return serializeDryRun(row, now);
}

export async function serializeDryRun(row: DryRunRow, now = new Date()): Promise<RoutineDryRun> {
  const stale =
    row.status === 'running' &&
    now.getTime() - row.createdAt.getTime() > DRY_RUN_TIMEOUT_MS + 60_000;
  const source = row.sourceRunId
    ? await prisma.routineRun.findUnique({
        where: { id: row.sourceRunId },
        select: { id: true, status: true, startedAt: true, error: true },
      })
    : null;
  return {
    id: row.id,
    routineId: row.routineId,
    kind: row.kind === 'tests' ? 'tests' : 'dry_run',
    status: stale ? 'failed' : (row.status as RoutineDryRun['status']),
    candidatePrompt: row.candidatePrompt,
    routineVersion: row.routineVersion,
    sourceRun: source
      ? {
          id: source.id,
          status: source.status,
          startedAt: source.startedAt.toISOString(),
          error: source.error,
        }
      : null,
    lastOutput: row.lastOutput,
    output: row.output,
    error: stale ? 'The dry run stopped before it finished. Try again.' : row.error,
    testResults: Array.isArray(row.testResults)
      ? (row.testResults as unknown as RoutineTestResult[])
      : null,
    blockedTools: Array.isArray(row.blockedTools) ? (row.blockedTools as string[]) : [],
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
  };
}
