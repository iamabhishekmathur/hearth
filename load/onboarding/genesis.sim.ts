/**
 * GENESIS — strict opening sequence on a FRESH isolated instance (:8100).
 *
 * Drives the REAL first-run path of a brand-new company:
 *   1. blank slate (needsSetup:true)
 *   2. create org + first admin (POST /admin/setup/init) → login → assert admin role
 *   3. COLD-START CLIFF: send a first chat message BEFORE any LLM is configured.
 *      Observe what a user actually sees (clear error vs silent hang).
 *   4. configure LLM via the real wizard (test-llm → keys → llm-config) — hot reload
 *   5. assert cliff resolves: a real agent reply now arrives
 *   6. cold-start empty-state sweep of tasks/decisions/memory/activity/signals/recs
 *
 * Run: API_URL=http://localhost:8100/api/v1 ./apps/api/node_modules/.bin/tsx load/onboarding/genesis.sim.ts
 *
 * Reads the real ANTHROPIC key from /Users/abhishek/projects/hearth/.env — never logs it.
 */
import { readFileSync } from 'node:fs';

const API = process.env.API_URL ?? 'http://localhost:8100/api/v1';
const REPLY_TIMEOUT_MS = 150_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 300) => {
  const c = (s ?? '').replace(/\s+/g, ' ').trim();
  return c.slice(0, n) + (c.length > n ? '…' : '');
};

