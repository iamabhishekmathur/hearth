/**
 * VERIFICATION sim for FIX webhook-graph (P0).
 *
 * Drives the now-reachable POST /webhooks/ingest/:urlToken end-to-end and
 * verifies, via the new authenticated GET /graph routes (and a Prisma probe
 * for ground truth), that an external actionable signal becomes a Task AND
 * lands the navigation graph (Person + produced_by + discussed_in).
 *
 * Run (cwd = apps/api):
 *   API_URL=http://localhost:8000/api/v1 ./node_modules/.bin/tsx \
 *     load-pressure/webhook-graph-verify.impl.ts
 */
import { createHmac } from 'crypto';
import { prisma } from '../src/lib/prisma.js';
import { loadProviders } from '../src/llm/provider-loader.js';

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const results: { assertion: string; status: 'pass' | 'fail' | 'inconclusive'; observed: string }[] = [];
function assert(assertion: string, status: 'pass' | 'fail' | 'inconclusive', observed: string) {
  results.push({ assertion, status, observed });
  console.log(`[${status.toUpperCase()}] ${assertion}\n    ${observed}`);
}

class Hearth {
  private cookies = new Map<string, string>();
  private csrf = '';
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
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    this.store(res);
  }
}

async function rawPost(path: string, rawBody: string, headers: Record<string, string>) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers, body: rawBody });
  const text = await res.text();
  let parsed: unknown;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
  return { status: res.status, body: parsed };
}

function signSlack(secret: string, ts: string, body: string) {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
}

