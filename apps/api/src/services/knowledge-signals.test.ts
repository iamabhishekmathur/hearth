import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    knowledgeSignal: {
      create: vi.fn(async () => ({ id: 'sig-1' })),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    routineRun: { update: vi.fn(async () => ({})) },
  },
}));

import { prisma } from '../lib/prisma.js';
import {
  redactSignalText,
  isEmptySearchResult,
  SearchSignalTracker,
  recordSignal,
  SIGNAL_TEXT_MAX,
} from './knowledge-signals.js';
import { looksLikeCorrection } from './experience-service.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe('redactSignalText — secrets', () => {
  it.each([
    ['OpenAI key', 'my key is sk-proj-abcdefghijklmnopqrstuvwxyz123456', 'sk-proj-abc'],
    ['Anthropic key', 'use sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv', 'sk-ant-api03'],
    ['GitHub token', 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abc'],
    ['Slack token', 'xoxb-1234567890-abcdefghijkl', 'xoxb-123'],
    ['AWS key id', 'AKIAIOSFODNN7EXAMPLE is the key', 'AKIAIOSFODNN7EXAMPLE'],
    ['Google key', 'AIzaSyA1234567890abcdefghijklmnopqrstu', 'AIzaSyA123'],
    [
      'JWT',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'eyJhbGci',
    ],
    ['Bearer header', 'Authorization: Bearer abc123def456ghi789', 'abc123def456'],
    ['password=', 'login with password=hunter2!', 'hunter2'],
    ['api_key:', 'api_key: 9f8e7d6c5b4a', '9f8e7d6c5b4a'],
    ['URL credentials', 'postgres://admin:s3cret@db.internal:5432/app', 's3cret'],
    ['long opaque token', 'ref Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4', 'Zm9vYmFy'],
  ])('removes a %s', (_label, input, secret) => {
    const out = redactSignalText(input)!;
    expect(out).not.toContain(secret);
    expect(out).toContain('[SECRET]');
  });

  it('removes a private key block', () => {
    const out = redactSignalText(
      'key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
    )!;
    expect(out).not.toContain('MIIabc');
  });

  it('keeps ordinary text intact', () => {
    expect(redactSignalText('Which channel do we post the weekly customer update in?')).toBe(
      'Which channel do we post the weekly customer update in?',
    );
  });
});

describe('redactSignalText — PII, length, shape', () => {
  it('removes an email address', () => {
    const out = redactSignalText('send it to jane.doe@acme.com please')!;
    expect(out).not.toContain('jane.doe@acme.com');
  });

  it(`cuts to ${SIGNAL_TEXT_MAX} characters`, () => {
    const out = redactSignalText('word '.repeat(400))!;
    expect(out.length).toBeLessThanOrEqual(SIGNAL_TEXT_MAX);
    expect(out.endsWith('…')).toBe(true);
  });

  it('collapses whitespace and returns null for empty input', () => {
    expect(redactSignalText('  a \n\n b  ')).toBe('a b');
    expect(redactSignalText('   ')).toBeNull();
    expect(redactSignalText(null)).toBeNull();
    expect(redactSignalText(undefined)).toBeNull();
  });
});

describe('isEmptySearchResult', () => {
  it('detects empty knowledge searches', () => {
    expect(isEmptySearchResult('recall_memory', { results: [] })).toBe(true);
    expect(isEmptySearchResult('session_search', { results: [], total: 0 })).toBe(true);
    expect(isEmptySearchResult('recall_decisions', { decisions: [], total: 0 })).toBe(true);
  });

  it('detects non-empty knowledge searches', () => {
    expect(isEmptySearchResult('recall_memory', { results: [{ content: 'x' }] })).toBe(false);
    expect(isEmptySearchResult('recall_decisions', { decisions: [{ id: 'd' }] })).toBe(false);
  });

  it('ignores tools that are not knowledge searches', () => {
    expect(isEmptySearchResult('web_search', { results: [] })).toBeNull();
    expect(isEmptySearchResult('list_tasks', { tasks: [] })).toBeNull();
  });

  it('does not count a failed search as empty', () => {
    expect(isEmptySearchResult('recall_memory', {}, 'db down')).toBeNull();
  });

  it('treats a malformed output as empty', () => {
    expect(isEmptySearchResult('recall_memory', null)).toBe(true);
  });
});

const ctx = {
  orgId: 'org-1',
  userId: 'u-1',
  teamId: 't-1',
  sessionId: 's-1',
  source: 'chat' as const,
};

