/**
 * Knowledge loop, Phase 1 — silent gap signals (test plan area B).
 *
 * Real Express app + Postgres. Every signal is written in the background, so
 * assertions poll. The user-facing responses must not change (B12).
 */
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import {
  prisma,
  seedAuthFixture,
  loginAgent,
  truncateAll,
  disconnect,
  type AuthFixture,
  type AgentClient,
} from './setup.js';
import {
  SearchSignalTracker,
  cleanupOldSignals,
  recordSignal,
} from '../src/services/knowledge-signals.js';
import { recordCorrectionSignals } from '../src/services/experience-service.js';

let fx: AuthFixture;
let member: AgentClient;

beforeEach(async () => {
  await truncateAll();
  fx = await seedAuthFixture();
  member = await loginAgent('member');
});

afterAll(async () => {
  await disconnect();
});

const signals = (where: Record<string, unknown> = {}) =>
  prisma.knowledgeSignal.findMany({ where, orderBy: { createdAt: 'asc' } });

/** A session owned by `agent` with a question and an answer already in it. */
async function sessionWithAnswer(
  agent: AgentClient,
  question = 'Where do we post the weekly customer update?',
) {
  const created = await agent.post('/api/v1/chat/sessions', { title: 'Updates' });
  expect(created.status).toBe(201);
  const sessionId = created.body.data.id as string;
  const session = await prisma.chatSession.findUniqueOrThrow({ where: { id: sessionId } });
  // Both in the past, so a message sent now is clearly newer.
  const now = Date.now();
  const q = await prisma.chatMessage.create({
    data: {
      orgId: session.orgId,
      sessionId,
      role: 'user',
      content: question,
      createdBy: session.userId,
      createdAt: new Date(now - 10_000),
    },
  });
  const a = await prisma.chatMessage.create({
    data: {
      orgId: session.orgId,
      sessionId,
      role: 'assistant',
      content: 'Post it in #customer.',
      createdAt: new Date(now - 5_000),
    },
  });
  return { sessionId, questionId: q.id, answerId: a.id };
}

// ── Thumbs-down ───────────────────────────────────────────────────────────

