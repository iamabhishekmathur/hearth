/**
 * Harness smoke test — proves the integration tier works end-to-end:
 * the app boots against the real test DB, migrations applied, the login + CSRF
 * handshake flows, role-based authz is enforced, and tenants are isolated.
 * If this passes, the ~10-branch test fan-out can build on top of it.
 */
import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  app,
  seedAuthFixture,
  loginAgent,
  truncateAll,
  disconnect,
  type AuthFixture,
} from './setup.js';

let fixture: AuthFixture;

beforeAll(async () => {
  await truncateAll();
  fixture = await seedAuthFixture();
});

afterAll(async () => {
  await disconnect();
});

describe('integration harness', () => {
  it('serves health', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
  });

  it('logs in and reflects the user role at /auth/me', async () => {
    const admin = await loginAgent('admin');
    const me = await admin.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data?.role ?? me.body.role).toBe('admin');
  });

  it('rejects a state-changing request with no CSRF header (403)', async () => {
    const member = await loginAgent('member');
    // .raw bypasses the auto-injected CSRF header → double-submit check fails.
    const res = await member.raw.post('/api/v1/memory').send({ layer: 'user', content: 'x' });
    expect(res.status).toBe(403);
  });

  it('enforces memory-layer authz by role', async () => {
    const viewer = await loginAgent('viewer');
    const denied = await viewer.post('/api/v1/memory', { layer: 'org', content: 'org-wide secret' });
    expect(denied.status).toBe(403);

    const member = await loginAgent('member');
    const ok = await member.post('/api/v1/memory', { layer: 'user', content: 'a personal note' });
    expect([200, 201]).toContain(ok.status);
  });

  it('isolates tenants — a rival org cannot see primary-org memory', async () => {
    const member = await loginAgent('member');
    const created = await member.post('/api/v1/memory', {
      layer: 'user',
      content: 'primary-only-note',
    });
    expect([200, 201]).toContain(created.status);
    const id = created.body.data?.id ?? created.body.id;
    expect(id).toBeTruthy();

    const rival = await loginAgent('rival');
    const list = await rival.get('/api/v1/memory?layer=user');
    expect(list.status).toBe(200);
    const items: Array<{ id: string }> = list.body.data ?? list.body.items ?? [];
    expect(items.find((m) => m.id === id)).toBeUndefined();
  });

  it('exposes the seeded multi-tenant fixture', () => {
    expect(fixture.users.admin.role).toBe('admin');
    expect(fixture.primary.orgId).not.toBe(fixture.rival.orgId);
  });
});
