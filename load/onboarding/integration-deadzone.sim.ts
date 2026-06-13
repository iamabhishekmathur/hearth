/**
 * INTEGRATION-DEAD-ZONE — does connecting a first integration produce ANY value?
 *
 * Hypothesis (to confirm or refute): connecting an integration is a pure
 * config write. It wraps a connector in the MCP gateway but enqueues NOTHING —
 * no memory synthesis, no work-intake/task detection, no backfill. Memory
 * synthesis is a DAILY worker (24h repeatable + on worker startup) and is the
 * ONLY thing that reads integration data — but it is never fired on connect.
 * Work-intake only fires from an inbound Slack webhook, never registered on
 * connect. So a brand-new user gets ZERO immediate value from their first
 * integration: a silent activation dead-zone.
 *
 * We TEST THE TRIGGER, not the endpoint:
 *   - snapshot a fresh member's GET /memory, /tasks, /activity BEFORE connect
 *   - the admin connects a real integration (POST /admin/integrations, slack,
 *     dummy creds) — the genuine user entry point
 *   - re-snapshot the SAME GETs AFTER a wait window
 *   - assert the gap: nothing new appears; integration just sits 'active'
 *   - NEGATIVE: confirm no synthesis/intake fired by the connect itself
 *
 * Org + LLM are shared (configured by GENESIS). We register our own member so
 * the value checks are isolated to a brand-new user. The integration is
 * org-scoped, so the admin connects it and synthesis (if it ran) would feed
 * any user in the org.
 *
 * Run: API_URL=http://localhost:8100/api/v1 \
 *   ./apps/api/node_modules/.bin/tsx load/onboarding/integration-deadzone.sim.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8100/api/v1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 240) => {
  const c = (s ?? '').replace(/\s+/g, ' ').trim();
  return c.slice(0, n) + (c.length > n ? '…' : '');
};

// Genesis admin (created by genesis.sim.ts). Org + LLM are shared.
const ADMIN_EMAIL = 'founder+genesis@hearth-onboard.test';
const ADMIN_PASSWORD = 'GenesisAdmin!2026';

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

/** Count rows behind a list endpoint, tolerating multiple envelope shapes. */
async function listCount(h: Hearth, path: string): Promise<{ status: number; count: number; ids: string[] }> {
  const r = await h.req<any>('GET', path);
  const b = r.body;
  let arr: any[] = [];
  if (Array.isArray(b)) arr = b;
  else if (Array.isArray(b?.data)) arr = b.data;
  else if (Array.isArray(b?.items)) arr = b.items;
  else if (Array.isArray(b?.decisions)) arr = b.decisions;
  const ids = arr.map((x) => x?.id).filter(Boolean);
  return { status: r.status, count: arr.length, ids };
}

const out: Record<string, unknown> = {};

