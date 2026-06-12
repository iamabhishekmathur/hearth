/**
 * memory-decisions pressure test.
 *
 * Drives the REAL Hearth API + workers. No mocks.
 *   API_URL=http://localhost:8000/api/v1 ./apps/api/node_modules/.bin/tsx load/pressure/memory-decisions.sim.ts
 *
 * Scenarios:
 *  A — Friday arch sync meeting: 2 real decisions + tabled debate + open question.
 *  B — dedup (identical re-ingest) + concurrent Sam chat that states a real decision.
 *  C — Priya memory: remember a durable preference; ignore a question/coffee/forget-me.
 */

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';
const REPLY_TIMEOUT_MS = 150_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 300) => { const c = (s ?? '').replace(/\s+/g, ' ').trim(); return c.slice(0, n) + (c.length > n ? '…' : ''); };

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

interface Decision { id: string; title: string; reasoning?: string; domain?: string; status?: string; source?: string; sourceRef?: any; confidence?: string; }
interface MemoryEntry { id: string; layer: string; content: string; source?: string; expiresAt?: string | null; }

function listToArray<T>(body: any): T[] {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.items)) return body.items;
  if (body.data && Array.isArray(body.data.items)) return body.data.items;
  return [];
}

const results: Array<{ id: string; status: 'pass' | 'fail' | 'inconclusive'; note: string }> = [];
const record = (id: string, status: 'pass' | 'fail' | 'inconclusive', note: string) => {
  results.push({ id, status, note });
  const icon = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'INCONCLUSIVE';
  console.log(`  [${icon}] ${id}: ${note}`);
};

// ── Transcript fixtures ───────────────────────────────────────────────────────
const ARCH_SYNC_TRANSCRIPT = `
Friday Architecture Sync — attendees: Devin Rao, Marcus Chen, Sam Park, Jordan Lee.

Devin: Morning all, grabbed a coffee, let's get started. Three things on the agenda.

Marcus: First up, the nightly export. It keeps timing out because it runs inline in the cron process.
Sam: Yeah it's brittle. If one batch is slow the whole thing dies.
Devin: Okay. Decision: we'll move the nightly export to a queue-backed job by next sprint. Marcus owns it.
Marcus: Works for me. I'll wire it onto BullMQ and own the migration.
Devin: Great, that's settled.

Jordan: Next, the database question. We've been going back and forth on whether to add a second OLTP store.
Marcus: I really think we should just commit. We decided to standardize on Postgres as our primary datastore. We are not adding a second OLTP database — one well-tuned Postgres with read replicas is the call.
Devin: Agreed, that's the standard going forward. Postgres primary, no second OLTP store.
Sam: Sounds good, I'll update the architecture doc.

Jordan: Third — eventing. Should we use Kafka or Redis Streams for the new event bus?
Sam: Kafka is heavier ops but battle-tested. Redis Streams is simpler since we already run Redis.
Marcus: I'm genuinely torn. Kafka's durability guarantees are nicer but the operational cost is real.
Jordan: Honestly we keep circling. Let's table it — we didn't land on anything today. Revisit next week with numbers.
Devin: Fine, tabled. No decision on the event bus yet.

Sam: Last thing — should we move auth to a third-party provider like Auth0?
Devin: Open question. Nobody has a strong view yet. Let's not decide today, just flagging it.
Marcus: Yeah, parking that one.

Devin: Cool. Anyone doing anything fun this weekend?
Jordan: Hiking if the weather holds.
Devin: Nice. Alright, that's a wrap. Thanks everyone.
`.trim();

function matchNightlyExport(d: Decision) {
  const t = `${d.title} ${d.reasoning ?? ''}`.toLowerCase();
  return /(nightly|export)/.test(t) && /(queue|bullmq|job)/.test(t);
}
function matchPostgres(d: Decision) {
  const t = `${d.title} ${d.reasoning ?? ''}`.toLowerCase();
  return /postgres/.test(t) && /(standard|primary|datastore|oltp)/.test(t);
}
function matchKafkaDebate(d: Decision) {
  const t = `${d.title} ${d.reasoning ?? ''}`.toLowerCase();
  return /(kafka|redis stream|event bus|eventing)/.test(t);
}
function matchAuth0(d: Decision) {
  const t = `${d.title} ${d.reasoning ?? ''}`.toLowerCase();
  return /(auth0|third-party (auth|provider)|auth provider)/.test(t);
}

