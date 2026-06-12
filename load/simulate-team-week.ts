/**
 * Collaborative team-week simulation — REAL multiplayer conversations.
 *
 * Unlike simulate-behavior.ts (one persona ↔ the agent, clean 2-turn Q&A), this
 * models how a small team actually works WITH an AI in a shared workspace:
 *
 *   - SHARED sessions where several teammates + the agent are in one thread —
 *     they @mention each other, disagree, and the agent tracks who said what.
 *   - SOLO threads that lean on the SHARED context built earlier in the week —
 *     "based on the Postgres decision we just made…" — so the agent has to
 *     navigate to prior decisions/tasks/people (the Person/Edge graph lights up).
 *   - Continuity ACROSS threads: a decision captured Monday is cited Thursday,
 *     and the weekly review has to reconcile a real conflict between them.
 *
 * 8 people across 3 teams (Engineering, Product, Design), ~5 interlocking
 * storylines, a simulated week of work. Every turn is a real agent call against
 * a live API+worker+LLM. Watch the threads unfold below.
 *
 * Requires: live API with the agent worker running and an LLM key configured.
 *   API_URL=http://localhost:8000/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/simulate-team-week.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';
const REPLY_TIMEOUT_MS = 150_000;

// ── HTTP client with a cookie jar + CSRF ─────────────────────────────────────
class Client {
  private cookies = new Map<string, string>();
  private csrf = '';
  email = '';
  id = '';
  name = '';

  private storeCookies(res: Response) {
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
    const me = await this.req<{ data: { id: string; name: string } }>('GET', '/auth/me');
    this.id = me.body.data.id;
    this.name = me.body.data.name;
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
const short = (s: unknown, n = 320) => {
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

async function getMessages(c: Client, sessionId: string): Promise<Msg[]> {
  return (await c.req<{ data: { messages: Msg[] } }>('GET', `/chat/sessions/${sessionId}`)).body.data.messages;
}

/** Create a SHARED (org-visible) session owned by `owner`, with `contributors` added. */
async function sharedSession(owner: Client, title: string, contributors: Client[]): Promise<string> {
  const res = await owner.req<{ data: { id: string } }>('POST', '/chat/sessions', { title });
  const id = res.body.data.id;
  await owner.req('PATCH', `/chat/sessions/${id}/visibility`, { visibility: 'org' });
  for (const c of contributors) {
    const r = await owner.req('POST', `/chat/sessions/${id}/collaborators`, { userId: c.id, role: 'contributor' });
    if (r.status >= 300) console.log(`     ⚠️  add collaborator ${c.email} → ${r.status}`);
  }
  console.log(`\n  ┌─ #shared “${title}”  (${owner.name} + ${contributors.map((c) => c.name).join(', ')})`);
  return id;
}

/** Create a private solo session. */
async function soloSession(owner: Client, title: string): Promise<string> {
  const res = await owner.req<{ data: { id: string } }>('POST', '/chat/sessions', { title });
  console.log(`\n  ┌─ (solo) “${title}”  (${owner.name})`);
  return res.body.data.id;
}

/** Post a message AS `c` and WAIT for the agent's next assistant reply. */
async function say(c: Client, sessionId: string, prompt: string): Promise<{ reply: string; lastId: string }> {
  console.log(`  │  🧑 ${c.name}: ${short(prompt, 260)}`);
  const before = (await getMessages(c, sessionId)).filter((m) => m.role === 'assistant').length;
  const send = await c.req<{ data: { messageId: string } }>('POST', `/chat/sessions/${sessionId}/messages`, { content: prompt });
  if (send.status !== 202) { console.log(`  │     ⚠️  send → ${send.status}`); return { reply: '', lastId: '' }; }

  const got = await poll(
    () => getMessages(c, sessionId),
    (msgs) => msgs.filter((m) => m.role === 'assistant').length > before &&
              !!msgs.filter((m) => m.role === 'assistant').slice(-1)[0]?.content,
    REPLY_TIMEOUT_MS,
  );
  if (!got) { console.log('  │     ⚠️  no AI reply within timeout'); return { reply: '', lastId: '' }; }
  const last = got.filter((m) => m.role === 'assistant').slice(-1)[0];
  console.log(`  │  🤖 Hearth: ${short(last.content, 360)}`);
  return { reply: last.content, lastId: last.id };
}

