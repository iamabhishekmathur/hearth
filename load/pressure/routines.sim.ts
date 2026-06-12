/**
 * Routines pressure test — drives the REAL Hearth API + workers.
 *
 * Scenarios:
 *  1. Devin (eng-lead): stale-PR sweep with {{team}} param, run-now team=Payments.
 *     -> A1 success+non-empty result, A2 'Payments' interpolated, A3 lastRunStatus/At, A4 tokenCount null
 *  2. Dana (product-lead): announcement routine WITH approval checkpoint.
 *     -> B1 should pause as awaiting_approval + surface a pending approval; B2 resolve resumes.
 *  3. Sam (dev1): malformed cron rejected (C1); valid routine still runs (C2);
 *     check /notifications before/after a completed in_app routine (C3 gap).
 *
 * Run:
 *   API_URL=http://localhost:8000/api/v1 ./apps/api/node_modules/.bin/tsx load/pressure/routines.sim.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';
const RUN_TIMEOUT_MS = 180_000;

// ── Hearth client (cookie jar + CSRF) — copied from load/simulate-llm-dialogue.ts ──
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
    const res = await fetch(`${API}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    this.store(res);
    const text = await res.text();
    let parsed: unknown;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
    return { status: res.status, body: parsed as T };
  }
  async login(email: string) {
    this.email = email;
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    this.store(res);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 280) => { const c = String(s ?? '').replace(/\s+/g, ' ').trim(); return c.slice(0, n) + (c.length > n ? '…' : ''); };

interface Run { id: string; status: string; output?: { result?: string } | null; error?: string | null; durationMs?: number | null; tokenCount?: number | null; summary?: string | null; startedAt?: string; completedAt?: string; }

async function latestRun(h: Hearth, routineId: string): Promise<Run | undefined> {
  const r = await h.req<{ data: Run[] }>('GET', `/routines/${routineId}/runs`);
  return r.body?.data?.[0];
}

/** Poll runs until the latest run leaves 'running' (or there is a terminal run), up to timeout. */
async function waitForRun(h: Hearth, routineId: string, sinceCount: number): Promise<Run | undefined> {
  const start = Date.now();
  while (Date.now() - start < RUN_TIMEOUT_MS) {
    await sleep(3000);
    const r = await h.req<{ data: Run[]; total: number }>('GET', `/routines/${routineId}/runs`);
    const runs = r.body?.data ?? [];
    if (runs.length > sinceCount) {
      const latest = runs[0];
      if (latest.status !== 'running') return latest;
      // run exists but still running — keep waiting
    }
  }
  return latestRun(h, routineId);
}

const findings: Record<string, string> = {};
function record(id: string, msg: string) { findings[id] = msg; console.log(`  [${id}] ${msg}`); }

// ── Scenario 1 ────────────────────────────────────────────────────────────────
async function scenario1() {
  console.log(`\n${'═'.repeat(78)}\n▶ S1: Devin — stale-PR sweep with {{team}} param (run team=Payments)\n${'═'.repeat(78)}`);
  const h = new Hearth();
  await h.login('eng-lead@hearth.local');

  const create = await h.req<{ data: { id: string } }>('POST', '/routines', {
    name: 'Stale PR sweep',
    description: 'On-demand sweep of stale PRs for a given team',
    prompt: 'You are doing a stale-PR sweep for the {{team}} team. Write a SHORT (3-4 sentence) status note that explicitly names the {{team}} team and describes how a stale-PR sweep for the {{team}} team would be reported. Begin your note with the literal team name.',
    schedule: '0 9 * * 1-5',
    delivery: { channels: ['in_app'] },
    parameters: [{ name: 'team', type: 'string', label: 'Team', required: true }],
  });
  console.log(`  create -> ${create.status}`);
  if (create.status !== 201) { record('S1', `FAIL create status ${create.status}: ${trim(JSON.stringify(create.body))}`); return; }
  const id = create.data?.id ?? (create.body as any).data.id;

  const before = (await h.req<{ data: Run[] }>('GET', `/routines/${id}/runs`)).body?.data?.length ?? 0;
  const run = await h.req('POST', `/routines/${id}/run-now`, { parameterValues: { team: 'Payments' } });
  console.log(`  run-now -> ${run.status} ${trim(JSON.stringify(run.body), 120)}`);

  const latest = await waitForRun(h, id, before);
  if (!latest) { record('A1', 'FAIL: no run row appeared within timeout'); return; }
  const result = latest.output?.result ?? '';
  console.log(`  run.status=${latest.status} durationMs=${latest.durationMs} tokenCount=${latest.tokenCount}`);
  console.log(`  result: ${trim(result, 400)}`);

  // A1
  if (latest.status === 'success' && result.length > 0) record('A1', `PASS: status=success, result len=${result.length}`);
  else record('A1', `FAIL: status=${latest.status}, result len=${result.length}, error=${trim(String(latest.error))}`);

  // A2 — interpolation
  const hasPayments = /Payments/.test(result) || /Payments/.test(latest.summary ?? '');
  if (hasPayments) record('A2', `PASS: 'Payments' present in result/summary (interpolation worked)`);
  else record('A2', `FAIL: 'Payments' NOT found in result/summary. result starts: ${trim(result, 160)}`);

  // A3 — lastRunStatus/At
  const det = await h.req<{ data: { lastRunStatus?: string; lastRunAt?: string } }>('GET', `/routines/${id}`);
  const lrs = det.body?.data?.lastRunStatus; const lra = det.body?.data?.lastRunAt;
  const recent = lra ? (Date.now() - new Date(lra).getTime()) < 5 * 60_000 : false;
  if (lrs === 'success' && recent) record('A3', `PASS: lastRunStatus=success, lastRunAt=${lra} (recent)`);
  else record('A3', `FAIL: lastRunStatus=${lrs}, lastRunAt=${lra} recent=${recent}`);

  // A4 — durationMs>0, tokenCount null (gap)
  const dur = latest.durationMs ?? 0;
  record('A4', `durationMs=${dur} (>0=${dur > 0}); tokenCount=${latest.tokenCount === null ? 'null (GAP: worker never records token usage)' : latest.tokenCount}`);
  (scenario1 as any).routineId = id;
}