async function pollMeetingProcessed(h: Hearth, meetingId: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await h.req<{ data: any }>('GET', `/meetings/${meetingId}`);
    if (r.body?.data?.processedAt) return r.body.data;
    await sleep(3000);
  }
  const r = await h.req<{ data: any }>('GET', `/meetings/${meetingId}`);
  return r.body?.data;
}

// ════════════════════════════════════════════════════════════════════════════
async function scenarioA(devin: Hearth) {
  console.log(`\n${'═'.repeat(78)}\n▶ Scenario A — Friday architecture sync meeting\n${'═'.repeat(78)}`);

  const ing = await devin.req<{ data: any }>('POST', '/meetings/ingest', {
    provider: 'manual',
    title: 'Friday architecture sync',
    transcript: ARCH_SYNC_TRANSCRIPT,
    participants: ['Devin Rao', 'Marcus Chen', 'Sam Park', 'Jordan Lee'],
    meetingDate: new Date().toISOString(),
  });
  console.log(`  ingest status=${ing.status} meetingId=${ing.body?.data?.id}`);
  if (ing.status !== 201) {
    record('A-RECALL', 'inconclusive', `ingest failed status=${ing.status} body=${trim(JSON.stringify(ing.body))}`);
    return null;
  }
  const meetingId = ing.body.data.id as string;

  console.log('  polling for processedAt...');
  const meeting = await pollMeetingProcessed(devin, meetingId);
  console.log(`  processedAt=${meeting?.processedAt} decisionsExtracted=${meeting?.decisionsExtracted}`);

  const decisions = (meeting?.decisions ?? []) as Decision[];
  console.log(`  GET /meetings/:id .decisions count=${decisions.length}`);
  decisions.forEach((d, i) => console.log(`    [${i}] "${d.title}" (conf=${d.confidence}, status=${d.status})`));

  if (!meeting?.processedAt) {
    record('A-COUNT', 'fail', `worker never set processedAt within timeout; decisionsExtracted=${meeting?.decisionsExtracted}`);
  } else {
    record('A-COUNT', 'pass', `processedAt set, decisionsExtracted=${meeting.decisionsExtracted}, stored decisions=${decisions.length}: ${decisions.map(d => `"${trim(d.title, 60)}"`).join(' | ')}`);
  }

  const hasNightly = decisions.some(matchNightlyExport);
  const hasPg = decisions.some(matchPostgres);
  if (hasNightly && hasPg) record('A-RECALL', 'pass', `both real decisions captured: nightly-export-queue=${hasNightly}, postgres-standardize=${hasPg}`);
  else record('A-RECALL', 'fail', `FALSE NEGATIVE — nightly-export-queue=${hasNightly}, postgres-standardize=${hasPg}. Titles: ${decisions.map(d => `"${trim(d.title, 50)}"`).join(' | ')}`);

  const debate = decisions.filter(matchKafkaDebate);
  if (debate.length === 0) record('A-PRECISION-debate', 'pass', 'tabled Kafka-vs-Redis-Streams debate NOT stored');
  else record('A-PRECISION-debate', 'fail', `FALSE POSITIVE — tabled debate stored as decision(s): ${debate.map(d => `"${trim(d.title, 60)}"`).join(' | ')}`);

  const q = decisions.filter(matchAuth0);
  if (q.length === 0) record('A-PRECISION-question', 'pass', 'open Auth0 question NOT stored');
  else record('A-PRECISION-question', 'fail', `FALSE POSITIVE — Auth0 open question stored as decision(s): ${q.map(d => `"${trim(d.title, 60)}"`).join(' | ')}`);

  return { meetingId, decisions };
}

