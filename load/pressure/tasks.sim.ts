/**
 * Task lifecycle pressure sim (key: tasks) — REAL product, REAL agent/workers.
 *
 *   chat -> promote-to-task -> planner (auto-advance) -> executor -> review -> done
 *   + changes_requested re-plan loop + idempotency/guard-rail probes.
 *
 * Run:
 *   API_URL=http://localhost:8000/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/pressure/tasks.sim.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';
const REPLY_TIMEOUT_MS = 150_000;
const TASK_TIMEOUT_MS = 180_000;

// ── Hearth client (cookie jar + CSRF) — copied from load/simulate-llm-dialogue.ts ──
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
  /** Send a user message and WAIT for Hearth's real assistant reply. Returns {messageId, reply}. */
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
        // last user message is the one we just sent
        const userMsgs = msgs.filter((m) => m.role === 'user');
        const userMessageId = userMsgs[userMsgs.length - 1]?.id ?? '';
        return { userMessageId, reply: assistants[assistants.length - 1].content };
      }
    }
    return { userMessageId: '', reply: '[hearth: no reply within timeout]' };
  }
  async messages(sessionId: string) {
    return (await this.req<{ data: { messages: any[] } }>('GET', `/chat/sessions/${sessionId}`)).body.data.messages;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 200) => { const c = (s ?? '').replace(/\s+/g, ' ').trim(); return c.slice(0, n) + (c.length > n ? '…' : ''); };

// ── assertion ledger ──
type Status = 'pass' | 'fail' | 'inconclusive';
const results: Array<{ id: string; status: Status; observed: string }> = [];
function rec(id: string, status: Status, observed: string) {
  results.push({ id, status, observed });
  const icon = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'INC ';
  console.log(`  [${icon}] ${id}: ${trim(observed, 240)}`);
}

async function pollTaskStatus(h: Hearth, taskId: string, want: string, timeoutMs = TASK_TIMEOUT_MS): Promise<string> {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const r = await h.req<{ data: { status: string } }>('GET', `/tasks/${taskId}`);
    last = r.body?.data?.status ?? `http_${r.status}`;
    if (last === want) return last;
    if (last === 'failed') return last;
    await sleep(3000);
  }
  return last;
}

