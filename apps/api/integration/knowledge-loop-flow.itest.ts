/**
 * Knowledge loop, Phase 2 — full data-flow tests (D4).
 *
 *   signals (written by the real Phase 1 paths) → curator → a card only the
 *   owner sees → approve → a new version → signals marked used → the next
 *   routine run / memory search uses the new version.
 *
 * Only two things are faked: the curator's model (injected) and the agent
 * loop a routine run calls (mocked below), so we can see the exact prompt the
 * run sends.
 */
import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';

const agent = vi.hoisted(() => ({
  mode: 'ok' as 'ok' | 'fail',
  prompts: [] as string[],
}));

vi.mock('../src/agent/agent-runtime.js', () => ({
  agentLoop: async function* (_ctx: unknown, messages: Array<{ content: string }>) {
    agent.prompts.push(messages[0]?.content ?? '');
    if (agent.mode === 'fail') throw new Error('Tool not found: tickets_search');
    yield { type: 'text_delta', content: 'Three tickets: A, B, C.' };
  },
}));
vi.mock('../src/agent/context-builder.js', () => ({
  buildAgentContext: async () => ({}),
}));

import {
  prisma,
  seedAuthFixture,
  loginAgent,
  truncateAll,
  disconnect,
  type AuthFixture,
} from './setup.js';
import { processRoutineJob } from '../src/jobs/routine-scheduler.js';
import { runCuratorForOrg } from '../src/services/knowledge-curator.js';

let fx: AuthFixture;

beforeEach(async () => {
  await truncateAll();
  fx = await seedAuthFixture();
  await prisma.org.update({
    where: { id: fx.primary.orgId },
    data: { settings: { features: { knowledgeLoop: true } } },
  });
  agent.mode = 'ok';
  agent.prompts = [];
});

afterAll(async () => {
  await disconnect();
});

const OLD_PROMPT = 'Summarise yesterday’s customer tickets.';
const NEW_PROMPT =
  'Summarise yesterday’s customer tickets from the Support queue (use ticket_lookup).';

describe('full loop: routine', () => {
  it('failed runs → card for the lead only → approve → next run uses the new prompt', async () => {
    const routine = await prisma.routine.create({
      data: {
        userId: fx.users.lead.id,
        name: 'Ticket digest',
        prompt: OLD_PROMPT,
        delivery: { channels: ['in_app'] },
        scope: 'team',
        teamId: fx.primary.teamId,
        orgId: fx.primary.orgId,
        version: 1,
      },
    });

    // 1. Two real failed runs write two run_failed signals (Phase 1 path).
    agent.mode = 'fail';
    for (let i = 0; i < 2; i++) {
      await expect(
        processRoutineJob({
          id: `job-${i}`,
          data: { routineId: routine.id, userId: fx.users.lead.id, triggeredBy: 'manual' },
        }),
      ).rejects.toThrow('Tool not found');
    }
    await expect
      .poll(async () =>
        prisma.knowledgeSignal.count({ where: { kind: 'run_failed', routineId: routine.id } }),
      )
      .toBe(2);
    expect(agent.prompts).toEqual([OLD_PROMPT, OLD_PROMPT]);

    // 2. The curator turns them into one card.
    const model = vi.fn(async () =>
      JSON.stringify({
        propose: true,
        after: NEW_PROMPT,
        reason: 'Runs fail looking for tickets; name the queue and tool.',
      }),
    );
    const summary = await runCuratorForOrg(fx.primary.orgId, { model });
    expect(summary).toMatchObject({ proposed: 1, modelCalls: 1 });
    const prompt = (model.mock.calls[0] as unknown as [{ user: string }])[0].user;
    expect(prompt).toContain('Tool not found: tickets_search');
    expect(prompt).toContain(OLD_PROMPT);

    // 3. Only the owner sees it.
    const member = await loginAgent('member');
    expect((await member.get('/api/v1/knowledge/proposals')).body.data).toEqual([]);
    const lead = await loginAgent('lead');
    const inbox = await lead.get('/api/v1/knowledge/proposals');
    expect(inbox.body.data).toHaveLength(1);
    const card = inbox.body.data[0];
    expect(card).toMatchObject({
      targetName: 'Ticket digest',
      before: OLD_PROMPT,
      after: NEW_PROMPT,
    });
    expect(card.evidence.counts).toEqual({ run_failed: 2 });
    expect(card.evidence.items[0].link).toMatchObject({
      type: 'routine_run',
      routineId: routine.id,
    });

    // Nothing has changed yet: a run now still uses the old prompt.
    agent.mode = 'ok';
    await processRoutineJob({
      id: 'job-before',
      data: { routineId: routine.id, userId: fx.users.lead.id, triggeredBy: 'manual' },
    });
    expect(agent.prompts.at(-1)).toBe(OLD_PROMPT);

    // 4. Approve → a new version marked "curator".
    const res = await lead.post(`/api/v1/knowledge/proposals/${card.id}/approve`, {});
    expect(res.status).toBe(200);
    const saved = await prisma.routine.findUniqueOrThrow({ where: { id: routine.id } });
    expect(saved).toMatchObject({ prompt: NEW_PROMPT, version: 2 });
    const versions = await prisma.routineVersion.findMany({
      where: { routineId: routine.id },
      orderBy: { version: 'asc' },
    });
    expect(versions.map((v) => [v.version, v.changeSource])).toEqual([[2, 'curator']]);

    // 5. The signals are marked used, on this card.
    const sigs = await prisma.knowledgeSignal.findMany({ where: { routineId: routine.id } });
    expect(sigs.every((s) => s.processedAt && s.proposalId === card.id)).toBe(true);

    // 6. The next run reads the new version.
    await processRoutineJob({
      id: 'job-after',
      data: { routineId: routine.id, userId: fx.users.lead.id, triggeredBy: 'schedule' },
    });
    expect(agent.prompts.at(-1)).toBe(NEW_PROMPT);
    const lastRun = await prisma.routineRun.findFirstOrThrow({
      where: { routineId: routine.id },
      orderBy: { startedAt: 'desc' },
    });
    expect(lastRun.status).toBe('success');

    // 7. A second curator pass has nothing to do (no unused signals).
    const again = await runCuratorForOrg(fx.primary.orgId, { model });
    expect(again.modelCalls).toBe(0);
  });
});

