/**
 * Skills pressure test — do installed skills actually flow into chat / tasks / routines?
 *
 * Verified mechanism (apps/api/src/agent/system-prompt.ts §3):
 *   For a given userId, ALL installed UserSkills are dumped (name+desc+content) into the
 *   system prompt under "## Installed Skills". Not relevance/tag matched — always injected.
 *   buildAgentContext(userId) feeds chat, task-planner, task-executor, routine-scheduler.
 *
 * Run:
 *   API_URL=http://localhost:8000/api/v1 ./apps/api/node_modules/.bin/tsx load/pressure/skills.sim.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';
const REPLY_TIMEOUT_MS = 150_000;

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
const trim = (s: string, n = 300) => { const c = (s ?? '').replace(/\s+/g, ' ').trim(); return c.slice(0, n) + (c.length > n ? '…' : ''); };
const has = (s: string, n: string) => (s ?? '').includes(n);

// ── Skill definitions with distinctive sentinels ──
const RNF_SENTINELS = ['RNF-v3', '## TL;DR', '## Shipped', '## Known Gremlins', '## Upgrade Footnotes'];
const SQL_SENTINELS = ['SQL-CHECKLIST-7', 'index coverage', 'N+1 risk', 'lock contention', 'cardinality estimate', 'rollback safety'];

const releaseNotesSkill = {
  name: 'release-notes-format',
  description: 'Mandatory structure for ALL release notes. Always apply when drafting release notes.',
  content: `---
name: release-notes-format
description: Mandatory structure for ALL release notes.
---

# Release Notes Format (house style)

When the user asks you to draft, write, or outline release notes for ANY version, you MUST
follow this exact structure with no deviation:

1. Begin the document with the literal marker line: \`RNF-v3\`
2. Then exactly these four H2 sections, in this order, using these EXACT headings:
   - \`## TL;DR\` — one-sentence summary
   - \`## Shipped\` — bullet list of what shipped
   - \`## Known Gremlins\` — known issues (we call them "gremlins", never "bugs")
   - \`## Upgrade Footnotes\` — migration/upgrade steps

Never use any other headings for release notes. Always include all four, even if a section is empty
(write "_None_"). The marker \`RNF-v3\` must appear before any other content.`,
};

const sqlReviewSkill = {
  name: 'sql-review-checklist',
  description: 'Mandatory checklist applied to ALL SQL query reviews.',
  content: `---
name: sql-review-checklist
description: Mandatory checklist applied to ALL SQL query reviews.
---

# SQL Review Checklist

When reviewing ANY SQL query, you MUST evaluate it against exactly these five items, in order,
and address each one explicitly by name:

1. index coverage — are the predicates/joins index-backed?
2. N+1 risk — could this run per-row in a loop?
3. lock contention — does it hold locks that block writers?
4. cardinality estimate — is the planner's row estimate plausible?
5. rollback safety — can it be reverted without data loss?

End EVERY SQL review with the trailing token on its own line: \`SQL-CHECKLIST-7\``,
};

interface Finding { id: string; status: 'pass' | 'fail' | 'inconclusive'; observed: string }
const findings: Finding[] = [];
const record = (id: string, status: Finding['status'], observed: string) => {
  findings.push({ id, status, observed });
  console.log(`  [${status.toUpperCase()}] ${id}: ${trim(observed, 220)}`);
};

async function findOrCreateSkill(client: Hearth, def: { name: string; description: string; content: string }, scope?: string) {
  // Look in the org list first (skills may already exist from a prior run)
  const list = await client.req<{ data: Array<{ id: string; name: string; status: string }> }>('GET', '/skills');
  const existing = list.body?.data?.find((s) => s.name === def.name);
  if (existing) return { status: 200, body: { data: existing }, reused: true };
  const body: any = { ...def };
  if (scope) body.scope = scope;
  const res = await client.req<{ data: { id: string; status: string } }>('POST', '/skills', body);
  return { ...res, reused: false };
}

async function main() {
  console.log(`\nSkills pressure test against ${API}\n${'='.repeat(70)}`);

  // ════════════════════════════════════════════════════════════════════
  // SCENARIO A — installed release-notes skill governs chat AND a task
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- Scenario A: Devin installs release-notes-format ---');
  const devin = new Hearth();
  await devin.login('eng-lead@hearth.local');

  const created = await findOrCreateSkill(devin, releaseNotesSkill);
  console.log(`  create/reuse skill -> status ${created.status} reused=${(created as any).reused} bodyStatus=${created.body?.data?.status}`);
  const rnfSkillId = created.body?.data?.id;
  if ((created as any).reused) {
    record('A1', 'inconclusive', `skill already existed from prior run; status=${created.body?.data?.status} (cannot reassert 201/published creation)`);
  } else if (created.status === 201 && created.body?.data?.status === 'published') {
    record('A1', 'pass', `POST /skills (no scope) -> 201, status='published'`);
  } else {
    record('A1', 'fail', `expected 201 published, got status ${created.status} body.status=${created.body?.data?.status}`);
  }

  if (!rnfSkillId) { record('A2', 'fail', 'no skill id returned'); }
  else {
    const inst = await devin.req('POST', `/skills/${rnfSkillId}/install`);
    const installedList = await devin.req<{ data: Array<{ name: string }> }>('GET', '/skills/installed');
    const names = (installedList.body?.data ?? []).map((s) => s.name);
    const ok = (inst.status === 201 || inst.status === 200) && names.includes('release-notes-format');
    record('A2', ok ? 'pass' : 'fail', `install -> ${inst.status}; installed=[${names.join(', ')}]`);
  }

  // A3 — chat reply must reflect the skill structure
  const sessId = await devin.newSession('v2.4 release notes');
  const chatQ = 'Draft the release notes for our v2.4 release. We shipped saved views and dark mode, there is a known issue with slow CSV export, and upgrading requires running a DB migration.';
  console.log('  asking Hearth in chat (waiting for real agent reply)...');
  const reply = await devin.ask(sessId, chatQ);
  console.log(`  Hearth reply: ${trim(reply, 400)}`);
  const presentRnf = RNF_SENTINELS.filter((s) => has(reply, s));
  if (presentRnf.length >= 4) {
    record('A3', 'pass', `chat reply contains ${presentRnf.length}/5 sentinels: ${presentRnf.join(' | ')}`);
  } else if (presentRnf.length >= 1) {
    record('A3', 'fail', `partial skill influence: only ${presentRnf.length}/5 sentinels present (${presentRnf.join(' | ')}). reply head: ${trim(reply, 160)}`);
  } else {
    record('A3', 'fail', `NO sentinels in chat reply — skill did not govern output. reply head: ${trim(reply, 200)}`);
  }

  // A4 — task planning/execution must reflect the skill
  const taskRes = await devin.req<{ data: { id: string; status: string } }>('POST', '/tasks', {
    title: 'Write v2.4 release notes',
    description: 'Draft the customer-facing release notes for v2.4 (saved views, dark mode; known slow CSV export; needs DB migration on upgrade).',
    source: 'manual',
  });
  const taskId = taskRes.body?.data?.id;
  console.log(`  task created -> ${taskRes.status} id=${taskId} status=${taskRes.body?.data?.status}`);
  if (!taskId) {
    record('A4', 'fail', `task create failed: ${taskRes.status} ${trim(JSON.stringify(taskRes.body), 150)}`);
  } else {
    // auto_detected -> backlog -> planning
    const t1 = await devin.req('PATCH', `/tasks/${taskId}`, { status: 'backlog' });
    const t2 = await devin.req('PATCH', `/tasks/${taskId}`, { status: 'planning' });
    console.log(`  transitions: backlog=${t1.status} planning=${t2.status}`);
    // Poll steps + subtasks for skill influence
    const start = Date.now();
    let evidence = '';
    let found = 0;
    while (Date.now() - start < 90_000) {
      await sleep(4000);
      const steps = await devin.req<{ data: Array<{ description?: string; output?: any; phase?: string; status?: string }> }>('GET', `/tasks/${taskId}/steps`);
      const taskNow = await devin.req<{ data: { status: string } }>('GET', `/tasks/${taskId}`);
      const subs = await devin.req<{ data: Array<{ title: string; description?: string }> }>('GET', `/tasks?parentTaskId=${taskId}`);
      const blob = JSON.stringify(steps.body?.data ?? []) + JSON.stringify(subs.body?.data ?? []);
      const present = RNF_SENTINELS.filter((s) => blob.includes(s));
      if (present.length > found) { found = present.length; evidence = present.join(' | '); }
      const stepCount = steps.body?.data?.length ?? 0;
      const planningDone = (steps.body?.data ?? []).some((s) => s.phase === 'planning' && s.status === 'completed');
      if (planningDone && stepCount > 0) {
        // grab a readable snippet
        const planStep = (steps.body?.data ?? []).find((s) => s.phase === 'planning');
        const raw = planStep?.output?.raw ?? '';
        console.log(`  task status=${taskNow.body?.data?.status} steps=${stepCount} planRaw head: ${trim(String(raw), 220)}`);
        if (found >= 1) break;
        // keep polling a bit for executor output
      }
      if (taskNow.body?.data?.status === 'review' || taskNow.body?.data?.status === 'done' || taskNow.body?.data?.status === 'failed') {
        if (found >= 1) break;
      }
    }
    if (found >= 4) record('A4', 'pass', `task plan/steps contain ${found}/5 sentinels: ${evidence}`);
    else if (found >= 1) record('A4', 'pass', `task plan reflects skill (${found}/5 sentinels): ${evidence}`);
    else {
      // dump a final snapshot for the report
      const steps = await devin.req<{ data: any[] }>('GET', `/tasks/${taskId}/steps`);
      const subs = await devin.req<{ data: any[] }>('GET', `/tasks?parentTaskId=${taskId}`);
      record('A4', 'fail', `no RNF sentinels in plan/steps/subtasks. steps=${steps.body?.data?.length ?? 0} subs=${subs.body?.data?.length ?? 0}. subtask titles: ${trim((subs.body?.data ?? []).map((s: any) => s.title).join(' / '), 200)}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // SCENARIO B — negative control: Sam never installed → no leak
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- Scenario B: Sam (no install) asks identical question ---');
  const sam = new Hearth();
  await sam.login('dev1@hearth.local');
  // Ensure Sam does NOT have it installed (uninstall if leftover from prior run)
  if (rnfSkillId) await sam.req('DELETE', `/skills/${rnfSkillId}/install`).catch(() => {});
  const samInstalled = await sam.req<{ data: Array<{ name: string }> }>('GET', '/skills/installed');
  const samNames = (samInstalled.body?.data ?? []).map((s) => s.name);
  if (!samNames.includes('release-notes-format')) record('B1', 'pass', `Sam installed=[${samNames.join(', ') || 'none'}] — no release-notes-format`);
  else record('B1', 'fail', `Sam unexpectedly has release-notes-format installed`);

  const samSess = await sam.newSession('v2.4 release notes (control)');
  console.log('  asking Hearth as Sam (waiting for real reply)...');
  const samReply = await sam.ask(samSess, chatQ);
  console.log(`  Hearth reply (Sam): ${trim(samReply, 400)}`);
  const leak = RNF_SENTINELS.filter((s) => has(samReply, s) && s !== '## Shipped'); // '## Shipped' is plausible generically; the rare ones are the tell
  const rareLeak = ['RNF-v3', '## Known Gremlins', '## Upgrade Footnotes'].filter((s) => has(samReply, s));
  if (rareLeak.length === 0) record('B2', 'pass', `no rare sentinels leaked to Sam (generic answer). incidental generic matches: [${leak.join(', ') || 'none'}]`);
  else record('B2', 'fail', `LEAK: Sam's reply contains rare sentinels [${rareLeak.join(', ')}] without installing the skill`);

  // ════════════════════════════════════════════════════════════════════
  // SCENARIO C — admin approval gate + SQL skill in a routine
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- Scenario C: org skill approval gate + routine ---');
  const omar = new Hearth();
  await omar.login('data-analyst@hearth.local');

  const sqlCreated = await findOrCreateSkill(omar, sqlReviewSkill, 'org');
  console.log(`  create/reuse SQL skill -> status ${sqlCreated.status} reused=${(sqlCreated as any).reused} bodyStatus=${sqlCreated.body?.data?.status}`);
  const sqlSkillId = sqlCreated.body?.data?.id;
  if ((sqlCreated as any).reused) {
    record('C1', 'inconclusive', `org skill already existed; status=${sqlCreated.body?.data?.status}`);
  } else if (sqlCreated.status === 201 && sqlCreated.body?.data?.status === 'pending_review') {
    record('C1', 'pass', `POST /skills {scope:'org'} -> 201 pending_review`);
  } else {
    record('C1', 'fail', `expected 201 pending_review, got ${sqlCreated.status} status=${sqlCreated.body?.data?.status}`);
  }

  // C2 — non-admin (Omar) cannot approve
  const nonAdminPatch = await omar.req('PATCH', `/skills/${sqlSkillId}`, { status: 'published' });
  if (nonAdminPatch.status === 403) record('C2', 'pass', `non-admin PATCH status -> 403`);
  else record('C2', 'fail', `expected 403, got ${nonAdminPatch.status} ${trim(JSON.stringify(nonAdminPatch.body), 120)}`);

  // C3 — admin approves
  const alex = new Hearth();
  await alex.login('admin@hearth.local');
  const adminPatch = await alex.req<{ data: { status: string } }>('PATCH', `/skills/${sqlSkillId}`, { status: 'published' });
  if (adminPatch.status === 200 && adminPatch.body?.data?.status === 'published') record('C3', 'pass', `admin PATCH -> 200 published`);
  else record('C3', 'fail', `expected 200 published, got ${adminPatch.status} status=${adminPatch.body?.data?.status}`);

  // Omar installs the now-published skill
  const omarInstall = await omar.req('POST', `/skills/${sqlSkillId}/install`);
  const omarInstalled = await omar.req<{ data: Array<{ name: string }> }>('GET', '/skills/installed');
  const omarNames = (omarInstalled.body?.data ?? []).map((s) => s.name);
  console.log(`  Omar install -> ${omarInstall.status}; installed=[${omarNames.join(', ')}]`);

  // C4 — routine test-run reflects SQL skill
  const routinePrompt = 'Review this SQL query for our analytics dashboard and report any concerns:\n\nSELECT u.id, u.email, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count FROM users u WHERE u.created_at > NOW() - INTERVAL \'30 days\' ORDER BY order_count DESC;';
  console.log('  running routine test-run (up to 30s server-side)...');
  const routineRun = await omar.req<{ data: { status: string; output: string | null; error?: string } }>('POST', '/routines/test-run', { prompt: routinePrompt });
  const out = routineRun.body?.data?.output ?? '';
  console.log(`  routine status=${routineRun.body?.data?.status} err=${routineRun.body?.data?.error ?? ''}`);
  console.log(`  routine output: ${trim(String(out), 500)}`);
  const sqlPresent = SQL_SENTINELS.filter((s) => has(String(out), s));
  if (sqlPresent.includes('SQL-CHECKLIST-7') && sqlPresent.length >= 4) {
    record('C4', 'pass', `routine output has token + ${sqlPresent.length}/6 sentinels: ${sqlPresent.join(' | ')}`);
  } else if (sqlPresent.length >= 1) {
    record('C4', 'fail', `partial: ${sqlPresent.length}/6 sentinels (${sqlPresent.join(' | ')}); SQL-CHECKLIST-7 present=${sqlPresent.includes('SQL-CHECKLIST-7')}. status=${routineRun.body?.data?.status}`);
  } else {
    record('C4', 'fail', `NO sentinels in routine output. status=${routineRun.body?.data?.status} err=${routineRun.body?.data?.error ?? ''} outHead=${trim(String(out), 150)}`);
  }

  // C5 — no cross-user bleed: Omar must NOT carry RNF-v3
  const rnfLeakOmar = ['RNF-v3', '## Known Gremlins', '## Upgrade Footnotes'].filter((s) => has(String(out), s));
  if (rnfLeakOmar.length === 0) record('C5', 'pass', `Omar's routine output has no release-notes sentinels (no cross-user bleed)`);
  else record('C5', 'fail', `BLEED: Omar's output contains [${rnfLeakOmar.join(', ')}] from another user's skill`);

  // ── Summary ──
  console.log(`\n${'='.repeat(70)}\nRESULTS`);
  for (const f of findings) console.log(`  ${f.id}: ${f.status.toUpperCase()}`);
  const pass = findings.filter((f) => f.status === 'pass').length;
  const fail = findings.filter((f) => f.status === 'fail').length;
  const inc = findings.filter((f) => f.status === 'inconclusive').length;
  console.log(`  TOTAL: ${pass} pass / ${fail} fail / ${inc} inconclusive`);
  console.log('\n__FINDINGS_JSON__' + JSON.stringify(findings));
}

main().catch((e) => { console.error('sim failed:', e); process.exit(1); });
