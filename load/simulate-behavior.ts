/**
 * Behavioral simulation — REAL users, REAL prompts, REAL AI replies.
 *
 * Unlike prisma/sim-seed.ts (which inserts lorem text directly), this drives the
 * product the way people actually use it: it logs in as the seeded personas,
 * sends genuine human prompts over the API, WAITS for Hearth's agent to reply,
 * and lets the real side effects happen — tasks created from chat, memory stored,
 * decisions captured, a routine that actually runs, a meeting that gets
 * decision-extracted, and a task the agent plans + executes.
 *
 * Driving these real flows IS the test (it's how we found the worker-crash and
 * the digest model:'default' bugs). Every prompt + the AI's actual reply is
 * printed so you can watch the conversation happen.
 *
 * Requires: a live API with the agent worker running and an LLM key configured.
 *   API_URL=http://localhost:8000/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/simulate-behavior.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';
const REPLY_TIMEOUT_MS = 120_000;

// ── tiny HTTP client with a cookie jar + CSRF ────────────────────────────────
class Client {
  private cookies = new Map<string, string>();
  private csrf = '';
  email = '';

  private storeCookies(res: Response) {
    // Node 18+ exposes getSetCookie(); fall back to the combined header.
    const list: string[] =
      (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
    for (const c of list) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      this.cookies.set(name, value);
      if (name === 'hearth.csrf') this.csrf = decodeURIComponent(value);
    }
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async login(email: string): Promise<void> {
    this.email = email;
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    this.storeCookies(res);
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
    this.storeCookies(res);
    let parsed: unknown = undefined;
    const text = await res.text();
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
    return { status: res.status, body: parsed as T };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (s: unknown, n = 220) => {
  const str = typeof s === 'string' ? s : s == null ? '' : JSON.stringify(s);
  const clean = str.replace(/\s+/g, ' ').trim();
  return clean.slice(0, n) + (clean.length > n ? '…' : '');
};

async function poll<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs: number, intervalMs = 2500): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (ok(v)) return v;
    await sleep(intervalMs);
  }
  return null;
}

interface Msg { id: string; role: string; content: string; createdAt: string }

/** Send a real prompt to a session and WAIT for the agent's assistant reply. */
async function say(c: Client, sessionId: string, prompt: string): Promise<string> {
  console.log(`\n  🧑 ${c.email.split('@')[0]}: ${short(prompt, 300)}`);
  const before = (await c.req<{ data: { messages: Msg[] } }>('GET', `/chat/sessions/${sessionId}`)).body.data.messages;
  const beforeAssistant = before.filter((m) => m.role === 'assistant').length;

  const send = await c.req<{ data: { messageId: string } }>('POST', `/chat/sessions/${sessionId}/messages`, { content: prompt });
  if (send.status !== 202) { console.log(`     ⚠️  send returned ${send.status}`); return ''; }

  const got = await poll(
    async () => (await c.req<{ data: { messages: Msg[] } }>('GET', `/chat/sessions/${sessionId}`)).body.data.messages,
    (msgs) => msgs.filter((m) => m.role === 'assistant').length > beforeAssistant &&
              !!msgs.filter((m) => m.role === 'assistant').slice(-1)[0]?.content,
    REPLY_TIMEOUT_MS,
  );
  if (!got) { console.log('     ⚠️  no AI reply within timeout'); return ''; }
  const reply = got.filter((m) => m.role === 'assistant').slice(-1)[0].content;
  console.log(`  🤖 Hearth: ${short(reply, 400)}`);
  return reply;
}

async function newSession(c: Client, title: string): Promise<string> {
  const res = await c.req<{ data: { id: string } }>('POST', '/chat/sessions', { title });
  return res.body.data.id;
}

// ── personas ─────────────────────────────────────────────────────────────────
async function engLeadScenario(): Promise<void> {
  const c = new Client(); await c.login('eng-lead@hearth.local');
  console.log('\n══ Engineering Lead — architecture decision + a routine ══');
  const s = await newSession(c, 'Event store: Postgres vs DynamoDB');
  await say(c, s, "We're choosing the datastore for our new event store. We need strong consistency, fairly complex queries for replay, and the team is deep in SQL already. Weigh Postgres against DynamoDB and give me a recommendation.");
  await say(c, s, "Agreed, let's go with Postgres. Please capture this as a team decision and remember that we standardized on Postgres for primary storage.");

  console.log('\n  → creating a real routine and running it now…');
  const r = await c.req<{ data: { id: string } }>('POST', '/routines', {
    name: 'Stale PR sweep', prompt: 'List any open pull requests that look stale and summarize what is blocking each.',
    schedule: '0 9 * * 1-5', delivery: { channels: ['in_app'] },
  });
  const runId = r.body.data.id;
  await c.req('POST', `/routines/${runId}/run-now`, {});
  const runs = await poll(
    async () => (await c.req<{ data: Array<{ status: string; output?: string }> }>('GET', `/routines/${runId}/runs`)).body.data,
    (rs) => rs.some((x) => x.status === 'success' || x.status === 'failed'),
    REPLY_TIMEOUT_MS,
  );
  const run = runs?.find((x) => x.status === 'success' || x.status === 'failed');
  console.log(`  ⚙️  routine run → ${run?.status ?? 'timeout'}${run?.output ? `: ${short(run.output, 200)}` : ''}`);
}