function readAnthropicKey(): string {
  const env = readFileSync('/Users/abhishek/projects/hearth/.env', 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='));
  if (!line) throw new Error('ANTHROPIC_API_KEY not found in .env');
  return line.slice('ANTHROPIC_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
}

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
  async login(email: string, password: string) {
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

interface Msg { id: string; role: string; content: string; metadata?: any }

async function assistantMessages(h: Hearth, sessionId: string): Promise<Msg[]> {
  const r = await h.req<{ data: { messages: Msg[] } }>('GET', `/chat/sessions/${sessionId}`);
  return (r.body?.data?.messages ?? []).filter((m) => m.role === 'assistant');
}

/** Send a user msg, poll for a NEW assistant message. Returns the new msg or null on timeout. */
async function ask(h: Hearth, sessionId: string, content: string, timeoutMs = REPLY_TIMEOUT_MS): Promise<{ sendStatus: number; reply: Msg | null }> {
  const before = (await assistantMessages(h, sessionId)).length;
  const send = await h.req('POST', `/chat/sessions/${sessionId}/messages`, { content });
  if (send.status !== 202) return { sendStatus: send.status, reply: null };
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(2500);
    const all = await assistantMessages(h, sessionId);
    if (all.length > before && all[all.length - 1]?.content) {
      return { sendStatus: send.status, reply: all[all.length - 1] };
    }
  }
  return { sendStatus: send.status, reply: null };
}

const out: Record<string, unknown> = {};

async function main() {
  const ANTHROPIC_KEY = readAnthropicKey();
  const admin = new Hearth();
  const adminEmail = `founder+genesis@hearth-onboard.test`;
  const adminPassword = 'GenesisAdmin!2026';

  // ── STEP 1: blank slate ──────────────────────────────────────────────
  const status0 = await admin.req<{ data: { needsSetup: boolean; hasAdmin: boolean; hasOrg: boolean } }>('GET', '/admin/setup/status');
  out.step1 = { status: status0.status, body: status0.body?.data };
  console.log('[1] setup/status', status0.status, JSON.stringify(status0.body?.data));

  // ── STEP 2: create org + first admin ─────────────────────────────────
  const init = await admin.req('POST', '/admin/setup/init', {
    email: adminEmail,
    password: adminPassword,
    name: 'Genesis Founder',
    orgName: 'Genesis Labs',
  });
  out.step2_init = { status: init.status, body: init.body };
  console.log('[2] setup/init', init.status, JSON.stringify(init.body)?.slice(0, 200));

  const loginStatus = await admin.login(adminEmail, adminPassword);
  const me = await admin.req<{ data: any }>('GET', '/auth/me');
  out.step2_login = { loginStatus, meStatus: me.status, me: me.body?.data };
  console.log('[2] login', loginStatus, 'me', me.status, JSON.stringify(me.body?.data)?.slice(0, 250));

  const status1 = await admin.req<{ data: any }>('GET', '/admin/setup/status');
  out.step2_statusAfter = status1.body?.data;
  console.log('[2] status after init', JSON.stringify(status1.body?.data));

  // ── STEP 3: COLD-START CLIFF — chat before any LLM configured ─────────
  // Confirm no provider is configured yet.
  const provBefore = await admin.req<{ data: any[] }>('GET', '/admin/llm-config/providers');
  out.step3_providersBefore = provBefore.body?.data;
  console.log('[3] providers before config', JSON.stringify(provBefore.body?.data?.map((p: any) => ({ id: p.id, configured: p.configured, keySource: p.keySource }))));

  const sess1 = await admin.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'First message (no LLM)' });
  const sess1Id = sess1.body?.data?.id;
  console.log('[3] session', sess1.status, sess1Id);

  // Shorter timeout — we're probing whether anything comes back at all.
  const cliff = await ask(admin, sess1Id!, 'Hi! Can you help me get started — what can you do for my team?', 40_000);
  // After the wait, re-read the FULL session to see exactly what's observable.
  const sess1Full = await admin.req<{ data: { messages: Msg[] } }>('GET', `/chat/sessions/${sess1Id}`);
  const allMsgs = sess1Full.body?.data?.messages ?? [];
  const asstMsgs = allMsgs.filter((m) => m.role === 'assistant');
  out.step3_cliff = {
    sendStatus: cliff.sendStatus,
    gotReply: !!cliff.reply,
    assistantCount: asstMsgs.length,
    userPersisted: allMsgs.some((m) => m.role === 'user'),
    assistantContent: cliff.reply ? trim(cliff.reply.content) : null,
    assistantMetadata: cliff.reply?.metadata ?? asstMsgs[asstMsgs.length - 1]?.metadata ?? null,
  };
  // cliffConfirmed = TRUE means a SILENT HANG (no reply AND no surfaced error). If a
  // clear error message was persisted, the cliff is NOT silent → cliffConfirmed false.
  const replyText = cliff.reply?.content ?? '';
  const hasSurfacedError =
    /error|no llm|provider|not configured|unavailable|failed/i.test(replyText) ||
    !!cliff.reply?.metadata?.error;
  const silentHang = !cliff.reply || (!hasSurfacedError && asstMsgs.length === 0);
  out.cliffConfirmed = silentHang;
  console.log('[3] CLIFF: gotReply=', !!cliff.reply, 'surfacedError=', hasSurfacedError, 'silentHang=', silentHang);
  console.log('[3] CLIFF assistant content:', trim(replyText, 200));
  console.log('[3] CLIFF assistant metadata:', JSON.stringify(cliff.reply?.metadata)?.slice(0, 200));

  // ── STEP 4: configure LLM via the real wizard ────────────────────────
  const testLlm = await admin.req('POST', '/admin/setup/test-llm', { provider: 'anthropic', apiKey: ANTHROPIC_KEY });
  out.step4_testLlm = { status: testLlm.status, body: testLlm.body };
  console.log('[4] test-llm', testLlm.status, JSON.stringify(testLlm.body));

  const saveKey = await admin.req('POST', '/admin/llm-config/keys', { provider: 'anthropic', apiKey: ANTHROPIC_KEY });
  out.step4_saveKey = { status: saveKey.status, body: saveKey.body };
  console.log('[4] keys', saveKey.status, JSON.stringify(saveKey.body));

  const setDefault = await admin.req('PUT', '/admin/llm-config', {
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    visionEnabled: true,
  });
  out.step4_setDefault = { status: setDefault.status, body: setDefault.body };
  console.log('[4] llm-config PUT', setDefault.status, JSON.stringify(setDefault.body));

  const provAfter = await admin.req<{ data: any[] }>('GET', '/admin/llm-config/providers');
  out.step4_providersAfter = provAfter.body?.data?.map((p: any) => ({ id: p.id, configured: p.configured, keySource: p.keySource }));
  console.log('[4] providers after', JSON.stringify(out.step4_providersAfter));

  // ── STEP 5: cliff resolves — real reply now arrives ──────────────────
  const sess2 = await admin.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'First message (LLM ready)' });
  const sess2Id = sess2.body?.data?.id;
  const resolved = await ask(admin, sess2Id!, 'Hi! In one or two sentences, what can you help my team with?', REPLY_TIMEOUT_MS);
  const realReply = resolved.reply;
  const realReplyIsError = !!realReply?.metadata?.error || /\[error:/i.test(realReply?.content ?? '');
  out.step5 = {
    sendStatus: resolved.sendStatus,
    gotReply: !!realReply,
    isError: realReplyIsError,
    content: realReply ? trim(realReply.content, 400) : null,
    metadata: realReply?.metadata ?? null,
  };
  out.llmConfigured = !!realReply && !realReplyIsError;
  console.log('[5] resolved reply gotReply=', !!realReply, 'isError=', realReplyIsError);
  console.log('[5] reply content:', trim(realReply?.content ?? '', 300));

  // ── STEP 6: cold-start empty-state sweep ─────────────────────────────
  const sweep: Record<string, { status: number; shape: string; note: string }> = {};
  const probes: Array<[string, string]> = [
    ['tasks', '/tasks'],
    ['decisions', '/decisions'],
    ['memory', '/memory'],
    ['activity', '/activity'],
    ['signals', '/activity/signals'],
    ['recommendations', '/recommendations/skills'],
  ];
  for (const [name, path] of probes) {
    const r = await admin.req<any>('GET', path);
    let shape = 'unknown';
    let note = '';
    const b = r.body;
    if (b && typeof b === 'object') {
      const arr = Array.isArray(b) ? b : Array.isArray(b.data) ? b.data : Array.isArray(b.items) ? b.items : Array.isArray(b.decisions) ? b.decisions : null;
      if (arr) {
        shape = `array(len=${arr.length})`;
        note = arr.length === 0 ? 'graceful empty' : 'non-empty';
      } else if (b.data && typeof b.data === 'object') {
        shape = `object(${Object.keys(b.data).slice(0, 6).join(',')})`;
        note = 'object payload';
      } else if (b.error) {
        shape = 'error';
        note = trim(String(b.error), 120);
      } else {
        shape = `object(${Object.keys(b).slice(0, 6).join(',')})`;
      }
    } else {
      shape = typeof b;
    }
    const graceful = r.status >= 200 && r.status < 300 && shape !== 'error';
    sweep[name] = { status: r.status, shape, note: graceful ? note || 'ok' : `NON-GRACEFUL: ${note}` };
    console.log(`[6] ${name} ${path} → ${r.status} ${shape} ${sweep[name].note}`);
  }
  out.step6_emptyState = sweep;

  out.orgReady =
    !!me.body?.data && me.body?.data?.role === 'admin' && out.llmConfigured === true;
  out.adminEmail = adminEmail;

  console.log('\n===== GENESIS RESULT =====');
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error('GENESIS FATAL', err);
  out.fatal = err instanceof Error ? err.message : String(err);
  console.log('\n===== GENESIS RESULT (partial) =====');
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
});