async function main() {
  const member = new Hearth();
  const admin = new Hearth();

  // ── Register an isolated fresh member (brand-new user in the shared org) ──
  const stamp = Date.now();
  const memberEmail = `deadzone.member+${stamp}@hearth-onboard.test`;
  const memberPassword = 'DeadzoneMember!2026';
  const regStatus = await member.register(memberEmail, memberPassword, 'Deadzone Member');
  const memberLogin = await member.login(memberEmail, memberPassword);
  const memberMe = await member.req<{ data: any }>('GET', '/auth/me');
  out.register = {
    regStatus,
    memberLogin,
    role: memberMe.body?.data?.role,
    orgId: memberMe.body?.data?.orgId,
    email: memberEmail,
  };
  console.log('[reg] register=', regStatus, 'login=', memberLogin, 'role=', memberMe.body?.data?.role);

  // ── Admin login (shared genesis admin — only admins may connect integrations) ──
  const adminLogin = await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const adminMe = await admin.req<{ data: any }>('GET', '/auth/me');
  out.admin = { adminLogin, role: adminMe.body?.data?.role, orgId: adminMe.body?.data?.orgId };
  console.log('[admin] login=', adminLogin, 'role=', adminMe.body?.data?.role);
  if (adminMe.body?.data?.role !== 'admin') throw new Error('admin login did not yield admin role');

  // ── BEFORE: the brand-new user's value surfaces (the real entry points) ──
  const before = {
    memory: await listCount(member, '/memory'),
    tasks: await listCount(member, '/tasks'),
    activity: await listCount(member, '/activity'),
    decisions: await listCount(member, '/decisions'),
  };
  out.before = before;
  console.log('[before] memory=', before.memory.count, 'tasks=', before.tasks.count,
    'activity=', before.activity.count, 'decisions=', before.decisions.count);

  // Admin sees the same org-scoped integration list (should be empty pre-connect).
  const integBefore = await listCount(admin, '/admin/integrations');
  out.integrationsBefore = integBefore;
  console.log('[before] admin integrations=', integBefore.count);

  // ── ACTION: connect the FIRST integration (the real user trigger) ────────
  // Slack with a dummy bot_token. In dev+dummy creds this wraps a DevMock and
  // reports 'active'; with a real-looking token the slack connector may error.
  // Either way the point is: what does the connect CHAIN cause downstream?
  const connect = await admin.req<{ data: any }>('POST', '/admin/integrations', {
    provider: 'slack',
    label: 'First Slack (deadzone probe)',
    credentials: { bot_token: 'xoxb-DUMMY-deadzone-probe-not-a-real-token' },
  });
  out.connect = { status: connect.status, body: connect.body };
  const integrationId = connect.body?.data?.id;
  console.log('[connect] status=', connect.status, 'id=', integrationId,
    'integStatus=', connect.body?.data?.status);

  // Confirm it persisted + health (does connecting register a poller/webhook?).
  const integAfterConnect = await admin.req<any>('GET', '/admin/integrations');
  out.integrationsAfterConnect = integAfterConnect.body?.data;
  let health: any = null;
  if (integrationId) {
    const h = await admin.req<any>('GET', `/admin/integrations/${integrationId}/health`);
    health = { status: h.status, body: h.body };
  }
  out.health = health;
  console.log('[connect] persisted integrations=',
    (integAfterConnect.body?.data ?? []).map((i: any) => `${i.provider}:${i.status}`).join(','),
    'health=', JSON.stringify(health?.body));

  // ── WAIT WINDOW: give any enqueued job a chance to run and surface value ──
  // Synthesis is a DAILY worker; if connect enqueued an immediate job, value
  // would appear here. If nothing appears, the dead-zone is confirmed.
  const WAIT_MS = 45_000;
  console.log(`[wait] polling member value surfaces for ${WAIT_MS / 1000}s …`);
  const waitStart = Date.now();
  let firstChangeAtMs: number | null = null;
  while (Date.now() - waitStart < WAIT_MS) {
    await sleep(5_000);
    const m = await listCount(member, '/memory');
    const t = await listCount(member, '/tasks');
    if (m.count > before.memory.count || t.count > before.tasks.count) {
      firstChangeAtMs = Date.now() - waitStart;
      console.log('[wait] CHANGE detected at', firstChangeAtMs, 'ms: memory=', m.count, 'tasks=', t.count);
      break;
    }
  }
  out.firstChangeAtMs = firstChangeAtMs;

  // ── AFTER: re-snapshot the exact same surfaces ───────────────────────────
  const after = {
    memory: await listCount(member, '/memory'),
    tasks: await listCount(member, '/tasks'),
    activity: await listCount(member, '/activity'),
    decisions: await listCount(member, '/decisions'),
  };
  out.after = after;
  console.log('[after] memory=', after.memory.count, 'tasks=', after.tasks.count,
    'activity=', after.activity.count, 'decisions=', after.decisions.count);

  // ── ASSERTIONS ───────────────────────────────────────────────────────────
  const memoryDelta = after.memory.count - before.memory.count;
  const tasksDelta = after.tasks.count - before.tasks.count;
  const activityDelta = after.activity.count - before.activity.count;
  const decisionsDelta = after.decisions.count - before.decisions.count;

  // ATTRIBUTION: memory + tasks are user-scoped to our brand-new member and are
  // the surfaces integration synthesis / work-intake feed. decisions + activity
  // are ORG-scoped on this SHARED throwaway org, so concurrent sims create
  // ambient rows there — any delta is noise unless it references our Slack
  // integration. Inspect the new decision rows for any integration/slack link.
  const decAfter = await member.req<any>('GET', '/decisions');
  const decRows: any[] = Array.isArray(decAfter.body?.data)
    ? decAfter.body.data
    : Array.isArray(decAfter.body?.decisions)
      ? decAfter.body.decisions
      : Array.isArray(decAfter.body)
        ? decAfter.body
        : [];
  const newDecisionIds = after.decisions.ids.filter((id) => !before.decisions.ids.includes(id));
  const newDecisionRows = decRows.filter((r) => newDecisionIds.includes(r?.id));
  const integrationLinkedDecisions = newDecisionRows.filter((r) =>
    /slack|integration|gmail|backfill/i.test(JSON.stringify(r ?? {})),
  );
  out.newDecisionTitles = newDecisionRows.map((r) => trim(r?.title ?? '', 80));
  out.integrationLinkedDecisionCount = integrationLinkedDecisions.length;

  const connectSucceeded = connect.status === 201 && !!integrationId;
  // The dead-zone is about the brand-new USER getting value. memory + tasks are
  // user-scoped and never moved; org-scoped decision/activity deltas are
  // attributable to concurrent sims (no integration linkage) → noise.
  const userValueProduced = memoryDelta > 0 || tasksDelta > 0;
  const deadzoneConfirmed =
    connectSucceeded &&
    memoryDelta === 0 &&
    tasksDelta === 0 &&
    integrationLinkedDecisions.length === 0 &&
    firstChangeAtMs === null;

  out.assertions = {
    connectSucceeded,
    integrationStatus: connect.body?.data?.status,
    memoryDelta,
    tasksDelta,
    activityDelta,
    decisionsDelta,
    integrationLinkedDecisionCount: integrationLinkedDecisions.length,
    orgNoiseNote:
      decisionsDelta > 0 && integrationLinkedDecisions.length === 0
        ? 'org-scoped decision delta is ambient noise from concurrent sims; NOT caused by connect'
        : 'no org-scoped delta',
    userValueProduced,
    deadzoneConfirmed,
  };
  console.log('\n===== DEAD-ZONE RESULT =====');
  console.log('connectSucceeded=', connectSucceeded, 'integrationStatus=', connect.body?.data?.status);
  console.log('memoryDelta=', memoryDelta, 'tasksDelta=', tasksDelta,
    'activityDelta=', activityDelta, 'decisionsDelta=', decisionsDelta);
  console.log('DEAD-ZONE CONFIRMED=', deadzoneConfirmed,
    '(connect produced ZERO immediate value, no job surfaced in', WAIT_MS / 1000, 's)');
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  out.fatal = err instanceof Error ? err.message : String(err);
  console.error('DEAD-ZONE FATAL', err);
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
});