// ── Scenario 2 — approval checkpoint ─────────────────────────────────────────
async function scenario2() {
  console.log(`\n${'═'.repeat(78)}\n▶ S2: Dana — announcement routine WITH an approval checkpoint\n${'═'.repeat(78)}`);
  const h = new Hearth();
  await h.login('product-lead@hearth.local');

  const create = await h.req<{ data: { id: string; checkpoints?: unknown } }>('POST', '/routines', {
    name: 'Customer announcement draft',
    description: 'Drafts a customer-facing announcement; should pause for sign-off',
    prompt: 'Draft a short, friendly customer-facing announcement (4-5 sentences) for a new feature called Saved Views.',
    schedule: '0 10 * * 1',
    delivery: { channels: ['in_app'] },
    checkpoints: [{
      name: 'PM sign-off',
      description: 'Product lead must approve before the announcement is delivered',
      position: 0,
      approverPolicy: { type: 'creator' },
    }],
  });
  console.log(`  create -> ${create.status}; checkpoints echoed: ${JSON.stringify((create.body as any)?.data?.checkpoints)}`);
  if (create.status !== 201) { record('B1', `FAIL create status ${create.status}: ${trim(JSON.stringify(create.body))}`); return; }
  const id = (create.body as any).data.id;

  const approvalsBefore = await h.req<{ data: any[] }>('GET', '/approvals');
  console.log(`  /approvals before run: ${approvalsBefore.status} count=${approvalsBefore.body?.data?.length ?? 0}`);

  const before = (await h.req<{ data: Run[] }>('GET', `/routines/${id}/runs`)).body?.data?.length ?? 0;
  await h.req('POST', `/routines/${id}/run-now`, {});

  // Watch for awaiting_approval specifically: poll several times early.
  let sawAwaiting = false; let observedStatuses: string[] = [];
  const start = Date.now();
  let latest: Run | undefined;
  while (Date.now() - start < RUN_TIMEOUT_MS) {
    await sleep(2500);
    const runs = (await h.req<{ data: Run[] }>('GET', `/routines/${id}/runs`)).body?.data ?? [];
    if (runs.length > before) {
      latest = runs[0];
      observedStatuses.push(latest.status);
      if (latest.status === 'awaiting_approval') sawAwaiting = true;
      if (latest.status === 'success' || latest.status === 'failed') break;
    }
  }
  console.log(`  run status trail: ${[...new Set(observedStatuses)].join(' -> ')}`);

  const approvalsAfter = await h.req<{ data: any[] }>('GET', '/approvals');
  const pendingCount = approvalsAfter.body?.data?.length ?? 0;
  console.log(`  /approvals after run: ${approvalsAfter.status} count=${pendingCount}`);

  if (sawAwaiting && pendingCount > 0) {
    record('B1', `PASS: run paused as awaiting_approval AND ${pendingCount} pending approval(s) surfaced`);
    // B2 — resolve and check resume
    const apprId = approvalsAfter.body.data[0].id;
    const resolve = await h.req('POST', `/approvals/${apprId}/resolve`, { decision: 'approved' });
    console.log(`  resolve -> ${resolve.status}`);
    const resumed = await waitForRun(h, id, before - 1);
    if (resumed?.status === 'success') record('B2', `PASS: after resolve, run reached success`);
    else record('B2', `FAIL: after resolve, run status=${resumed?.status}`);
  } else {
    record('B1', `FAIL (GAP): never saw awaiting_approval (statuses=${[...new Set(observedStatuses)].join('/')}), pendingApprovals=${pendingCount}. ` +
      `Checkpoint was accepted+stored at create but the worker never reads checkpoints/creates an approval — run went straight to ${latest?.status}.`);
    record('B2', `INCONCLUSIVE: no approval was ever created (blocked by B1), so resolve→resume cannot be exercised.`);
  }
}

