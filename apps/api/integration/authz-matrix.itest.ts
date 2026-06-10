/**
 * AUTHZ MATRIX — table-driven role-based access-control assertions.
 *
 * Loads `route-manifest.json` and, for every admin-group endpoint, asserts:
 *   - admin                        → NOT 403 (reaches the handler)
 *   - team_lead / member / viewer  → 403 Forbidden
 *
 * Plus the memory-layer write gate (org→admin, team→admin+lead, user→all) and
 * that ordinary reads (GET /tasks, GET /memory) work for every role.
 *
 * DRIFT DETECTION (Part 1 §4.1): every route in the manifest under
 * `/api/v1/admin/` MUST be covered by an explicit classification in
 * ADMIN_ROUTE_POLICY below. If a manifest admin route is unclassified, the
 * suite FAILS naming the offending route — so a newly-added admin endpoint
 * can't silently skip its authz expectation.
 *
 * Pattern copied from smoke.itest.ts: import from './setup.js', truncate+seed
 * in beforeEach, drive with loginAgent(role).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeEach, afterAll, beforeAll, describe, it, expect } from 'vitest';
import {
  seedAuthFixture,
  loginAgent,
  truncateAll,
  disconnect,
  type AgentClient,
  type FixtureRole,
} from './setup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ManifestRoute {
  method: string;
  path: string;
  guards: string[];
}
interface Manifest {
  generatedRoutes: number;
  routes: ManifestRoute[];
}

const manifest: Manifest = JSON.parse(
  readFileSync(join(__dirname, 'route-manifest.json'), 'utf8'),
) as Manifest;

/**
 * Classification of every admin route group. Each manifest route under
 * `/api/v1/admin/` must fall into exactly one bucket:
 *   - 'admin'     → gated by requireRole('admin'); non-admins get 403.
 *   - 'bootstrap' → unauthenticated setup/bootstrap; NOT role-gated.
 *
 * The groups below are matched by path prefix. Drift detection asserts every
 * manifest admin route prefix-matches one of these entries.
 */
type Policy = 'admin' | 'bootstrap';
interface PolicyEntry {
  prefix: string;
  policy: Policy;
  reason: string;
}

const ADMIN_ROUTE_POLICY: PolicyEntry[] = [
  // requireRole('admin') — confirmed in routes/admin/* (router.use or per-route)
  { prefix: '/api/v1/admin/analytics/', policy: 'admin', reason: 'analytics.ts requireRole(admin)' },
  { prefix: '/api/v1/admin/audit-logs/', policy: 'admin', reason: 'audit-logs.ts requireRole(admin)' },
  { prefix: '/api/v1/admin/cognitive/', policy: 'admin', reason: 'cognitive.ts router.use(requireRole(admin))' },
  { prefix: '/api/v1/admin/compliance/', policy: 'admin', reason: 'compliance.ts requireRole(admin)' },
  { prefix: '/api/v1/admin/governance/', policy: 'admin', reason: 'governance.ts router.use(requireRole(admin))' },
  { prefix: '/api/v1/admin/integrations/', policy: 'admin', reason: 'integrations.ts router.use(requireRole(admin))' },
  { prefix: '/api/v1/admin/llm-config/', policy: 'admin', reason: 'llm-config.ts requireRole(admin)' },
  { prefix: '/api/v1/admin/routines/', policy: 'admin', reason: 'admin/routines.ts requireRole(admin)' },
  { prefix: '/api/v1/admin/sso/', policy: 'admin', reason: 'sso.ts requireRole(admin)' },
  { prefix: '/api/v1/admin/teams/', policy: 'admin', reason: 'teams.ts requireRole(admin)' },
  { prefix: '/api/v1/admin/users/', policy: 'admin', reason: 'users.ts requireRole(admin)' },
  // Unauthenticated bootstrap — first-run setup wizard, deliberately NOT role-gated.
  { prefix: '/api/v1/admin/setup/', policy: 'bootstrap', reason: 'setup.ts is the pre-auth bootstrap path' },
];

function classify(path: string): PolicyEntry | undefined {
  return ADMIN_ROUTE_POLICY.find((e) => path.startsWith(e.prefix));
}

const ADMIN_MANIFEST_ROUTES = manifest.routes.filter((r) => r.path.startsWith('/api/v1/admin/'));

/**
 * Substitutes representative ids for `:param` placeholders so the route is
 * reachable enough to hit the role guard. The guard runs before any DB lookup,
 * so a bogus id is fine — we only assert on 403-vs-not-403.
 */
function concretePath(path: string): string {
  return path
    .replace(/:id\b/g, '00000000-0000-4000-8000-000000000000')
    .replace(/:[A-Za-z][A-Za-z0-9_]*/g, 'x');
}

async function call(agent: AgentClient, method: string, path: string) {
  switch (method) {
    case 'GET':
      return agent.get(path);
    case 'POST':
      return agent.post(path, {});
    case 'PUT':
      return agent.put(path, {});
    case 'PATCH':
      return agent.patch(path, {});
    case 'DELETE':
      return agent.del(path);
    default:
      throw new Error(`unsupported method ${method}`);
  }
}