describe('SearchSignalTracker', () => {
  it('B1: one empty search → one signal with the query', () => {
    const t = new SearchSignalTracker(ctx);
    t.observe('recall_memory', { query: 'customer update channel' }, { results: [] });
    expect(t.pendingSignal()).toMatchObject({
      kind: 'empty_search',
      source: 'chat',
      orgId: 'org-1',
      userId: 'u-1',
      sessionId: 's-1',
      text: 'customer update channel',
      detail: { queries: ['customer update channel'], tools: ['recall_memory'], emptyCount: 1 },
    });
  });

  it('B5: three empty searches in one run merge into ONE signal', () => {
    const t = new SearchSignalTracker(ctx);
    t.observe('recall_memory', { query: 'a' }, { results: [] });
    t.observe('session_search', { query: 'b' }, { results: [] });
    t.observe('recall_memory', { query: 'a' }, { results: [] });
    const s = t.pendingSignal()!;
    expect(s.detail).toEqual({
      queries: ['a', 'b'],
      tools: ['recall_memory', 'session_search'],
      emptyCount: 3,
    });
  });

  it('B6: an empty search followed by a successful one → no signal (found on retry)', () => {
    const t = new SearchSignalTracker(ctx);
    t.observe('recall_memory', { query: 'a' }, { results: [] });
    t.observe('recall_memory', { query: 'a2' }, { results: [{ content: 'hit' }] });
    expect(t.pendingSignal()).toBeNull();
  });

  it('a success followed by an empty search → a signal', () => {
    const t = new SearchSignalTracker(ctx);
    t.observe('recall_memory', { query: 'a' }, { results: [{ content: 'hit' }] });
    t.observe('recall_decisions', { query: 'who owns billing' }, { decisions: [] });
    expect(t.pendingSignal()?.text).toBe('who owns billing');
  });

  it('no knowledge searches → no signal; other tools are ignored', () => {
    const t = new SearchSignalTracker(ctx);
    t.observe('web_search', { query: 'x' }, { results: [] });
    expect(t.pendingSignal()).toBeNull();
    expect(t.log).toHaveLength(0);
  });

  it('flush writes once, stores the routine search log without queries, and is idempotent', async () => {
    asMock(prisma.knowledgeSignal.create).mockClear();
    asMock(prisma.routineRun.update).mockClear();
    const t = new SearchSignalTracker({
      ...ctx,
      source: 'routine',
      routineId: 'r-1',
      routineRunId: 'run-1',
    });
    t.observe('recall_memory', { query: 'secret plan' }, { results: [] });
    await t.flush();
    await t.flush();
    expect(prisma.knowledgeSignal.create).toHaveBeenCalledTimes(1);
    expect(prisma.routineRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { searchLog: [{ tool: 'recall_memory', found: false }] },
    });
  });
});

describe('recordSignal', () => {
  it('redacts text and string details before writing', async () => {
    asMock(prisma.knowledgeSignal.create).mockClear();
    await recordSignal({
      orgId: 'org-1',
      kind: 'regenerate',
      source: 'chat',
      text: 'try again with password=hunter2',
      detail: { before: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
    });
    const data = asMock(prisma.knowledgeSignal.create).mock.calls[0][0].data;
    expect(data.text).not.toContain('hunter2');
    expect(JSON.stringify(data.detail)).not.toContain('ghp_abc');
  });

  it('B9: never throws when the write fails', async () => {
    asMock(prisma.knowledgeSignal.create).mockRejectedValueOnce(new Error('db down'));
    await expect(
      recordSignal({ orgId: 'org-1', kind: 'run_failed', source: 'routine' }),
    ).resolves.toBeNull();
  });

  it('writes nothing without an org', async () => {
    asMock(prisma.knowledgeSignal.create).mockClear();
    expect(await recordSignal({ orgId: '', kind: 'run_failed', source: 'routine' })).toBeNull();
    expect(prisma.knowledgeSignal.create).not.toHaveBeenCalled();
  });
});

describe('looksLikeCorrection', () => {
  it.each([
    'No, it moved to #customer-updates',
    'nope, wrong channel',
    "That's outdated — we use Linear now",
    'Actually, the owner is Priya now',
    'It has moved to the new board',
    'Post it in #customer-updates instead',
    'We no longer use that process',
    'not Jira, use Linear',
  ])('flags %j', (text) => {
    expect(looksLikeCorrection(text)).toBe(true);
  });

  it.each([
    'Thanks, that looks great',
    'Can you also add a summary?',
    'Now draft the email to the customer',
    'Notion is where we keep specs',
  ])('does not flag %j', (text) => {
    expect(looksLikeCorrection(text)).toBe(false);
  });
});
