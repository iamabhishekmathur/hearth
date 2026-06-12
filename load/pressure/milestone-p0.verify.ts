/**
 * FIX VERIFY — milestone-p0. Drives chat -> promote(planning) -> planner ->
 * executor -> review -> approve -> done, then asserts task_progress system
 * messages (started/executing/review + done) appear in the session.
 *
 *   API_URL=http://localhost:8000/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/pressure/milestone-p0.verify.ts
 */
const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';
const REPLY_TIMEOUT_MS = 150_000;
const TASK_TIMEOUT_MS = 200_000;

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
  async ask(sessionId: string, content: string): Promise<{ userMessageId: string; reply: string }> {
    const get = () => this.req<{ data: { messages: Array<{ id: string; role: string; content: string }> } }>('GET', `/chat/sessions/${sessionId}`);
    const beforeMsgs = (await get()).body.data.messages;
    const before = beforeMsgs.filter((m) => m.role === 'assistant').length;
    const send = await this.req('POST', `/chat/sessions/${sessionId}/messages`, { content });
    if (send.status !== 202) return { userMessageId: '', reply: `[hearth send failed: ${send.status}]` };
    const start = Date.now();
    while (Date.now() - start < REPLY_TIMEOUT_MS) {
      await sleep(2500);
      const msgs = (await get()).body.data.messages;
      const assistants = msgs.filter((m) => m.role === 'assistant');
      if (assistants.length > before && assistants[assistants.length - 1]?.content) {
        const userMsgs = msgs.filter((m) => m.role === 'user');
        return { userMessageId: userMsgs[userMsgs.length - 1]?.id ?? '', reply: assistants[assistants.length - 1].content };
      }
    }
    return { userMessageId: '', reply: '[hearth: no reply within timeout]' };
  }
  async messages(sessionId: string) {
    return (await this.req<{ data: { messages: any[] } }>('GET', `/chat/sessions/${sessionId}`)).body.data.messages;
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 160) => { const c = (s ?? '').replace(/\s+/g, ' ').trim(); return c.slice(0, n) + (c.length > n ? '…' : ''); };

async function pollTaskStatus(h: Hearth, taskId: string, want: string, timeoutMs = TASK_TIMEOUT_MS): Promise<string> {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const r = await h.req<{ data: { status: string } }>('GET', `/tasks/${taskId}`);
    last = r.body?.data?.status ?? `http_${r.status}`;
    if (last === want || last === 'failed') return last;
    await sleep(3000);
  }
  return last;
}

async function main() {
  console.log(`milestone-p0 verify against ${API}`);
  const h = new Hearth();
  await h.login('dev1@hearth.local');
  const sid = await h.newSession('milestone-p0 verify — webhook fix');
  console.log(`session ${sid}`);

  const { userMessageId, reply } = await h.ask(
    sid,
    "We're seeing a spike of 500s on the Stripe webhook handler since 14:00. charge.refunded events with a null payment_intent slip through and blow up. Add a null-guard plus a bounded retry on the webhook handler.",
  );
  console.log(`hearth replied: ${trim(reply)}`);
  if (!userMessageId) { console.log('FAIL: no user message id'); process.exit(1); }

  const promote = await h.req<any>('POST', `/chat/sessions/${sid}/messages/${userMessageId}/promote-to-task`, {
    title: 'Null-guard + bounded retry on Stripe webhook handler',
    targetStatus: 'planning', attachRecentN: 4, provenance: 'chat_button',
  });
  const taskId = promote.body?.data?.id;
  console.log(`promote status=${promote.status} taskId=${taskId}`);
  if (!taskId) { console.log('FAIL: promote failed'); process.exit(1); }

  const reached = await pollTaskStatus(h, taskId, 'review');
  console.log(`task auto-advanced to: ${reached}`);

  const beforeApprove = (await h.messages(sid))
    .filter((m: any) => m.role === 'system' && m.metadata?.kind === 'task_progress' && m.metadata?.taskId === taskId)
    .map((m: any) => m.metadata.milestone);
  console.log(`milestones BEFORE approve: [${beforeApprove.join(', ')}]`);

  if (reached !== 'review') { console.log(`WARN: never reached review (status=${reached}); cannot test done`); }

  let approveStatus = 0, finalStatus = '';
  if (reached === 'review') {
    const rev = await h.req<any>('POST', `/tasks/${taskId}/reviews`, { decision: 'approved' });
    approveStatus = rev.status;
    finalStatus = (await h.req<{ data: any }>('GET', `/tasks/${taskId}`)).body.data?.status;
    console.log(`approve status=${approveStatus} taskStatus=${finalStatus}`);
    // milestone post is fire-and-forget; give it a moment
    await sleep(2500);
  }

  const afterApprove = (await h.messages(sid))
    .filter((m: any) => m.role === 'system' && m.metadata?.kind === 'task_progress' && m.metadata?.taskId === taskId)
    .map((m: any) => m.metadata.milestone);
  console.log(`milestones AFTER approve: [${afterApprove.join(', ')}]`);

  const hasCore = ['started', 'executing', 'review'].every((k) => beforeApprove.includes(k));
  const hasDone = afterApprove.includes('done');
  console.log('\n=== RESULT ===');
  console.log(`core milestones (started/executing/review) present: ${hasCore}`);
  console.log(`done milestone present after approve: ${hasDone}`);
  console.log(JSON.stringify({ sid, taskId, reached, approveStatus, finalStatus, beforeApprove, afterApprove, hasCore, hasDone }));
}
main().catch((e) => { console.error('verify failed:', e); process.exit(1); });
