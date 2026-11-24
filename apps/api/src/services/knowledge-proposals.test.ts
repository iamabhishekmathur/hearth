import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));

import type { KnowledgeProposal } from '@prisma/client';
import { buildEvidence, canReview, evidenceLabel } from './knowledge-proposals.js';

const t0 = new Date('2026-11-20T10:00:00Z');
const sig = (over: Record<string, unknown> = {}) => ({
  kind: 'correction',
  source: 'chat',
  createdAt: t0,
  text: 'It is #customer-updates now',
  userId: 'u-member',
  sessionId: 's-private',
  routineId: null,
  routineRunId: null,
  ...over,
});
const noAccess = { sessions: new Set<string>(), routines: new Set<string>() };

describe('buildEvidence — privacy', () => {
  it('a private session the viewer cannot open: label only, no quote, no link', () => {
    const e = buildEvidence([sig()], 'u-admin', noAccess);
    expect(e.items[0]).toMatchObject({
      label: 'A member corrected an answer.',
      quote: null,
      link: null,
    });
  });

  it('a session the viewer can open: quote and link', () => {
    const e = buildEvidence([sig()], 'u-admin', {
      sessions: new Set(['s-private']),
      routines: new Set(),
    });
    expect(e.items[0].quote).toBe('It is #customer-updates now');
    expect(e.items[0].link).toEqual({ type: 'session', sessionId: 's-private' });
  });

  it('the viewer’s own signal shows its quote even without a link', () => {
    const e = buildEvidence([sig({ userId: 'u-admin', sessionId: null })], 'u-admin', noAccess);
    expect(e.items[0].quote).toBe('It is #customer-updates now');
    expect(e.items[0].link).toBeNull();
  });

  it('a routine the viewer can view: link to the run', () => {
    const e = buildEvidence(
      [
        sig({
          kind: 'run_failed',
          source: 'routine',
          sessionId: null,
          routineId: 'r1',
          routineRunId: 'run1',
        }),
      ],
      'u-admin',
      { sessions: new Set(), routines: new Set(['r1']) },
    );
    expect(e.items[0].link).toEqual({ type: 'routine_run', routineId: 'r1', runId: 'run1' });
    expect(e.items[0].quote).not.toBeNull();
  });

  it('a routine the viewer cannot view: no link, no quote', () => {
    const e = buildEvidence(
      [sig({ kind: 'run_failed', source: 'routine', sessionId: null, routineId: 'r1' })],
      'u-admin',
      noAccess,
    );
    expect(e.items[0]).toMatchObject({ link: null, quote: null });
  });

  it('a signal with no user and no source is never quoted', () => {
    const e = buildEvidence([sig({ userId: null, sessionId: null })], 'u-admin', noAccess);
    expect(e.items[0].quote).toBeNull();
  });
});

describe('buildEvidence — counts', () => {
  it('counts by kind and distinct people', () => {
    const e = buildEvidence(
      [
        sig({ kind: 'empty_search', userId: 'a' }),
        sig({ kind: 'empty_search', userId: 'b' }),
        sig({ kind: 'empty_search', userId: 'a' }),
        sig({ kind: 'correction', userId: 'c' }),
        sig({ kind: 'correction', userId: null }),
      ],
      'viewer',
      noAccess,
    );
    expect(e.counts).toEqual({ empty_search: 3, correction: 2 });
    expect(e.people).toBe(3);
    expect(e.items).toHaveLength(5);
  });

  it('no signals → empty evidence', () => {
    expect(buildEvidence([], 'v', noAccess)).toEqual({ counts: {}, people: 0, items: [] });
  });

  it('dates are ISO strings', () => {
    expect(buildEvidence([sig()], 'v', noAccess).items[0].createdAt).toBe(t0.toISOString());
  });
});

describe('evidenceLabel', () => {
  it.each([
    ['empty_search', 'chat', 'An agent searched and found nothing.'],
    ['empty_search', 'routine', 'A routine run searched and found nothing.'],
    ['correction', 'chat', 'A member corrected an answer.'],
    ['thumbs_down', 'chat', 'Someone marked an answer as unhelpful.'],
    ['regenerate', 'chat', 'Someone asked for a new answer.'],
    ['edited_output', 'routine', "An owner edited the routine's output before approving it."],
    ['run_failed', 'routine', 'A routine run failed.'],
    ['mystery', 'other', 'Something pointed to a gap.'],
  ])('%s/%s', (kind, source, label) => {
    expect(evidenceLabel(kind, source)).toBe(label);
  });
});

describe('canReview (ownership at read time)', () => {
  const row = (over: Partial<KnowledgeProposal> = {}) =>
    ({
      orgId: 'o1',
      targetType: 'memory',
      targetScope: 'team',
      targetTeamId: 't1',
      targetUserId: null,
      ...over,
    }) as KnowledgeProposal;
  const live = {
    type: 'memory' as const,
    id: 'm1',
    orgId: 'o1',
    scope: 'team',
    teamId: 't1',
    userId: null,
    ownerId: null,
    name: 'n',
    content: 'c',
    version: 1,
  };
  const actor = (role: string, teamId = 't1', orgId: string | null = 'o1') => ({
    userId: 'u',
    orgId,
    teamId,
    role,
  });

  it('a lead of the team can review; a lead of another team cannot', () => {
    expect(canReview(actor('team_lead'), row(), live)).toBe(true);
    expect(canReview(actor('team_lead', 't2'), row(), live)).toBe(false);
  });

  it('members and viewers cannot review team items', () => {
    expect(canReview(actor('member'), row(), live)).toBe(false);
    expect(canReview(actor('viewer'), row(), live)).toBe(false);
  });

  it('another org never can, even an admin', () => {
    expect(canReview(actor('admin', 't1', 'o2'), row(), live)).toBe(false);
  });

  it('uses the LIVE target: moved to another team → the old team’s lead loses it', () => {
    expect(canReview(actor('team_lead'), row(), { ...live, teamId: 't2' })).toBe(false);
  });

  it('a named owner on the live target can review', () => {
    expect(canReview({ ...actor('member'), userId: 'm' }, row(), { ...live, ownerId: 'm' })).toBe(
      true,
    );
  });

  it('falls back to the snapshot when the target is gone', () => {
    expect(canReview(actor('team_lead'), row(), null)).toBe(true);
  });
});
