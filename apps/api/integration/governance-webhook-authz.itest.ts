/**
 * Cluster 4 regression tests: governance must FAIL CLOSED on a broken block
 * policy (regulated posture), and webhook ingest must reject forged/unsigned
 * payloads (no blanket-accept for jira/notion/unsigned-generic).
 */
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import { seedAuthFixture, loginAgent, anonAgent, truncateAll, disconnect, type AuthFixture } from './setup.js';

let fx: AuthFixture;
beforeEach(async () => { await truncateAll(); fx = await seedAuthFixture(); });
afterAll(disconnect);

describe('governance fail-closed', () => {
  it('a block policy that cannot be evaluated (invalid regex) blocks the message', async () => {
    const admin = await loginAgent('admin');
    await admin.put('/api/v1/admin/governance/settings', { enabled: true, checkUserMessages: true });
    await admin.post('/api/v1/admin/governance/policies', {
      name: 'Broken regex', ruleType: 'regex', ruleConfig: { pattern: '([unterminated', flags: '' },
      severity: 'critical', enforcement: 'block',
    });
    const member = await loginAgent('member');
    const sid = (await member.post('/api/v1/chat/sessions', { title: 's' })).body.data.id;
    const res = await member.post(`/api/v1/chat/sessions/${sid}/messages`, { content: 'hello there' });
    expect(res.status).toBe(403); // fail CLOSED — cannot verify safety, so block
  });
});

describe('webhook ingest signature', () => {
  it('an unsigned generic/unknown-provider webhook is rejected (fail closed)', async () => {
    const owner = await loginAgent('member');
    const ep = (await owner.post('/api/v1/routines/webhook-endpoints', { provider: 'custom' })).body.data;
    const res = await anonAgent()
      .post(`/api/v1/webhooks/ingest/${ep.urlToken}`)
      .set('content-type', 'application/json')
      .send({ event: 'forged' });
    expect(res.status).toBe(401);
  });

  it('Jira/Notion accept the unguessable URL token (no body HMAC required)', async () => {
    const owner = await loginAgent('member');
    const ep = (await owner.post('/api/v1/routines/webhook-endpoints', { provider: 'jira' })).body.data;
    const res = await anonAgent()
      .post(`/api/v1/webhooks/ingest/${ep.urlToken}`)
      .set('content-type', 'application/json')
      .send({ issue: { fields: { summary: 'real jira event' } } });
    expect(res.status).toBe(200);
  });
});
