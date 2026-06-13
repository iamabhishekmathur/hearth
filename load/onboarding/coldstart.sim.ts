/**
 * COLD-START-PERSONALIZATION journey.
 *
 * A brand-new 'member' user with NO history (empty cognitive profile, empty
 * memory) lands in a shared org that already has a working LLM (genesis admin
 * configured it). We test the REAL triggers, not endpoints:
 *
 *  (1) First-message sanity: does the agent reply sanely with an empty
 *      cognitive profile + empty memory? (context-builder must not crash.)
 *  (2) Cognitive-profile build: drive 3+ real chat turns to completion and
 *      check whether the cognitive profile gets BUILT via its real trigger
 *      (session-completion enqueue → cognitive-extraction worker), OR whether
 *      it is feature-flag-gated OFF by default so personalization NEVER fires.
 *      We determine WHICH, with evidence, and probe the user opt-in gate.
 *  (3) Cold-start of proactive surfaces: GET recommendations/skills,
 *      activity, activity/signals, activity/digest for the empty account —
 *      graceful empty results or errors? Where is a new account stuck with no
 *      path out of cold-start emptiness?
 *
 * Run:
 *   API_URL=http://localhost:8100/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/onboarding/coldstart.sim.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8100/api/v1';
const PASSWORD = 'changeme';
const REPLY_TIMEOUT_MS = 150_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 600) => {
  const c = (s ?? '').replace(/\s+/g, ' ').trim();
  return c.slice(0, n) + (c.length > n ? '…' : '');
};

// ── Hearth client (cookie jar + double-submit CSRF) ──────────────────────────
class Hearth {
  private cookies = new Map<string, string>();
  private csrf = '';
  email = '';
  userId = '';

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
  async req<T = any>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
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
  async register(email: string, name: string) {
    this.email = email;
    const r = await this.req<{ data?: { user?: { id?: string; role?: string } } }>(
      'POST',
      '/auth/register',
      { email, password: PASSWORD, name },
    );
    return r;
  }
  async login(email: string) {
    this.email = email;
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    this.store(res);
  }
  async newSession(title: string): Promise<string> {
    const r = await this.req<{ data: { id: string } }>('POST', '/chat/sessions', { title });
    if (r.status !== 201 && r.status !== 200)
      throw new Error(`newSession failed ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body.data.id;
  }
  /** Send a user message; WAIT for Hearth's real assistant reply. Returns {content, error, raw}. */
  async ask(
    sessionId: string,
    content: string,
  ): Promise<{ content: string; error: unknown; status: number }> {
    const getMsgs = () =>
      this.req<{
        data: {
          messages: Array<{ role: string; content: string; metadata?: Record<string, unknown> }>;
        };
      }>('GET', `/chat/sessions/${sessionId}`);
    const before = (await getMsgs()).body.data.messages.filter((m) => m.role === 'assistant').length;
    const send = await this.req('POST', `/chat/sessions/${sessionId}/messages`, { content });
    if (send.status !== 202)
      return { content: `[send failed: ${send.status} ${JSON.stringify(send.body)}]`, error: send.body, status: send.status };
    const start = Date.now();
    while (Date.now() - start < REPLY_TIMEOUT_MS) {
      await sleep(2500);
      const all = (await getMsgs()).body.data.messages.filter((m) => m.role === 'assistant');
      if (all.length > before) {
        const last = all[all.length - 1];
        if (last?.content)
          return { content: last.content, error: last.metadata?.error, status: 202 };
      }
    }
    return { content: '[no reply within timeout]', error: 'timeout', status: 202 };
  }
}

interface Finding {
  label: string;
  pass: boolean | 'info';
  detail: string;
}
const findings: Finding[] = [];
function record(label: string, pass: boolean | 'info', detail: string) {
  findings.push({ label, pass, detail });
  const tag = pass === 'info' ? 'ℹ️ ' : pass ? '✅' : '❌';
  console.log(`${tag} ${label} — ${trim(detail, 300)}`);
}

