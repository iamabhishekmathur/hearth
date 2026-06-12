/**
 * Two-LLM dialogue — a test-user LLM talks to the REAL Hearth agent.
 *
 * This is different from simulate-team-week.ts, where the human turns are
 * hardcoded strings. Here BOTH sides are live LLMs:
 *
 *   ┌─ test-user LLM (OpenAI / GPT) ─┐         ┌─ Hearth agent (its real ─┐
 *   │ given a persona + a goal,      │  ──►    │ system prompt, tools,    │
 *   │ reads Hearth's ACTUAL reply,   │         │ memory, real LLM call)   │
 *   │ and writes the next user turn  │  ◄──    │ — nothing mocked         │
 *   └────────────────────────────────┘         └──────────────────────────┘
 *
 * The test-user LLM never sees Hearth's system prompt — it only sees what a
 * real user sees (Hearth's chat replies). It keeps going until its goal is met
 * (it emits <END>) or a turn cap is hit. So the conversation is emergent, not
 * scripted: Hearth's responses genuinely steer where the user goes next.
 *
 * Hearth runs on its default provider (Claude); the test user runs on OpenAI —
 * two distinct models, so it's unmistakably a dialogue, not an echo.
 *
 * Requires: live API + worker + an LLM key for Hearth, and OPENAI_API_KEY for
 * the test-user side.
 *   API_URL=http://localhost:8000/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/simulate-llm-dialogue.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const TEST_USER_MODEL = process.env.TEST_USER_MODEL ?? 'gpt-4o';
const REPLY_TIMEOUT_MS = 150_000;
const MAX_TURNS = 7;

if (!OPENAI_KEY) {
  console.error('OPENAI_API_KEY is required for the test-user LLM.');
  process.exit(1);
}

// ── Hearth client (cookie jar + CSRF) ────────────────────────────────────────
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
  async newSession(title: string): Promise<string> {
    return (await this.req<{ data: { id: string } }>('POST', '/chat/sessions', { title })).body.data.id;
  }
  /** Send a user message and WAIT for Hearth's real assistant reply. */
  async ask(sessionId: string, content: string): Promise<string> {
    const msgs = () => this.req<{ data: { messages: Array<{ role: string; content: string }> } }>('GET', `/chat/sessions/${sessionId}`);
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
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 380) => { const c = s.replace(/\s+/g, ' ').trim(); return c.slice(0, n) + (c.length > n ? '…' : ''); };

// ── Test-user LLM (OpenAI, direct — never sees Hearth's system prompt) ────────
interface OAIMsg { role: 'system' | 'user' | 'assistant'; content: string }

async function testUserTurn(system: string, history: OAIMsg[]): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: TEST_USER_MODEL, temperature: 0.8, max_tokens: 400, messages: [{ role: 'system', content: system }, ...history] }),
  });
  if (!res.ok) throw new Error(`test-user LLM error ${res.status}: ${trim(await res.text(), 200)}`);
  const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices[0].message.content.trim();
}

function personaSystem(name: string, role: string, goal: string): string {
  return [
    `You are ${name}, a ${role}. You are chatting with "Hearth", an AI work assistant your team uses.`,
    `Behave like a real person in a work chat: natural, concise (1-4 sentences), specific. React to what Hearth actually says — push back, ask follow-ups, give the details it asks for, or move on.`,
    `Your goal for this conversation: ${goal}`,
    `Do NOT narrate or describe yourself. Output ONLY your chat message — the literal text you'd type to Hearth.`,
    `When your goal is met or the conversation would naturally wrap up, end your final message with the token <END> on its own.`,
  ].join('\n');
}

// ── A scenario: one test-user LLM ↔ the real Hearth agent ────────────────────
interface Scenario { email: string; name: string; role: string; goal: string; sessionTitle: string }

async function runDialogue(s: Scenario): Promise<void> {
  console.log(`\n${'═'.repeat(78)}\n▶ ${s.name} (${s.role}) — goal: ${s.goal}\n${'═'.repeat(78)}`);
  const hearth = new Hearth();
  await hearth.login(s.email);
  const sessionId = await hearth.newSession(s.sessionTitle);
  const system = personaSystem(s.name, s.role, s.goal);

  const history: OAIMsg[] = []; // from the test-user's POV: assistant = user's own msgs, user = Hearth's replies
  let userMsg = await testUserTurn(system + '\n\nWrite your opening message to Hearth now.', history);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const done = /<END>/.test(userMsg);
    const clean = userMsg.replace(/<END>/g, '').trim();
    if (clean) console.log(`\n  🧑 ${s.name}: ${trim(clean)}`);
    history.push({ role: 'assistant', content: clean || userMsg });
    if (!clean) break;

    const hearthReply = await hearth.ask(sessionId, clean);
    console.log(`  🔥 Hearth: ${trim(hearthReply)}`);
    history.push({ role: 'user', content: hearthReply });

    if (done) { console.log(`  ⏹  ${s.name} ended the conversation.`); break; }
    userMsg = await testUserTurn(system, history);
  }
}

// ── Scenarios ────────────────────────────────────────────────────────────────
const SCENARIOS: Scenario[] = [
  {
    email: 'pm1@hearth.local', name: 'Priya', role: 'product manager',
    goal: 'Get a concrete, sequenced launch plan for a new "saved views" feature, and have Hearth capture the rollout approach so the team can follow it.',
    sessionTitle: 'Saved views — launch planning',
  },
  {
    email: 'dev1@hearth.local', name: 'Sam', role: 'backend engineer',
    goal: "Figure out why a nightly job intermittently times out, narrow it to a likely cause, and get a task created to fix it.",
    sessionTitle: 'Nightly job timeouts',
  },
];

async function main() {
  console.log(`Two-LLM dialogue against ${API}`);
  console.log(`Test user: OpenAI ${TEST_USER_MODEL}  ·  Hearth: its real agent (default provider).`);
  const t0 = Date.now();
  for (const s of SCENARIOS) await runDialogue(s);
  console.log(`\n✅ Done in ${Math.round((Date.now() - t0) / 1000)}s.`);
}

main().catch((e) => { console.error('dialogue failed:', e); process.exit(1); });