async function main() {
  const ADMIN = 'admin@hearth.local';
  const h = new Hearth();
  await h.login(ADMIN);
  await loadProviders();

  const me = await prisma.user.findFirst({ where: { email: ADMIN }, select: { id: true, team: { select: { orgId: true } } } });
  const orgId = me!.team!.orgId!;
  const run = Date.now().toString(36);
  const slackUserId = `U_INGEST_${run}`;
  const threadId = `1718999999.${run}`;
  const channel = 'C_ENG_ALERTS';
  const actionableText = `@marcus please fix the nightly export job that keeps failing — we need it before Friday's board demo`;

  // Create endpoint via API
  const created = await h.req<{ data: { id: string; urlToken: string; plainSecret: string } }>(
    'POST', '/routines/webhook-endpoints', { provider: 'slack' });
  const urlToken = created.body?.data?.urlToken;
  const plainSecret = created.body?.data?.plainSecret;
  assert('webhook endpoint created via API', urlToken ? 'pass' : 'fail', `status ${created.status} urlToken=${urlToken?.slice(0, 10)}`);
  if (!urlToken) { await finish(); return; }

  // ── 1. ACTIONABLE ingest → reachable (CSRF exempt) ────────────────────────
  const ts1 = Math.floor(Date.now() / 1000).toString();
  const body1 = JSON.stringify({
    type: 'event_callback', event_id: `Ev_${run}`, team_id: 'T_X',
    event: { type: 'message', user: slackUserId, text: actionableText, channel, ts: threadId, thread_ts: threadId, client_msg_id: `cmid_${run}` },
  });
  const ing1 = await rawPost(`/webhooks/ingest/${urlToken}`, body1, {
    'content-type': 'application/json', 'x-slack-request-timestamp': ts1, 'x-slack-signature': signSlack(plainSecret, ts1, body1),
  });
  assert('POST /webhooks/ingest reachable (not blocked by CSRF)', ing1.status === 200 ? 'pass' : 'fail',
    `status ${ing1.status} body=${JSON.stringify(ing1.body)}`);

  // detection is async after the 200 ack; poll
  let task: { id: string } | null = null;
  for (let i = 0; i < 25; i++) {
    await sleep(3000);
    task = await prisma.task.findFirst({ where: { orgId, sourceRef: { path: ['messageId'], equals: `cmid_${run}` } }, select: { id: true } });
    if (task) break;
  }
  assert('actionable ingest → Task auto-created', task ? 'pass' : 'fail', task ? `task ${task.id}` : 'no task after ~75s');

  if (task) {
    // Person via GET /graph/persons
    const personsResp = await h.req<{ data: { id: string; slackUserId: string }[] }>('GET', `/graph/persons?slackUserId=${slackUserId}`);
    const person = personsResp.body?.data?.[0];
    assert('Person upserted (read via GET /graph/persons)', person ? 'pass' : 'fail',
      person ? `person ${person.id} slackUserId=${person.slackUserId}` : `none (status ${personsResp.status})`);

    // Edges via GET /graph/edges
    const edgesResp = await h.req<{ data: { kind: string; toType: string; toId: string }[] }>(
      'GET', `/graph/edges?fromType=task&fromId=${task.id}`);
    const edges = edgesResp.body?.data ?? [];
    const kinds = new Set(edges.map((e) => `${e.kind}:${e.toType}`));
    assert('produced_by edge task→person landed (read via GET /graph/edges)',
      kinds.has('produced_by:person') ? 'pass' : 'fail',
      `edges=[${edges.map((e) => `${e.kind}→${e.toType}`).join(', ')}]`);
    assert('discussed_in edge task→external_ref landed (read via GET /graph/edges)',
      kinds.has('discussed_in:external_ref') ? 'pass' : 'fail',
      `edges=[${edges.map((e) => `${e.kind}→${e.toType}`).join(', ')}]`);

    // Navigability via GET /graph/navigate
    const nav = await h.req<{ data: { nodes: { type: string }[] } }>('GET', `/graph/navigate?type=task&id=${task.id}&depth=2`);
    const navTypes = new Set((nav.body?.data?.nodes ?? []).map((n) => n.type));
    assert('graph navigable from task (person + external_ref reachable)',
      navTypes.has('person') && navTypes.has('external_ref') ? 'pass' : 'fail',
      `nodes reached: [${[...navTypes].join(', ')}]`);
  }

  // ── 2. NON-actionable ingest → NO task ────────────────────────────────────
  const nonActUser = `U_DANA_${run}`;
  const ts2 = Math.floor(Date.now() / 1000).toString();
  const body2 = JSON.stringify({
    type: 'event_callback', event_id: `Ev2_${run}`, team_id: 'T_X',
    event: { type: 'message', user: nonActUser, text: `thanks team, great work! 🎉 proud of how launch day went`, channel, ts: `1718000000.${run}`, client_msg_id: `cmid_non_${run}` },
  });
  const ing2 = await rawPost(`/webhooks/ingest/${urlToken}`, body2, {
    'content-type': 'application/json', 'x-slack-request-timestamp': ts2, 'x-slack-signature': signSlack(plainSecret, ts2, body2),
  });
  assert('non-actionable ingest accepted (200)', ing2.status === 200 ? 'pass' : 'fail', `status ${ing2.status}`);
  await sleep(12000);
  const nonTask = await prisma.task.findFirst({ where: { orgId, sourceRef: { path: ['messageId'], equals: `cmid_non_${run}` } }, select: { id: true } });
  assert('non-actionable ingest → NO Task created', !nonTask ? 'pass' : 'fail', nonTask ? `WRONGLY created ${nonTask.id}` : 'no task');
  const strayPerson = await prisma.person.findFirst({ where: { orgId, slackUserId: nonActUser } });
  assert('non-actionable ingest does NOT pollute graph with a Person', !strayPerson ? 'pass' : 'fail',
    strayPerson ? `stray person ${strayPerson.id}` : 'no person');

  // ── 3. DUPLICATE actionable ingest → exactly one task ─────────────────────
  // Distinct delivery id + messageId so event-dedup doesn't short-circuit; the
  // intake-deduplicator must catch the identical title.
  const ts3 = Math.floor(Date.now() / 1000).toString();
  const body3 = JSON.stringify({
    type: 'event_callback', event_id: `Ev3_${run}`, team_id: 'T_X',
    event: { type: 'message', user: slackUserId, text: actionableText, channel, ts: `1718888888.${run}`, thread_ts: `1718888888.${run}`, client_msg_id: `cmid_dup_${run}` },
  });
  const ing3 = await rawPost(`/webhooks/ingest/${urlToken}`, body3, {
    'content-type': 'application/json', 'x-slack-request-timestamp': ts3, 'x-slack-signature': signSlack(plainSecret, ts3, body3),
  });
  assert('duplicate ingest accepted (200)', ing3.status === 200 ? 'pass' : 'fail', `status ${ing3.status}`);
  await sleep(15000);
  const dupTask = await prisma.task.findFirst({ where: { orgId, sourceRef: { path: ['messageId'], equals: `cmid_dup_${run}` } }, select: { id: true } });
  assert('duplicate actionable ingest → NO second Task (intake dedup holds)',
    !dupTask ? 'pass' : 'fail',
    !dupTask ? 'second identical signal correctly deduped (no new task)' : `WRONGLY created second task ${dupTask.id}`);

  await finish();
}

async function finish() {
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const inc = results.filter((r) => r.status === 'inconclusive').length;
  console.log(`\n════════ RESULTS: ${pass} pass / ${fail} fail / ${inc} inconclusive ════════`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error('SIM ERROR', e); try { await prisma.$disconnect(); } catch {} process.exit(1); });
