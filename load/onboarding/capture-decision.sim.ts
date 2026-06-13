/**
 * Live sim — capture_decision OVER-EAGERNESS guard (#4, prompt-level).
 *
 * Verifies the prompt-level fix so the agent only records a decision that was
 * actually FINALIZED/committed, and does NOT fabricate a "deferred decision"
 * out of an explicitly unresolved/deferred debate.
 *
 *   POSITIVE: a clearly committed decision is stated mid-chat
 *             → a decision row should appear via GET /decisions.
 *   NEGATIVE: an explicitly unresolved / "let's revisit next sprint" debate
 *             → NO new decision row should appear.
 *
 * Each scenario uses a fresh session and we diff GET /decisions before/after,
 * so this works regardless of any pre-existing decisions in the org. The
 * agent runs on its real system prompt + tools + LLM — nothing is mocked.
 *
 * Requires: live API + worker + a configured LLM on the target instance.
 *   API_URL=http://localhost:8100/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/onboarding/capture-decision.sim.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8100/api/v1';
const PASSWORD = process.env.SIM_PASSWORD ?? 'changeme-Sim123!';
const REPLY_TIMEOUT_MS = 150_000;
const STAMP = Date.now().toString(36);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 320) => {
  const c = s.replace(/\s+/g, ' ').trim();
  return c.slice(0, n) + (c.length > n ? '…' : '');
};

interface DecisionRow {
  id: string;
  title: string;
  status?: string;
  sessionId?: string | null;
}

// ── Hearth client (cookie jar + double-submit CSRF) ──────────────────────────
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

  /** Register a fresh user (auto-logs-in, sets CSRF). Falls back to login if it already exists. */
  async registerOrLogin(email: string, name: string) {
    this.email = email;
    const reg = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    });
    if (reg.status === 201) {
      this.store(reg);
      return;
    }
    // Already exists (or registration disabled) — try login.
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 200) {
      throw new Error(`auth failed for ${email}: register=${reg.status} login=${res.status}`);
    }
    this.store(res);
  }

  async newSession(title: string): Promise<string> {
    const r = await this.req<{ data: { id: string } }>('POST', '/chat/sessions', { title });
    if (r.status !== 201 && r.status !== 200) throw new Error(`newSession failed: ${r.status}`);
    return r.body.data.id;
  }

  /** Send a user message and WAIT for Hearth's real assistant reply. */
  async ask(sessionId: string, content: string): Promise<string> {
    const msgs = () =>
      this.req<{ data: { messages: Array<{ role: string; content: string }> } }>(
        'GET',
        `/chat/sessions/${sessionId}`,
      );
    const before = (await msgs()).body.data.messages.filter((m) => m.role === 'assistant').length;
    const send = await this.req('POST', `/chat/sessions/${sessionId}/messages`, { content });
    if (send.status !== 202) return `[hearth send failed: ${send.status}]`;
    const start = Date.now();
    while (Date.now() - start < REPLY_TIMEOUT_MS) {
      await sleep(2500);
      const all = (await msgs()).body.data.messages.filter((m) => m.role === 'assistant');
      if (all.length > before && all[all.length - 1]?.content) return all[all.length - 1].content;
    }
    return '[hearth: no reply within timeout]';
  }

  /** All non-archived decisions visible to this user. */
  async listDecisions(): Promise<DecisionRow[]> {
    const r = await this.req<{ data: DecisionRow[] }>('GET', '/decisions?limit=100');
    return Array.isArray(r.body?.data) ? r.body.data : [];
  }
}

// A captured decision is detected by its DB row carrying our session id, OR
// (defensively) by a new decision id appearing after the conversation.
async function decisionsForSession(h: Hearth, sessionId: string, baselineIds: Set<string>): Promise<DecisionRow[]> {
  const all = await h.listDecisions();
  return all.filter((d) => d.sessionId === sessionId || !baselineIds.has(d.id));
}

interface Scenario {
  kind: 'positive' | 'negative';
  title: string;
  turns: string[];
}

const SCENARIOS: Scenario[] = [
  {
    kind: 'positive',
    title: 'Committed decision (should capture)',
    turns: [
      "We've been comparing Postgres and DynamoDB for the new events store. I want to lock this in now.",
      "Final call: we're going with Postgres. The team agreed in standup — we value transactional consistency and our ops team already runs Postgres. We've decided, this is settled.",
      'Great, thanks. Anything else you need from me to record that?',
    ],
  },
  {
    kind: 'negative',
    title: 'Deferred / unresolved debate (must NOT capture)',
    turns: [
      "We're debating whether to add a Redis cache in front of the search service. Some folks think it'd help latency.",
      "Honestly I'm torn — maybe Redis, maybe we just leave it with no cache for now. Let's not decide today. Let's table it and revisit next sprint once we have load numbers. We haven't decided anything.",
      "Yeah let's just leave it open for now. We'll circle back.",
    ],
  },
];

async function runScenario(h: Hearth, s: Scenario): Promise<{ ok: boolean; detail: string }> {
  console.log(`\n${'═'.repeat(78)}\n▶ [${s.kind.toUpperCase()}] ${s.title}\n${'═'.repeat(78)}`);

  const baseline = await h.listDecisions();
  const baselineIds = new Set(baseline.map((d) => d.id));

  const sessionId = await h.newSession(`capture-decision ${s.kind} ${STAMP}`);
  for (const turn of s.turns) {
    console.log(`\n  🧑 ${trim(turn)}`);
    const reply = await h.ask(sessionId, turn);
    console.log(`  🔥 ${trim(reply)}`);
  }

  // Give any async decision write a moment to land.
  await sleep(3000);

  const captured = await decisionsForSession(h, sessionId, baselineIds);
  const capturedTitles = captured.map((d) => `"${d.title}" [${d.status ?? '?'}]`).join(', ') || '(none)';

  if (s.kind === 'positive') {
    const ok = captured.length >= 1;
    console.log(`  ➜ captured ${captured.length} decision(s): ${capturedTitles}`);
    return {
      ok,
      detail: ok
        ? `PASS positive — decision row appeared: ${capturedTitles}`
        : `FAIL positive — expected a decision row, found none`,
    };
  } else {
    const ok = captured.length === 0;
    console.log(`  ➜ captured ${captured.length} decision(s): ${capturedTitles}`);
    return {
      ok,
      detail: ok
        ? `PASS negative — no decision row from the deferred debate`
        : `FAIL negative — phantom decision captured: ${capturedTitles}`,
    };
  }
}

async function main() {
  console.log(`capture_decision over-eagerness sim against ${API}`);
  const h = new Hearth();
  await h.registerOrLogin(`capture-decision+${STAMP}@hearth.local`, 'Decision Sim User');

  const results: Array<{ ok: boolean; detail: string }> = [];
  for (const s of SCENARIOS) {
    results.push(await runScenario(h, s));
  }

  console.log(`\n${'═'.repeat(78)}\nRESULTS\n${'═'.repeat(78)}`);
  for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'} ${r.detail}`);

  const allOk = results.every((r) => r.ok);
  console.log(`\n${allOk ? '✅ ALL PASSED' : '❌ FAILURES PRESENT'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('sim failed:', e);
  process.exit(1);
});
