/**
 * Knowledge loop, Phase 1 — silent gap signals.
 *
 * A signal is a background record that the AI may not know something it
 * should: a knowledge search that found nothing, a person correcting it, a
 * thumbs-down, a regenerate, an owner editing a routine's output before
 * approval, a failed routine run. Members never see signals. The Phase 2
 * curator groups them into proposals for owners.
 *
 * Rules every writer here follows:
 *   - Never break the work that produced the signal: every write is
 *     best-effort and swallows its own errors (logged without content).
 *   - Store as little as possible: `text` is redacted (secrets, then PII) and
 *     cut to 500 characters. Tool OUTPUT is never stored.
 *   - Kept 90 days (cleanupOldSignals, run daily by the worker).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { withRlsBypass } from '../lib/tenant-context.js';
import { scrubText, createTokenMap } from '../compliance/scrubber.js';
import { resolveDetectors } from '../compliance/packs/index.js';

export type SignalKind =
  | 'empty_search'
  | 'correction'
  | 'thumbs_down'
  | 'regenerate'
  | 'edited_output'
  | 'run_failed';

export type SignalSource = 'chat' | 'routine' | 'task' | 'other';

export const SIGNAL_RETENTION_DAYS = 90;
export const SIGNAL_TEXT_MAX = 500;

// ── Redaction ─────────────────────────────────────────────────────────────

/**
 * Credential shapes the PII pack does not cover. Order matters: the specific
 * vendor prefixes run before the generic long-token rule.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[SECRET]'],
  [/\b(?:sk|pk|rk)-(?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/g, '[SECRET]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[SECRET]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '[SECRET]'],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[SECRET]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[SECRET]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[SECRET]'], // JWT
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [SECRET]'],
  [
    /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b(\s*[:=]\s*|\s+is\s+)("[^"]*"|'[^']*'|\S+)/gi,
    '$1$2[SECRET]',
  ],
  [/:\/\/([^:/\s@]+):([^@\s]+)@/g, '://$1:[SECRET]@'], // credentials in URLs
  [/\b[A-Za-z0-9_\-+/]{40,}={0,2}(?![A-Za-z0-9])/g, '[SECRET]'], // long opaque tokens
];

let piiDetectors: ReturnType<typeof resolveDetectors> | null = null;

/** Secrets first, then the PII pack (emails, phones, IDs, cards…), then cut. */
export function redactSignalText(
  raw: string | null | undefined,
  max = SIGNAL_TEXT_MAX,
): string | null {
  if (raw == null) return null;
  let text = String(raw);
  for (const [re, replacement] of SECRET_PATTERNS) text = text.replace(re, replacement);
  try {
    piiDetectors ??= resolveDetectors(['pii']);
    text = scrubText(text, piiDetectors, createTokenMap()).scrubbedText;
  } catch {
    // The PII pack is best-effort; secrets are already gone.
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text.length > 0 ? text : null;
}

// ── Recording ─────────────────────────────────────────────────────────────

export interface SignalInput {
  orgId: string;
  kind: SignalKind;
  source: SignalSource;
  userId?: string | null;
  teamId?: string | null;
  sessionId?: string | null;
  messageId?: string | null;
  routineId?: string | null;
  routineRunId?: string | null;
  taskId?: string | null;
  /** Raw text; redacted here before it is stored. */
  text?: string | null;
  /** Small extras; string values are redacted here. */
  detail?: Record<string, unknown>;
}

function redactDetail(v: unknown): unknown {
  if (typeof v === 'string') return redactSignalText(v, 300);
  if (Array.isArray(v)) return v.slice(0, 20).map(redactDetail);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDetail(x)]));
  }
  return v;
}

/**
 * Writes one signal. Never throws — a failed signal must not fail the chat,
 * run or request that produced it. Returns the new id, or null.
 */