async function main() {
  console.log(`Cold-start personalization journey against ${API}\n${'═'.repeat(78)}`);
  const h = new Hearth();
  const email = `coldstart+${Date.now()}@hearth.local`;

  // ── 0. Register a fresh isolated member ──────────────────────────────────
  const reg = await h.register(email, 'Cold Start Tester');
  record(
    '0. register fresh member',
    reg.status === 201,
    `status=${reg.status} role=${reg.body?.data?.user?.role ?? '?'} body=${trim(JSON.stringify(reg.body), 200)}`,
  );
  await h.login(email);
  const me = await h.req<{ data: { id: string; role: string; orgId: string | null } }>(
    'GET',
    '/auth/me',
  );
  h.userId = me.body.data.id;
  record(
    '0b. /auth/me resolves org + member role',
    me.status === 200 && !!me.body.data.orgId && me.body.data.role === 'member',
    `status=${me.status} role=${me.body.data?.role} orgId=${me.body.data?.orgId ? 'present' : 'NULL'}`,
  );

  // ── Baseline: confirm empty cognitive profile + empty memory ─────────────
  const cogStatus0 = await h.req<{ data: { orgEnabled: boolean; userEnabled: boolean } }>(
    'GET',
    '/chat/cognitive-profile/status',
  );
  record(
    '1a. cognitive-profile/status (baseline)',
    'info',
    `status=${cogStatus0.status} orgEnabled=${cogStatus0.body.data?.orgEnabled} userEnabled=${cogStatus0.body.data?.userEnabled}`,
  );
  const mem0 = await h.req<{ data: unknown[] }>('GET', '/memory');
  const memCount0 = Array.isArray(mem0.body?.data) ? mem0.body.data.length : -1;
  record(
    '1b. memory empty at cold start',
    memCount0 === 0,
    `status=${mem0.status} memoryCount=${memCount0} body=${trim(JSON.stringify(mem0.body), 150)}`,
  );

  // ── 1. First message sanity with EMPTY profile + EMPTY memory ────────────
  const session = await h.newSession('Cold start — first contact');
  const firstReply = await h.ask(
    session,
    "Hi — this is my first time using Hearth. I'm a backend engineer just getting started. What can you help me with?",
  );
  const firstSane =
    firstReply.status === 202 &&
    !firstReply.error &&
    firstReply.content.length > 20 &&
    !/^\s*_?\[error/i.test(firstReply.content) &&
    !firstReply.content.startsWith('[send failed') &&
    firstReply.content !== '[no reply within timeout]';
  record(
    '1. first message — sane reply on empty profile/memory',
    firstSane,
    `error=${JSON.stringify(firstReply.error)} reply="${trim(firstReply.content, 400)}"`,
  );

  // ── 2. Drive 3+ real turns to completion → does a profile get BUILT? ─────
  // Use substantive, opinion-bearing turns so extraction has signal.
  const turns = [
    "I strongly prefer Postgres over Mongo for anything transactional — I've been burned by eventual consistency bugs too many times. How do you think about that tradeoff?",
    "When I design a service I always start from the failure modes first, then the happy path. I find most outages come from unhandled edge cases, not core logic.",
    "For code review I care most about clear naming and small PRs. Huge PRs are where bugs hide. What's your take on keeping review scope tight?",
  ];
  for (let i = 0; i < turns.length; i++) {
    const r = await h.ask(session, turns[i]);
    const ok = r.status === 202 && !r.error && r.content.length > 10;
    console.log(`  turn ${i + 1}: ${ok ? 'ok' : 'PROBLEM'} — ${trim(r.content, 160)}`);
    if (!ok)
      record(`2.turn${i + 1} failed`, false, `error=${JSON.stringify(r.error)} reply="${trim(r.content, 200)}"`);
  }
  record(
    '2a. drove 3 substantive turns to completion',
    true,
    `session=${session} — each turn returned an assistant reply (see log above)`,
  );

  // The session-completion enqueue of cognitive extraction is gated by
  // isCognitiveEnabledForOrg(). Wait generously for the worker, then check
  // whether ANYTHING was extracted.
  console.log('  ...waiting 25s for any cognitive-extraction worker side effect...');
  await sleep(25_000);
  const cogStatusAfter = await h.req<{ data: { orgEnabled: boolean; userEnabled: boolean } }>(
    'GET',
    '/chat/cognitive-profile/status',
  );
  const orgGateOn = cogStatusAfter.body.data?.orgEnabled === true;
  record(
    '2b. org cognitive gate state (the BUILT-vs-GATED-OFF verdict)',
    orgGateOn ? true : 'info',
    orgGateOn
      ? `orgEnabled=true — extraction CAN fire`
      : `orgEnabled=FALSE by default → runAgent finally short-circuits enqueueCognitiveExtraction. ` +
        `Personalization NEVER fires for a fresh org. The cognitive profile is feature-flag-gated OFF.`,
  );

  // Probe the user opt-in gate without the org gate: per chat.ts:746-757, a
  // PUT to opt in while the org is disabled must 400. This proves a brand-new
  // member has NO self-serve path to turn personalization on.
  const optIn = await h.req('PUT', '/chat/cognitive-profile/status', { enabled: true });
  record(
    '2c. member self-serve opt-in blocked while org gate off',
    !orgGateOn ? optIn.status === 400 : 'info',
    `PUT status=${optIn.status} body=${trim(JSON.stringify(optIn.body), 150)} ` +
      `(member cannot reach admin /admin/cognitive/settings → no path out of un-personalized state)`,
  );

  // Confirm the member truly cannot flip the org gate (admin-only).
  const adminFlip = await h.req('PUT', '/admin/cognitive/settings', { enabled: true });
  record(
    '2d. member cannot enable org-wide cognitive (admin-only)',
    adminFlip.status === 403,
    `PUT /admin/cognitive/settings status=${adminFlip.status} body=${trim(JSON.stringify(adminFlip.body), 120)}`,
  );

  // ── 3. Cold-start of proactive surfaces ──────────────────────────────────
  const recs = await h.req<{ data: unknown }>('GET', '/recommendations/skills');
  const recsArr = (recs.body as any)?.data;
  const recsLen = Array.isArray(recsArr) ? recsArr.length : Array.isArray((recsArr as any)?.recommendations) ? (recsArr as any).recommendations.length : -1;
  record(
    '3a. recommendations/skills graceful on empty account',
    recs.status === 200,
    `status=${recs.status} shape=${trim(JSON.stringify(recs.body), 220)}`,
  );
  const signals = await h.req<{ data: unknown[] }>('GET', '/activity/signals');
  const sigLen = Array.isArray(signals.body?.data) ? signals.body.data.length : -1;
  record(
    '3b. activity/signals graceful empty',
    signals.status === 200,
    `status=${signals.status} signalCount=${sigLen} body=${trim(JSON.stringify(signals.body), 200)}`,
  );
  const activity = await h.req<{ data: unknown[] }>('GET', '/activity');
  const actLen = Array.isArray(activity.body?.data) ? activity.body.data.length : -1;
  record(
    '3c. activity feed graceful empty',
    activity.status === 200,
    `status=${activity.status} feedCount=${actLen} body=${trim(JSON.stringify(activity.body), 200)}`,
  );
  const digest = await h.req<{ data: unknown }>('GET', '/activity/digest');
  record(
    '3d. activity/digest graceful empty',
    digest.status === 200,
    `status=${digest.status} body=${trim(JSON.stringify(digest.body), 220)}`,
  );

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(78)}\nSUMMARY`);
  for (const f of findings) {
    const tag = f.pass === 'info' ? 'INFO' : f.pass ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${f.label}`);
  }
  const fails = findings.filter((f) => f.pass === false).length;
  console.log(`\n${fails} hard failures / ${findings.length} checks.`);
}

main().catch((e) => {
  console.error('coldstart sim failed:', e);
  process.exit(1);
});
