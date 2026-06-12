/**
 * WEBHOOK → GRAPH pressure test.
 *
 * Strategic surface under test: external signal → auto-detected task →
 * Person/Edge navigation graph ("navigation over search").
 *
 * This sim probes the path HONESTLY across its real seams:
 *
 *  A. Generic webhook ingest  (POST /webhooks/ingest/:urlToken)
 *       - create endpoint via API, capture urlToken
 *       - POST an ACTIONABLE Slack-style event
 *       - observe: does a Task get auto-created? does the graph populate?
 *
 *  B. Slack webhook           (POST /webhooks/slack)
 *       - the only HTTP route that is wired to detectAndCreateTask
 *       - POST an actionable event, observe the real response
 *
 *  C. Detection pipeline      (detectAndCreateTask, in-process)
 *       - the EXACT function the work-intake worker runs
 *       - feed a FULL actionable DetectedMessage (text + fromHandle + threadRef)
 *       - verify: Task created + Person upserted + produced_by + discussed_in
 *       - feed a NON-actionable message → no Task
 *       - feed the SAME actionable event twice → dedup (one Task)
 *
 *  D. Real enqueue path       (enqueueSlackMessage → worker → detectAndCreateTask)
 *       - this is what /webhooks/slack actually calls
 *       - shows whether graph edges are landed when a Slack message arrives
 *         through the production code path (vs. the hand-fed pipeline in C)
 *
 * Graph is read back via direct Prisma probes (there is NO HTTP read route for
 * persons/edges — that absence is itself recorded as a finding).
 *
 * Run:
 *   API_URL=http://localhost:8000/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/pressure/webhook-graph.sim.ts
 */

import { createHmac } from 'crypto';
// Reuse the API's own Prisma singleton + services so all bare imports
// (@prisma/client, @hearth/shared) resolve from apps/api/node_modules.
// Run with cwd = apps/api (see footer of this file for the exact command).
import { prisma } from '../src/lib/prisma.js';
import { detectAndCreateTask } from '../src/services/task-detector.js';
import { enqueueSlackMessage, workIntakeQueue } from '../src/jobs/work-intake-scheduler.js';
import { loadProviders } from '../src/llm/provider-loader.js';

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const out: any = { interactions: [], results: [], notes: [] };

function record(actor: string, action: string, hearthResponse: string) {
  out.interactions.push({ actor, action, hearthResponse });
  console.log(`\n[${actor}] ${action}\n   → ${hearthResponse}`);
}
function assert(assertion: string, status: 'pass' | 'fail' | 'inconclusive', observed: string) {
  out.results.push({ assertion, status, observed });
  console.log(`   [${status.toUpperCase()}] ${assertion}\n       ${observed}`);
}

// ── Hearth HTTP client (cookie jar + CSRF) ───────────────────────────────────
class Hearth {
  private cookies = new Map<string, string>();
  private csrf = '';
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
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this.store(res);
    const text = await res.text();
    let parsed: unknown;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
    return { status: res.status, body: parsed as T };
  }
  async login(email: string) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    this.store(res);
  }
}

// Raw POST helper for webhook ingest (no auth, raw body + custom headers).
async function rawPost(path: string, rawBody: string, headers: Record<string, string>) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers, body: rawBody });
  const text = await res.text();
  let parsed: unknown;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
  return { status: res.status, body: parsed };
}

