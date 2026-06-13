/**
 * Security regression tests for Routines + Skills authz defects (harness waves
 * 5, 6, 9). Assert the CORRECT behavior — red pre-fix, green post-fix.
 */
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import { prisma, seedAuthFixture, loginAgent, truncateAll, disconnect, type AuthFixture } from './setup.js';

let fx: AuthFixture;
const yaml = (n: string, d: string) => `---\nname: ${n}\ndescription: ${d}\n---\nDo ${d}.`;

beforeEach(async () => { await truncateAll(); fx = await seedAuthFixture(); });
afterAll(disconnect);

describe('routines authz', () => {
  it('a member cannot create an org-scoped routine', async () => {
    const member = await loginAgent('member');
    const res = await member.post('/api/v1/routines', { name: 'org routine', prompt: 'x', scope: 'org' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("a non-owner cannot read another user's routine run history", async () => {
    const lead = await loginAgent('lead');
    const rid = (await lead.post('/api/v1/routines', { name: 'r', prompt: 'x', scope: 'personal' })).body.data.id;
    const member = await loginAgent('member');
    const res = await member.get(`/api/v1/routines/${rid}/runs`);
    expect([403, 404]).toContain(res.status);
  });

  it("a non-owner cannot attach a trigger to another user's routine", async () => {
    const lead = await loginAgent('lead');
    const rid = (await lead.post('/api/v1/routines', { name: 'r', prompt: 'x', scope: 'personal' })).body.data.id;
    const ep = (await lead.post('/api/v1/routines/webhook-endpoints', { provider: 'slack' })).body.data;
    const member = await loginAgent('member');
    const res = await member.post(`/api/v1/routines/${rid}/triggers`, { webhookEndpointId: ep.id, eventType: 'message' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('skills authz', () => {
  it('a member cannot create an org-scoped skill', async () => {
    const member = await loginAgent('member');
    const res = await member.post('/api/v1/skills', { name: 'org-skill', description: 'do org things', content: yaml('org-skill', 'do org things'), scope: 'org' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("listing skills does not leak another user's personal skill", async () => {
    const member = await loginAgent('member');
    await member.post('/api/v1/skills', { name: 'my-private', description: 'private thing', content: yaml('my-private', 'private thing'), scope: 'personal' });
    const lead = await loginAgent('lead');
    const list = (await lead.get('/api/v1/skills')).body.data as any[];
    expect(list.some((s) => s.name === 'my-private')).toBe(false);
  });

  it('a member cannot seed org skills', async () => {
    const member = await loginAgent('member');
    const res = await member.post('/api/v1/skills/seed', {});
    expect(res.status).toBe(403);
  });

  it('double-installing a skill counts the user once', async () => {
    const author = await loginAgent('member');
    const id = (await author.post('/api/v1/skills', { name: 'shareable', description: 'shareable thing', content: yaml('shareable', 'shareable thing'), scope: 'personal' })).body.data.id;
    const other = await loginAgent('lead');
    await other.post(`/api/v1/skills/${id}/install`, {});
    await other.post(`/api/v1/skills/${id}/install`, {});
    const count = (await prisma.skill.findUnique({ where: { id }, select: { installCount: true } }))?.installCount;
    expect(count).toBeLessThanOrEqual(1);
  });
});
