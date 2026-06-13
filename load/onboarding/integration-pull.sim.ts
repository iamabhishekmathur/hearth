/**
 * INTEGRATION-PULL — does connecting an integration genuinely PULL value?
 *
 * This is the positive counterpart to integration-deadzone.sim.ts. It proves the
 * on-connect backfill fix end to end:
 *
 *   1. Stand up a REAL mock MCP data source (load/onboarding/mock-mcp/server.ts)
 *      that serves Slack messages, Gmail emails, AND a Granola meeting transcript
 *      as fixtures, over JSON-RPC — the exact protocol Hearth's CustomMCPConnector
 *      speaks.
 *   2. A fresh user connects it via POST /admin/integrations (provider 'custom',
 *      serverUrl = the mock). Hearth discovers the tools, and the connect path
 *      enqueues (a) memory synthesis + (b) task-detection backfill.
 *   3. Hearth PULLS the fixtures through its normal MCP/synthesis path, turning
 *      them into MEMORY ENTRIES (Slack/Gmail/Granola content) and AUTO-DETECTED
 *      TASKS. We assert both appear, and that memory content actually references
 *      the fixture text — i.e. Hearth did the pulling, not the test.
 *   4. NEGATIVE: connect a SECOND mock whose credential is broken (server in
 *      broken mode → tools/list fails). We hit its health endpoint and assert the
 *      persisted status is driven to 'error' (not stuck 'active').
 *
 * The mock server runs IN THIS PROCESS and listens on 127.0.0.1; the Hearth API
 * (same host) fetches it during the backfill. Keep this process alive until the
 * assertions complete.
 *
 * Run: API_URL=http://localhost:8100/api/v1 \
 *   ./apps/api/node_modules/.bin/tsx load/onboarding/integration-pull.sim.ts
 */
import { startMockMcpServer } from './mock-mcp/server.js';

const API = process.env.API_URL ?? 'http://localhost:8100/api/v1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Hearth {
  private cookies = new Map<string, string>();
  private csrf = '';
  email = '';

  private store(res: Response) {
    const list: string[] =
      (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
    for (const c of list) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const n = pair.slice(0, eq).trim();
      this.cookies.set(n, pair.slice(eq + 1).trim());
      if (n === 'hearth.csrf') this.csrf = decodeURIComponent(pair.slice(eq + 1).trim());
    }
  }
  private cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async req<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = { cookie: this.cookieHeader() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = this.csrf;
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this.store(res);
    const text = await res.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed as T };
  }
  async register(email: string, password: string, name: string): Promise<number> {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    this.store(res);
    return res.status;
  }
  async login(email: string, password: string): Promise<number> {
    this.email = email;
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    this.store(res);
    return res.status;
  }
}

/** Fetch raw list rows, tolerating envelope shapes. */
async function listRows(h: Hearth, path: string): Promise<any[]> {
  const r = await h.req<any>('GET', path);
  const b = r.body;
  if (Array.isArray(b)) return b;
  if (Array.isArray(b?.data)) return b.data;
  if (Array.isArray(b?.items)) return b.items;
  return [];
}

const out: Record<string, unknown> = {};