// ── Scenario 3 — malformed cron + notification discoverability ───────────────
async function scenario3() {
  console.log(`\n${'═'.repeat(78)}\n▶ S3: Sam — malformed cron rejected; valid routine runs; check notification bell\n${'═'.repeat(78)}`);
  const h = new Hearth();
  await h.login('dev1@hearth.local');

  // C1 — malformed cron
  const bad = await h.req('POST', '/routines', {
    name: 'Fat-fingered cron routine',
    prompt: 'Summarize open bugs.',
    schedule: 'not a cron at all',
    delivery: { channels: ['in_app'] },
  });
  console.log(`  bad-cron create -> ${bad.status}: ${trim(JSON.stringify(bad.body), 160)}`);
  if (bad.status === 400 && /cron/i.test(JSON.stringify(bad.body))) record('C1', `PASS: malformed cron rejected at route (400, "${(bad.body as any)?.error})"`);
  else record('C1', `FAIL: expected 400 cron rejection, got ${bad.status}: ${trim(JSON.stringify(bad.body))}`);

  // Notifications BEFORE
  const notifBefore = await h.req<{ data: { items: any[]; unreadCount: number } }>('GET', '/notifications');
  const beforeCount = notifBefore.body?.data?.items?.length ?? 0;
  const beforeUnread = notifBefore.body?.data?.unreadCount ?? 0;
  console.log(`  /notifications before: items=${beforeCount} unread=${beforeUnread}`);

  // C2 — valid routine still runs to success
  const good = await h.req<{ data: { id: string } }>('POST', '/routines', {
    name: 'Open bug digest',
    prompt: 'Write a 2-sentence digest acknowledging this is the open-bug digest routine. Keep it short.',
    schedule: '0 8 * * *',
    delivery: { channels: ['in_app'] },
  });
  if (good.status !== 201) { record('C2', `FAIL create good routine: ${good.status}`); return; }
  const id = (good.body as any).data.id;
  const before = (await h.req<{ data: Run[] }>('GET', `/routines/${id}/runs`)).body?.data?.length ?? 0;
  await h.req('POST', `/routines/${id}/run-now`, {});
  const latest = await waitForRun(h, id, before);
  console.log(`  good routine run.status=${latest?.status} resultLen=${latest?.output?.result?.length ?? 0}`);
  if (latest?.status === 'success' && (latest.output?.result?.length ?? 0) > 0)
    record('C2', `PASS: valid routine ran to success despite prior bad-cron attempt (queue not poisoned)`);
  else record('C2', `FAIL: good routine status=${latest?.status}, error=${trim(String(latest?.error))}`);

  // C3 — notifications AFTER a completed in_app routine
  await sleep(3000); // give delivery a beat
  const notifAfter = await h.req<{ data: { items: any[]; unreadCount: number } }>('GET', '/notifications');
  const afterCount = notifAfter.body?.data?.items?.length ?? 0;
  const afterUnread = notifAfter.body?.data?.unreadCount ?? 0;
  const newItems = (notifAfter.body?.data?.items ?? []).filter((i: any) =>
    /routine/i.test(JSON.stringify(i)) && /Open bug digest|routine_result|completed/i.test(JSON.stringify(i)));
  console.log(`  /notifications after: items=${afterCount} unread=${afterUnread}; routine-result rows=${newItems.length}`);
  if (afterCount > beforeCount && newItems.length > 0)
    record('C3', `PASS: completed in_app routine wrote a discoverable notification row`);
  else record('C3', `FAIL (GAP): no new notification row after a completed in_app routine ` +
    `(items ${beforeCount}->${afterCount}, unread ${beforeUnread}->${afterUnread}). ` +
    `deliver() emits only a transient socket 'notification' event; it never calls notification-service.notify(), so the result is absent from the bell.`);
}

async function main() {
  console.log(`Routines pressure test against ${API}`);
  const t0 = Date.now();
  await scenario1();
  await scenario2();
  await scenario3();
  console.log(`\n${'═'.repeat(78)}\nSUMMARY (${Math.round((Date.now() - t0) / 1000)}s)\n${'═'.repeat(78)}`);
  for (const [k, v] of Object.entries(findings)) console.log(`  ${k}: ${v}`);
}

main().catch((e) => { console.error('sim failed:', e); process.exit(1); });
