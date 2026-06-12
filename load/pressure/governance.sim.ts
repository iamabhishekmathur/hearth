/**
 * GOVERNANCE pressure test — REAL and OBSERVABLE.
 *
 * An admin adds governance controls (a BLOCKING keyword policy + a MONITORING
 * keyword policy + org governance settings enabled). A normal user then hits
 * them in a live chat session, and we capture exactly what Hearth does:
 *   - blocking message  → HTTP 403, agent never runs, violation recorded
 *   - monitoring message → HTTP 202, agent still replies, violation recorded
 *   - clean message      → HTTP 202, agent replies, no violation
 * Then we prove the control is real by disabling the blocking policy and
 * resending the same blocked message (should now pass). Finally TEARDOWN:
 * delete the created policies and restore the org's original governance
 * settings so the seeded org is left clean.
 *
 *   API_URL=http://localhost:8000/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/pressure/governance.sim.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';
const REPLY_TIMEOUT_MS = 60_000;

// ── Hearth client (cookie jar + double-submit CSRF) — copied from load/simulate-llm-dialogue.ts ──
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
  async assistantCount(sessionId: string): Promise<number> {
    const r = await this.req<{ data: { messages: Array<{ role: string; content: string }> } }>('GET', `/chat/sessions/${sessionId}`);
    return r.body.data.messages.filter((m) => m.role === 'assistant').length;
  }
  /** Send a user message; return raw send status + body. Does NOT wait for a reply. */
  async send(sessionId: string, content: string): Promise<{ status: number; body: any }> {
    return this.req(sessionId ? `POST` : `POST`, `/chat/sessions/${sessionId}/messages`, { content });
  }
  /** Wait for a NEW assistant reply beyond `before` count. Returns reply text or null. */
  async waitForReply(sessionId: string, before: number): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < REPLY_TIMEOUT_MS) {
      await sleep(2500);
      const r = await this.req<{ data: { messages: Array<{ role: string; content: string }> } }>('GET', `/chat/sessions/${sessionId}`);
      const all = r.body.data.messages.filter((m) => m.role === 'assistant');
      if (all.length > before && all[all.length - 1]?.content) return all[all.length - 1].content;
    }
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 220) => { const c = (s ?? '').replace(/\s+/g, ' ').trim(); return c.slice(0, n) + (c.length > n ? '…' : ''); };
const hr = (c = '─') => c.repeat(78);

// ── Structured capture for the final report ──
interface Interaction { actor: string; action: string; hearthResponse: string }
const interactions: Interaction[] = [];
const log = (i: Interaction) => { interactions.push(i); };

