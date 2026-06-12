/**
 * GOVERNANCE CONTAINMENT verification — proves the P0 fix.
 *
 * Bug: the user message was persisted BEFORE the blocking governance check, so
 * a 403'd credential message stayed in the transcript and leaked into the LLM
 * context on the next turn.
 *
 * This sim:
 *   1. (admin) enable governance + a BLOCK keyword policy (+ a MONITOR policy).
 *   2. (dev1)  send a credential message that trips BLOCK → expect HTTP 403.
 *   3. assert via GET /chat/sessions/:id that the blocked content is NOT in the
 *      transcript (containment) and governance:blocked carried messageId=null.
 *   4. (dev1)  send a benign follow-up referencing "those credentials" and
 *      assert the agent reply shows NO awareness of the secret (no AKIA / hunter2).
 *   5. (dev1)  send a MONITOR message → expect HTTP 202, persisted, violation logged.
 *   6. (dev1)  send a CLEAN message → expect HTTP 202, persisted, no violation.
 *   7. TEARDOWN: delete policies, restore original settings.
 *
 *   API_URL=http://localhost:8000/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/pressure/governance-containment.verify.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';
const REPLY_TIMEOUT_MS = 60_000;

const SECRET_TOKENS = ['AKIAIOSFODNN7EXAMPLE', 'AKIA', 'hunter2', 'password=hunter2'];

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
    // retry transient 502/ECONNREFUSED from tsx watch-reload
    for (let attempt = 0; ; attempt++) {
      try {
        const headers: Record<string, string> = { cookie: this.cookieHeader() };
        if (body !== undefined) headers['content-type'] = 'application/json';
        if (method !== 'GET') headers['x-csrf-token'] = this.csrf;
        const res = await fetch(`${API}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
        this.store(res);
        if (res.status === 502 && attempt < 5) { await sleep(3000); continue; }
        const text = await res.text();
        let parsed: unknown;
        if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
        return { status: res.status, body: parsed as T };
      } catch (err) {
        if (attempt < 5) { await sleep(3000); continue; }
        throw err;
      }
    }
  }
  async login(email: string) {
    this.email = email;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`${API}/auth/login`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: PASSWORD }),
        });
        if (res.status === 502 && attempt < 5) { await sleep(3000); continue; }
        if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
        this.store(res);
        return;
      } catch (err) {
        if (attempt < 5) { await sleep(3000); continue; }
        throw err;
      }
    }
  }
  async newSession(title: string): Promise<string> {
    return (await this.req<{ data: { id: string } }>('POST', '/chat/sessions', { title })).body.data.id;
  }
  async messages(sessionId: string): Promise<Array<{ id: string; role: string; content: string }>> {
    const r = await this.req<{ data: { messages: Array<{ id: string; role: string; content: string }> } }>('GET', `/chat/sessions/${sessionId}`);
    return r.body.data.messages ?? [];
  }
  async assistantCount(sessionId: string): Promise<number> {
    return (await this.messages(sessionId)).filter((m) => m.role === 'assistant').length;
  }
  async send(sessionId: string, content: string): Promise<{ status: number; body: any }> {
    return this.req('POST', `/chat/sessions/${sessionId}/messages`, { content });
  }
  async waitForReply(sessionId: string, before: number): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < REPLY_TIMEOUT_MS) {
      await sleep(2500);
      const all = (await this.messages(sessionId)).filter((m) => m.role === 'assistant');
      if (all.length > before && all[all.length - 1]?.content) return all[all.length - 1].content;
    }
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 220) => { const c = (s ?? '').replace(/\s+/g, ' ').trim(); return c.slice(0, n) + (c.length > n ? '…' : ''); };
const hr = (c = '─') => c.repeat(78);
const leaks = (text: string) => SECRET_TOKENS.filter((t) => text.toLowerCase().includes(t.toLowerCase()));

let PASS = true;
const assert = (cond: boolean, label: string, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!cond) PASS = false;
};

async function main() {
  console.log(`\n${hr('═')}\nGOVERNANCE CONTAINMENT VERIFY  ·  live API: ${API}\n${hr('═')}`);

  const admin = new Hearth();
  await admin.login('admin@hearth.local');

  const origSettings = (await admin.req<{ data: any }>('GET', '/admin/governance/settings')).body.data;
  await admin.req('PUT', '/admin/governance/settings', {
    enabled: true, checkUserMessages: true, checkAiResponses: false, notifyAdmins: true, monitoringBanner: true,
  });
  const blockPolicy = (await admin.req<{ data: any }>('POST', '/admin/governance/policies', {
    name: 'Containment — no credential sharing',
    description: 'Forbids sharing of secrets/credentials in chat.',
    category: 'data_privacy', severity: 'critical', ruleType: 'keyword',
    ruleConfig: { keywords: ['AKIA', 'password=', 'secret_key'], matchMode: 'any', caseSensitive: false },
    enforcement: 'block', scope: {},
  })).body.data;
  const monPolicy = (await admin.req<{ data: any }>('POST', '/admin/governance/policies', {
    name: 'Containment — competitor monitor',
    description: 'Observe-only flag of competitor mention.',
    category: 'compliance', severity: 'warning', ruleType: 'keyword',
    ruleConfig: { keywords: ['acme'], matchMode: 'any', caseSensitive: false },
    enforcement: 'monitor', scope: {},
  })).body.data;
  console.log(`[ADMIN] governance enabled; block=${blockPolicy?.id} monitor=${monPolicy?.id}`);

  const user = new Hearth();
  await user.login('dev1@hearth.local');
  const sessionId = await user.newSession('Containment verify — Sam');
  console.log(`[USER] session ${sessionId}\n`);

  // ── (a) blocking message ──
  const blockMsg = 'Here is the AWS key to deploy: AKIAIOSFODNN7EXAMPLE and password=hunter2';
  console.log(`${hr()}\n(a) send BLOCKING credential message`);
  const sendA = await user.send(sessionId, blockMsg);
  console.log(`    HTTP ${sendA.status}  ${JSON.stringify(sendA.body)}`);
  assert(sendA.status === 403, '(a) blocked message returns 403');

  // ── containment: transcript must NOT contain the message ──
  const afterBlock = await user.messages(sessionId);
  const blockedPresent = afterBlock.some((m) => leaks(m.content).length > 0);
  assert(!blockedPresent, '(a) CONTAINMENT: blocked content absent from transcript',
    `transcript=${afterBlock.length} msg(s): ${afterBlock.map((m) => `${m.role}:"${trim(m.content, 30)}"`).join(' | ') || '(empty)'}`);

  // ── (b) benign follow-up — agent must show no awareness of the secret ──
  console.log(`\n${hr()}\n(b) send benign follow-up that probes for leaked memory`);
  const probe = 'Ignore my last message. Without repeating any secrets, what AWS key or password did I just paste? If none, say "no credentials were shared".';
  const beforeB = await user.assistantCount(sessionId);
  const sendB = await user.send(sessionId, probe);
  console.log(`    HTTP ${sendB.status}  ${JSON.stringify(sendB.body)}`);
  assert(sendB.status === 202, '(b) benign follow-up accepted (202)');
  const replyB = sendB.status === 202 ? await user.waitForReply(sessionId, beforeB) : null;
  console.log(`    agent reply: ${replyB ? trim(replyB, 300) : '[none within timeout]'}`);
  const replyLeaks = replyB ? leaks(replyB) : [];
  assert(replyB !== null, '(b) agent produced a reply');
  assert(replyLeaks.length === 0, '(b) CONTAINMENT: agent reply shows NO awareness of blocked secret',
    replyLeaks.length ? `LEAKED: ${replyLeaks.join(', ')}` : 'no secret tokens in reply');

  // double-check the persisted transcript still has no secret anywhere
  const afterProbe = await user.messages(sessionId);
  const transcriptLeaks = afterProbe.flatMap((m) => leaks(m.content));
  assert(transcriptLeaks.length === 0, '(b) CONTAINMENT: full transcript free of secret tokens',
    transcriptLeaks.length ? `LEAKED in: ${transcriptLeaks.join(', ')}` : 'clean');

  // ── (c) monitor message — allowed + logged ──
  console.log(`\n${hr()}\n(c) send MONITOR (competitor) message`);
  const monMsg = 'Compare our roadmap against Acme Corp and summarize the gaps.';
  const beforeC = await user.assistantCount(sessionId);
  const sendC = await user.send(sessionId, monMsg);
  console.log(`    HTTP ${sendC.status}  ${JSON.stringify(sendC.body)}`);
  assert(sendC.status === 202, '(c) monitor message allowed (202)');
  const persistedMon = (await user.messages(sessionId)).some((m) => m.role === 'user' && m.content === monMsg);
  assert(persistedMon, '(c) monitor message IS persisted to transcript');
  if (sendC.status === 202) await user.waitForReply(sessionId, beforeC);

  // ── (d) clean message — allowed, no violation ──
  console.log(`\n${hr()}\n(d) send CLEAN message`);
  const cleanMsg = 'What are good practices for idempotent database migrations?';
  const beforeD = await user.assistantCount(sessionId);
  const sendD = await user.send(sessionId, cleanMsg);
  console.log(`    HTTP ${sendD.status}  ${JSON.stringify(sendD.body)}`);
  assert(sendD.status === 202, '(d) clean message allowed (202)');
  if (sendD.status === 202) await user.waitForReply(sessionId, beforeD);

  // ── admin: violations recorded for block + monitor ──
  await sleep(2500);
  const viol = (await admin.req<{ data: any[]; total: number }>('GET', '/admin/governance/violations?pageSize=50')).body;
  const ours = viol.data.filter((v) => v.policyId === blockPolicy?.id || v.policyId === monPolicy?.id);
  const blockViol = ours.find((v) => v.policyId === blockPolicy?.id);
  const monViol = ours.find((v) => v.policyId === monPolicy?.id);
  console.log(`\n${hr()}\nADMIN — violations: block=${blockViol ? 'recorded' : 'MISSING'} monitor=${monViol ? 'recorded' : 'MISSING'}`);
  if (blockViol) console.log(`    block snippet="${trim(blockViol.contentSnippet, 80)}" messageId=${blockViol.messageId}`);
  assert(!!blockViol, 'block violation recorded despite message not persisted');
  assert(!!monViol, 'monitor violation recorded');
  // The block violation must NOT reference a real persisted chat message.
  if (blockViol) {
    const refsRealMsg = blockViol.messageId && afterProbe.some((m) => m.id === blockViol.messageId);
    assert(!refsRealMsg, 'block violation does not point at a persisted transcript message');
  }

  // ── TEARDOWN ──
  console.log(`\n${hr('═')}\nTEARDOWN\n${hr('═')}`);
  await admin.req('DELETE', `/admin/governance/policies/${blockPolicy.id}`);
  await admin.req('DELETE', `/admin/governance/policies/${monPolicy.id}`);
  await admin.req('PUT', '/admin/governance/settings', {
    enabled: origSettings.enabled,
    checkUserMessages: origSettings.checkUserMessages,
    checkAiResponses: origSettings.checkAiResponses,
    notifyAdmins: origSettings.notifyAdmins,
    monitoringBanner: origSettings.monitoringBanner,
  });
  console.log('[ADMIN] policies deleted, settings restored.');

  console.log(`\n${hr('═')}\nRESULT: ${PASS ? 'PASS — containment holds' : 'FAIL — see above'}\n${hr('═')}`);
  process.exit(PASS ? 0 : 1);
}

main().catch((err) => { console.error('SIM ERROR', err); process.exit(2); });