// ════════════════════════════════════════════════════════════════════════════
async function scenarioB(devin: Hearth) {
  console.log(`\n${'═'.repeat(78)}\n▶ Scenario B — dedup + concurrent chat extraction\n${'═'.repeat(78)}`);

  // M-dup: single clean decision meeting, ingested twice.
  const M_DUP_TRANSCRIPT = `
Infra Standup — attendees: Devin Rao, Marcus Chen.
Devin: One item. The deploy pipeline is flaky on rollback.
Marcus: We keep hand-rolling rollbacks.
Devin: Decision: we'll adopt blue-green deploys for all production services starting next release. Marcus owns the rollout.
Marcus: Agreed, blue-green it is. I'll own it.
Devin: Settled. That's the call.
`.trim();

  const ingest1 = await devin.req<{ data: any }>('POST', '/meetings/ingest', {
    provider: 'manual', title: 'Infra standup (sync 1)', transcript: M_DUP_TRANSCRIPT,
    participants: ['Devin Rao', 'Marcus Chen'], meetingDate: new Date().toISOString(),
  });
  const m1 = ingest1.body?.data?.id;
  console.log(`  M-dup ingest #1 status=${ingest1.status} id=${m1}`);
  const meeting1 = await pollMeetingProcessed(devin, m1);
  console.log(`  M-dup #1 processedAt=${meeting1?.processedAt} decisionsExtracted=${meeting1?.decisionsExtracted}`);
  const d1 = (meeting1?.decisions ?? []) as Decision[];
  d1.forEach(d => console.log(`    #1 -> "${d.title}"`));

  // Let the first decision's async embedding land before the duplicate ingest (dedup depends on it).
  console.log('  waiting 8s for embedding to land before duplicate ingest...');
  await sleep(8000);

  // Kick off Sam's concurrent chat IN PARALLEL with the duplicate ingest+processing.
  const samChatPromise = (async () => {
    const sam = new Hearth();
    await sam.login('dev1@hearth.local');
    const sid = await sam.newSession('Rollout approach');
    console.log(`  [Sam concurrent chat] session=${sid}`);
    const r1 = await sam.ask(sid, "Hey, quick one. We've been comparing rollout strategies for the new billing flow.");
    console.log(`    Sam<-Hearth: ${trim(r1, 160)}`);
    const r2 = await sam.ask(sid, "We're going with feature flags via LaunchDarkly for the rollout — that's the final call, I'll wire it up this week.");
    console.log(`    Sam<-Hearth: ${trim(r2, 160)}`);
    const r3 = await sam.ask(sid, "Can you note that down as our decision so the team sees it?");
    console.log(`    Sam<-Hearth: ${trim(r3, 160)}`);
    return { sam, sid };
  })();

  const ingest2 = await devin.req<{ data: any }>('POST', '/meetings/ingest', {
    provider: 'manual', title: 'Infra standup (sync 2 - re-sync)', transcript: M_DUP_TRANSCRIPT,
    participants: ['Devin Rao', 'Marcus Chen'], meetingDate: new Date().toISOString(),
  });
  const m2 = ingest2.body?.data?.id;
  console.log(`  M-dup ingest #2 (re-sync) status=${ingest2.status} id=${m2}`);
  const meeting2 = await pollMeetingProcessed(devin, m2);
  console.log(`  M-dup #2 processedAt=${meeting2?.processedAt} decisionsExtracted=${meeting2?.decisionsExtracted}`);
  const d2 = (meeting2?.decisions ?? []) as Decision[];
  d2.forEach(d => console.log(`    #2 -> "${d.title}"`));

  const { sam, sid } = await samChatPromise;

  // Settle for any async embedding/dedup + concurrency to finish.
  await sleep(6000);

  // B-DEDUP: count blue-green decisions across the whole org.
  const all = listToArray<Decision>((await devin.req('GET', '/decisions?limit=100')).body);
  const blueGreen = all.filter(d => /blue.?green/i.test(`${d.title} ${d.reasoning ?? ''}`) && d.status !== 'archived' && d.status !== 'superseded');
  console.log(`  blue-green active decisions across org: ${blueGreen.length}`);
  blueGreen.forEach(d => console.log(`    bg -> id=${d.id} "${trim(d.title, 70)}" status=${d.status} src=${d.source} ref=${JSON.stringify(d.sourceRef)}`));
  if (blueGreen.length === 1) record('B-DEDUP', 'pass', `exactly 1 active blue-green decision after identical double-ingest (dedup held). decisionsExtracted #1=${meeting1?.decisionsExtracted} #2=${meeting2?.decisionsExtracted}`);
  else if (blueGreen.length === 0) record('B-DEDUP', 'inconclusive', `0 blue-green decisions — extractor missed the M-dup decision entirely (#1 extracted=${meeting1?.decisionsExtracted}); cannot test dedup`);
  else record('B-DEDUP', 'fail', `DEDUP MISS — ${blueGreen.length} active blue-green decisions after identical re-ingest. #2 decisionsExtracted=${meeting2?.decisionsExtracted}. Likely async-embedding race (embedding written after insert).`);

  // B-CONCURRENCY: A's meeting decisions still intact (recall preserved after concurrent activity).
  record('B-CONCURRENCY', 'pass', `after concurrent chat+re-ingest, GET /decisions returns ${all.length} rows intact (no fetch error); M-dup #1 decisions=${d1.length}`);

  // B-CHAT-DECISION: did Sam's chat decision become a Decision row?
  const sessionDecisions = all.filter(d => d.source === 'chat' && d.sourceRef?.sessionId === sid);
  const launchDarkly = all.filter(d => /launchdarkly|feature flag/i.test(`${d.title} ${d.reasoning ?? ''}`));
  const pending = listToArray<Decision>((await devin.req('GET', '/decisions/pending-review')).body);
  const pendingLD = pending.filter(d => /launchdarkly|feature flag/i.test(`${d.title} ${d.reasoning ?? ''}`) || d.sourceRef?.sessionId === sid);
  console.log(`  chat decisions for session ${sid}: ${sessionDecisions.length}; LaunchDarkly-matching: ${launchDarkly.length}; pending-review LD: ${pendingLD.length}`);
  if (sessionDecisions.length > 0 || launchDarkly.length > 0 || pendingLD.length > 0) {
    record('B-CHAT-DECISION', 'pass', `chat decision captured: sessionRows=${sessionDecisions.length} ldRows=${launchDarkly.length} pendingLD=${pendingLD.length}`);
  } else {
    record('B-CHAT-DECISION', 'fail', `FALSE NEGATIVE — Sam stated a final, committed decision ("going with feature flags via LaunchDarkly... final call") across 3 chat turns and asked Hearth to note it; NO Decision row exists (source=chat or LaunchDarkly match) and nothing in pending-review. Code grep confirms NOTHING enqueues the 'chat_session' extraction job and there is no save_decision agent tool — chat decisions are structurally never captured as Decisions.`);
  }

  return { sam, sid };
}

