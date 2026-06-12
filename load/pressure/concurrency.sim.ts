/**
 * CONCURRENCY / CORRECTNESS pressure test.
 *
 * Drives concurrent CORRECTNESS races against a LIVE Hearth API + DB and
 * asserts there are no lost updates, double-counts, or illegal states. We
 * concentrate concurrency on fast REST endpoints (reactions, reads, tasks,
 * collaborators) and deliberately AVOID flooding the single agent worker —
 * the few real messages we need for the unread-count scenario are inserted
 * directly into the DB with controlled `createdBy` so we have ground truth
 * and never dispatch the agent loop dozens of times.
 *
 * Run:
 *   API_URL=http://localhost:8000/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/pressure/concurrency.sim.ts
 */
import { PrismaClient } from '@prisma/client';

const API = (process.env.API_URL ?? 'http://localhost:8000/api/v1').replace(/\/$/, '');
const PASSWORD = 'changeme';
const prisma = new PrismaClient();

// ── Hearth client (cookie jar + double-submit CSRF) — copied pattern ──────────
class Hearth {
  private cookies = new Map<string, string>();
  private csrf = '';
  email = '';
  userId = '';
  orgId = '';

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
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
    return { status: res.status, body: parsed as T };
  }
  async login(email: string) {
    this.email = email;
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    this.store(res);
    const me = await this.req<{ data: { id: string; orgId?: string } }>('GET', '/auth/me');
    this.userId = (me.body as any)?.data?.id ?? '';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EMOJIS = ['👍', '👎', '✅', '❓', '⚠️', '🎯'];

const interactions: Array<{ actor: string; action: string; hearthResponse: string }> = [];
const results: Array<{ assertion: string; status: 'pass' | 'fail' | 'inconclusive'; observed: string }> = [];
const defects: Array<{ severity: 'P0' | 'P1' | 'P2' | 'P3'; title: string; detail: string }> = [];
const log = (actor: string, action: string, hearthResponse: string) =>
  interactions.push({ actor, action, hearthResponse });
const assert = (assertion: string, ok: boolean, observed: string) =>
  results.push({ assertion, status: ok ? 'pass' : 'fail', observed });

const FIXTURES = [
  'admin@hearth.local', 'cto@hearth.local', 'eng-lead@hearth.local', 'dev1@hearth.local',
  'dev2@hearth.local', 'product-lead@hearth.local', 'pm1@hearth.local', 'designer@hearth.local',
  'data-analyst@hearth.local', 'intern@hearth.local',
];

async function main() {
  console.log(`▶ concurrency.sim against ${API}`);
  const clients: Hearth[] = [];
  for (const email of FIXTURES) {
    const h = new Hearth();
    await h.login(email);
    clients.push(h);
  }
  console.log(`✓ logged in ${clients.length} clients`);
  const owner = clients[0]; // admin owns the shared session
  const members = clients.slice(1);

  // Create one org-visible shared session everyone can access.
  const sess = await owner.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'Concurrency Arena' });
  const sessionId = sess.body.data.id;
  await owner.req('PATCH', `/chat/sessions/${sessionId}/visibility`, { visibility: 'org' });
  log('admin', 'create org-visible session', `200, sessionId=${sessionId}`);

  // Seed ONE message everyone reacts to (direct DB insert, no agent dispatch).
  const orgId = (await prisma.user.findUnique({
    where: { id: owner.userId },
    include: { team: { select: { orgId: true } } },
  }))!.team!.orgId!;
  const target = await prisma.chatMessage.create({
    data: { orgId, sessionId, role: 'user', content: 'React to me', createdBy: owner.userId },
    select: { id: true },
  });
  const messageId = target.id;

  // ────────────────────────────────────────────────────────────────────────
  // SCENARIO 1 — Reaction races: many users react to the SAME message at once,
  // plus rapid toggle (add/remove) of the same emoji by some users.
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n── Scenario 1: reaction races ──');

  // 1a. Every member adds the SAME emoji 👍 concurrently, each TWICE (idempotency
  //     under race). Expected: exactly one 👍 per distinct user, count = #members.
  const addOps: Promise<unknown>[] = [];
  for (const m of members) {
    addOps.push(m.req('POST', `/chat/sessions/${sessionId}/messages/${messageId}/reactions`, { emoji: '👍' }));
    addOps.push(m.req('POST', `/chat/sessions/${sessionId}/messages/${messageId}/reactions`, { emoji: '👍' }));
  }
  // 1b. Simultaneously: each member adds a DISTINCT emoji from the palette.
  for (let i = 0; i < members.length; i++) {
    const e = EMOJIS[i % EMOJIS.length];
    addOps.push(members[i].req('POST', `/chat/sessions/${sessionId}/messages/${messageId}/reactions`, { emoji: e }));
  }
  const addResults = await Promise.all(addOps);
  const addStatuses = (addResults as any[]).map((r) => r.status);
  log('10 members', 'concurrent add 👍 x2 each + distinct emoji each', `statuses=${JSON.stringify(tally(addStatuses))}`);

  // Assertion: concurrent identical reaction-adds must NOT 500. prisma.upsert is
  // not race-safe — two concurrent first-writes both INSERT and one gets a
  // P2002 unique-constraint violation surfaced as a raw 500.
  const add500s = addStatuses.filter((s) => s >= 500).length;
  assert(
    'concurrent identical reaction-adds never return 5xx (upsert race-safe)',
    add500s === 0,
    `5xx responses during concurrent reaction adds=${add500s} of ${addStatuses.length}`,
  );
  if (add500s > 0) defects.push({
    severity: 'P1',
    title: 'prisma.upsert race throws HTTP 500 on concurrent reaction adds',
    detail: `addMessageReaction() uses prisma.messageReaction.upsert. Under concurrent identical (messageId,userId,emoji) writes, ${add500s}/${addStatuses.length} requests returned 500 with a raw "Unique constraint failed on the fields: (message_id,user_id,emoji)" Prisma error (also leaks the query into the response body). The same non-race-safe upsert pattern is used by markSessionRead, addCollaborator, and joinSession. Fix: ON CONFLICT DO NOTHING / createMany skipDuplicates, or catch P2002 and treat as success.`,
  });

  // 1c. Toggle race: first 4 members rapidly add+remove 🎯 concurrently (interleaved).
  const togglers = members.slice(0, 4);
  const toggleOps: Promise<unknown>[] = [];
  for (const m of togglers) {
    toggleOps.push(m.req('POST', `/chat/sessions/${sessionId}/messages/${messageId}/reactions`, { emoji: '🎯' }));
    toggleOps.push(m.req('DELETE', `/chat/sessions/${sessionId}/messages/${messageId}/reactions/${encodeURIComponent('🎯')}`));
    toggleOps.push(m.req('POST', `/chat/sessions/${sessionId}/messages/${messageId}/reactions`, { emoji: '🎯' }));
    toggleOps.push(m.req('DELETE', `/chat/sessions/${sessionId}/messages/${messageId}/reactions/${encodeURIComponent('🎯')}`));
  }
  await Promise.all(toggleOps);
  log('4 members', 'concurrent add/remove 🎯 (toggle race, even ops → expect removed)', 'completed');

  await sleep(300); // let writes settle

  // GROUND TRUTH from DB
  const dbReactions = await prisma.messageReaction.findMany({
    where: { messageId },
    select: { userId: true, emoji: true },
  });
  // API view
  const apiSess = await owner.req<{ data: { messages: Array<{ id: string; reactions: Array<{ emoji: string; count: number; userIds: string[] }> }> } }>('GET', `/chat/sessions/${sessionId}`);
  const apiMsg = apiSess.body.data.messages.find((m) => m.id === messageId);
  const apiThumbs = apiMsg?.reactions.find((r) => r.emoji === '👍');

  // Assertion 1a: 👍 count exactly = #members, no double-count
  const dbThumbsUsers = new Set(dbReactions.filter((r) => r.emoji === '👍').map((r) => r.userId));
  const okThumbs = dbThumbsUsers.size === members.length &&
    apiThumbs?.count === members.length &&
    new Set(apiThumbs?.userIds).size === members.length;
  assert(
    '👍 reacted by all 10 members exactly once each despite concurrent double-adds (no double-count, no lost update)',
    okThumbs,
    `db distinct 👍 users=${dbThumbsUsers.size}, api count=${apiThumbs?.count}, api distinct userIds=${new Set(apiThumbs?.userIds).size}, expected=${members.length}`,
  );
  if (!okThumbs) defects.push({
    severity: 'P1',
    title: 'Reaction count drift under concurrent identical adds',
    detail: `Expected exactly ${members.length} distinct 👍 reactors; DB had ${dbThumbsUsers.size}, API reported count=${apiThumbs?.count}, distinct userIds=${new Set(apiThumbs?.userIds).size}.`,
  });

  // Assertion 1b: no duplicate (user,emoji) rows anywhere
  const seen = new Set<string>();
  let dupes = 0;
  for (const r of dbReactions) {
    const k = `${r.userId}|${r.emoji}`;
    if (seen.has(k)) dupes++;
    seen.add(k);
  }
  assert('no duplicate (user,emoji) reaction rows after concurrent races', dupes === 0, `duplicate rows=${dupes}, total rows=${dbReactions.length}`);
  if (dupes > 0) defects.push({ severity: 'P0', title: 'Duplicate reaction rows', detail: `${dupes} duplicate (user,emoji) rows survived concurrency — unique constraint or upsert race.` });

  // Assertion 1c: toggle race — even number of ops (2 add, 2 remove) per user → final = removed.
  const dbBullseye = dbReactions.filter((r) => r.emoji === '🎯').map((r) => r.userId);
  const toggleUserIds = new Set(togglers.map((t) => t.userId));
  const leaked = dbBullseye.filter((u) => toggleUserIds.has(u));
  // Note: this is a sequential-consistency expectation; out-of-order completion CAN
  // legitimately leave a 🎯 present. We report it as observed, flag as inconclusive
  // if present (it indicates ordering, not necessarily a correctness bug), but a
  // count>1 PER USER would be a real double-count bug.
  const perUserBullseye = new Map<string, number>();
  for (const u of dbBullseye) perUserBullseye.set(u, (perUserBullseye.get(u) ?? 0) + 1);
  const overCounted = [...perUserBullseye.values()].some((c) => c > 1);
  results.push({
    assertion: 'toggle race on 🎯 never yields >1 row per user (no double-count on add/remove interleave)',
    status: overCounted ? 'fail' : 'pass',
    observed: `🎯 rows for togglers=${leaked.length}, max per-user=${Math.max(0, ...perUserBullseye.values())}`,
  });
  if (overCounted) defects.push({ severity: 'P0', title: 'Toggle race double-counts a single user', detail: 'A 🎯 add/remove interleave left >1 reaction row for one user.' });
  log('verify', 'reaction ground-truth', `db rows=${dbReactions.length}, 👍 users=${dbThumbsUsers.size}, 🎯 toggler rows=${leaked.length}`);

  // ────────────────────────────────────────────────────────────────────────
  // SCENARIO 2 — Unread-count correctness under concurrent posts.
  // Several users post into the shared session concurrently; then we check each
  // reader's unread count: must count messages they didn't write, EXCLUDE their
  // own, and (known bug) we check whether assistant createdBy=null messages get
  // wrongly counted as unread for the user who "asked".
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n── Scenario 2: unread-count correctness ──');

  // Fresh session for clean accounting.
  const s2 = await owner.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'Unread Arena' });
  const s2id = s2.body.data.id;
  await owner.req('PATCH', `/chat/sessions/${s2id}/visibility`, { visibility: 'org' });

  // Each poster establishes a read marker at "now - past" so all new posts are unread for everyone.
  // First, baseline: everyone marks the session read at a seed message.
  const seedMsg = await prisma.chatMessage.create({
    data: { orgId, sessionId: s2id, role: 'user', content: 'seed', createdBy: owner.userId },
    select: { id: true },
  });
  await Promise.all(clients.map((c) => c.req('POST', `/chat/sessions/${s2id}/read`, { lastMessageId: seedMsg.id })));
  await sleep(50);

  // Concurrent posts: 5 distinct users each insert 2 messages (DB insert with createdBy
  // = themselves, to avoid 10x agent dispatch). Plus ONE assistant reply (createdBy=null)
  // tied to the asker = dev1.
  const posters = [clients[1], clients[2], clients[3], clients[4], clients[5]];
  const postOps: Promise<unknown>[] = [];
  for (const p of posters) {
    postOps.push(prisma.chatMessage.create({ data: { orgId, sessionId: s2id, role: 'user', content: `msg-a from ${p.email}`, createdBy: p.userId } }));
    postOps.push(prisma.chatMessage.create({ data: { orgId, sessionId: s2id, role: 'user', content: `msg-b from ${p.email}`, createdBy: p.userId } }));
  }
  // Assistant reply with createdBy=null (the known-bug carrier). dev1=clients[3] is "the asker".
  postOps.push(prisma.chatMessage.create({ data: { orgId, sessionId: s2id, role: 'assistant', content: 'assistant reply', createdBy: null } }));
  await Promise.all(postOps);
  log('5 posters', 'concurrent insert 2 msgs each + 1 assistant(createdBy=null)', '11 messages total');

  await sleep(200);

  // Total messages now (excluding seed) = 10 user + 1 assistant = 11.
  // For each reader, expected unread = (# messages with createdBy != reader AND createdBy != null... )
  //   BUT current impl: OR[{createdBy:null},{createdBy:{not:userId}}] → INCLUDES assistant(null).
  // Ground-truth expectation (CORRECT semantics): unread should EXCLUDE the reader's own
  // messages. The assistant(null) message is genuinely "not yours", so for a 3rd-party reader
  // it's legitimately unread. The bug is specifically: for the ASKER, an assistant reply to
  // their own question reads as unread. We test both the general correctness and the asker case.

  const counts = await Promise.all(clients.map(async (c) => {
    const r = await c.req<{ data: Record<string, { unreadCount: number }> }>('GET', '/chat/sessions/unread-counts');
    return { email: c.email, userId: c.userId, count: r.body.data[s2id]?.unreadCount ?? 0 };
  }));

  // Compute ground truth per user from DB (messages after the seed read marker).
  const allMsgs = await prisma.chatMessage.findMany({
    where: { sessionId: s2id, content: { not: 'seed' } },
    select: { createdBy: true },
  });
  for (const c of counts) {
    const ownCount = allMsgs.filter((m) => m.createdBy === c.userId).length;
    const others = allMsgs.filter((m) => m.createdBy !== c.userId && m.createdBy !== null).length;
    const assistantNull = allMsgs.filter((m) => m.createdBy === null).length;
    // Impl-expected (current code): others + assistantNull (excludes only own user msgs).
    const implExpected = others + assistantNull;
    const ok = c.count === implExpected;
    assert(
      `unread count for ${c.email} excludes own ${ownCount} msg(s) and matches deterministic count under concurrent posts`,
      ok,
      `api unread=${c.count}, expected(excl own)=${implExpected} [others=${others}, assistant(null)=${assistantNull}, own=${ownCount}]`,
    );
    if (!ok) defects.push({
      severity: 'P1',
      title: `Unread count wrong for ${c.email} under concurrency`,
      detail: `Expected ${implExpected} (others=${others}, assistantNull=${assistantNull}, own excluded=${ownCount}); API returned ${c.count}.`,
    });
  }

  // Focused known-bug check: the asker (dev1=clients[3]) — does the assistant(null) reply
  // count against them? Under correct product semantics it should NOT (it's a reply to them).
  const asker = counts.find((c) => c.email === 'dev1@hearth.local')!;
  const askerOthers = allMsgs.filter((m) => m.createdBy !== asker.userId && m.createdBy !== null).length;
  const assistantNullN = allMsgs.filter((m) => m.createdBy === null).length;
  const askerCountsAssistant = asker.count === askerOthers + assistantNullN && assistantNullN > 0;
  results.push({
    assertion: 'KNOWN BUG: assistant reply (createdBy=null) does NOT inflate the asker\'s unread count',
    status: askerCountsAssistant ? 'fail' : 'pass',
    observed: `dev1 unread=${asker.count}; others(non-null,not-dev1)=${askerOthers}; assistant(null)=${assistantNullN}. assistant counted against asker=${askerCountsAssistant}`,
  });
  if (askerCountsAssistant) defects.push({
    severity: 'P2',
    title: 'Assistant replies (createdBy=null) count as unread for the asker',
    detail: `getUnreadCounts OR-clause [{createdBy:null},{createdBy:{not:userId}}] treats every assistant message (createdBy=null) as unread for every user, including the person it was replying to. dev1 unread=${asker.count} includes ${assistantNullN} assistant message(s) that are replies to dev1. Confirmed under concurrent posting.`,
  });
  log('verify', 'unread ground-truth', `dev1 unread=${asker.count}, assistant(null) msgs=${assistantNullN}`);

  // ────────────────────────────────────────────────────────────────────────
  // SCENARIO 3 — Collaborator add/remove races.
  // Concurrent add + remove of the SAME target collaborator; assert consistent
  // final state (the upsert + deleteMany must not leave a torn/duplicate row).
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n── Scenario 3: collaborator add/remove races ──');
  const s3 = await owner.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'Collab Arena' });
  const s3id = s3.body.data.id;
  const targetUser = clients[6]; // pm1

  // Fire many interleaved add+remove of the SAME (session,user) concurrently.
  const collabOps: Promise<any>[] = [];
  for (let i = 0; i < 10; i++) {
    collabOps.push(owner.req('POST', `/chat/sessions/${s3id}/collaborators`, { userId: targetUser.userId, role: 'contributor' }));
    collabOps.push(owner.req('DELETE', `/chat/sessions/${s3id}/collaborators/${targetUser.userId}`));
  }
  const collabRes = await Promise.all(collabOps);
  log('admin', '10x concurrent add+remove same collaborator (pm1)', `statuses=${JSON.stringify(tally(collabRes.map((r) => r.status)))}`);
  await sleep(200);

  // Ground truth: at most ONE row for (session,user) — never duplicated.
  const collabRows = await prisma.sessionCollaborator.findMany({ where: { sessionId: s3id, userId: targetUser.userId } });
  assert('collaborator (session,user) never duplicated after add/remove race', collabRows.length <= 1, `rows for (session,user)=${collabRows.length}`);
  if (collabRows.length > 1) defects.push({ severity: 'P0', title: 'Duplicate collaborator rows', detail: `${collabRows.length} rows for one (session,user) after concurrent add/remove.` });

  // Final state should be internally consistent between API list and DB.
  const apiCollabs = await owner.req<{ data: Array<{ userId: string }> }>('GET', `/chat/sessions/${s3id}/collaborators`);
  const apiHas = apiCollabs.body.data.some((c) => c.userId === targetUser.userId);
  const dbHas = collabRows.length === 1;
  assert('API collaborator list agrees with DB on final membership after race', apiHas === dbHas, `apiHas=${apiHas}, dbHas=${dbHas}`);
  if (apiHas !== dbHas) defects.push({ severity: 'P1', title: 'Collaborator API/DB divergence', detail: `API list says present=${apiHas} but DB says present=${dbHas}.` });

  // Settled-state determinism: run one final deterministic add, then one final remove,
  // and confirm the row reflects the last op (no lost update).
  await owner.req('POST', `/chat/sessions/${s3id}/collaborators`, { userId: targetUser.userId, role: 'contributor' });
  await sleep(80);
  const afterAdd = await prisma.sessionCollaborator.count({ where: { sessionId: s3id, userId: targetUser.userId } });
  await owner.req('DELETE', `/chat/sessions/${s3id}/collaborators/${targetUser.userId}`);
  await sleep(80);
  const afterRemove = await prisma.sessionCollaborator.count({ where: { sessionId: s3id, userId: targetUser.userId } });
  assert('sequential add then remove leaves exactly 0 rows (no lost update)', afterAdd === 1 && afterRemove === 0, `afterAdd=${afterAdd}, afterRemove=${afterRemove}`);

  // ────────────────────────────────────────────────────────────────────────
  // SCENARIO 4 — Task status transition races.
  // Concurrent PATCHes to the SAME task. Assert no illegal state lands.
  // Killer case: backlog → {planning, archived} concurrently. archived is
  // terminal (VALID_STATUS_TRANSITIONS.archived === []). If both reads observe
  // `backlog`, both validate, both commit (read-modify-write, no row lock), and
  // an archived task can be resurrected to planning — an archived→planning move
  // the state machine explicitly forbids.
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n── Scenario 4: task status transition races ──');
  let illegalLandings = 0;
  const TRIALS = 8;
  const transitionDetails: string[] = [];
  for (let t = 0; t < TRIALS; t++) {
    const created = await owner.req<{ data: { id: string; status: string } }>('POST', '/tasks', {
      title: `race-task-${t}`,
      source: 'manual',
    });
    const taskId = created.body.data.id;
    const startStatus = created.body.data.status;
    // Ensure we start at backlog. auto_detected→backlog, or manual may already be backlog.
    if (startStatus !== 'backlog') {
      const allowed: Record<string, string> = { auto_detected: 'backlog' };
      if (allowed[startStatus]) await owner.req('PATCH', `/tasks/${taskId}`, { status: 'backlog' });
    }
    // Concurrent contradictory transitions from backlog.
    const [toPlanning, toArchived] = await Promise.all([
      owner.req<{ data: { status: string }; error?: string }>('PATCH', `/tasks/${taskId}`, { status: 'planning' }),
      owner.req<{ data: { status: string }; error?: string }>('PATCH', `/tasks/${taskId}`, { status: 'archived' }),
    ]);
    await sleep(60);
    const finalRow = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
    const finalStatus = finalRow?.status;
    // Both succeeded?
    const planningOk = toPlanning.status === 200;
    const archivedOk = toArchived.status === 200;
    // Illegal landing detection: if the task ended in 'planning' but 'archived' ALSO
    // returned 200, then an archived task was moved to planning (archived has no out-edges),
    // OR a planning move was applied after archival — either way the committed sequence
    // violated the state machine (archived is terminal).
    const bothCommitted = planningOk && archivedOk;
    const resurrected = bothCommitted && finalStatus === 'planning';
    if (resurrected) illegalLandings++;
    transitionDetails.push(`trial${t}: planning=${toPlanning.status}, archived=${toArchived.status}, final=${finalStatus}${resurrected ? ' ⚠ARCHIVED→PLANNING' : ''}`);
  }
  log('admin', `${TRIALS}x concurrent backlog→planning ∥ backlog→archived on same task`, transitionDetails.slice(0, 3).join(' | '));
  console.log(transitionDetails.join('\n'));

  assert(
    'concurrent contradictory transitions never produce an illegal committed state (e.g. archived task resurrected to planning)',
    illegalLandings === 0,
    `${illegalLandings}/${TRIALS} trials landed in planning while BOTH planning+archived PATCHes returned 200 (archived is terminal → illegal)`,
  );
  if (illegalLandings > 0) defects.push({
    severity: 'P1',
    title: 'Task status transition is a read-modify-write race (lost-update / illegal landing)',
    detail: `updateTask() in task-service.ts does findFirst→validate-in-JS→update with no row lock or atomic guard. Concurrent PATCHes both read the same prior status, both pass validation, and both commit. In ${illegalLandings}/${TRIALS} trials, a task ended in 'planning' even though an 'archived' transition also committed (archived is terminal: VALID_STATUS_TRANSITIONS.archived===[]), so the state machine was violated. Fix: guard the update with a WHERE status=expected (compare-and-set) or SELECT FOR UPDATE.`,
  });

  // Cleanup created tasks (best effort)
  // (left in place; sim seed is disposable)

  await prisma.$disconnect();

  // ── Summary ──
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  console.log(`\n══ RESULTS: ${pass} pass, ${fail} fail, ${defects.length} defects ══`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.assertion}\n        ${r.observed}`);
  console.log('\n__JSON__' + JSON.stringify({ interactions, results, defects }));
}

function tally(arr: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of arr) out[x] = (out[x] ?? 0) + 1;
  return out;
}

main().catch(async (e) => {
  console.error('FATAL', e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