describe('thumbs-down signals', () => {
  it('B4: a thumbs-down records one signal with the question it answered', async () => {
    const { sessionId, answerId } = await sessionWithAnswer(member);
    const res = await member.post(
      `/api/v1/chat/sessions/${sessionId}/messages/${answerId}/feedback`,
      {
        rating: 'negative',
      },
    );
    // B12: the response is unchanged — nothing about signals.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { messageId: answerId, rating: 'negative' } });

    await expect.poll(async () => (await signals({ kind: 'thumbs_down' })).length).toBe(1);
    const [s] = await signals({ kind: 'thumbs_down' });
    expect(s).toMatchObject({
      orgId: fx.primary.orgId,
      source: 'chat',
      userId: fx.users.member.id,
      sessionId,
      messageId: answerId,
      text: 'Where do we post the weekly customer update?',
    });
  });

  it('rating negative twice keeps one signal; switching to positive removes it', async () => {
    const { sessionId, answerId } = await sessionWithAnswer(member);
    const url = `/api/v1/chat/sessions/${sessionId}/messages/${answerId}/feedback`;
    await member.post(url, { rating: 'negative' });
    await expect.poll(async () => (await signals({ kind: 'thumbs_down' })).length).toBe(1);
    await member.post(url, { rating: 'negative' });
    await new Promise((r) => setTimeout(r, 200));
    expect(await signals({ kind: 'thumbs_down' })).toHaveLength(1);

    await member.post(url, { rating: 'positive' });
    await expect.poll(async () => (await signals({ kind: 'thumbs_down' })).length).toBe(0);
  });

  it('switching to positive keeps a signal the curator already used', async () => {
    const { sessionId, answerId } = await sessionWithAnswer(member);
    const url = `/api/v1/chat/sessions/${sessionId}/messages/${answerId}/feedback`;
    await member.post(url, { rating: 'negative' });
    await expect.poll(async () => (await signals({ kind: 'thumbs_down' })).length).toBe(1);
    await prisma.knowledgeSignal.updateMany({ data: { processedAt: new Date() } });
    await member.post(url, { rating: 'positive' });
    await new Promise((r) => setTimeout(r, 200));
    expect(await signals({ kind: 'thumbs_down' })).toHaveLength(1);
  });

  it('a positive rating alone writes nothing', async () => {
    const { sessionId, answerId } = await sessionWithAnswer(member);
    await member.post(`/api/v1/chat/sessions/${sessionId}/messages/${answerId}/feedback`, {
      rating: 'positive',
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(await signals()).toHaveLength(0);
  });

  it('a rating on the user’s own message is not a signal', async () => {
    const { sessionId, questionId } = await sessionWithAnswer(member);
    await member.post(`/api/v1/chat/sessions/${sessionId}/messages/${questionId}/feedback`, {
      rating: 'negative',
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(await signals()).toHaveLength(0);
  });

  it('B11 rule: a viewer’s thumbs-down counts like anyone else’s', async () => {
    const viewer = await loginAgent('viewer');
    const { sessionId, answerId } = await sessionWithAnswer(viewer);
    await viewer.post(`/api/v1/chat/sessions/${sessionId}/messages/${answerId}/feedback`, {
      rating: 'negative',
    });
    await expect
      .poll(async () => (await signals({ kind: 'thumbs_down', userId: fx.users.viewer.id })).length)
      .toBe(1);
  });

  it('another member of the org cannot rate a message in someone else’s session → 404, no signal', async () => {
    const { sessionId, answerId } = await sessionWithAnswer(member);
    const lead = await loginAgent('lead');
    const rival = await loginAgent('rival');
    for (const agent of [lead, rival]) {
      const res = await agent.post(`/api/v1/chat/sessions/${sessionId}/messages/${answerId}/feedback`, {
        rating: 'negative',
      });
      expect(res.status).toBe(404);
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(await signals()).toHaveLength(0);
    const msg = await prisma.chatMessage.findUniqueOrThrow({ where: { id: answerId } });
    expect((msg.metadata as Record<string, unknown> | null)?.feedback).toBeUndefined();
  });

  it('B7: the stored question has secrets removed', async () => {
    const { sessionId, answerId } = await sessionWithAnswer(
      member,
      'Why does login fail with password=hunter2 and key sk-proj-abcdefghijklmnopqrstuvwxyz123456?',
    );
    await member.post(`/api/v1/chat/sessions/${sessionId}/messages/${answerId}/feedback`, {
      rating: 'negative',
    });
    await expect.poll(async () => (await signals({ kind: 'thumbs_down' })).length).toBe(1);
    const [s] = await signals({ kind: 'thumbs_down' });
    expect(s.text).not.toContain('hunter2');
    expect(s.text).not.toContain('sk-proj-abc');
  });
});

// ── Regenerate ────────────────────────────────────────────────────────────

describe('regenerate signals', () => {
  it('B4: a regenerate records a signal on the latest answer, with the question', async () => {
    const { sessionId, answerId } = await sessionWithAnswer(member);
    const res = await member.post(`/api/v1/chat/sessions/${sessionId}/messages`, {
      content: 'Where do we post the weekly customer update?',
      regenerate: true,
    });
    expect(res.status).toBe(202);
    expect(Object.keys(res.body.data)).toEqual(['messageId']);

    await expect.poll(async () => (await signals({ kind: 'regenerate' })).length).toBe(1);
    const [s] = await signals({ kind: 'regenerate' });
    expect(s).toMatchObject({
      messageId: answerId,
      sessionId,
      userId: fx.users.member.id,
      source: 'chat',
    });
  });

  it('uses regenerateOf when it names an answer in the session', async () => {
    const { sessionId, answerId } = await sessionWithAnswer(member);
    await member.post(`/api/v1/chat/sessions/${sessionId}/messages`, {
      content: 'again',
      regenerate: true,
      regenerateOf: answerId,
    });
    await expect
      .poll(async () => (await signals({ kind: 'regenerate' }))[0]?.messageId)
      .toBe(answerId);
  });

  it('ignores a regenerateOf from another session and falls back to this session', async () => {
    const other = await sessionWithAnswer(member, 'other question');
    const mine = await sessionWithAnswer(member);
    await member.post(`/api/v1/chat/sessions/${mine.sessionId}/messages`, {
      content: 'again',
      regenerate: true,
      regenerateOf: other.answerId,
    });
    await expect
      .poll(async () => (await signals({ kind: 'regenerate' }))[0]?.messageId)
      .toBe(mine.answerId);
  });

  it('an ordinary send writes no signal', async () => {
    const { sessionId } = await sessionWithAnswer(member);
    await member.post(`/api/v1/chat/sessions/${sessionId}/messages`, { content: 'thanks' });
    await new Promise((r) => setTimeout(r, 200));
    expect(await signals()).toHaveLength(0);
  });

  it('a regenerate in a session with no answer yet writes nothing', async () => {
    const created = await member.post('/api/v1/chat/sessions', {});
    await member.post(`/api/v1/chat/sessions/${created.body.data.id}/messages`, {
      content: 'hi',
      regenerate: true,
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(await signals()).toHaveLength(0);
  });
});

// ── Edited routine output ─────────────────────────────────────────────────

describe('edited-output signals', () => {
  async function seedPendingApproval(ownerUserId: string, agentOutput: string) {
    const routine = await prisma.routine.create({
      data: {
        userId: ownerUserId,
        name: 'Weekly update',
        prompt: 'Post the update',
        delivery: { channels: ['in_app'] },
        orgId: fx.primary.orgId,
      },
    });
    const run = await prisma.routineRun.create({
      data: { routineId: routine.id, status: 'running' as never },
    });
    const checkpoint = await prisma.approvalCheckpoint.create({
      data: { routineId: routine.id, name: 'Gate', position: 0 },
    });
    const approval = await prisma.approvalRequest.create({
      data: { runId: run.id, checkpointId: checkpoint.id, status: 'pending' as never, agentOutput },
    });
    return { routine, run, approval };
  }

  it('B4: an owner editing the output before approval records a signal', async () => {
    const { routine, run, approval } = await seedPendingApproval(
      fx.users.member.id,
      'Posting in #customer',
    );
    const res = await member.post(`/api/v1/approvals/${approval.id}/resolve`, {
      decision: 'edited',
      editedOutput: 'Posting in #customer-updates',
    });
    expect(res.status).toBe(200);
    await expect.poll(async () => (await signals({ kind: 'edited_output' })).length).toBe(1);
    const [s] = await signals({ kind: 'edited_output' });
    expect(s).toMatchObject({
      orgId: fx.primary.orgId,
      source: 'routine',
      routineId: routine.id,
      routineRunId: run.id,
      userId: fx.users.member.id,
      text: 'Posting in #customer-updates',
    });
    expect(s.detail).toEqual({ before: 'Posting in #customer' });
  });

  it('a plain approval, or an "edit" that changes nothing, writes no signal', async () => {
    const a = await seedPendingApproval(fx.users.member.id, 'Same text');
    await member.post(`/api/v1/approvals/${a.approval.id}/resolve`, { decision: 'approved' });
    const b = await seedPendingApproval(fx.users.member.id, 'Same text');
    await member.post(`/api/v1/approvals/${b.approval.id}/resolve`, {
      decision: 'edited',
      editedOutput: ' Same text ',
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(await signals({ kind: 'edited_output' })).toHaveLength(0);
  });
});

// ── Agent-run tracker against the real DB ─────────────────────────────────

describe('empty-search tracker (DB)', () => {
  it('B2: a routine run stores one signal and a {tool, found} search log — no query text', async () => {
    const routine = await prisma.routine.create({
      data: {
        userId: fx.users.member.id,
        name: 'R',
        prompt: 'p',
        delivery: {},
        orgId: fx.primary.orgId,
      },
    });
    const run = await prisma.routineRun.create({
      data: { routineId: routine.id, status: 'running' as never },
    });
    const t = new SearchSignalTracker({
      orgId: fx.primary.orgId,
      userId: fx.users.member.id,
      teamId: fx.primary.teamId,
      source: 'routine',
      routineId: routine.id,
      routineRunId: run.id,
    });
    t.observe('recall_memory', { query: 'customer channel' }, { results: [] });
    t.observe('recall_decisions', { query: 'who approves' }, { decisions: [] });
    await t.flush();

    const [s] = await signals({ kind: 'empty_search' });
    expect(s).toMatchObject({
      source: 'routine',
      routineId: routine.id,
      routineRunId: run.id,
      sessionId: null,
    });
    const after = await prisma.routineRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.searchLog).toEqual([
      { tool: 'recall_memory', found: false },
      { tool: 'recall_decisions', found: false },
    ]);
    expect(JSON.stringify(after.searchLog)).not.toContain('customer');
  });

  it('B2: a task run is attributed to the task', async () => {
    const task = await prisma.task.create({
      data: { orgId: fx.primary.orgId, userId: fx.users.member.id, title: 'T', source: 'manual' },
    });
    const t = new SearchSignalTracker({
      orgId: fx.primary.orgId,
      userId: fx.users.member.id,
      teamId: null,
      source: 'task',
      taskId: task.id,
    });
    t.observe('session_search', { query: 'q' }, { results: [] });
    await t.flush();
    expect(await signals({ kind: 'empty_search', taskId: task.id, source: 'task' })).toHaveLength(
      1,
    );
  });

  it('B9: a failed write never throws (unknown org → FK error swallowed)', async () => {
    await expect(
      recordSignal({ orgId: 'no-such-org', kind: 'run_failed', source: 'routine', text: 'boom' }),
    ).resolves.toBeNull();
    const t = new SearchSignalTracker({
      orgId: 'no-such-org',
      userId: 'u',
      teamId: null,
      source: 'chat',
    });
    t.observe('recall_memory', { query: 'x' }, { results: [] });
    await expect(t.flush()).resolves.toBeUndefined();
  });
});

// ── Corrections ───────────────────────────────────────────────────────────

describe('correction signals', () => {
  it('B3: records each explicit correction once per session, redacted', async () => {
    const { sessionId } = await sessionWithAnswer(member);
    const input = { sessionId, userId: fx.users.member.id, orgId: fx.primary.orgId };
    const corrections = [
      { wrong: 'Post in #customer', correct: 'The weekly update goes in #customer-updates' },
      { wrong: 'x', correct: 'The deploy token is ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
      { wrong: 'empty', correct: '   ' },
    ];
    expect(await recordCorrectionSignals(input, corrections)).toBe(2);
    // Reflection re-runs after each turn — the same corrections must not repeat.
    expect(await recordCorrectionSignals(input, corrections)).toBe(0);

    const rows = await signals({ kind: 'correction' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      text: 'The weekly update goes in #customer-updates',
      sessionId,
      source: 'chat',
    });
    expect(rows[0].detail).toEqual({ wrong: 'Post in #customer' });
    expect(rows[1].text).not.toContain('ghp_abc');
  });

  it('no corrections → nothing written', async () => {
    const input = { sessionId: 's', userId: fx.users.member.id, orgId: fx.primary.orgId };
    expect(await recordCorrectionSignals(input, [])).toBe(0);
    expect(await recordCorrectionSignals(input, undefined)).toBe(0);
  });
});

// ── Retention ─────────────────────────────────────────────────────────────

describe('retention', () => {
  it('B8: the daily cleanup removes signals older than 90 days, across orgs, and keeps newer ones', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);
    await prisma.knowledgeSignal.createMany({
      data: [
        { orgId: fx.primary.orgId, kind: 'empty_search', source: 'chat', createdAt: old },
        { orgId: fx.rival.orgId, kind: 'empty_search', source: 'chat', createdAt: old },
        { orgId: fx.primary.orgId, kind: 'empty_search', source: 'chat', createdAt: recent },
      ],
    });
    expect(await cleanupOldSignals(now)).toBe(2);
    const left = await signals();
    expect(left).toHaveLength(1);
    expect(left[0].createdAt.getTime()).toBe(recent.getTime());
  });

  it('deleting an org removes its signals', async () => {
    await recordSignal({ orgId: fx.empty.orgId, kind: 'run_failed', source: 'routine' });
    expect(await signals({ orgId: fx.empty.orgId })).toHaveLength(1);
    await prisma.org.delete({ where: { id: fx.empty.orgId } });
    expect(await signals({ orgId: fx.empty.orgId })).toHaveLength(0);
  });
});