async function devScenario(): Promise<void> {
  const c = new Client(); await c.login('dev1@hearth.local');
  console.log('\n══ Developer — debugging help → task → plan → execute ══');
  const s = await newSession(c, 'Connection pool exhausted under load');
  await say(c, s, "Under load our API throws intermittent 'connection pool exhausted' errors. We use Prisma against Postgres behind PgBouncer. What are the most likely causes and how should I investigate, concretely?");
  await say(c, s, "Helpful. Create a task for me to add connection-pool metrics and tune the pool size, and note the leading hypotheses in its description.");

  // Find the task the agent created for this user, then drive it through planning + execution.
  await sleep(3000);
  const tasks = (await c.req<{ data: Array<{ id: string; title: string; status: string }> }>('GET', '/tasks?parentOnly=true').catch(() => ({ body: { data: [] } } as any))).body.data ?? [];
  const task = tasks.find((t) => /pool|connection/i.test(t.title));
  if (!task) { console.log('  ⚠️  no task found from the conversation (agent may not have created one)'); return; }
  console.log(`  📋 task created by agent: "${task.title}" (${task.status})`);
  if (task.status === 'auto_detected') { await c.req('PATCH', `/tasks/${task.id}`, { status: 'backlog' }); }
  await c.req('PATCH', `/tasks/${task.id}`, { status: 'planning' });
  console.log('  → moved to planning; waiting for the agent to plan…');
  const planned = await poll(
    async () => (await c.req<{ data: { status: string } }>('GET', `/tasks/${task.id}`)).body.data,
    (t) => t.status !== 'planning',
    REPLY_TIMEOUT_MS,
  );
  console.log(`  🗂️  task after planning → ${planned?.status ?? 'timeout'}`);
}

async function pmScenario(): Promise<void> {
  const c = new Client(); await c.login('pm1@hearth.local');
  console.log('\n══ Product Manager — launch checklist + a remembered preference ══');
  const s = await newSession(c, 'Dark mode launch');
  await say(c, s, "We're launching dark mode next week. Draft a launch checklist covering QA, docs, rollout, comms, and rollback.");
  await say(c, s, "Please remember that our launches always use a canary rollout: 5% → 25% → 100% over three days. Apply that to the rollout section.");
}

async function designerScenario(): Promise<void> {
  const c = new Client(); await c.login('designer@hearth.local');
  console.log('\n══ Designer — empty-state copy ══');
  const s = await newSession(c, 'Tasks empty-state copy');
  await say(c, s, "The tasks page empty state just says 'No tasks.' Give me three warmer, more encouraging one-line options.");
  await say(c, s, "I like the second one — tighten it to under 8 words.");
}

async function ctoScenario(): Promise<void> {
  const c = new Client(); await c.login('cto@hearth.local');
  console.log('\n══ CTO — ingest a real meeting → decisions extracted, then review ══');
  const transcript = [
    "Priya: Let's lock the datastore question. Engineering wants Postgres for the event store.",
    "Marcus: Agreed — strong consistency and the team knows SQL. Decision: we'll use Postgres for the event store, not DynamoDB.",
    "Priya: Good. Second item — we keep getting paged on the nightly export. Decision: we'll move the nightly export to a queue-backed job with retries by end of next sprint. Marcus owns it.",
    "Marcus: I'll also add an alert if the export runs longer than 30 minutes.",
    "Priya: Last thing — pricing. Decision: we'll launch per-seat pricing for the team tier, revisit usage-based in Q4.",
  ].join('\n');
  const before = (await c.req<{ data: any[] }>('GET', '/decisions?limit=1')).body.data?.length ?? 0;
  const ing = await c.req<{ data: { id: string } }>('POST', '/meetings/ingest', {
    provider: 'granola', title: 'Weekly eng sync', transcript,
    participants: ['cto@hearth.local', 'eng-lead@hearth.local'],
    meetingDate: new Date().toISOString(),
  });
  console.log(`  📝 meeting ingested (${ing.status}); waiting for decision extraction…`);
  const after = await poll(
    async () => (await c.req<{ data: any[] }>('GET', '/decisions?limit=50')).body.data ?? [],
    (d) => d.length > before,
    REPLY_TIMEOUT_MS,
  );
  console.log(`  ⚖️  decisions after extraction: ${after?.length ?? '?'} (was ${before})`);
  if (after) for (const d of after.slice(0, 4)) console.log(`     • ${short((d as any).title, 100)}`);

  const s = await newSession(c, 'This week in decisions');
  await say(c, s, "Summarize the key engineering decisions captured this week and flag whether any of them conflict with each other.");
}

// ── run ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Behavioral simulation against ${API}`);
  console.log('Each turn is a real agent call — watch the conversations below.\n');
  const t0 = Date.now();
  // Sequential for clarity (you can read the conversations as they happen).
  await engLeadScenario();
  await devScenario();
  await pmScenario();
  await designerScenario();
  await ctoScenario();
  console.log(`\n✅ Behavioral simulation complete in ${Math.round((Date.now() - t0) / 1000)}s.`);
}

main().catch((e) => { console.error('simulation failed:', e); process.exit(1); });