describe('full loop: memory', () => {
  it('thumbs-downs in chat → card for admins → approve → memory search returns the new fact', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/memory', {
      layer: 'org',
      content: 'The weekly customer update is posted in #customers every Friday.',
    });
    expect(created.status).toBe(201);
    const entryId = created.body.data.id as string;

    // Two members' thumbs-downs on answers about it (real feedback route).
    const member = await loginAgent('member');
    const viewer = await loginAgent('viewer');
    for (const [who, c] of [
      ['member', member],
      ['viewer', viewer],
    ] as const) {
      const s = await c.post('/api/v1/chat/sessions', { title: 'Updates' });
      const sessionId = s.body.data.id as string;
      const session = await prisma.chatSession.findUniqueOrThrow({ where: { id: sessionId } });
      const now = Date.now();
      await prisma.chatMessage.create({
        data: {
          orgId: session.orgId,
          sessionId,
          role: 'user',
          content: `Where is the weekly customer update posted? (${who})`,
          createdBy: session.userId,
          createdAt: new Date(now - 10_000),
        },
      });
      const answer = await prisma.chatMessage.create({
        data: {
          orgId: session.orgId,
          sessionId,
          role: 'assistant',
          content: 'In #customers.',
          createdAt: new Date(now - 5_000),
        },
      });
      const fb = await c.post(`/api/v1/chat/sessions/${sessionId}/messages/${answer.id}/feedback`, {
        rating: 'negative',
      });
      expect(fb.status).toBe(200);
      // Members see nothing new in chat: the response is the plain rating.
      expect(fb.body).toEqual({ data: { messageId: answer.id, rating: 'negative' } });
    }
    await expect
      .poll(async () => prisma.knowledgeSignal.count({ where: { kind: 'thumbs_down' } }))
      .toBe(2);

    const NEW_FACT = 'The weekly customer update is posted in #customer-updates every Friday.';
    const summary = await runCuratorForOrg(fx.primary.orgId, {
      model: async () =>
        JSON.stringify({
          propose: true,
          after: NEW_FACT,
          reason: 'Two people found the old channel wrong.',
        }),
    });
    expect(summary.proposed).toBe(1);

    // The evidence comes from private chats: no quotes for the admin.
    const [card] = (await admin.get('/api/v1/knowledge/proposals')).body.data;
    expect(card.targetId).toBe(entryId);
    expect(card.evidence.people).toBe(2);
    expect(card.evidence.items.every((i: { quote: unknown }) => i.quote === null)).toBe(true);
    // Members get nothing.
    expect((await member.get('/api/v1/knowledge/proposals')).body.data).toEqual([]);

    const res = await admin.post(`/api/v1/knowledge/proposals/${card.id}/approve`, {});
    expect(res.status).toBe(200);

    const read = await member.get(`/api/v1/memory/${entryId}`);
    expect(read.body.data).toMatchObject({ content: NEW_FACT, version: 2 });
    const search = await member.post('/api/v1/memory/search', { query: 'weekly customer update' });
    expect(search.status).toBe(200);
    expect(JSON.stringify(search.body)).toContain('#customer-updates');
    const sigs = await prisma.knowledgeSignal.findMany();
    expect(sigs.every((s) => s.proposalId === card.id && s.processedAt)).toBe(true);
  });
});
