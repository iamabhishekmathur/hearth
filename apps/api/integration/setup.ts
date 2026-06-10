/**
 * Integration-test harness.
 *
 * Boots the real Express app in-process (NODE_ENV=test skips httpServer.listen)
 * and drives it with supertest against a real Postgres + Redis (the
 * docker-compose.test.yml stack). Provides:
 *
 *   - `app`              the Express instance under test
 *   - `prisma`           a PLAIN PrismaClient (bypasses the tenant extension) for
 *                        seeding + assertions
 *   - `seedAuthFixture`  creates a primary org (4 roles), a rival org, an empty org
 *   - `loginAgent(role)` a cookie-persisting supertest agent already logged in,
 *                        with helpers that auto-inject the CSRF header on mutations
 *   - `truncateAll`      wipe all rows between tests
 *
 * Tier-B tests (authz matrix, tenant isolation, queues) build on this.
 */
import request, { type Test } from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { app } from '../src/index.js';

export { app };

/** Plain client — no tenant extension, so we can seed/inspect any org freely. */
export const prisma = new PrismaClient();

const TEST_PASSWORD = 'changeme';
let passwordHashCache: string | null = null;
async function passwordHash(): Promise<string> {
  passwordHashCache ??= await bcrypt.hash(TEST_PASSWORD, 10);
  return passwordHashCache;
}

export type FixtureRole = 'admin' | 'lead' | 'member' | 'viewer' | 'rival';

export interface AuthFixture {
  primary: { orgId: string; teamId: string };
  rival: { orgId: string; teamId: string };
  empty: { orgId: string };
  users: Record<FixtureRole, { id: string; email: string; role: string; orgId: string }>;
  password: string;
}

/**
 * Seeds the canonical multi-tenant fixture used by authz/tenancy tests:
 *   - primary org `hearth-sim`: admin / team_lead / member / viewer
 *   - rival org `rival-corp`:   one admin (the tenant-isolation foil)
 *   - empty org `empty-org`:    no users (cold-start cases)
 * Call after `truncateAll()` in a beforeEach (or once in beforeAll).
 */
export async function seedAuthFixture(): Promise<AuthFixture> {
  const hash = await passwordHash();

  const primaryOrg = await prisma.org.create({ data: { name: 'Hearth Sim', slug: 'hearth-sim' } });
  const primaryTeam = await prisma.team.create({ data: { name: 'Engineering', orgId: primaryOrg.id } });

  const rivalOrg = await prisma.org.create({ data: { name: 'Rival Corp', slug: 'rival-corp' } });
  const rivalTeam = await prisma.team.create({ data: { name: 'Rival Eng', orgId: rivalOrg.id } });

  const emptyOrg = await prisma.org.create({ data: { name: 'Empty Org', slug: 'empty-org' } });

  const mk = (email: string, name: string, role: string, teamId: string) =>
    prisma.user.create({
      data: { email, name, role: role as never, authProvider: 'email', passwordHash: hash, teamId },
    });

  const admin = await mk('admin@itest.local', 'Admin', 'admin', primaryTeam.id);
  const lead = await mk('lead@itest.local', 'Team Lead', 'team_lead', primaryTeam.id);
  const member = await mk('member@itest.local', 'Member', 'member', primaryTeam.id);
  const viewer = await mk('viewer@itest.local', 'Viewer', 'viewer', primaryTeam.id);
  const rival = await mk('rival@itest.local', 'Rival Admin', 'admin', rivalTeam.id);

  const u = (x: { id: string; email: string; role: string }, orgId: string) => ({
    id: x.id,
    email: x.email,
    role: x.role,
    orgId,
  });

  return {
    primary: { orgId: primaryOrg.id, teamId: primaryTeam.id },
    rival: { orgId: rivalOrg.id, teamId: rivalTeam.id },
    empty: { orgId: emptyOrg.id },
    users: {
      admin: u(admin, primaryOrg.id),
      lead: u(lead, primaryOrg.id),
      member: u(member, primaryOrg.id),
      viewer: u(viewer, primaryOrg.id),
      rival: u(rival, rivalOrg.id),
    },
    password: TEST_PASSWORD,
  };
}

const ROLE_EMAIL: Record<FixtureRole, string> = {
  admin: 'admin@itest.local',
  lead: 'lead@itest.local',
  member: 'member@itest.local',
  viewer: 'viewer@itest.local',
  rival: 'rival@itest.local',
};

function readCookie(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as string[] | undefined;
  if (!raw) return undefined;
  for (const c of raw) {
    const m = c.match(new RegExp(`${name.replace('.', '\\.')}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]);
  }
  return undefined;
}

/** A logged-in supertest agent whose mutation helpers auto-send the CSRF header. */
export interface AgentClient {
  csrf: string;
  email: string;
  get(path: string): Test;
  post(path: string, body?: unknown): Test;
  patch(path: string, body?: unknown): Test;
  put(path: string, body?: unknown): Test;
  del(path: string): Test;
  /** Escape hatch: the raw cookie-persisting agent. */
  raw: ReturnType<typeof request.agent>;
}

/**
 * Logs in a fixture user (by role or explicit email) and returns a client whose
 * post/patch/put/del helpers carry the session cookie + matching CSRF header.
 * Requires `seedAuthFixture()` to have run.
 */
export async function loginAgent(roleOrEmail: FixtureRole | string): Promise<AgentClient> {
  const email = (ROLE_EMAIL as Record<string, string>)[roleOrEmail] ?? roleOrEmail;
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
  if (res.status !== 200) {
    throw new Error(`loginAgent: login failed for ${email} (status ${res.status})`);
  }
  const csrf = readCookie(res, 'hearth.csrf');
  if (!csrf) throw new Error(`loginAgent: no hearth.csrf cookie for ${email}`);

  const withCsrf = (t: Test) => t.set('x-csrf-token', csrf);
  return {
    csrf,
    email,
    raw: agent,
    get: (path) => agent.get(path),
    post: (path, body) => withCsrf(agent.post(path)).send(body as object),
    patch: (path, body) => withCsrf(agent.patch(path)).send(body as object),
    put: (path, body) => withCsrf(agent.put(path)).send(body as object),
    del: (path) => withCsrf(agent.delete(path)),
  };
}

/** An anonymous supertest client (no session) for unauthenticated-path tests. */
export function anonAgent(): ReturnType<typeof request.agent> {
  return request.agent(app);
}

/** Truncate every application table (keeps the migrations ledger). */
export async function truncateAll(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Close the harness's Prisma connection — call in an afterAll if desired. */
export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
