/**
 * Tenancy + validation regression tests (harness waves 7, 10, 11).
 */
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';
import { prisma, seedAuthFixture, loginAgent, truncateAll, disconnect, type AuthFixture } from './setup.js';

let fx: AuthFixture;
beforeEach(async () => { await truncateAll(); fx = await seedAuthFixture(); });
afterAll(disconnect);

describe('tenancy', () => {
  it('an admin cannot move a user into another org\'s team', async () => {
    const admin = await loginAgent('admin');
    const res = await admin.patch(`/api/v1/admin/users/${fx.users.member.id}`, { teamId: fx.rival.teamId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const after = await prisma.user.findUnique({ where: { id: fx.users.member.id }, select: { teamId: true } });
    expect(after?.teamId).not.toBe(fx.rival.teamId);
  });

  it('a decision cannot be linked to a decision in another org', async () => {
    const lead = await loginAgent('lead');
    const d1 = (await lead.post('/api/v1/decisions', { title: 'Ours', reasoning: 'r', scope: 'team' })).body.data.id;
    const rival = await loginAgent('rival');
    const dr = (await rival.post('/api/v1/decisions', { title: 'Theirs', reasoning: 'r', scope: 'team' })).body.data.id;
    const res = await lead.post(`/api/v1/decisions/${d1}/dependencies`, { toDecisionId: dr, relationship: 'related_to' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('a teamless (org-less) user cannot create a decision', async () => {
    const hash = await bcrypt.hash('changeme', 10);
    await prisma.user.create({ data: { email: 'lonewolf@itest.local', name: 'Lone Wolf', role: 'member', authProvider: 'email', passwordHash: hash } });
    const lone = await loginAgent('lonewolf@itest.local');
    const res = await lone.post('/api/v1/decisions', { title: 'orphan', reasoning: 'no org' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('validation', () => {
  it('capturing a decision with invalid enums returns 400, not 500', async () => {
    const lead = await loginAgent('lead');
    const res = await lead.post('/api/v1/decisions', { title: 'bad', reasoning: 'r', confidence: 'super-high', scope: 'galactic' });
    expect(res.status).toBe(400);
  });

  it('an expired memory is not returned by GET /memory/:id', async () => {
    const member = await loginAgent('member');
    const id = (await member.post('/api/v1/memory', { layer: 'user', content: 'expired note', expiresAt: new Date(Date.now() - 86_400_000).toISOString() })).body.data.id;
    const res = await member.get(`/api/v1/memory/${id}`);
    expect(res.status).toBe(404);
  });
});
