/**
 * E2E simulation harness — shared core used by every feature-area "wave".
 *
 *   - HearthClient      drive the REAL product over the API as any persona
 *   - personaTurn       an OpenAI "test user" that reacts to Hearth's replies
 *   - prisma            direct DB read access to OBSERVE side effects
 *   - Recorder          accumulates a coverage matrix + defect log across waves
 *
 * The whole point: feed realistic enterprise scenarios in, watch how Hearth's
 * frontend/backend actually respond, and record pass/fail + defects per
 * (feature × scenario-type). Hearth's side is never mocked.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
export const OPENAI_KEY = process.env.OPENAI_API_KEY;
export const PERSONA_MODEL = process.env.TEST_USER_MODEL ?? 'gpt-4o';
export const PASSWORD = 'changeme';
const REPLY_TIMEOUT_MS = 150_000;

export const prisma = new PrismaClient();

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const short = (s: unknown, n = 300) => {
  const str = typeof s === 'string' ? s : s == null ? '' : JSON.stringify(s);
  return str.replace(/\s+/g, ' ').trim().slice(0, n);
};

// ── Hearth API client (cookie jar + CSRF) ────────────────────────────────────
export interface Me { id: string; name: string; email: string; role: string; orgId: string | null }

export class HearthClient {
  private cookies = new Map<string, string>();
  private csrf = '';
  me!: Me;

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
  private cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }

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

  /** Multipart POST (file upload) with cookies + CSRF. fetch sets the boundary. */
  async reqForm<T = any>(path: string, form: FormData): Promise<{ status: number; body: T }> {
    const res = await fetch(`${API}${path}`, { method: 'POST', headers: { cookie: this.cookieHeader(), 'x-csrf-token': this.csrf }, body: form });
    this.store(res);
    const text = await res.text();
    let parsed: unknown;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
    return { status: res.status, body: parsed as T };
  }

  async login(email: string): Promise<HearthClient> {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    this.store(res);
    this.me = (await this.req<{ data: Me }>('GET', '/auth/me')).body.data;
    return this;
  }

  async newSession(title?: string): Promise<string> {
    return (await this.req<{ data: { id: string } }>('POST', '/chat/sessions', { title })).body.data.id;
  }

  /** Send a message and wait for Hearth's next real assistant reply (or null on timeout). */
  async sendAndWait(sessionId: string, content: string): Promise<string | null> {
    const get = () => this.req<{ data: { messages: Array<{ role: string; content: string }> } }>('GET', `/chat/sessions/${sessionId}`);
    const before = (await get()).body.data.messages.filter((m) => m.role === 'assistant').length;
    const send = await this.req('POST', `/chat/sessions/${sessionId}/messages`, { content });
    if (send.status !== 202) return `[send status ${send.status}: ${short(send.body, 120)}]`;
    const start = Date.now();
    while (Date.now() - start < REPLY_TIMEOUT_MS) {
      await sleep(2500);
      const a = (await get()).body.data.messages.filter((m) => m.role === 'assistant');
      if (a.length > before && a[a.length - 1]?.content) return a[a.length - 1].content;
    }
    return null;
  }
}

export async function loginAs(email: string): Promise<HearthClient> {
  return new HearthClient().login(email);
}

// ── Test-user LLM (OpenAI, direct — never sees Hearth's system prompt) ────────
export interface OAIMsg { role: 'system' | 'user' | 'assistant'; content: string }

export async function personaTurn(system: string, history: OAIMsg[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY required for the test-user LLM');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: PERSONA_MODEL,
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 400,
      messages: [{ role: 'system', content: system }, ...history],
    }),
  });
  if (!res.ok) throw new Error(`persona LLM ${res.status}: ${short(await res.text(), 160)}`);
  const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices[0].message.content.trim();
}

/** Build a persona system prompt for a test user with a role + goal. */
export function persona(name: string, role: string, goal: string, extra = ''): string {
  return [
    `You are ${name}, a ${role} at a ~500-person regulated tech company. You're using "Hearth", an AI work assistant your team uses in chat.`,
    `Behave like a real person at work: natural, concise (1-4 sentences), specific. React to what Hearth actually says.`,
    `Your goal: ${goal}`,
    extra,
    `Output ONLY your chat message — the literal text you'd type. End your final message with <END> when your goal is met or the conversation would naturally wrap up.`,
  ].filter(Boolean).join('\n');
}