/** A teammate reacts to a message — small collaborative signal. */
async function react(c: Client, sessionId: string, messageId: string, emoji = '👍'): Promise<void> {
  if (!messageId) return;
  const r = await c.req('POST', `/chat/sessions/${sessionId}/messages/${messageId}/reactions`, { emoji });
  if (r.status < 300) console.log(`  │     ${emoji} ${c.name} reacted`);
}

const close = () => console.log('  └─────────────────────────────────────────────');

// ── storylines ───────────────────────────────────────────────────────────────
async function datastoreDecision(P: Record<string, Client>): Promise<void> {
  console.log('\n══ STORY 1 — Datastore decision (shared) → migration plan (solo) ══');
  const s = await sharedSession(P.engLead, 'Event store: Postgres vs DynamoDB', [P.cto, P.dev1]);
  await say(P.engLead, s, "We need to pick the datastore for the new event store: strong consistency, complex replay queries, and the team is deep in SQL. @Marcus @Sam let's decide together — Postgres or DynamoDB?");
  await say(P.cto, s, "I lean Postgres — strong consistency and we know SQL cold. My one worry is write throughput at peak load.");
  await say(P.dev1, s, "Agreed on Postgres, but operationally I'm nervous about replay query cost over a huge event table. Can the agent lay out the tradeoffs against both of those concerns?");
  const synth = await say(P.engLead, s, "Synthesize the tradeoffs — address Marcus's throughput worry and Sam's replay-cost concern specifically — then give a clear recommendation.");
  await react(P.dev1, s, synth.lastId);
  await say(P.engLead, s, "Good — let's go with Postgres. Capture this as a team decision, and remember that we've standardized on Postgres for primary storage.");
  close();

  // Solo follow-up that depends on the shared decision above.
  const m = await soloSession(P.dev1, 'Event store migration plan');
  await say(P.dev1, m, "Based on the Postgres decision we just made for the event store, draft a concrete migration plan and create a task for me for the first milestone.");
  close();
}

async function darkModeLaunch(P: Record<string, Client>): Promise<void> {
  console.log('\n══ STORY 2 — Dark mode launch (shared, disagreement, shared artifact) ══');
  const s = await sharedSession(P.pm1, 'Dark mode launch', [P.designer, P.dev2]);
  await say(P.pm1, s, "We launch dark mode next week. @Nina @Jordan let's build the launch checklist together — cover QA, docs, rollout, comms, rollback.");
  await say(P.designer, s, "On QA: we need explicit contrast and accessibility checks — that's bitten us before. Make it its own section, don't bury it.");
  await say(P.dev2, s, "And rollback has to be instant — a feature-flag kill switch, not a redeploy. Please call that out explicitly.");
  await say(P.pm1, s, "Fold Nina's accessibility QA section and Jordan's kill-switch rollback into a launch checklist artifact. Also remember: our launches always use a canary rollout, 5% → 25% → 100% over three days.");
  close();

  const m = await soloSession(P.designer, 'Dark mode empty-state copy');
  await say(P.designer, m, "For the dark mode launch, the tasks page empty state just says 'No tasks.' Give me three warmer options, each under 8 words.");
  close();
}

