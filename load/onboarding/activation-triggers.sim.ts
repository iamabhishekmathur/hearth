/**
 * ACTIVATION-TRIGGERS — the centerpiece of trigger-path fidelity.
 *
 * A freshly-registered MEMBER (role:member) in the shared bootstrap org holds a
 * realistic first conversation and we assert the right artifacts are born
 * THROUGH THEIR REAL TRIGGERS — never by POSTing the endpoint directly.
 *
 *   DECISION  ← agent calls capture_decision mid-chat when a committed decision
 *                is stated. NEGATIVE: an unresolved debate creates NO decision.
 *   MEMORY    ← agent calls save_memory on "remember that ...", then a NEW
 *                session retrieves & uses it. NEGATIVE: a plain question stores none.
 *   TASK      ← agent's propose_task → TaskSuggestion(pending) → /accept creates the
 *                Task (or create_task / promote-to-task). NEGATIVE: propose_task
 *                must not itself create a Task before accept.
 *
 * Org + LLM are already configured by the GENESIS agent on :8100. We only need to
 * register our own user. The worker (src/worker.ts) is up, so the background
 * decision-extraction path is also live (we observe it as a secondary signal).
 *
 * Run: API_URL=http://localhost:8100/api/v1 ./apps/api/node_modules/.bin/tsx load/onboarding/activation-triggers.sim.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8100/api/v1';
const REPLY_TIMEOUT_MS = 150_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 400) => {
  const c = (s ?? '').replace(/\s+/g, ' ').trim();
  return c.slice(0, n) + (c.length > n ? '…' : '');
};

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
  async register(email: string, password: string, name: string) {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    this.store(res);
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
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

async function sessionMessages(h: Hearth, sessionId: string): Promise<Msg[]> {
  const r = await h.req<{ data: { messages: Msg[] } }>('GET', `/chat/sessions/${sessionId}`);
  return r.body?.data?.messages ?? [];
}
async function assistantMessages(h: Hearth, sessionId: string): Promise<Msg[]> {
  return (await sessionMessages(h, sessionId)).filter((m) => m.role === 'assistant');
}

/** Send a user msg, poll for a NEW assistant message. */
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

const out: Record<string, any> = {};

async function listDecisions(h: Hearth) {
  const r = await h.req<{ data: any[] }>('GET', '/decisions?limit=50');
  return Array.isArray(r.body?.data) ? r.body.data : [];
}
async function listMemory(h: Hearth) {
  const r = await h.req<{ data: any[]; total: number }>('GET', '/memory?pageSize=100');
  return Array.isArray(r.body?.data) ? r.body.data : [];
}
async function listTasks(h: Hearth) {
  const r = await h.req<{ data: any[] }>('GET', '/tasks?page=1');
  return Array.isArray(r.body?.data) ? r.body.data : [];
}
async function listSuggestions(h: Hearth, status = 'pending') {
  const r = await h.req<{ data: any[] }>('GET', `/task-suggestions?status=${status}`);
  return Array.isArray(r.body?.data) ? r.body.data : [];
}