/** Run a full LLM-driven dialogue: a persona ↔ the real Hearth agent. Returns the transcript. */
export async function runDialogue(
  client: HearthClient, sessionId: string, system: string, maxTurns = 6,
  onTurn?: (who: string, text: string) => void,
): Promise<Array<{ who: 'user' | 'hearth'; text: string }>> {
  const transcript: Array<{ who: 'user' | 'hearth'; text: string }> = [];
  const history: OAIMsg[] = [];
  let userMsg = await personaTurn(system + '\n\nWrite your opening message to Hearth now.', history);
  for (let t = 0; t < maxTurns; t++) {
    const done = /<END>/.test(userMsg);
    const clean = userMsg.replace(/<END>/g, '').trim();
    if (clean) { transcript.push({ who: 'user', text: clean }); onTurn?.('user', clean); history.push({ role: 'assistant', content: clean }); }
    if (!clean) break;
    const reply = await client.sendAndWait(sessionId, clean);
    const r = reply ?? '[no reply / timeout]';
    transcript.push({ who: 'hearth', text: r }); onTurn?.('hearth', r); history.push({ role: 'user', content: r });
    if (done) break;
    userMsg = await personaTurn(system, history);
  }
  return transcript;
}

// ── Coverage matrix + defect recorder ────────────────────────────────────────
export type ScenarioType = 'happy' | 'error' | 'user_error' | 'violation' | 'permission' | 'pressure';
export type Status = 'pass' | 'fail' | 'partial' | 'blocked';

export interface ScenarioResult {
  feature: string;        // e.g. "Chat", "Tasks", "Governance"
  subFeature: string;     // e.g. "shared session", "kanban transition"
  type: ScenarioType;
  name: string;
  expected: string;
  observed: string;
  status: Status;
  defects?: string[];     // anything Hearth got wrong / unexpected
  ts?: string;
}

const RESULTS_PATH = 'load/harness/results.json';
const REPORT_PATH = 'load/harness/COVERAGE.md';

export class Recorder {
  private results: ScenarioResult[] = [];
  constructor(private wave: string) {
    if (existsSync(RESULTS_PATH)) {
      try { this.results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8')); } catch { this.results = []; }
    }
  }
  /** Record a scenario outcome. Logs a one-liner as it goes. */
  record(r: Omit<ScenarioResult, 'ts'>): void {
    const full = { ...r, ts: new Date().toISOString() };
    this.results.push(full);
    const icon = { pass: '✅', fail: '❌', partial: '🟡', blocked: '⛔' }[r.status];
    console.log(`  ${icon} [${r.feature}/${r.subFeature}] (${r.type}) ${r.name}`);
    if (r.defects?.length) r.defects.forEach((d) => console.log(`        ⚠️  ${d}`));
  }
  save(): void {
    mkdirSync(dirname(RESULTS_PATH), { recursive: true });
    writeFileSync(RESULTS_PATH, JSON.stringify(this.results, null, 2));
    writeFileSync(REPORT_PATH, this.render());
    console.log(`\nRecorded ${this.results.filter((r) => r.feature).length} total scenarios → ${REPORT_PATH}`);
  }
  private render(): string {
    const types: ScenarioType[] = ['happy', 'error', 'user_error', 'violation', 'permission', 'pressure'];
    const features = [...new Set(this.results.map((r) => r.feature))].sort();
    const cell = (f: string, t: ScenarioType) => {
      const rs = this.results.filter((r) => r.feature === f && r.type === t);
      if (rs.length === 0) return '·';
      const pass = rs.filter((r) => r.status === 'pass').length;
      const fail = rs.filter((r) => r.status === 'fail').length;
      const other = rs.length - pass - fail;
      return `${pass}✅${fail ? ` ${fail}❌` : ''}${other ? ` ${other}🟡` : ''}`;
    };
    const lines: string[] = [];
    lines.push('# Hearth E2E Coverage Matrix\n');
    lines.push(`Generated ${new Date().toISOString()} · ${this.results.length} scenarios\n`);
    lines.push('| Feature | ' + types.join(' | ') + ' |');
    lines.push('|' + '---|'.repeat(types.length + 1));
    for (const f of features) lines.push(`| ${f} | ` + types.map((t) => cell(f, t)).join(' | ') + ' |');
    const defects = this.results.filter((r) => r.defects?.length);
    lines.push(`\n## Defects (${defects.reduce((n, r) => n + (r.defects?.length ?? 0), 0)})\n`);
    for (const r of defects) {
      for (const d of r.defects!) lines.push(`- **[${r.feature}/${r.subFeature}]** (${r.type}) ${d}  \n  ↳ _${r.name}_`);
    }
    lines.push('\n## Failures & partials\n');
    for (const r of this.results.filter((r) => r.status === 'fail' || r.status === 'partial')) {
      lines.push(`- ${r.status === 'fail' ? '❌' : '🟡'} **[${r.feature}/${r.subFeature}]** ${r.name} — expected: ${r.expected} · observed: ${r.observed}`);
    }
    return lines.join('\n') + '\n';
  }
}