const NON_ADMIN_ROLES: FixtureRole[] = ['lead', 'member', 'viewer'];

let admin: AgentClient;
let lead: AgentClient;
let member: AgentClient;
let viewer: AgentClient;
const agentByRole = (): Record<FixtureRole, AgentClient> => ({
  admin,
  lead,
  member,
  viewer,
  rival: member, // unused here
});

beforeAll(async () => {
  await truncateAll();
});

beforeEach(async () => {
  await truncateAll();
  await seedAuthFixture();
  admin = await loginAgent('admin');
  lead = await loginAgent('lead');
  member = await loginAgent('member');
  viewer = await loginAgent('viewer');
});

afterAll(async () => {
  await disconnect();
});

describe('authz matrix — drift detection', () => {
  it('classifies every /api/v1/admin/ route in the manifest', () => {
    const unclassified = ADMIN_MANIFEST_ROUTES.filter((r) => !classify(r.path)).map(
      (r) => `${r.method} ${r.path}`,
    );
    expect(
      unclassified,
      `Unclassified admin route(s) — add an ADMIN_ROUTE_POLICY entry: ${unclassified.join(', ')}`,
    ).toEqual([]);
  });

  it('covers every admin group with at least one admin-policy route', () => {
    // Sanity: the admin policy buckets are actually exercised by the manifest,
    // so the matrix below is meaningful (no dead classifications).
    const adminPrefixes = ADMIN_ROUTE_POLICY.filter((e) => e.policy === 'admin');
    for (const entry of adminPrefixes) {
      const hit = ADMIN_MANIFEST_ROUTES.some((r) => r.path.startsWith(entry.prefix));
      expect(hit, `policy prefix ${entry.prefix} matches no manifest route`).toBe(true);
    }
  });
});

describe('authz matrix — admin-only endpoints', () => {
  // Only the role-gated admin routes (skip the bootstrap setup group).
  const adminOnly = ADMIN_MANIFEST_ROUTES.filter((r) => classify(r.path)?.policy === 'admin');

  it('has a non-empty admin-only route set', () => {
    expect(adminOnly.length).toBeGreaterThan(20);
  });

  for (const route of adminOnly) {
    const path = concretePath(route.path);
    const label = `${route.method} ${route.path}`;

    it(`admin reaches handler (not 403): ${label}`, async () => {
      const res = await call(admin, route.method, path);
      // Admin must clear the role guard. The handler may then 400/404/500 on the
      // bogus id/empty body — all acceptable; we only forbid the 403 role wall
      // and the 401 unauth wall.
      expect(res.status, `${label} returned ${res.status} for admin`).not.toBe(403);
      expect(res.status, `${label} returned ${res.status} for admin`).not.toBe(401);
    });

    for (const role of NON_ADMIN_ROLES) {
      it(`${role} is forbidden (403): ${label}`, async () => {
        const client = agentByRole()[role];
        const res = await call(client, route.method, path);
        expect(res.status, `${label} returned ${res.status} for ${role}`).toBe(403);
      });
    }
  }
});

describe('authz matrix — memory-layer write gate', () => {
  // org → admin only; team → admin + team_lead; user → all roles.
  const cases: Array<{ layer: string; allowed: FixtureRole[]; denied: FixtureRole[] }> = [
    { layer: 'org', allowed: ['admin'], denied: ['lead', 'member', 'viewer'] },
    { layer: 'team', allowed: ['admin', 'lead'], denied: ['member', 'viewer'] },
    { layer: 'user', allowed: ['admin', 'lead', 'member', 'viewer'], denied: [] },
  ];

  for (const c of cases) {
    for (const role of c.allowed) {
      it(`${role} may write ${c.layer}-layer memory`, async () => {
        const client = agentByRole()[role];
        const res = await client.post('/api/v1/memory', {
          layer: c.layer,
          content: `${role} writing ${c.layer} layer`,
        });
        expect([200, 201], `expected create ok, got ${res.status}`).toContain(res.status);
      });
    }
    for (const role of c.denied) {
      it(`${role} is denied ${c.layer}-layer memory (403)`, async () => {
        const client = agentByRole()[role];
        const res = await client.post('/api/v1/memory', {
          layer: c.layer,
          content: `${role} attempting ${c.layer} layer`,
        });
        expect(res.status, `expected 403 for ${role}/${c.layer}`).toBe(403);
      });
    }
  }
});

describe('authz matrix — reads allowed for all roles', () => {
  const ALL_ROLES: FixtureRole[] = ['admin', 'lead', 'member', 'viewer'];

  for (const role of ALL_ROLES) {
    it(`${role} can GET /tasks`, async () => {
      const res = await agentByRole()[role].get('/api/v1/tasks/');
      expect(res.status).toBe(200);
    });
    it(`${role} can GET /memory`, async () => {
      const res = await agentByRole()[role].get('/api/v1/memory/');
      expect(res.status).toBe(200);
    });
  }
});
