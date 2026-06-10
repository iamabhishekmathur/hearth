/**
 * Memory layer authz / scoping integration tests.
 *
 * The smoke test already covers the basic role gate (viewer can't write org)
 * and tenant isolation. Here we go deeper on the *team* layer:
 *   - team-layer entries are shared between members of the same team
 *   - team-layer entries are NOT visible to a different team in the same org
 *   - expired entries are excluded from listing
 *
 * Routes under test (mounted at /api/v1/memory, see src/routes/memory.ts):
 *   GET  /memory?layer=...
 *   POST /memory
 *
 * The canonical fixture puts admin/lead/member/viewer in ONE primary team, so
 * we provision a second team + an extra same-team member with the plain prisma
 * client, then log those users in by explicit email.
 */
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';
import {
  prisma,
  seedAuthFixture,
  loginAgent,
  truncateAll,
  disconnect,
  type AuthFixture,
} from './setup.js';

let fx: AuthFixture;
let teammateEmail: string;
let otherTeamLeadEmail: string;

beforeEach(async () => {
  await truncateAll();
  fx = await seedAuthFixture();

  const hash = await bcrypt.hash(fx.password, 10);

  // A second member of the *same* primary team as the seeded users.
  teammateEmail = 'teammate@itest.local';
  await prisma.user.create({
    data: {
      email: teammateEmail,
      name: 'Teammate',
      role: 'member' as never,
      authProvider: 'email',
      passwordHash: hash,
      teamId: fx.primary.teamId,
    },
  });

  // A second team in the SAME org, with its own team_lead (so it can write the
  // team layer for its own team).
  const otherTeam = await prisma.team.create({
    data: { name: 'Other Team', orgId: fx.primary.orgId },
  });
  otherTeamLeadEmail = 'otherlead@itest.local';
  await prisma.user.create({
    data: {
      email: otherTeamLeadEmail,
      name: 'Other Lead',
      role: 'team_lead' as never,
      authProvider: 'email',
      passwordHash: hash,
      teamId: otherTeam.id,
    },
  });
});

afterAll(async () => {
  await disconnect();
});

describe('memory — team layer sharing', () => {
  it('a team-layer entry is visible to another member of the same team', async () => {
    // team_lead can write the team layer.
    const lead = await loginAgent('lead');
    const created = await lead.post('/api/v1/memory', {
      layer: 'team',
      content: 'team-shared playbook',
    });
    expect([200, 201]).toContain(created.status);
    const id = created.body.data?.id ?? created.body.id;
    expect(id).toBeTruthy();

    // A different member of the SAME team can see it.
    const teammate = await loginAgent(teammateEmail);
    const list = await teammate.get('/api/v1/memory?layer=team');
    expect(list.status).toBe(200);
    const ids: string[] = (list.body.data ?? []).map((m: { id: string }) => m.id);
    expect(ids).toContain(id);
  });

  it('a team-layer entry is NOT visible to a different team in the same org', async () => {
    const lead = await loginAgent('lead');
    const created = await lead.post('/api/v1/memory', {
      layer: 'team',
      content: 'engineering-only note',
    });
    const id = created.body.data?.id ?? created.body.id;

    // The lead of a DIFFERENT team (same org) must not see it.
    const otherLead = await loginAgent(otherTeamLeadEmail);
    const list = await otherLead.get('/api/v1/memory?layer=team');
    expect(list.status).toBe(200);
    const ids: string[] = (list.body.data ?? []).map((m: { id: string }) => m.id);
    expect(ids).not.toContain(id);
  });

  it('GET /memory/:id of a foreign-team entry is 404', async () => {
    const lead = await loginAgent('lead');
    const created = await lead.post('/api/v1/memory', { layer: 'team', content: 'x' });
    const id = created.body.data?.id ?? created.body.id;

    const otherLead = await loginAgent(otherTeamLeadEmail);
    const got = await otherLead.get(`/api/v1/memory/${id}`);
    expect(got.status).toBe(404);
  });
});

describe('memory — org layer & role gate', () => {
  it('org-layer entry written by admin is visible to every member of the org', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/memory', {
      layer: 'org',
      content: 'org-wide announcement',
    });
    expect([200, 201]).toContain(created.status);
    const id = created.body.data?.id ?? created.body.id;

    // A member of a *different team* but same org still sees org-layer memory.
    const otherLead = await loginAgent(otherTeamLeadEmail);
    const list = await otherLead.get('/api/v1/memory?layer=org');
    const ids: string[] = (list.body.data ?? []).map((m: { id: string }) => m.id);
    expect(ids).toContain(id);
  });

  it('team_lead in another team cannot write to the org layer (403)', async () => {
    const otherLead = await loginAgent(otherTeamLeadEmail);
    const res = await otherLead.post('/api/v1/memory', { layer: 'org', content: 'nope' });
    expect(res.status).toBe(403);
  });
});

describe('memory — expiry', () => {
  it('an expired user-layer entry is excluded from listing', async () => {
    const member = await loginAgent('member');

    // Live entry (no expiry).
    const live = await member.post('/api/v1/memory', { layer: 'user', content: 'live note' });
    const liveId = live.body.data?.id ?? live.body.id;

    // Expired entry (expiresAt in the past). Seed directly so we control the time.
    const expired = await prisma.memoryEntry.create({
      data: {
        orgId: fx.primary.orgId,
        userId: fx.users.member.id,
        layer: 'user' as never,
        content: 'stale note',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const list = await member.get('/api/v1/memory?layer=user');
    expect(list.status).toBe(200);
    const ids: string[] = (list.body.data ?? []).map((m: { id: string }) => m.id);
    expect(ids).toContain(liveId);
    expect(ids).not.toContain(expired.id);
  });
});