async function main() {
  console.log(`\n${hr('═')}\nGOVERNANCE PRESSURE TEST  ·  live API: ${API}\n${hr('═')}`);

  // ════════════════════════════════════════════════════════════════════════
  // STEP 1 — ADMIN adds governance controls
  // ════════════════════════════════════════════════════════════════════════
  const admin = new Hearth();
  await admin.login('admin@hearth.local');
  console.log('\n[ADMIN] Logged in as admin@hearth.local (Alex Rivera)');

  // Capture original org governance settings so teardown can restore them.
  const origSettingsResp = await admin.req<{ data: any }>('GET', '/admin/governance/settings');
  const origSettings = origSettingsResp.body.data;
  console.log('[ADMIN] Original governance settings:', JSON.stringify(origSettings));

  // Enable governance (default is enabled:false → without this, NOTHING is evaluated).
  const enableResp = await admin.req('PUT', '/admin/governance/settings', {
    enabled: true,
    checkUserMessages: true,
    checkAiResponses: false,
    notifyAdmins: true,
    monitoringBanner: true,
  });
  console.log(`[ADMIN] Enabled governance settings → ${enableResp.status} ${JSON.stringify(enableResp.body)}`);
  log({ actor: 'admin@hearth.local', action: 'PUT /admin/governance/settings {enabled:true,checkUserMessages:true,notifyAdmins:true}', hearthResponse: `${enableResp.status} ${JSON.stringify(enableResp.body)}` });

  // BLOCKING policy: forbid sharing of credentials/secrets via keyword match.
  const blockCreate = await admin.req<{ data: any }>('POST', '/admin/governance/policies', {
    name: 'No credential sharing',
    description: 'Forbids sharing of secrets/credentials in chat.',
    category: 'data_privacy',
    severity: 'critical',
    ruleType: 'keyword',
    ruleConfig: { keywords: ['AKIA', 'password=', 'secret_key', 'BEGIN RSA PRIVATE KEY'], matchMode: 'any', caseSensitive: false },
    enforcement: 'block',
    scope: {},
  });
  const blockPolicy = blockCreate.body.data;
  console.log(`[ADMIN] Created BLOCKING policy → ${blockCreate.status}  id=${blockPolicy?.id}`);
  log({ actor: 'admin@hearth.local', action: "POST /admin/governance/policies (BLOCK, keyword, severity=critical) 'No credential sharing'", hearthResponse: `${blockCreate.status} id=${blockPolicy?.id} enforcement=${blockPolicy?.enforcement}` });

  // MONITORING policy: observe-only flag of a forbidden topic keyword.
  const monCreate = await admin.req<{ data: any }>('POST', '/admin/governance/policies', {
    name: 'Competitor-name monitoring',
    description: 'Observe-only: flags messages mentioning the competitor "Acme".',
    category: 'compliance',
    severity: 'warning',
    ruleType: 'keyword',
    ruleConfig: { keywords: ['acme'], matchMode: 'any', caseSensitive: false },
    enforcement: 'monitor',
    scope: {},
  });
  const monPolicy = monCreate.body.data;
  console.log(`[ADMIN] Created MONITORING policy → ${monCreate.status}  id=${monPolicy?.id}`);
  log({ actor: 'admin@hearth.local', action: "POST /admin/governance/policies (MONITOR, keyword, severity=warning) 'Competitor-name monitoring'", hearthResponse: `${monCreate.status} id=${monPolicy?.id} enforcement=${monPolicy?.enforcement}` });

  // GET the controls back and PRINT them.
  const listResp = await admin.req<{ data: any[] }>('GET', '/admin/governance/policies');
  const ours = listResp.body.data.filter((p) => p.id === blockPolicy?.id || p.id === monPolicy?.id);
  console.log(`\n${hr()}\nCONTROLS NOW ACTIVE (org governance enabled=${(await admin.req<{ data: any }>('GET', '/admin/governance/settings')).body.data.enabled})\n${hr()}`);
  for (const p of ours) {
    console.log(`  • [${p.enforcement.toUpperCase()}] "${p.name}"  severity=${p.severity}  type=${p.ruleType}`);
    console.log(`      match: ${JSON.stringify(p.ruleConfig)}  enabled=${p.enabled}  violations=${p.violationCount ?? 0}`);
  }
  console.log(hr());

  // ════════════════════════════════════════════════════════════════════════
  // STEP 2 — A normal USER hits the controls in one session
  // ════════════════════════════════════════════════════════════════════════
  const user = new Hearth();
  await user.login('dev1@hearth.local');
  console.log('\n[USER] Logged in as dev1@hearth.local (Sam Park)');
  const sessionId = await user.newSession('Governance pressure — Sam');
  console.log(`[USER] New session ${sessionId}`);

  // (a) VIOLATES blocking policy
  const blockMsg = 'Here is the AWS key to deploy: AKIAIOSFODNN7EXAMPLE and password=hunter2';
  console.log(`\n${hr()}\nUSER ACTION (a) — message that VIOLATES the BLOCKING policy:\n  "${blockMsg}"\n${hr()}`);
  const beforeA = await user.assistantCount(sessionId);
  const sendA = await user.send(sessionId, blockMsg);
  console.log(`  HEARTH RESPONSE: HTTP ${sendA.status}  body=${JSON.stringify(sendA.body)}`);
  let replyA: string | null = '[not polled — blocked]';
  if (sendA.status === 202) {
    replyA = await user.waitForReply(sessionId, beforeA);
    console.log(`  Agent reply: ${replyA ? trim(replyA) : '[none within timeout]'}`);
  } else {
    console.log('  Agent NOT dispatched (request returned before runAgent).');
  }
  log({ actor: 'dev1@hearth.local', action: `send credential-sharing message (trips BLOCK policy): "${trim(blockMsg, 80)}"`, hearthResponse: `HTTP ${sendA.status} ${JSON.stringify(sendA.body)}; agent reply=${sendA.status === 202 ? (replyA ? 'produced' : 'none') : 'NOT dispatched'}` });

  // (b) Trips MONITORING policy only
  const monMsg = 'Can you compare our roadmap against Acme Corp and summarize the gaps?';
  console.log(`\n${hr()}\nUSER ACTION (b) — message that trips the MONITORING policy only:\n  "${monMsg}"\n${hr()}`);
  const beforeB = await user.assistantCount(sessionId);
  const sendB = await user.send(sessionId, monMsg);
  console.log(`  HEARTH RESPONSE: HTTP ${sendB.status}  body=${JSON.stringify(sendB.body)}`);
  let replyB: string | null = null;
  if (sendB.status === 202) {
    replyB = await user.waitForReply(sessionId, beforeB);
    console.log(`  Agent reply: ${replyB ? trim(replyB) : '[none within timeout]'}`);
  }
  log({ actor: 'dev1@hearth.local', action: `send competitor-mention message (trips MONITOR policy): "${trim(monMsg, 80)}"`, hearthResponse: `HTTP ${sendB.status}; agent reply=${replyB ? 'produced (allowed through)' : 'none'}` });

  // (c) Clean compliant message
  const cleanMsg = 'What are good practices for writing idempotent database migrations?';
  console.log(`\n${hr()}\nUSER ACTION (c) — clean compliant message:\n  "${cleanMsg}"\n${hr()}`);
  const beforeC = await user.assistantCount(sessionId);
  const sendC = await user.send(sessionId, cleanMsg);
  console.log(`  HEARTH RESPONSE: HTTP ${sendC.status}  body=${JSON.stringify(sendC.body)}`);
  let replyC: string | null = null;
  if (sendC.status === 202) {
    replyC = await user.waitForReply(sessionId, beforeC);
    console.log(`  Agent reply: ${replyC ? trim(replyC) : '[none within timeout]'}`);
  }
  log({ actor: 'dev1@hearth.local', action: `send clean compliant message: "${trim(cleanMsg, 80)}"`, hearthResponse: `HTTP ${sendC.status}; agent reply=${replyC ? 'produced' : 'none'}` });

  // ── Admin reads violations ──
  await sleep(2000); // let fire-and-forget monitor evaluation land
  const viol = await admin.req<{ data: any[]; total: number }>('GET', `/admin/governance/violations?pageSize=50`);
  const ourViol = viol.body.data.filter((v) => v.policyId === blockPolicy?.id || v.policyId === monPolicy?.id);
  console.log(`\n${hr()}\nADMIN VIEW — violations recorded (GET /admin/governance/violations, total=${viol.body.total}):\n${hr()}`);
  for (const v of ourViol) {
    console.log(`  • policy="${v.policyName}" user=${v.userName} severity=${v.severity} enforcement=${v.enforcement} status=${v.status}`);
    console.log(`      snippet="${trim(v.contentSnippet, 90)}"  match=${JSON.stringify(v.matchDetails)}`);
  }
  const blockViol = ourViol.find((v) => v.policyId === blockPolicy?.id);
  const monViol = ourViol.find((v) => v.policyId === monPolicy?.id);
  log({ actor: 'admin@hearth.local', action: 'GET /admin/governance/violations', hearthResponse: `${ourViol.length} violation(s) for our policies: block=${blockViol ? 'recorded' : 'MISSING'}, monitor=${monViol ? 'recorded' : 'MISSING'}` });

  // ════════════════════════════════════════════════════════════════════════
  // STEP 3 — Prove the control is real: disable blocking policy, resend
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${hr('═')}\nSTEP 3 — Disable BLOCKING policy, resend the previously-blocked message\n${hr('═')}`);
  const disableResp = await admin.req('PUT', `/admin/governance/policies/${blockPolicy.id}`, { enabled: false });
  console.log(`[ADMIN] Disabled blocking policy → ${disableResp.status}`);
  log({ actor: 'admin@hearth.local', action: `PUT /admin/governance/policies/${blockPolicy.id} {enabled:false}`, hearthResponse: `${disableResp.status} (policy disabled)` });

  // Policy cache TTL is 60s; wait it out so hasBlockPolicies() reflects the change.
  console.log('[ADMIN] Waiting 62s for the 60s in-memory policy cache to expire...');
  await sleep(62_000);

  const beforeD = await user.assistantCount(sessionId);
  const sendD = await user.send(sessionId, blockMsg);
  console.log(`\nUSER ACTION (d) — resend the SAME blocked message:\n  "${blockMsg}"`);
  console.log(`  HEARTH RESPONSE: HTTP ${sendD.status}  body=${JSON.stringify(sendD.body)}`);
  let replyD: string | null = null;
  if (sendD.status === 202) {
    replyD = await user.waitForReply(sessionId, beforeD);
    console.log(`  Agent reply: ${replyD ? trim(replyD) : '[none within timeout]'}`);
  }
  log({ actor: 'dev1@hearth.local', action: 'resend the SAME credential message AFTER block policy disabled', hearthResponse: `HTTP ${sendD.status} (previously 403); agent reply=${replyD ? 'produced' : 'none'}` });

  // ════════════════════════════════════════════════════════════════════════
  // TEARDOWN — delete created policies, restore original settings
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${hr('═')}\nTEARDOWN\n${hr('═')}`);
  const delBlock = await admin.req('DELETE', `/admin/governance/policies/${blockPolicy.id}`);
  const delMon = await admin.req('DELETE', `/admin/governance/policies/${monPolicy.id}`);
  console.log(`[ADMIN] Deleted blocking policy → ${delBlock.status}; monitoring policy → ${delMon.status}`);
  const restore = await admin.req('PUT', '/admin/governance/settings', {
    enabled: origSettings.enabled,
    checkUserMessages: origSettings.checkUserMessages,
    checkAiResponses: origSettings.checkAiResponses,
    notifyAdmins: origSettings.notifyAdmins,
    monitoringBanner: origSettings.monitoringBanner,
  });
  console.log(`[ADMIN] Restored original governance settings → ${restore.status} ${JSON.stringify(origSettings)}`);

  // Verify clean
  const afterList = await admin.req<{ data: any[] }>('GET', '/admin/governance/policies');
  const leftover = afterList.body.data.filter((p) => p.id === blockPolicy.id || p.id === monPolicy.id);
  console.log(`[ADMIN] Leftover of our policies after teardown: ${leftover.length} (expect 0)`);
  log({ actor: 'admin@hearth.local', action: 'TEARDOWN: delete both policies + restore settings', hearthResponse: `del=${delBlock.status}/${delMon.status}, settings restored=${restore.status}, leftover policies=${leftover.length}` });

  // ── Machine-readable summary for the harness ──
  const result = {
    sendBlockedStatus: sendA.status,
    blockedAgentReply: sendA.status === 202 ? !!replyA : false,
    sendMonitorStatus: sendB.status,
    monitorAgentReply: !!replyB,
    sendCleanStatus: sendC.status,
    cleanAgentReply: !!replyC,
    blockViolationRecorded: !!blockViol,
    monitorViolationRecorded: !!monViol,
    resendAfterDisableStatus: sendD.status,
    teardownLeftover: leftover.length,
  };
  console.log(`\n${hr('═')}\nRESULT JSON: ${JSON.stringify(result)}\n${hr('═')}`);
}

main().catch((e) => { console.error('governance sim failed:', e); process.exit(1); });
