/**
 * Knowledge loop, Phase 4 — routine test cases.
 *
 * A test case is a short list of phrases (`mustContain`) a routine must keep.
 * It is used twice:
 *
 *   1. As a GUARD on the prompt. A change to the prompt (an edit, a rollback,
 *      or approving a later curator fix) that drops a phrase the current
 *      prompt has is blocked with 409, unless an owner overrides it.
 *   2. As a CHECK on output. "Run tests" dry-runs the routine and passes a
 *      case when the output contains every phrase.
 *
 * Cases come from two places: approving a curator fix to a routine makes one
 * from the words the fix added (`derivePhrases`), and owners add their own.
 *
 * Matching is plain and explainable: case-insensitive, curly quotes made
 * straight, runs of white space made one space. No model is involved.
 */
import { Prisma, type RoutineTestCase as TestCaseRow } from '@prisma/client';
import type { RoutineTestCase, RoutineTestFailure, RoutineTestResult } from '@hearth/shared';
import { prisma } from '../lib/prisma.js';
import { isFeatureEnabled } from '../lib/feature-flags.js';
import type { TenantTx } from '../lib/tenant-context.js';

export const MAX_PHRASES = 10;
export const MAX_PHRASE_CHARS = 200;
export const MAX_DESCRIPTION_CHARS = 500;
export const MAX_CASES_PER_ROUTINE = 50;
/** Phrases taken from one approved fix. */
export const MAX_DERIVED_PHRASES = 5;
/** A derived phrase is cut to this length (at a word boundary). */
export const MAX_DERIVED_PHRASE_CHARS = 60;

// ── Matching ──────────────────────────────────────────────────────────────

/** The form both sides are compared in. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsPhrase(text: string, phrase: string): boolean {
  const p = normalizeForMatch(phrase);
  return p.length > 0 && normalizeForMatch(text).includes(p);
}

// ── Deriving phrases from a fix ───────────────────────────────────────────

/** Filler words trimmed from the ends of a derived phrase. */
const FILLER = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'to',
  'of',
  'in',
  'on',
  'for',
  'from',
  'with',
  'by',
  'at',
  'as',
  'is',
  'are',
  'be',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'into',
  'via',
  'if',
  'when',
  'then',
  'also',
  'please',
  'use',
  'using',
  'always',
  'only',
  'just',
  'so',
  'than',
  'not',
  'no',
  'all',
  'any',
  'each',
  'every',
  'new',
  'now',
]);

/** A token's comparison key: lower case, edge punctuation removed (a leading # or @ stays). */
function tokenKey(token: string): string {
  return token
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}#@]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '');
}

/** Indexes of `after` tokens that are not part of a longest common subsequence with `before`. */
function addedTokenIndexes(before: string[], after: string[]): boolean[] {
  const b = before.map(tokenKey);
  const a = after.map(tokenKey);
  const added = a.map(() => false);
  // Long prompts: fall back to "words the old prompt never used" (still deterministic).
  if (a.length * b.length > 4_000_000) {
    const seen = new Set(b);
    a.forEach((k, i) => {
      added[i] = k.length > 0 && !seen.has(k);
    });
    return added;
  }
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (j < m && lcs[i][j + 1] >= lcs[i + 1][j]) {
      j++;
    } else {
      // Pure punctuation never makes a phrase on its own.
      added[i] = a[i].length > 0;
      i++;
    }
  }
  return added;
}

function trimFiller(words: string[]): string[] {
  let s = 0;
  let e = words.length;
  while (s < e && FILLER.has(tokenKey(words[s]))) s++;
  while (e > s && FILLER.has(tokenKey(words[e - 1]))) e--;
  return words.slice(s, e);
}

function cutAtWord(phrase: string, max: number): string {
  if (phrase.length <= max) return phrase;
  const cut = phrase.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : phrase.slice(0, max)).trim();
}

/**
 * The phrases a fix added, in order:
 *   1. split both texts into words and find the words `after` added (a
 *      word-level diff; case and edge punctuation are ignored);
 *   2. join each run of added words, and split it at punctuation;
 *   3. trim filler words ("the", "use", "from", …) from both ends;
 *   4. keep pieces with at least 3 characters and a letter or digit, cut to
 *      60 characters at a word boundary, drop repeats, keep the first 5.
 *
 * Every phrase is a piece of `after`, so the fixed prompt always passes its
 * own guard. A fix that only removed text yields no phrases.
 */