async function main() {
  const u = new Hearth();
  const stamp = Date.now();
  const email = `riley.activation+${stamp}@hearth-onboard.test`;
  const password = 'ActivationMember!2026';

  // ── REGISTER our own fresh member ────────────────────────────────────
  const reg = await u.register(email, password, 'Riley Chen');
  const loginStatus = await u.login(email, password);
  const me = await u.req<{ data: any }>('GET', '/auth/me');
  out.register = {
    status: reg.status,
    loginStatus,
    role: me.body?.data?.role,
    orgId: me.body?.data?.orgId ?? null,
    userId: me.body?.data?.id ?? null,
  };
  console.log('[reg] status', reg.status, 'login', loginStatus, 'role', me.body?.data?.role, 'orgId', me.body?.data?.orgId);
  if (me.body?.data?.role !== 'member') {
    console.log('[reg] WARNING: expected role member, got', me.body?.data?.role);
  }
  const myUserId = me.body?.data?.id;

  // Baselines (the shared org may already have artifacts from genesis; we assert DELTAS).
  const decBaseline = await listDecisions(u);
  const memBaseline = await listMemory(u);
  const taskBaseline = await listTasks(u);
  out.baselines = { decisions: decBaseline.length, memory: memBaseline.length, tasks: taskBaseline.length };
  const decBaselineIds = new Set(decBaseline.map((d) => d.id));
  const memBaselineIds = new Set(memBaseline.map((m) => m.id));
  const taskBaselineIds = new Set(taskBaseline.map((t) => t.id));

  // ════════════════════════════════════════════════════════════════════
  // 1. DECISION — positive: a clearly committed decision mid-conversation
  // ════════════════════════════════════════════════════════════════════
  const decSess = await u.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'Storage architecture' });
  const decSessId = decSess.body?.data?.id;
  out.decision = { sessionId: decSessId };

  // Turn 1: warm up with context (so it reads like a real conversation).
  const d1 = await ask(u, decSessId!, "Hey, I'm setting up the data layer for our new analytics service. We've been going back and forth between Postgres and Mongo for primary storage.");
  out.decision.turn1Reply = d1.reply ? trim(d1.reply.content, 300) : null;
  console.log('[decision] turn1 reply:', trim(d1.reply?.content ?? '', 200));

  // Turn 2: the committed decision — explicit, final, with rationale.
  const d2 = await ask(
    u,
    decSessId!,
    "Okay, we've made the call: we're standardizing on PostgreSQL for primary storage across all services. That's the final decision — the team aligned because we need strong transactional guarantees and our ops team already runs Postgres at scale. Mongo's out.",
  );
  out.decision.turn2Reply = d2.reply ? trim(d2.reply.content, 400) : null;
  console.log('[decision] turn2 (committed) reply:', trim(d2.reply?.content ?? '', 250));

  // Allow the agent tool-call's createDecision to land; poll the GET for a NEW row.
  let newDecision: any = null;
  for (let i = 0; i < 8; i++) {
    await sleep(2500);
    const now = await listDecisions(u);
    const fresh = now.filter((d) => !decBaselineIds.has(d.id));
    // Prefer a chat-sourced decision tied to THIS session, mentioning Postgres.
    newDecision =
      fresh.find((d) => d.source === 'chat' && d.sourceRef?.sessionId === decSessId) ??
      fresh.find((d) => /postgre/i.test(d.title ?? '') || /postgre/i.test(d.reasoning ?? '')) ??
      fresh[0] ??
      null;
    if (newDecision) break;
  }
  out.decision.captured = newDecision
    ? {
        id: newDecision.id,
        title: newDecision.title,
        reasoning: trim(newDecision.reasoning ?? '', 220),
        source: newDecision.source,
        sourceSessionId: newDecision.sourceRef?.sessionId ?? null,
        status: newDecision.status,
        createdById: newDecision.createdById ?? null,
        attributedToMe: (newDecision.createdById ?? null) === myUserId,
      }
    : null;
  console.log('[decision] captured:', JSON.stringify(out.decision.captured));

  // ── DECISION negative: an UNRESOLVED debate must create NO decision ──
  const debateSess = await u.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'Cache debate (unresolved)' });
  const debateSessId = debateSess.body?.data?.id;
  const decAfterPos = await listDecisions(u);
  const decAfterPosIds = new Set(decAfterPos.map((d) => d.id));
  const dn = await ask(
    u,
    debateSessId!,
    "Separately — for our caching layer I'm genuinely torn. Maybe Redis, maybe Memcached, honestly maybe we don't even need a cache yet. Let's not decide today, let's revisit next sprint once we have load numbers.",
  );
  out.decision.negativeReply = dn.reply ? trim(dn.reply.content, 300) : null;
  console.log('[decision] negative (debate) reply:', trim(dn.reply?.content ?? '', 200));
  // Give both the agent-tool path and the 8s-delayed background extractor time to (not) fire.
  await sleep(14000);
  const decAfterNeg = await listDecisions(u);
  const debateDecisions = decAfterNeg.filter(
    (d) => !decAfterPosIds.has(d.id) && (d.sourceRef?.sessionId === debateSessId || /redis|memcache|cach/i.test(d.title ?? '')),
  );
  out.decision.negativeCreatedNoDecision = debateDecisions.length === 0;
  out.decision.negativeStrayRows = debateDecisions.map((d) => ({ id: d.id, title: d.title, session: d.sourceRef?.sessionId }));
  console.log('[decision] negative created decisions:', debateDecisions.length);

  // ════════════════════════════════════════════════════════════════════
  // 2. MEMORY — positive: "remember that ..." → save_memory, then retrieve
  // ════════════════════════════════════════════════════════════════════
  const memSess = await u.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'Launch process' });
  const memSessId = memSess.body?.data?.id;
  out.memory = { writeSessionId: memSessId };

  const m1 = await ask(
    u,
    memSessId!,
    "Please remember that our launches always use a canary rollout: 5% → 25% → 100%. We never ship to 100% in one shot — that's a hard rule for our team.",
  );
  out.memory.writeReply = m1.reply ? trim(m1.reply.content, 350) : null;
  console.log('[memory] write reply:', trim(m1.reply?.content ?? '', 220));

  let newMemory: any = null;
  for (let i = 0; i < 8; i++) {
    await sleep(2500);
    const now = await listMemory(u);
    const fresh = now.filter((mm) => !memBaselineIds.has(mm.id));
    newMemory =
      fresh.find((mm) => /canary|5%|25%|100%|rollout/i.test(JSON.stringify(mm.content ?? mm))) ??
      fresh[0] ??
      null;
    if (newMemory) break;
  }
  out.memory.stored = newMemory
    ? {
        id: newMemory.id,
        layer: newMemory.layer,
        content: trim(typeof newMemory.content === 'string' ? newMemory.content : JSON.stringify(newMemory.content ?? newMemory), 240),
        expiresAt: newMemory.expiresAt ?? null,
        isUserLayer: newMemory.layer === 'user',
      }
    : null;
  console.log('[memory] stored:', JSON.stringify(out.memory.stored));

  // ── MEMORY retrieval: a NEW session asks something that should recall it ──
  const recallSess = await u.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'Rollout question (new session)' });
  const recallSessId = recallSess.body?.data?.id;
  out.memory.recallSessionId = recallSessId;
  const r1 = await ask(
    u,
    recallSessId!,
    "Quick one — when we ship the new billing feature next week, what rollout percentages should we step through?",
  );
  const recallText = r1.reply?.content ?? '';
  // Did the agent USE the stored canary memory? Look for the specific steps.
  const recalledCanary =
    /canary/i.test(recallText) ||
    (/5\s*%/.test(recallText) && /25\s*%/.test(recallText) && /100\s*%/.test(recallText));
  out.memory.recall = {
    reply: trim(recallText, 400),
    recalledStoredFact: recalledCanary,
  };
  console.log('[memory] recall used stored fact:', recalledCanary, '|', trim(recallText, 200));

  // ── MEMORY negative: a plain question must store NO memory ──
  const memNegSess = await u.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'Plain question' });
  const memNegSessId = memNegSess.body?.data?.id;
  const memBeforeNeg = await listMemory(u);
  const memBeforeNegIds = new Set(memBeforeNeg.map((mm) => mm.id));
  const mn = await ask(u, memNegSessId!, "Should we use Markdown or AsciiDoc for our internal docs? What do you think?");
  out.memory.negativeReply = mn.reply ? trim(mn.reply.content, 300) : null;
  await sleep(6000);
  const memAfterNeg = await listMemory(u);
  const strayMem = memAfterNeg.filter(
    (mm) => !memBeforeNegIds.has(mm.id) && /markdown|asciidoc|docs/i.test(JSON.stringify(mm.content ?? mm)),
  );
  out.memory.negativeStoredNoMemory = strayMem.length === 0;
  out.memory.negativeStrayRows = strayMem.map((mm) => ({ id: mm.id, layer: mm.layer, content: trim(JSON.stringify(mm.content ?? mm), 120) }));
  console.log('[memory] negative stored memories:', strayMem.length);

  // ════════════════════════════════════════════════════════════════════
  // 3. TASK from conversation — real path (propose_task → accept, or create_task)
  // ════════════════════════════════════════════════════════════════════
  const taskSess = await u.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'Q3 onboarding revamp' });
  const taskSessId = taskSess.body?.data?.id;
  out.task = { sessionId: taskSessId };

  // A turn that implies delegable, multi-step work (drives propose_task / create_task).
  const t1 = await ask(
    u,
    taskSessId!,
    "I need to completely revamp our new-hire onboarding flow before Q3. It's a real project: audit the current 12-step flow, interview the last 5 hires about where they got stuck, redesign the checklist, and roll out the new version to the next cohort. Can you set this up as a tracked task and own the breakdown?",
  );
  out.task.reply = t1.reply ? trim(t1.reply.content, 450) : null;
  console.log('[task] reply:', trim(t1.reply?.content ?? '', 280));

  // Path A: did the agent create_task directly? (new Task appears tied to session)
  let directTask: any = null;
  // Path B: did the agent propose_task? (a pending suggestion appears)
  let suggestion: any = null;
  for (let i = 0; i < 8; i++) {
    await sleep(2500);
    const tasksNow = await listTasks(u);
    directTask =
      tasksNow.find((t) => !taskBaselineIds.has(t.id) && t.sourceSessionId === taskSessId) ??
      tasksNow.find((t) => !taskBaselineIds.has(t.id) && /onboard/i.test(t.title ?? '')) ??
      null;
    const sugg = await listSuggestions(u, 'pending');
    suggestion = sugg.find((s) => s.sessionId === taskSessId) ?? sugg[0] ?? null;
    if (directTask || suggestion) break;
  }
  out.task.directCreateTask = directTask
    ? { id: directTask.id, title: directTask.title, status: directTask.status, sourceSessionId: directTask.sourceSessionId, provenance: directTask.provenance ?? null }
    : null;
  out.task.proposedSuggestion = suggestion
    ? { id: suggestion.id, title: suggestion.proposedTitle, status: suggestion.status, sessionId: suggestion.sessionId }
    : null;
  console.log('[task] direct create_task:', JSON.stringify(out.task.directCreateTask));
  console.log('[task] propose_task suggestion:', JSON.stringify(out.task.proposedSuggestion));

  // If a suggestion exists, assert it did NOT already create a task, then ACCEPT it.
  if (suggestion) {
    const tasksBeforeAccept = await listTasks(u);
    const proposedAlreadyTask = tasksBeforeAccept.some(
      (t) => !taskBaselineIds.has(t.id) && t.sourceSessionId === taskSessId,
    );
    out.task.proposeDidNotCreateTaskBeforeAccept = !proposedAlreadyTask;
    console.log('[task] propose_task created task BEFORE accept?', proposedAlreadyTask, '(should be false)');

    const accept = await u.req<{ data: { task: any } }>('POST', `/task-suggestions/${suggestion.id}/accept`, {
      targetStatus: 'backlog',
    });
    out.task.acceptStatus = accept.status;
    const acceptedTask = accept.body?.data?.task ?? null;
    out.task.acceptedTask = acceptedTask
      ? { id: acceptedTask.id, title: acceptedTask.title, status: acceptedTask.status, sourceSessionId: acceptedTask.sourceSessionId, provenance: acceptedTask.provenance ?? null }
      : null;
    console.log('[task] accept status', accept.status, 'task:', JSON.stringify(out.task.acceptedTask));

    // Confirm the task now exists in the real list with session provenance.
    const tasksAfterAccept = await listTasks(u);
    const realTask = tasksAfterAccept.find((t) => t.id === acceptedTask?.id);
    out.task.taskMaterializedViaAccept = !!realTask && realTask.sourceSessionId === taskSessId;
    out.task.realTaskRow = realTask
      ? { id: realTask.id, title: realTask.title, status: realTask.status, sourceSessionId: realTask.sourceSessionId, sourceMessageId: realTask.sourceMessageId ?? null }
      : null;
  } else {
    out.task.proposeDidNotCreateTaskBeforeAccept = null;
    out.task.taskMaterializedViaAccept = null;
  }

  // FALLBACK real trigger: if neither propose nor create_task fired, drive the
  // explicit manual trigger (promote-to-task button) on the user's own message —
  // still NOT a direct POST /tasks.
  if (!directTask && !out.task.acceptedTask) {
    const msgs = await sessionMessages(u, taskSessId!);
    const userMsg = [...msgs].reverse().find((m) => m.role === 'user');
    if (userMsg) {
      const promote = await u.req<{ data: { task: any; existing?: boolean } }>(
        'POST',
        `/chat/sessions/${taskSessId}/messages/${userMsg.id}/promote-to-task`,
        { targetStatus: 'backlog' },
      );
      out.task.promoteFallbackStatus = promote.status;
      const pt = promote.body?.data?.task ?? null;
      out.task.promoteFallbackTask = pt
        ? { id: pt.id, title: pt.title, status: pt.status, sourceSessionId: pt.sourceSessionId, provenance: pt.provenance ?? null }
        : null;
      console.log('[task] promote-to-task fallback', promote.status, JSON.stringify(out.task.promoteFallbackTask));
    }
  }

  // Final delta count of tasks created during the run.
  const tasksFinal = await listTasks(u);
  out.task.tasksCreatedThisRun = tasksFinal.filter((t) => !taskBaselineIds.has(t.id)).map((t) => ({ id: t.id, title: t.title, status: t.status, provenance: t.provenance ?? null, sourceSessionId: t.sourceSessionId ?? null }));

  console.log('\n===== ACTIVATION-TRIGGERS RESULT =====');
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error('ACTIVATION FATAL', err);
  out.fatal = err instanceof Error ? err.message : String(err);
  console.log('\n===== ACTIVATION-TRIGGERS RESULT (partial) =====');
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
});