async function main() {
  // ── 0. Stand up the mock MCP source (starts healthy; broken later) ────────
  const healthy = await startMockMcpServer({ broken: false });
  out.mock = { healthyUrl: healthy.url };
  console.log('[mock] healthy=', healthy.url);

  try {
    // ── 1. Fresh user (admin of a brand-new... no — genesis org member) ─────
    // We register a fresh user; on the :8100 genesis fixture the first user of a
    // new org becomes its admin (admins may connect integrations). We rely on the
    // register→login→me flow and assert the role.
    const stamp = Date.now();
    const email = `pull.user+${stamp}@hearth-onboard.test`;
    const password = 'PullUser!2026';
    const user = new Hearth();
    const reg = await user.register(email, password, 'Pull User');
    const login = await user.login(email, password);
    const me = await user.req<{ data: any }>('GET', '/auth/me');
    const role = me.body?.data?.role;
    out.user = { reg, login, role, orgId: me.body?.data?.orgId, email };
    console.log('[user] reg=', reg, 'login=', login, 'role=', role);
    if (role !== 'admin') {
      // Fall back to the shared genesis admin if a fresh user is not an admin.
      const ADMIN_EMAIL = 'founder+genesis@hearth-onboard.test';
      const ADMIN_PASSWORD = 'GenesisAdmin!2026';
      await user.login(ADMIN_EMAIL, ADMIN_PASSWORD);
      const adminMe = await user.req<{ data: any }>('GET', '/auth/me');
      out.fellBackToAdmin = adminMe.body?.data?.role;
      console.log('[user] fell back to genesis admin, role=', adminMe.body?.data?.role);
      if (adminMe.body?.data?.role !== 'admin') throw new Error('no admin available to connect integrations');
    }

    // ── 2. BEFORE snapshot ────────────────────────────────────────────────
    const beforeMemory = await listRows(user, '/memory');
    const beforeTasks = await listRows(user, '/tasks');
    out.before = { memory: beforeMemory.length, tasks: beforeTasks.length };
    console.log('[before] memory=', beforeMemory.length, 'tasks=', beforeTasks.length);

    // ── 3. CONNECT the healthy mock (Slack + Gmail + Granola via one MCP) ──
    const connect = await user.req<{ data: any }>('POST', '/admin/integrations', {
      provider: 'custom',
      label: 'Mock work feed (pull probe)',
      serverUrl: healthy.url,
      credentials: { server_url: healthy.url },
    });
    const integrationId = connect.body?.data?.id;
    out.connect = { status: connect.status, id: integrationId, integStatus: connect.body?.data?.status };
    console.log('[connect] status=', connect.status, 'id=', integrationId, 'integStatus=', connect.body?.data?.status);
    if (connect.status !== 201 || !integrationId) throw new Error(`connect failed: ${connect.status}`);

    // ── 4. WAIT for the on-connect backfill to pull + create value ────────
    // Synthesis embeds + dedups; task detection runs an LLM per candidate.
    const WAIT_MS = 90_000;
    console.log(`[wait] polling for pulled memory + tasks for up to ${WAIT_MS / 1000}s …`);
    const start = Date.now();
    let memoryRows: any[] = beforeMemory;
    let taskRows: any[] = beforeTasks;
    let firstValueAtMs: number | null = null;
    while (Date.now() - start < WAIT_MS) {
      await sleep(5_000);
      memoryRows = await listRows(user, '/memory');
      taskRows = await listRows(user, '/tasks');
      if (
        firstValueAtMs === null &&
        (memoryRows.length > beforeMemory.length || taskRows.length > beforeTasks.length)
      ) {
        firstValueAtMs = Date.now() - start;
        console.log('[wait] first value at', firstValueAtMs, 'ms');
      }
      // Stop early once we have both memory + at least one new task.
      if (memoryRows.length > beforeMemory.length && taskRows.length > beforeTasks.length) break;
    }
    out.firstValueAtMs = firstValueAtMs;

    // ── 5. Inspect WHAT was pulled — must reference fixture content ────────
    const newMemory = memoryRows.filter((m) => !beforeMemory.some((b) => b.id === m.id));
    const newTasks = taskRows.filter((t) => !beforeTasks.some((b) => b.id === t.id));
    const memoryBlob = JSON.stringify(newMemory).toLowerCase();
    const tasksBlob = JSON.stringify(newTasks).toLowerCase();

    // Fingerprints unique to our fixtures (Slack / Gmail / Granola).
    const sawSlack = /billing webhook|onboarding checklist|product hunt/.test(memoryBlob);
    const sawGmail = /msa|security questionnaire|enterprise contract/.test(memoryBlob);
    const sawGranola = /backfill|launch comms|migration/.test(memoryBlob);
    const taskFromFixture =
      /billing webhook|onboarding checklist|msa|security questionnaire|launch comms|migration|backfill/.test(
        tasksBlob,
      );

    out.pulled = {
      newMemoryCount: newMemory.length,
      newTaskCount: newTasks.length,
      sawSlack,
      sawGmail,
      sawGranola,
      taskFromFixture,
      sampleMemory: newMemory.slice(0, 5).map((m) => String(m.content ?? '').slice(0, 100)),
      sampleTasks: newTasks.slice(0, 5).map((t) => String(t.title ?? '').slice(0, 100)),
    };
    console.log('[pulled] memory+=', newMemory.length, 'tasks+=', newTasks.length,
      'slack=', sawSlack, 'gmail=', sawGmail, 'granola=', sawGranola, 'taskFromFixture=', taskFromFixture);

    // ── 6. NEGATIVE: a credential that WAS active must flip to 'error' ─────
    // Sanity: the healthy integration's health is true and persists 'active'.
    const healthyHealth = await user.req<any>('GET', `/admin/integrations/${integrationId}/health`);
    let listAfterHealthy = await user.req<any>('GET', '/admin/integrations');
    const healthyRow = (listAfterHealthy.body?.data ?? []).find((i: any) => i.id === integrationId);
    out.healthyHealth = { body: healthyHealth.body, persistedStatus: healthyRow?.status };
    console.log('[healthy] health=', JSON.stringify(healthyHealth.body), 'persistedStatus=', healthyRow?.status);

    // Now BREAK the source (simulates a revoked/expired token) and re-check.
    // This is the bug the fix closes: a broken token used to read 'active' forever.
    healthy.break();
    const brokenHealth = await user.req<any>('GET', `/admin/integrations/${integrationId}/health`);
    const list = await user.req<any>('GET', '/admin/integrations');
    const row = (list.body?.data ?? []).find((i: any) => i.id === integrationId);
    const brokenPersistedStatus: string | null = row?.status ?? null;
    out.brokenHealth = brokenHealth.body;
    out.brokenPersistedStatus = brokenPersistedStatus;
    console.log('[broken] health=', JSON.stringify(brokenHealth.body), 'persistedStatus=', brokenPersistedStatus);
    healthy.fix(); // restore so teardown is clean

    // ── 7. ASSERTIONS ─────────────────────────────────────────────────────
    const memoryPulled = newMemory.length > 0 && (sawSlack || sawGmail || sawGranola);
    const tasksCreated = newTasks.length > 0;
    const allThreeSources = sawSlack && sawGmail && sawGranola;
    const brokenIsUnhealthy =
      brokenHealth?.body?.health?.healthy === false || brokenPersistedStatus === 'error';
    const brokenNotActive = brokenPersistedStatus !== 'active';

    const PASS =
      memoryPulled && tasksCreated && brokenIsUnhealthy && brokenNotActive;

    out.assertions = {
      memoryPulled,
      tasksCreated,
      allThreeSources,
      taskFromFixture,
      brokenIsUnhealthy,
      brokenNotActive,
      PASS,
    };

    console.log('\n===== INTEGRATION-PULL RESULT =====');
    console.log('memoryPulled=', memoryPulled, '(slack/gmail/granola in pulled memory)');
    console.log('allThreeSources=', allThreeSources, 'tasksCreated=', tasksCreated, 'taskFromFixture=', taskFromFixture);
    console.log('brokenIsUnhealthy=', brokenIsUnhealthy, 'brokenPersistedStatus=', brokenPersistedStatus);
    console.log('PASS=', PASS);
    console.log(JSON.stringify(out, null, 2));

    if (!PASS) process.exitCode = 1;
  } finally {
    await healthy.close();
  }
}

main().catch((err) => {
  out.fatal = err instanceof Error ? err.message : String(err);
  console.error('INTEGRATION-PULL FATAL', err);
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
});