export function derivePhrases(before: string, after: string): string[] {
  const b = before.match(/\S+/g) ?? [];
  const a = after.match(/\S+/g) ?? [];
  const added = addedTokenIndexes(b, a);

  const runs: string[][] = [];
  let run: string[] = [];
  a.forEach((tok, i) => {
    if (added[i]) run.push(tok);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of runs) {
    // Split at punctuation; a "." or ":" only when it ends a word (keeps
    // file names, times and URLs whole).
    const segments = r.join(' ').split(/[,;!?()[\]{}"“”]+|[.:](?=\s|$)/);
    for (const seg of segments) {
      const words = trimFiller(seg.trim().split(/\s+/).filter(Boolean));
      // Strip quotes/punctuation left on the outer edges.
      let phrase = words
        .join(' ')
        .replace(/^[^\p{L}\p{N}#@]+/u, '')
        .replace(/[^\p{L}\p{N})\]]+$/u, '');
      phrase = cutAtWord(phrase, MAX_DERIVED_PHRASE_CHARS);
      if (phrase.length < 3 || !/[\p{L}\p{N}]/u.test(phrase)) continue;
      const key = normalizeForMatch(phrase);
      if (seen.has(key)) continue;
      // The cut must still be a piece of the fixed prompt.
      if (!containsPhrase(after, phrase)) continue;
      seen.add(key);
      out.push(phrase);
      if (out.length >= MAX_DERIVED_PHRASES) return out;
    }
  }
  return out;
}

// ── The guard ─────────────────────────────────────────────────────────────

export interface GuardCase {
  id: string;
  description: string;
  mustContain: unknown;
}

export function phrasesOf(c: { mustContain: unknown }): string[] {
  return Array.isArray(c.mustContain)
    ? c.mustContain.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : [];
}

/**
 * Pure: the cases a prompt change breaks. A phrase counts only when the
 * current prompt has it and the next one does not — so a phrase meant for the
 * output (not in the prompt at all) never blocks an edit.
 */
export function findRemovedPhrases(
  cases: GuardCase[],
  currentPrompt: string,
  nextPrompt: string,
): RoutineTestFailure[] {
  const failures: RoutineTestFailure[] = [];
  for (const c of cases) {
    const missing = phrasesOf(c).filter(
      (p) => containsPhrase(currentPrompt, p) && !containsPhrase(nextPrompt, p),
    );
    if (missing.length > 0) {
      failures.push({
        testCaseId: c.id,
        description: c.description,
        missing,
        reason:
          missing.length === 1
            ? `The new prompt no longer says "${missing[0]}".`
            : `The new prompt no longer says ${missing.map((p) => `"${p}"`).join(', ')}.`,
      });
    }
  }
  return failures;
}

/** Pure: check one output against each case. */
export function checkOutput(cases: GuardCase[], output: string): RoutineTestResult[] {
  return cases.map((c) => {
    const missing = phrasesOf(c).filter((p) => !containsPhrase(output, p));
    return { testCaseId: c.id, description: c.description, passed: missing.length === 0, missing };
  });
}

type Db = TenantTx | typeof prisma;

async function knowledgeLoopOn(db: Db, orgId: string | null): Promise<boolean> {
  if (!orgId) return false;
  const org = await db.org.findUnique({ where: { id: orgId }, select: { settings: true } });
  return isFeatureEnabled(org?.settings, 'knowledgeLoop');
}

/**
 * The test cases a change of `routine.prompt` to `nextPrompt` would break.
 * Empty when nothing breaks, the routine has no cases, or the org's
 * `knowledgeLoop` flag is off.
 */
export async function promptChangeFailures(
  routine: { id: string; orgId: string | null; prompt: string },
  nextPrompt: string,
  db: Db = prisma,
  orgIdFallback: string | null = null,
): Promise<RoutineTestFailure[]> {
  if (nextPrompt === routine.prompt) return [];
  const cases = await db.routineTestCase.findMany({
    where: { routineId: routine.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, description: true, mustContain: true },
  });
  if (cases.length === 0) return [];
  if (!(await knowledgeLoopOn(db, routine.orgId ?? orgIdFallback))) return [];
  return findRemovedPhrases(cases, routine.prompt, nextPrompt);
}

/** Thrown inside a transaction to abort a change the tests block. */
export class TestGuardError extends Error {
  constructor(public readonly failures: RoutineTestFailure[]) {
    super('The change removes text that a test case needs');
    this.name = 'TestGuardError';
  }
}

/** The JSON body every blocked change answers with (409). */
export function testGuardBody(failures: RoutineTestFailure[]) {
  return {
    error:
      'This change removes text that a test case needs. Keep the text, change the test case, or save anyway.',
    code: 'tests_failed',
    failures,
  };
}

// ── Reads and writes ──────────────────────────────────────────────────────

export function serializeTestCase(row: TestCaseRow): RoutineTestCase {
  return {
    id: row.id,
    routineId: row.routineId,
    proposalId: row.proposalId,
    description: row.description,
    mustContain: phrasesOf(row),
    source: row.source === 'proposal' ? 'proposal' : 'manual',
    createdById: row.createdById,
    lastStatus: row.lastStatus === 'passed' || row.lastStatus === 'failed' ? row.lastStatus : null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastMissing: Array.isArray(row.lastMissing) ? (row.lastMissing as string[]) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listTestCases(routineId: string): Promise<RoutineTestCase[]> {
  const rows = await prisma.routineTestCase.findMany({
    where: { routineId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(serializeTestCase);
}

/** Trim, drop empties and repeats (by match form). */
export function cleanPhrases(phrases: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of phrases) {
    const t = p.trim().replace(/\s+/g, ' ');
    const key = normalizeForMatch(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export type CreateResult = { status: 'ok'; testCase: RoutineTestCase } | { status: 'too_many' };

export async function createTestCase(input: {
  orgId: string;
  routineId: string;
  description: string;
  mustContain: string[];
  createdById: string;
}): Promise<CreateResult> {
  const count = await prisma.routineTestCase.count({ where: { routineId: input.routineId } });
  if (count >= MAX_CASES_PER_ROUTINE) return { status: 'too_many' };
  const row = await prisma.routineTestCase.create({
    data: {
      orgId: input.orgId,
      routineId: input.routineId,
      description: input.description.trim(),
      mustContain: cleanPhrases(input.mustContain) as Prisma.InputJsonValue,
      source: 'manual',
      createdById: input.createdById,
    },
  });
  return { status: 'ok', testCase: serializeTestCase(row) };
}

/** Returns null when the case is not on this routine. */
export async function updateTestCase(
  routineId: string,
  id: string,
  data: { description?: string; mustContain?: string[] },
): Promise<RoutineTestCase | null> {
  const existing = await prisma.routineTestCase.findFirst({ where: { id, routineId } });
  if (!existing) return null;
  const phrasesChanged = data.mustContain !== undefined;
  const row = await prisma.routineTestCase.update({
    where: { id },
    data: {
      ...(data.description !== undefined && { description: data.description.trim() }),
      ...(phrasesChanged && {
        mustContain: cleanPhrases(data.mustContain!) as Prisma.InputJsonValue,
        // The old result was for other phrases.
        lastStatus: null,
        lastCheckedAt: null,
        lastMissing: Prisma.DbNull,
        lastDryRunId: null,
      }),
    },
  });
  return serializeTestCase(row);
}

export async function deleteTestCase(routineId: string, id: string): Promise<boolean> {
  const res = await prisma.routineTestCase.deleteMany({ where: { id, routineId } });
  return res.count > 0;
}

/**
 * Called inside the approval transaction of a curator fix to a routine:
 * records a test case made of the phrases the fix added. Returns its id, or
 * null when the fix added nothing to hold on to (it only removed text).
 */
export async function createTestCaseFromFix(
  tx: TenantTx,
  input: {
    orgId: string;
    routineId: string;
    proposalId: string;
    before: string;
    after: string;
    approvedById: string;
  },
): Promise<string | null> {
  const phrases = derivePhrases(input.before, input.after);
  if (phrases.length === 0) return null;
  // Built from the prompt only: anyone who can view the routine sees test
  // cases, and the curator's reason is for owners (it can echo evidence).
  const description = `Keeps an approved fix: the prompt says ${phrases
    .map((p) => `"${p}"`)
    .join(', ')}`.slice(0, MAX_DESCRIPTION_CHARS);
  const row = await tx.routineTestCase.create({
    data: {
      orgId: input.orgId,
      routineId: input.routineId,
      proposalId: input.proposalId,
      description,
      mustContain: phrases as Prisma.InputJsonValue,
      source: 'proposal',
      createdById: input.approvedById,
    },
  });
  return row.id;
}

/** Store a "Run tests" result on each case (only for runs of the saved prompt). */
export async function recordTestResults(
  results: RoutineTestResult[],
  dryRunId: string,
  at: Date,
): Promise<void> {
  for (const r of results) {
    await prisma.routineTestCase.updateMany({
      where: { id: r.testCaseId },
      data: {
        lastStatus: r.passed ? 'passed' : 'failed',
        lastCheckedAt: at,
        lastMissing: r.missing as Prisma.InputJsonValue,
        lastDryRunId: dryRunId,
      },
    });
  }
}