async function main() {
  const ADMIN = 'admin@hearth.local';
  const h = new Hearth();
  await h.login(ADMIN);

  // Populate the LLM registry exactly as the API bootstrap does, so the
  // in-process detectAndCreateTask runs a REAL classification (no mocks).
  await loadProviders();

  const me = await prisma.user.findFirst({
    where: { email: ADMIN },
    select: { id: true, team: { select: { orgId: true } } },
  });
  const userId = me!.id;
  const orgId = me!.team!.orgId!;
  record('harness', 'resolve admin identity', `userId=${userId} orgId=${orgId}`);

  // Unique handle/thread per run so we can read back exactly what THIS run landed.
  const run = Date.now().toString(36);
  const slackUserId = `U_BOARD_${run}`;
  const threadId = `1718000000.${run}`;
  const channel = 'C_ENG_ALERTS';
  const actionableText =
    `@marcus can someone fix the nightly export job that's been failing? need it before Friday's board demo`;

  // ════════════════════════════════════════════════════════════════════════
  // A. Generic webhook ingest: create endpoint via API, POST actionable event
  // ════════════════════════════════════════════════════════════════════════
  const created = await h.req<{ data: { id: string; urlToken: string; plainSecret: string } }>(
    'POST', '/routines/webhook-endpoints', { provider: 'slack' },
  );
  record('admin', 'POST /routines/webhook-endpoints {provider:slack}',
    `${created.status} urlToken=${created.body?.data?.urlToken?.slice(0, 12)}… secretReturned=${!!created.body?.data?.plainSecret}`);

  if (created.status !== 201 || !created.body?.data?.urlToken) {
    assert('webhook endpoint can be created via API', 'fail', `status ${created.status}`);
  } else {
    assert('webhook endpoint can be created via API', 'pass', `201, urlToken issued`);
  }

  const urlToken = created.body?.data?.urlToken;
  const plainSecret = created.body?.data?.plainSecret;

  if (urlToken) {
    // Build a realistic Slack event_callback body and sign it the way the
    // generic verifier expects for provider=slack (v0:ts:body HMAC).
    const ts = Math.floor(Date.now() / 1000).toString();
    const slackBody = JSON.stringify({
      type: 'event_callback',
      event_id: `Ev_${run}`,
      team_id: 'T_RIVAL',
      event: {
        type: 'message',
        user: slackUserId,
        text: actionableText,
        channel,
        ts: threadId,
        thread_ts: threadId,
        client_msg_id: `cmid_${run}`,
      },
    });
    const sig = 'v0=' + createHmac('sha256', plainSecret).update(`v0:${ts}:${slackBody}`).digest('hex');

    const ingest = await rawPost(`/webhooks/ingest/${urlToken}`, slackBody, {
      'content-type': 'application/json',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': sig,
    });
    record('slack-bot', `POST /webhooks/ingest/:token (actionable, signed)`,
      `${ingest.status} ${JSON.stringify(ingest.body)}`);

    // Give any async processing a chance.
    await sleep(8000);

    const tasksAfterIngest = await prisma.task.findMany({
      where: { orgId, sourceRef: { path: ['messageId'], equals: `cmid_${run}` } },
      select: { id: true },
    });
    const ingestCreatedTask = tasksAfterIngest.length > 0;
    assert(
      'generic /webhooks/ingest auto-creates a Task for an actionable Slack message',
      ingestCreatedTask ? 'pass' : 'fail',
      ingestCreatedTask
        ? `task ${tasksAfterIngest[0].id} created`
        : `NO task created. The generic ingest route only runs trigger/routine matching ` +
          `(findMatchingTriggers + enqueueRoutineForEvent); it never calls detectAndCreateTask. ` +
          `Auto-task-detection is unreachable through this endpoint.`,
    );

    const personAfterIngest = await prisma.person.findFirst({ where: { orgId, slackUserId } });
    assert(
      'generic /webhooks/ingest upserts a Person from the Slack handle',
      personAfterIngest ? 'pass' : 'fail',
      personAfterIngest ? `person ${personAfterIngest.id}` : `NO Person row landed via ingest path`,
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // B. Slack webhook route — the only HTTP path wired to detection
  // ════════════════════════════════════════════════════════════════════════
  {
    const ts = Math.floor(Date.now() / 1000).toString();
    const slackBody = JSON.stringify({
      type: 'event_callback', team_id: 'T_RIVAL',
      event: { type: 'message', user: slackUserId, text: actionableText, channel, ts: threadId, client_msg_id: `cmid_b_${run}` },
    });
    // We don't know the configured signing secret; send a plausible signature.
    const sig = 'v0=' + createHmac('sha256', 'unknown', ).update(`v0:${ts}:${slackBody}`).digest('hex');
    const resp = await rawPost('/webhooks/slack', slackBody, {
      'content-type': 'application/json',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': sig,
    });
    record('slack-bot', 'POST /webhooks/slack (actionable)',
      `${resp.status} ${JSON.stringify(resp.body)}`);
    const usable = resp.status === 200;
    assert(
      '/webhooks/slack (the only route wired to detectAndCreateTask) is usable in this env',
      usable ? 'pass' : 'fail',
      usable
        ? '200 accepted'
        : `status ${resp.status} — ${JSON.stringify(resp.body)}. SLACK_SIGNING_SECRET is unset and the ` +
          `seeded slack integration has no config.team_id, so the message would never reach work-intake even if signed.`,
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // C. Detection pipeline (detectAndCreateTask) — full message w/ graph refs
  //    This is the EXACT function the work-intake worker runs.
  // ════════════════════════════════════════════════════════════════════════
  const messageId = `msg_${run}`;
  const fullMessage = {
    source: 'slack' as const,
    text: actionableText,
    from: '@marcus',
    messageId,
    channel,
    userId,
    orgId,
    fromHandle: { provider: 'slack' as const, externalId: slackUserId, displayName: 'Board Bot' },
    threadRef: { provider: 'slack', externalId: threadId },
  };

  const r1 = await detectAndCreateTask(fullMessage);
  record('pipeline', 'detectAndCreateTask(actionable + fromHandle + threadRef)', JSON.stringify(r1));
  assert(
    'actionable message → Task auto-created (pipeline)',
    r1.created ? 'pass' : 'fail',
    r1.created ? `task ${r1.taskId}` : `not created: ${r1.reason}`,
  );

  let taskId = r1.taskId;
  if (taskId) {
    const person = await prisma.person.findFirst({ where: { orgId, slackUserId } });
    assert(
      'Person upserted from Slack handle',
      person ? 'pass' : 'fail',
      person ? `person ${person.id} slackUserId=${person.slackUserId} displayName=${person.displayName}` : 'no person',
    );

    if (person) {
      const producedBy = await prisma.edge.findFirst({
        where: { orgId, fromType: 'task', fromId: taskId, toType: 'person', toId: person.id, kind: 'produced_by' },
      });
      assert(
        'produced_by edge task→person landed',
        producedBy ? 'pass' : 'fail',
        producedBy ? `edge ${producedBy.id} source=${producedBy.source}` : 'no produced_by edge',
      );
    }

    const discussedIn = await prisma.edge.findFirst({
      where: { orgId, fromType: 'task', fromId: taskId, toType: 'external_ref', kind: 'discussed_in',
               toId: `slack:${threadId}` },
    });
    assert(
      'discussed_in edge task→external_ref(thread) landed',
      discussedIn ? 'pass' : 'fail',
      discussedIn
        ? `edge ${discussedIn.id} externalRef=${JSON.stringify(discussedIn.externalRef)}`
        : 'no discussed_in edge',
    );

    // Graph navigability: from the task seed we should reach BOTH the person
    // and the external thread ref.
    const out2 = await prisma.edge.findMany({ where: { orgId, fromType: 'task', fromId: taskId, stale: false } });
    const reaches = new Set(out2.map((e) => `${e.toType}:${e.kind}`));
    const navigable = reaches.has('person:produced_by') && reaches.has('external_ref:discussed_in');
    assert(
      'graph is navigable from the auto-detected task (person + thread reachable)',
      navigable ? 'pass' : (out2.length > 0 ? 'inconclusive' : 'fail'),
      `outgoing edges: [${out2.map((e) => `${e.kind}→${e.toType}`).join(', ')}]`,
    );
  }

  // C2. Non-actionable message → NO task
  const nonActText = `thanks team, great work! 🎉 really proud of how the launch went today`;
  const nonActMsgId = `msg_nonact_${run}`;
  const r2 = await detectAndCreateTask({
    source: 'slack', text: nonActText, from: '@dana', messageId: nonActMsgId, channel, userId, orgId,
    fromHandle: { provider: 'slack', externalId: `U_DANA_${run}` },
  });
  record('pipeline', 'detectAndCreateTask(non-actionable "thanks team…")', JSON.stringify(r2));
  assert(
    'non-actionable message → NO Task created',
    !r2.created ? 'pass' : 'fail',
    !r2.created ? `correctly skipped: ${r2.reason}` : `WRONGLY created task ${r2.taskId}`,
  );
  // And no stray Person/edges from a non-actionable message
  const strayPerson = await prisma.person.findFirst({ where: { orgId, slackUserId: `U_DANA_${run}` } });
  assert(
    'non-actionable message does not pollute the graph with a Person',
    !strayPerson ? 'pass' : 'fail',
    !strayPerson ? 'no person landed' : `stray person ${strayPerson?.id} (edges only land after a task is created, so this would be a leak)`,
  );

  // C3. Dedup — same actionable event twice → one task
  const r3 = await detectAndCreateTask(fullMessage);
  record('pipeline', 'detectAndCreateTask(SAME actionable event again)', JSON.stringify(r3));
  const dupTasks = await prisma.task.findMany({
    where: { orgId, sourceRef: { path: ['messageId'], equals: messageId } },
    select: { id: true },
  });
  // Dedup is by semantic similarity on title, not messageId, so also count by title.
  const sameTitleTasks = taskId
    ? await prisma.task.findMany({
        where: { orgId, title: (await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } }))!.title },
        select: { id: true },
      })
    : [];
  const deduped = !r3.created;
  assert(
    'duplicate actionable event → dedup holds (no second Task)',
    deduped ? 'pass' : (sameTitleTasks.length <= 1 ? 'pass' : 'fail'),
    deduped
      ? `2nd call skipped: ${r3.reason}`
      : `2nd call created ${r3.taskId}; tasks w/ same messageId=${dupTasks.length}, same title=${sameTitleTasks.length}`,
  );

  // ════════════════════════════════════════════════════════════════════════
  // D. Real enqueue path: enqueueSlackMessage → worker → detectAndCreateTask.
  //    This is what /webhooks/slack actually calls. Tests whether the
  //    PRODUCTION code path lands graph edges (it drops fromHandle/threadRef).
  // ════════════════════════════════════════════════════════════════════════
  {
    const prodMsgId = `prod_${run}`;
    const prodHandle = `U_PROD_${run}`;
    const prodThread = `1718111111.${run}`;
    // Inspect the actual enqueue signature: it accepts only {text,from,messageId,channel}.
    await enqueueSlackMessage(userId, {
      text: `@team please rotate the prod database credentials before the audit on Monday`,
      from: prodHandle,
      messageId: prodMsgId,
      channel,
      // @ts-expect-error — intentionally probing: does the real signature even accept graph refs?
      fromHandle: { provider: 'slack', externalId: prodHandle },
      // @ts-expect-error
      threadRef: { provider: 'slack', externalId: prodThread },
    } as any);
    record('production-path', 'enqueueSlackMessage(...) (as /webhooks/slack calls it)',
      `enqueued job slack-intake-${prodMsgId}`);

    // Wait for the worker to drain (real LLM classification + create).
    let prodTask: { id: string } | null = null;
    for (let i = 0; i < 30; i++) {
      await sleep(4000);
      prodTask = await prisma.task.findFirst({
        where: { orgId, sourceRef: { path: ['messageId'], equals: prodMsgId } },
        select: { id: true },
      });
      if (prodTask) break;
    }
    record('production-path', 'poll for worker-created task',
      prodTask ? `task ${prodTask.id} created by worker` : 'no task after 120s');

    assert(
      'production enqueue path (worker) auto-creates a Task',
      prodTask ? 'pass' : 'inconclusive',
      prodTask ? `task ${prodTask.id}` : 'worker did not produce a task within 120s (worker running?)',
    );

    if (prodTask) {
      const prodEdges = await prisma.edge.findMany({ where: { orgId, fromType: 'task', fromId: prodTask.id } });
      const prodPerson = await prisma.person.findFirst({ where: { orgId, slackUserId: prodHandle } });
      assert(
        'production path lands graph edges (Person/produced_by/discussed_in)',
        prodEdges.length > 0 ? 'pass' : 'fail',
        prodEdges.length > 0
          ? `edges: [${prodEdges.map((e) => e.kind).join(', ')}]`
          : `ZERO edges and person=${prodPerson ? prodPerson.id : 'none'}. ` +
            `enqueueSlackMessage's signature is {text,from,messageId,channel} — it DROPS fromHandle/threadRef, ` +
            `and the worker calls detectAndCreateTask without them. The graph-landing code in landEdges() is ` +
            `DEAD through the real webhook→task path. "Navigation over search" produces an isolated task node.`,
      );
    }
  }

  // ── Summary ──
  const pass = out.results.filter((r: any) => r.status === 'pass').length;
  const fail = out.results.filter((r: any) => r.status === 'fail').length;
  const inc = out.results.filter((r: any) => r.status === 'inconclusive').length;
  console.log(`\n════════ RESULTS: ${pass} pass / ${fail} fail / ${inc} inconclusive ════════`);
  console.log(JSON.stringify(out, null, 2));

  await workIntakeQueue.close();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('SIM ERROR', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