async function incidentEscalation(P: Record<string, Client>): Promise<void> {
  console.log('\n══ STORY 3 — Pool exhaustion: solo debugging → escalation → handoff ══');
  const solo = await soloSession(P.dev2, 'Connection pool exhausted under load');
  await say(P.dev2, solo, "Under load our API throws intermittent 'connection pool exhausted' errors with Prisma behind PgBouncer. What are the most likely causes and how do I investigate, concretely?");
  close();

  const s = await sharedSession(P.dev2, 'Prod incident: pool exhaustion', [P.engLead, P.dev1]);
  await say(P.dev2, s, "Escalating — pool exhaustion is hitting prod intermittently now. @Devin @Sam need your eyes. Prisma + PgBouncer, errors spike under load.");
  await say(P.engLead, s, "Check PgBouncer transaction mode vs Prisma's prepared statements first — classic mismatch. Agent, summarize the top hypotheses and give us a triage order.");
  await say(P.engLead, s, "Create a task to add connection-pool metrics and tune the pool size, and assign it to @Sam — Sam, you own this one.");
  close();
}

async function roadmapDebate(P: Record<string, Client>): Promise<void> {
  console.log('\n══ STORY 4 — Q3 roadmap (cross-team, references prior decisions) ══');
  const s = await sharedSession(P.productLead, 'Q3 roadmap: mobile vs platform', [P.cto, P.pm1, P.designer]);
  await say(P.productLead, s, "Q3 planning. @Marcus @Priya @Nina — do we bet on a mobile push or on platform/infra investment? Let's hash it out.");
  await say(P.cto, s, "Given we just standardized on Postgres and we're firefighting the pool incident, I want platform headroom — not all-in on mobile.");
  await say(P.pm1, s, "But per-seat pricing for the team tier lands best with mobile reach — that's our clearest growth lever this quarter.");
  await say(P.productLead, s, "Weigh this against the decisions we've already made this quarter, then recommend a split and capture the outcome as a decision.");
  close();
}

async function weeklyReview(P: Record<string, Client>): Promise<void> {
  console.log('\n══ STORY 5 — Meeting ingest → weekly decision review (CTO) ══');
  const transcript = [
    "Priya: Quick sync. First, mobile. Decision: we're going mobile-first for Q3 — it's the growth bet.",
    "Marcus: Noted, though that's in tension with the platform headroom we just talked about.",
    "Priya: Second, the nightly export keeps paging us. Decision: move the nightly export to a queue-backed job with retries by end of next sprint; Marcus owns it.",
    "Marcus: I'll add an alert if the export runs over 30 minutes.",
  ].join('\n');
  const ing = await P.cto.req('POST', '/meetings/ingest', {
    provider: 'granola', title: 'Weekly eng/product sync', transcript,
    participants: ['cto@hearth.local', 'product-lead@hearth.local'],
    meetingDate: new Date().toISOString(),
  });
  console.log(`  📝 meeting ingested (${ing.status}); giving extraction a few seconds…`);
  await sleep(8000);

  const s = await soloSession(P.cto, 'This week in decisions');
  await say(P.cto, s, "Summarize the key decisions captured across the team this week, and flag any that conflict with each other.");
  close();
}

// ── run ──────────────────────────────────────────────────────────────────────
const ROSTER: Record<string, string> = {
  cto: 'cto@hearth.local',
  engLead: 'eng-lead@hearth.local',
  dev1: 'dev1@hearth.local',
  dev2: 'dev2@hearth.local',
  dataAnalyst: 'data-analyst@hearth.local',
  productLead: 'product-lead@hearth.local',
  pm1: 'pm1@hearth.local',
  designer: 'designer@hearth.local',
};

async function main() {
  console.log(`Collaborative team-week simulation against ${API}`);
  console.log('Shared multi-person threads + solo threads that build on the shared context.\n');
  const t0 = Date.now();

  const P: Record<string, Client> = {};
  for (const [key, email] of Object.entries(ROSTER)) {
    const c = new Client();
    await c.login(email);
    P[key] = c;
  }
  console.log(`Logged in ${Object.keys(P).length} teammates across Engineering, Product, Design.`);

  await datastoreDecision(P);
  await darkModeLaunch(P);
  await incidentEscalation(P);
  await roadmapDebate(P);
  await weeklyReview(P);

  console.log(`\n✅ Team-week simulation complete in ${Math.round((Date.now() - t0) / 1000)}s.`);
}

main().catch((e) => { console.error('simulation failed:', e); process.exit(1); });