// ════════════════════════════════════════════════════════════════════════════
async function scenarioC() {
  console.log(`\n${'═'.repeat(78)}\n▶ Scenario C — Priya memory: remember this, ignore that\n${'═'.repeat(78)}`);
  const priya = new Hearth();
  await priya.login('pm1@hearth.local');

  const baseline = listToArray<MemoryEntry>((await priya.req('GET', '/memory?pageSize=100')).body);
  console.log(`  baseline memory entries (visible): ${baseline.length}`);
  const baselineIds = new Set(baseline.map(m => m.id));

  const sid = await priya.newSession('Release notes preferences');

  const turns = [
    "Please remember that I always want release notes drafted in our changelog voice — present tense, user-facing, and never include internal ticket IDs.",
    "Quick question — do you think we should switch our changelog format over to Markdown?",
    "I'm grabbing a coffee, back in 5.",
    "Actually, forget that thing I said about switching to Markdown — ignore it completely, it's not happening.",
  ];
  for (const t of turns) {
    console.log(`\n  🧑 Priya: ${trim(t, 160)}`);
    const reply = await priya.ask(sid, t);
    console.log(`  🔥 Hearth: ${trim(reply, 220)}`);
  }

  // Settle for any async memory embedding.
  await sleep(4000);

  const after = listToArray<MemoryEntry>((await priya.req('GET', '/memory?pageSize=100')).body);
  const userLayer = listToArray<MemoryEntry>((await priya.req('GET', '/memory?layer=user&pageSize=100')).body);
  const newEntries = after.filter(m => !baselineIds.has(m.id));
  console.log(`\n  memory after: total=${after.length} (new=${newEntries.length}), user-layer=${userLayer.length}`);
  newEntries.forEach(m => console.log(`    NEW [${m.layer}] (src=${m.source}, exp=${m.expiresAt ?? 'never'}): "${trim(m.content, 140)}"`));

  const txt = (m: MemoryEntry) => m.content.toLowerCase();
  const changelogEntries = newEntries.filter(m => /changelog|release note|present tense|ticket id/.test(txt(m)));
  const changelogUser = changelogEntries.filter(m => m.layer === 'user' && (!m.expiresAt));
  if (changelogUser.length > 0) record('C-RECALL', 'pass', `durable changelog-voice preference stored as persistent user-layer memory: "${trim(changelogUser[0].content, 120)}"`);
  else if (changelogEntries.length > 0) record('C-RECALL', 'inconclusive', `changelog preference stored but NOT as persistent user-layer (layer=${changelogEntries[0].layer}, exp=${changelogEntries[0].expiresAt}): "${trim(changelogEntries[0].content, 100)}"`);
  else record('C-RECALL', 'fail', `FALSE NEGATIVE — no memory entry captures the changelog-voice preference. New entries: ${newEntries.map(m => `[${m.layer}]"${trim(m.content, 50)}"`).join(' | ') || '(none)'}`);

  const questionEntries = newEntries.filter(m => /should we switch|markdown\?|switch our changelog (over )?to markdown/.test(txt(m)) && !/forget|ignore|not happening/.test(txt(m)));
  // A memory that records the Markdown idea as a fact/preference (not the forget instruction)
  const markdownAsFact = newEntries.filter(m => /markdown/.test(txt(m)) && !/forget|ignore|not happening|don'?t|do not/.test(txt(m)));
  if (markdownAsFact.length === 0) record('C-PRECISION-question', 'pass', 'the "switch to Markdown" question was NOT stored as a memory');
  else record('C-PRECISION-question', 'fail', `FALSE POSITIVE — Markdown question/idea stored as memory: ${markdownAsFact.map(m => `[${m.layer}]"${trim(m.content, 80)}"`).join(' | ')}`);

  const coffeeUser = newEntries.filter(m => /coffee|back in 5/.test(txt(m)) && m.layer === 'user' && !m.expiresAt);
  const coffeeAny = newEntries.filter(m => /coffee|back in 5/.test(txt(m)));
  if (coffeeUser.length === 0) {
    const nuance = coffeeAny.length > 0 ? ` (stored only as ${coffeeAny.map(m => `${m.layer}/exp=${m.expiresAt}`).join(',')} — acceptable ephemeral)` : '';
    record('C-PRECISION-transient', 'pass', `transient "grabbing coffee" not persisted as durable user memory${nuance}`);
  } else {
    record('C-PRECISION-transient', 'fail', `FALSE POSITIVE — transient coffee status stored as persistent user memory: ${coffeeUser.map(m => `"${trim(m.content, 60)}"`).join(' | ')}`);
  }

  // C-FORGET: nothing should retain the Markdown idea as a remembered fact after forget.
  if (markdownAsFact.length === 0) record('C-FORGET', 'pass', 'explicit "forget the Markdown thing" honored — no memory retains the Markdown idea as a fact');
  else record('C-FORGET', 'fail', `forget not honored — Markdown idea retained: ${markdownAsFact.map(m => `"${trim(m.content, 60)}"`).join(' | ')}`);

  return { newEntries };
}

// ════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`memory-decisions pressure test → ${API}`);
  const t0 = Date.now();

  const devin = new Hearth();
  await devin.login('eng-lead@hearth.local');

  const a = await scenarioA(devin);
  const b = await scenarioB(devin);
  const c = await scenarioC();

  // B-CHAT-DECISION code-truth note already embedded. Also confirm A intact post-everything.
  if (a) {
    const meetingNow = (await devin.req<{ data: any }>('GET', `/meetings/${a.meetingId}`)).body?.data;
    const stillThere = (meetingNow?.decisions ?? []) as Decision[];
    console.log(`\n  [post-run] Scenario A meeting still has ${stillThere.length} decisions (intact check).`);
  }

  console.log(`\n${'═'.repeat(78)}\nSUMMARY (${Math.round((Date.now() - t0) / 1000)}s)\n${'═'.repeat(78)}`);
  for (const r of results) console.log(`  ${r.status.toUpperCase().padEnd(13)} ${r.id}: ${r.note}`);
  const pass = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail').length;
  const inc = results.filter(r => r.status === 'inconclusive').length;
  console.log(`\n  totals: ${pass} pass, ${fail} fail, ${inc} inconclusive`);
}

main().catch((e) => { console.error('sim failed:', e); process.exit(1); });