export async function recordSignal(input: SignalInput): Promise<string | null> {
  try {
    if (!input.orgId) return null;
    const row = await prisma.knowledgeSignal.create({
      data: {
        orgId: input.orgId,
        kind: input.kind,
        source: input.source,
        userId: input.userId ?? null,
        teamId: input.teamId ?? null,
        sessionId: input.sessionId ?? null,
        messageId: input.messageId ?? null,
        routineId: input.routineId ?? null,
        routineRunId: input.routineRunId ?? null,
        taskId: input.taskId ?? null,
        text: redactSignalText(input.text),
        detail: input.detail ? (redactDetail(input.detail) as Prisma.InputJsonValue) : undefined,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    // Log the shape only — never the text, which may hold user content.
    logger.warn(
      { errName: (err as Error)?.name, kind: input.kind, source: input.source },
      'Failed to record knowledge signal',
    );
    return null;
  }
}

/**
 * Thumbs-down is a toggle: the latest rating wins. A negative rating writes
 * one signal per message (re-rating negative is a no-op); switching to
 * positive removes the signal the curator has not used yet.
 */
export async function setThumbsDownSignal(
  input: Omit<SignalInput, 'kind'> & { messageId: string },
  negative: boolean,
): Promise<void> {
  try {
    const existing = await prisma.knowledgeSignal.findFirst({
      where: { messageId: input.messageId, kind: 'thumbs_down', orgId: input.orgId },
      select: { id: true, processedAt: true },
    });
    if (negative) {
      if (!existing) await recordSignal({ ...input, kind: 'thumbs_down' });
      return;
    }
    if (existing && !existing.processedAt) {
      await prisma.knowledgeSignal.delete({ where: { id: existing.id } });
    }
  } catch (err) {
    logger.warn({ errName: (err as Error)?.name }, 'Failed to update thumbs-down signal');
  }
}

/** Removes signals past the retention window. Returns the number removed. */
export async function cleanupOldSignals(
  now = new Date(),
  days = SIGNAL_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  // Cross-org retention sweep from the worker (no tenant context). RLS is
  // FORCED on this table, so without the bypass a non-superuser DB role
  // (RDS) would see — and delete — nothing.
  const res = await withRlsBypass((tx) =>
    tx.knowledgeSignal.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  );
  return res.count;
}

// ── Empty-search tracking inside an agent run ─────────────────────────────

/**
 * The knowledge-search tools whose empty result means "Hearth does not know
 * this". Web search, integrations and task/routine listings are not
 * knowledge, so an empty result there is not a gap.
 */
export const KNOWLEDGE_SEARCH_TOOLS = new Set([
  'recall_memory',
  'session_search',
  'recall_decisions',
]);

/** True when a knowledge-search tool returned nothing. Errors are not "empty". */
export function isEmptySearchResult(
  toolName: string,
  output: unknown,
  error?: string,
): boolean | null {
  if (!KNOWLEDGE_SEARCH_TOOLS.has(toolName)) return null;
  if (error) return null;
  const o = (output ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case 'recall_memory':
    case 'session_search':
      return !Array.isArray(o.results) || o.results.length === 0;
    case 'recall_decisions':
      return !Array.isArray(o.decisions) || o.decisions.length === 0;
    default:
      return null;
  }
}

export interface SearchObservation {
  tool: string;
  found: boolean;
  query: string | null;
}

export interface SignalRunContext {
  orgId: string;
  userId: string;
  teamId: string | null;
  sessionId?: string | null;
  source: SignalSource;
  routineId?: string | null;
  routineRunId?: string | null;
  taskId?: string | null;
}

/**
 * Watches one agent run. At the end it writes AT MOST ONE empty-search
 * signal: several empty searches in a run merge into one, and a run whose
 * LAST knowledge search found something writes none (found on retry). For a
 * routine run it also stores `{tool, found}` per search on the run.
 */
export class SearchSignalTracker {
  private readonly observations: SearchObservation[] = [];
  private flushed = false;

  constructor(private readonly ctx: SignalRunContext) {}

  observe(toolName: string, input: unknown, output: unknown, error?: string): void {
    const empty = isEmptySearchResult(toolName, output, error);
    if (empty === null) return;
    const q = (input as Record<string, unknown> | null)?.query;
    this.observations.push({
      tool: toolName,
      found: !empty,
      query: typeof q === 'string' ? q : null,
    });
  }

  get log(): ReadonlyArray<SearchObservation> {
    return this.observations;
  }

  /** The signal this run should write, or null. Pure — used by flush and tests. */
  pendingSignal(): SignalInput | null {
    const last = this.observations.at(-1);
    if (!last || last.found) return null;
    const empties = this.observations.filter((o) => !o.found);
    const queries = Array.from(
      new Set(empties.map((o) => o.query).filter((q): q is string => !!q)),
    );
    return {
      orgId: this.ctx.orgId,
      kind: 'empty_search',
      source: this.ctx.source,
      userId: this.ctx.userId,
      teamId: this.ctx.teamId,
      sessionId: this.ctx.sessionId ?? null,
      routineId: this.ctx.routineId ?? null,
      routineRunId: this.ctx.routineRunId ?? null,
      taskId: this.ctx.taskId ?? null,
      text: queries[0] ?? null,
      detail: {
        queries: queries.slice(0, 10),
        tools: Array.from(new Set(empties.map((o) => o.tool))),
        emptyCount: empties.length,
      },
    };
  }

  /** Writes the run's signal and routine search log. Idempotent; never throws. */
  async flush(): Promise<void> {
    if (this.flushed) return;
    this.flushed = true;
    const signal = this.pendingSignal();
    if (signal) await recordSignal(signal);
    if (this.ctx.routineRunId && this.observations.length > 0) {
      try {
        await prisma.routineRun.update({
          where: { id: this.ctx.routineRunId },
          data: {
            searchLog: this.observations.map((o) => ({
              tool: o.tool,
              found: o.found,
            })) as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        logger.warn({ errName: (err as Error)?.name }, 'Failed to store routine search log');
      }
    }
  }
}