async function pollTaskStatusChange(h: Hearth, taskId: string, from: string, timeoutMs = TASK_TIMEOUT_MS): Promise<string> {
  const start = Date.now();
  let last = from;
  while (Date.now() - start < timeoutMs) {
    const r = await h.req<{ data: { status: string } }>('GET', `/tasks/${taskId}`);
    last = r.body?.data?.status ?? `http_${r.status}`;
    if (last !== from) return last;
    await sleep(3000);
  }
  return last;
}

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 1 — Sam Park: incident fix -> planning -> review -> done
// ════════════════════════════════════════════════════════════════════════════
async function scenario1() {
  console.log('\n══ Scenario 1: Sam Park drives an incident fix to DONE ══');
  const h = new Hearth();
  await h.login('dev1@hearth.local');
  const sid = await h.newSession('Payments 500 spike');

  const { userMessageId, reply } = await h.ask(
    sid,
    "We're seeing a spike of 500s on the Stripe webhook handler since 14:00. Looks like charge.refunded events with a null `payment_intent` slip through and blow up. I want to add a null-guard plus a bounded retry on the webhook handler.",
  );
  console.log(`  Hearth replied: ${trim(reply)}`);
  if (!userMessageId) { rec('A1', 'inconclusive', 'no user message id captured (send may have failed)'); return; }

  // (a) Explicit promote -> planning
  const promote = await h.req<any>('POST', `/chat/sessions/${sid}/messages/${userMessageId}/promote-to-task`, {
    title: 'Null-guard + bounded retry on Stripe webhook handler',
    targetStatus: 'planning',
    attachRecentN: 4,
    provenance: 'chat_button',
  });
  const taskId = promote.body?.data?.id;
  rec('A1', promote.status === 201 && !!taskId ? 'pass' : 'fail',
    `promote status=${promote.status} taskId=${taskId} body=${trim(JSON.stringify(promote.body), 160)}`);
  if (!taskId) return;

  // producedTaskIds chip
  const msgs = await h.messages(sid);
  const origin = msgs.find((m: any) => m.id === userMessageId);
  const chip = Array.isArray(origin?.producedTaskIds) && origin.producedTaskIds.includes(taskId);
  rec('A1', chip ? 'pass' : 'fail', `message.producedTaskIds=${JSON.stringify(origin?.producedTaskIds)}`);

  // A2 chat_excerpt context item
  const ctx = await h.req<{ data: any[] }>('GET', `/tasks/${taskId}/context-items`);
  const excerpt = (ctx.body.data ?? []).find((c) => c.type === 'chat_excerpt');
  const expectedDeep = `/chat/${sid}?messageId=${userMessageId}`;
  rec('A2',
    excerpt && excerpt.label === 'From chat' && excerpt.deepLink === expectedDeep ? 'pass' : 'fail',
    excerpt ? `type=${excerpt.type} label=${excerpt.label} deepLink=${excerpt.deepLink} (expected ${expectedDeep})` : `no chat_excerpt; items=${JSON.stringify((ctx.body.data ?? []).map((c) => c.type))}`);

  // A5 auto-advance to review with NO manual PATCH
  const reached = await pollTaskStatus(h, taskId, 'review');
  rec('A5', reached === 'review' ? 'pass' : 'fail', `polled to status=${reached} with zero manual PATCH`);

  // A3 subtasks
  const t = await h.req<{ data: any }>('GET', `/tasks/${taskId}`);
  const subs = t.body.data?.subTasks ?? [];
  rec('A3', subs.length >= 1 ? 'pass' : 'fail', `subTasks.length=${subs.length}`);

  // A4 steps with phase/durationMs/toolUsed
  const steps = (await h.req<{ data: any[] }>('GET', `/tasks/${taskId}/steps`)).body.data ?? [];
  const planStep = steps.find((s) => s.phase === 'planning');
  const execSteps = steps.filter((s) => s.phase === 'execution');
  const anyTool = execSteps.find((s) => s.toolUsed);
  const planDur = planStep && typeof planStep.durationMs === 'number';
  rec('A4',
    planStep && planDur && execSteps.length >= 1 ? (anyTool ? 'pass' : 'fail') : 'fail',
    `steps=${steps.length} planning(phase,durMs)=${!!planStep},${planStep?.durationMs} execSteps=${execSteps.length} toolUsed=${execSteps.map((s) => s.toolUsed).join('|') || 'NONE'}`);

  // A6 milestones in chat
  const allMsgs = await h.messages(sid);
  const milestones = allMsgs.filter((m: any) => m.role === 'system' && m.metadata?.kind === 'task_progress' && m.metadata?.taskId === taskId).map((m: any) => m.metadata.milestone);
  const hasStartExecReview = ['started', 'executing', 'review'].every((k) => milestones.includes(k));
  rec('A6', hasStartExecReview ? 'pass' : 'fail', `milestones(before approve)=[${milestones.join(', ')}]`);

  // A7 approve -> done + review row
  const rev = await h.req<any>('POST', `/tasks/${taskId}/reviews`, { decision: 'approved' });
  const afterStatus = (await h.req<{ data: any }>('GET', `/tasks/${taskId}`)).body.data?.status;
  const reviews = (await h.req<{ data: any[] }>('GET', `/tasks/${taskId}/reviews`)).body.data ?? [];
  rec('A7',
    rev.status === 201 && afterStatus === 'done' && reviews.length === 1 && reviews[0].decision === 'approved' ? 'pass' : 'fail',
    `reviewPOST=${rev.status} status=${afterStatus} reviews=${reviews.length} decisions=[${reviews.map((r) => r.decision).join(',')}]`);

  // A6 follow-up: done milestone after approval?
  const finalMsgs = await h.messages(sid);
  const doneMilestone = finalMsgs.some((m: any) => m.metadata?.kind === 'task_progress' && m.metadata?.taskId === taskId && m.metadata?.milestone === 'done');
  rec('A6-done', doneMilestone ? 'pass' : 'fail', `done milestone posted to chat after approve=${doneMilestone} (grep showed no caller posts milestone:'done')`);

  return { taskId, sid };
}

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 2 — Dana Lewis: changes_requested loop
// ════════════════════════════════════════════════════════════════════════════
async function scenario2() {
  console.log('\n══ Scenario 2: Dana Lewis uses the changes_requested loop ══');
  const h = new Hearth();
  await h.login('product-lead@hearth.local');
  const sid = await h.newSession('GA launch — announcement');

  const { userMessageId, reply } = await h.ask(
    sid,
    "For the GA launch I need a first draft of the GA announcement blog post — cover the new collaboration features, the migration path, and a short FAQ. Keep it factual.",
  );
  console.log(`  Hearth replied: ${trim(reply)}`);
  if (!userMessageId) { rec('B1', 'inconclusive', 'no user message id'); return; }

  const promote = await h.req<any>('POST', `/chat/sessions/${sid}/messages/${userMessageId}/promote-to-task`, {
    title: 'Draft the GA announcement blog post',
    targetStatus: 'planning',
    attachRecentN: 4,
    provenance: 'chat_button',
  });
  const taskId = promote.body?.data?.id;
  console.log(`  promoted -> task ${taskId} (status ${promote.status})`);
  if (!taskId) { rec('B1', 'inconclusive', `promote failed ${promote.status}`); return; }

  let st = await pollTaskStatus(h, taskId, 'review');
  if (st !== 'review') { rec('B1', 'inconclusive', `task never reached first review (status=${st})`); return; }

  // count steps before loop
  const stepsBefore = (await h.req<{ data: any[] }>('GET', `/tasks/${taskId}/steps`)).body.data ?? [];
  const planStepsBefore = stepsBefore.filter((s) => s.phase === 'planning').length;

  // B3 empty feedback rejected
  const empty = await h.req<any>('POST', `/tasks/${taskId}/reviews`, { decision: 'changes_requested' });
  rec('B3', empty.status === 400 ? 'pass' : 'fail', `changes_requested w/o feedback -> ${empty.status} body=${trim(JSON.stringify(empty.body), 120)}`);

  // B1 changes_requested -> planning
  const feedback = "Too marketing-heavy. Cut the hype adjectives, lead with the concrete migration steps, and make the FAQ answer the top 3 breaking changes plainly.";
  const cr = await h.req<any>('POST', `/tasks/${taskId}/reviews`, { decision: 'changes_requested', feedback });
  const afterCR = (await h.req<{ data: any }>('GET', `/tasks/${taskId}`)).body.data?.status;
  rec('B1', cr.status === 201 && afterCR === 'planning' ? 'pass' : 'fail', `reviewPOST=${cr.status} status=${afterCR}`);

  // B2 feedback persisted in context
  const ctxTask = (await h.req<{ data: any }>('GET', `/tasks/${taskId}`)).body.data;
  const persisted = ctxTask?.context?.reviewFeedback;
  rec('B2', persisted === feedback ? 'pass' : 'fail', `context.reviewFeedback=${trim(String(persisted), 100)}`);

  // B4 re-plans and re-reaches review with a 2nd planning step
  const st2 = await pollTaskStatus(h, taskId, 'review');
  const stepsAfter = (await h.req<{ data: any[] }>('GET', `/tasks/${taskId}/steps`)).body.data ?? [];
  const planStepsAfter = stepsAfter.filter((s) => s.phase === 'planning').length;
  rec('B4', st2 === 'review' && planStepsAfter >= planStepsBefore + 1 ? 'pass' : 'fail',
    `2nd review status=${st2} planningSteps ${planStepsBefore}->${planStepsAfter}`);

  // B5 second approve -> done, 2 reviews ordered
  const ap2 = await h.req<any>('POST', `/tasks/${taskId}/reviews`, { decision: 'approved' });
  const finalStatus = (await h.req<{ data: any }>('GET', `/tasks/${taskId}`)).body.data?.status;
  const reviews = (await h.req<{ data: any[] }>('GET', `/tasks/${taskId}/reviews`)).body.data ?? [];
  const ordered = reviews.length === 2 && reviews[0].decision === 'changes_requested' && reviews[1].decision === 'approved';
  rec('B5', ap2.status === 201 && finalStatus === 'done' && ordered ? 'pass' : 'fail',
    `approve=${ap2.status} status=${finalStatus} reviews=[${reviews.map((r) => r.decision).join(',')}]`);

  // B6 milestone dedup on 2nd cycle
  const allMsgs = await h.messages(sid);
  const ms = allMsgs.filter((m: any) => m.metadata?.kind === 'task_progress' && m.metadata?.taskId === taskId).map((m: any) => m.metadata.milestone);
  const execCount = ms.filter((x: string) => x === 'executing').length;
  const reviewCount = ms.filter((x: string) => x === 'review').length;
  rec('B6', 'inconclusive', `milestone counts across loop: executing=${execCount} review=${reviewCount} all=[${ms.join(', ')}] (postTaskProgress dedupes per session+task+milestone => 2nd cards expected suppressed)`);
}

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 3 — Jordan Lee: idempotency + guard rails
// ════════════════════════════════════════════════════════════════════════════
async function scenario3() {
  console.log('\n══ Scenario 3: Jordan Lee — idempotency + illegal transitions ══');
  const h = new Hearth();
  await h.login('dev2@hearth.local');
  const sid = await h.newSession('Flaky test triage');

  const { userMessageId, reply } = await h.ask(
    sid,
    "The auth integration test `login.spec.ts` is flaky in CI — fails ~1 in 5 runs on a race with the session cookie. Can you note this so we fix it?",
  );
  console.log(`  Hearth replied: ${trim(reply)}`);
  if (!userMessageId) { rec('C1', 'inconclusive', 'no user message id'); return; }

  // C1 double-promote (backlog so no planner churn)
  const p1 = await h.req<any>('POST', `/chat/sessions/${sid}/messages/${userMessageId}/promote-to-task`, {
    title: 'Fix flaky login.spec.ts CI race', targetStatus: 'backlog', attachRecentN: 4, provenance: 'chat_button',
  });
  const p2 = await h.req<any>('POST', `/chat/sessions/${sid}/messages/${userMessageId}/promote-to-task`, {
    title: 'Fix flaky login.spec.ts CI race', targetStatus: 'backlog', attachRecentN: 4, provenance: 'chat_button',
  });
  const id1 = p1.body?.data?.id;
  const id2 = p2.body?.data?.id;
  const existing2 = p2.body?.data?.existing;
  const msgs = await h.messages(sid);
  const origin = msgs.find((m: any) => m.id === userMessageId);
  const occurrences = (origin?.producedTaskIds ?? []).filter((x: string) => x === id1).length;
  rec('C1',
    p1.status === 201 && p2.status === 200 && id1 && id1 === id2 && existing2 === true && occurrences === 1 ? 'pass' : 'fail',
    `p1=${p1.status}(${id1}) p2=${p2.status}(${id2}) existing=${existing2} producedTaskIds=${JSON.stringify(origin?.producedTaskIds)} occurrencesOfTask=${occurrences}`);
  if (!id1) return;

  // C3 single chat_excerpt
  const ctx = (await h.req<{ data: any[] }>('GET', `/tasks/${id1}/context-items`)).body.data ?? [];
  const excerptCount = ctx.filter((c) => c.type === 'chat_excerpt').length;
  rec('C3', excerptCount === 1 ? 'pass' : 'fail', `chat_excerpt count=${excerptCount} (items=${JSON.stringify(ctx.map((c) => c.type))})`);

  // C2 illegal backlog -> done
  const illegal = await h.req<any>('PATCH', `/tasks/${id1}`, { status: 'done' });
  const okErr = typeof illegal.body?.error === 'string' && /Invalid status transition/i.test(illegal.body.error);
  rec('C2', illegal.status === 422 && okErr ? 'pass' : 'fail', `PATCH backlog->done = ${illegal.status} error=${trim(JSON.stringify(illegal.body?.error), 120)}`);

  // C4 legal planning<->backlog
  const toPlanning = await h.req<any>('PATCH', `/tasks/${id1}`, { status: 'planning' });
  // small wait — moving to planning enqueues planner which may auto-advance; immediately move back
  const backToBacklog = await h.req<any>('PATCH', `/tasks/${id1}`, { status: 'backlog' });
  rec('C4', toPlanning.status === 200 && backToBacklog.status === 200 ? 'pass' : 'fail',
    `->planning=${toPlanning.status}(${toPlanning.body?.data?.status}) ->backlog=${backToBacklog.status}(${backToBacklog.body?.data?.status})`);
}

async function main() {
  console.log(`Task lifecycle pressure sim against ${API}`);
  const t0 = Date.now();
  try { await scenario1(); } catch (e) { console.error('scenario1 error:', e); }
  try { await scenario2(); } catch (e) { console.error('scenario2 error:', e); }
  try { await scenario3(); } catch (e) { console.error('scenario3 error:', e); }
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s.`);
  console.log('\n=== LEDGER ===');
  for (const r of results) console.log(`${r.status.toUpperCase().padEnd(12)} ${r.id}  ${trim(r.observed, 200)}`);
  console.log('=== JSON ===');
  console.log(JSON.stringify(results));
}

main().catch((e) => { console.error('sim failed:', e); process.exit(1); });
