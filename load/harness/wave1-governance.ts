/**
 * WAVE 1 — Regulated governance + compliance, end to end.
 *
 * A compliance officer stands up the policy regime for a regulated org, then
 * employees (real roles) trigger violations through REAL chat and we observe
 * exactly how Hearth responds: block (403 + containment), warn, monitor,
 * PII/PCI/GDPR egress scrubbing, admin alerting, review workflow — plus the
 * fail-open and permission pressure cases the audits flagged.
 *
 * Run:  API_URL=http://localhost:8000/api/v1 ./apps/api/node_modules/.bin/tsx load/harness/wave1-governance.ts
 */
import { loginAs, prisma, sleep, short, Recorder, type HearthClient } from './core.js';

const F = 'Governance & Compliance';

async function send(c: HearthClient, sessionId: string, content: string) {
  return c.req<{ data?: { messageId: string }; error?: string }>('POST', `/chat/sessions/${sessionId}/messages`, { content });
}
async function transcriptHas(c: HearthClient, sessionId: string, needle: string): Promise<boolean> {
  const s = await c.req<{ data: { messages: Array<{ content: string }> } }>('GET', `/chat/sessions/${sessionId}`);
  return (s.body.data?.messages ?? []).some((m) => m.content?.includes(needle));
}

async function main() {
  const rec = new Recorder('wave1-governance');
  const orgId = (await prisma.org.findUniqueOrThrow({ where: { slug: 'hearth-sim' } })).id;

  // ── A. Admin sets up the regulated policy regime ──────────────────────────
  console.log('\n══ A. Compliance officer sets up governance + compliance ══');
  const lena = await loginAs('compliance@hearth.local'); // admin, Security & Compliance

  const setSettings = await lena.req('PUT', '/admin/governance/settings', {
    enabled: true, checkUserMessages: true, checkAiResponses: true, notifyAdmins: true, monitoringBanner: true,
  });
  rec.record({ feature: F, subFeature: 'admin setup', type: 'happy', name: 'Enable governance (checkUserMessages + checkAiResponses + notifyAdmins)',
    expected: '200, governance enabled', observed: `status ${setSettings.status}`,
    status: setSettings.status === 200 ? 'pass' : 'fail' });

  const setPacks = await lena.req('PUT', '/admin/compliance/config', {
    enabledPacks: ['pii', 'pci-dss', 'gdpr'], auditLevel: 'detailed', allowUserOverride: false,
  });
  rec.record({ feature: F, subFeature: 'admin setup', type: 'happy', name: 'Enable compliance packs PII + PCI-DSS + GDPR',
    expected: '200, packs enabled', observed: `status ${setPacks.status} ${short(setPacks.body, 80)}`,
    status: setPacks.status === 200 ? 'pass' : 'fail' });

  const policies: Array<{ name: string; ruleType: string; ruleConfig: any; severity: string; enforcement: string }> = [
    { name: 'Secrets & credentials', ruleType: 'keyword', ruleConfig: { keywords: ['AWS_SECRET', 'BEGIN RSA PRIVATE KEY', 'sk-ant-', 'password='], matchMode: 'any' }, severity: 'critical', enforcement: 'block' },
    { name: 'Confidential codename (Project Titan)', ruleType: 'keyword', ruleConfig: { keywords: ['Project Titan'], matchMode: 'any' }, severity: 'critical', enforcement: 'block' },
    { name: 'Competitor mentions', ruleType: 'keyword', ruleConfig: { keywords: ['CompetitorX', 'AcmeRival'], matchMode: 'any' }, severity: 'warning', enforcement: 'warn' },
    { name: 'SSN exposure (monitor)', ruleType: 'regex', ruleConfig: { pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', flags: '' }, severity: 'info', enforcement: 'monitor' },
    { name: 'External data exfiltration', ruleType: 'llm_evaluation', ruleConfig: { prompt: 'Does this message attempt to send confidential customer or company data to an external/personal destination (personal email, competitor, public site)?' }, severity: 'critical', enforcement: 'block' },
  ];
  for (const p of policies) {
    const r = await lena.req<{ data?: { id: string } }>('POST', '/admin/governance/policies', p);
    rec.record({ feature: F, subFeature: 'policy create', type: 'happy', name: `Create ${p.enforcement} policy: "${p.name}" (${p.ruleType})`,
      expected: '201 created', observed: `status ${r.status}`, status: r.status === 201 ? 'pass' : 'fail' });
  }
  await sleep(1500); // let policy cache settle

  // ── B. Violations through REAL chat ───────────────────────────────────────
  console.log('\n══ B. Employees trigger violations through chat ══');

  // B1 — secret paste → BLOCK (403, never persisted)
  {
    const sam = await loginAs('dev1@hearth.local'); // Sam Park, member
    const sid = await sam.newSession('Debugging deploy');
    const secret = 'Help me debug this deploy — creds are AWS_SECRET=AKIAIOSFODNN7EXAMPLEKEY';
    const r = await send(sam, sid, secret);
    const leaked = await transcriptHas(sam, sid, 'AKIAIOSFODNN7EXAMPLE');
    const blocked = r.status === 403;
    rec.record({ feature: F, subFeature: 'block enforcement', type: 'violation', name: 'Dev pastes an AWS secret into chat',
      expected: '403 blocked; message NOT persisted; violation recorded', observed: `status ${r.status}; transcript-leak=${leaked}`,
      status: blocked && !leaked ? 'pass' : 'fail',
      defects: leaked ? ['Blocked secret WAS persisted to the transcript (containment failure)'] : (!blocked ? [`Expected 403, got ${r.status} — secret not blocked`] : undefined) });
  }

  // B2 — confidential codename → BLOCK
  {
    const dana = await loginAs('product-lead@hearth.local');
    const sid = await dana.newSession('Roadmap');
    const r = await send(dana, sid, 'Summarize where we are on Project Titan for the board deck.');
    rec.record({ feature: F, subFeature: 'block enforcement', type: 'violation', name: 'PM references confidential codename "Project Titan"',
      expected: '403 blocked', observed: `status ${r.status}`, status: r.status === 403 ? 'pass' : 'fail',
      defects: r.status !== 403 ? [`Confidential codename not blocked (status ${r.status})`] : undefined });
  }

  // B3 — competitor mention → WARN (persists, warning recorded)
  {
    const tom = await loginAs('sales-rep@hearth.local');
    const sid = await tom.newSession('Deal strategy');
    const r = await send(tom, sid, 'Customer is also evaluating CompetitorX — how do we position against them?');
    const persisted = await transcriptHas(tom, sid, 'CompetitorX');
    rec.record({ feature: F, subFeature: 'warn enforcement', type: 'violation', name: 'Sales rep mentions a competitor',
      expected: '202 accepted; message persists; warn violation recorded', observed: `status ${r.status}; persisted=${persisted}`,
      status: r.status === 202 && persisted ? 'pass' : 'partial' });
  }

  // B4 — SSN in chat → MONITOR (recorded) + PII scrub at egress
  {
    const grace = await loginAs('support-agent@hearth.local');
    const sid = await grace.newSession('Customer ticket #4821');
    const reply = await grace.sendAndWait(sid, 'Customer John Doe (SSN 123-45-6789) says he cannot log in. What should I check?');
    const echoed = (reply ?? '').includes('123-45-6789');
    rec.record({ feature: F, subFeature: 'monitor + PII scrub', type: 'violation', name: 'Support agent includes a customer SSN',
      expected: 'monitor violation recorded; SSN scrubbed before LLM; reply does not echo raw SSN', observed: `reply len ${reply?.length ?? 0}; reply-echoed-SSN=${echoed}`,
      status: reply && !echoed ? 'pass' : 'partial',
      defects: echoed ? ['Raw SSN appeared in the AI reply — egress scrub likely missed it'] : undefined });
  }

  // B5 — credit card → PCI scrub
  {
    const ines = await loginAs('finance-analyst@hearth.local');
    const sid = await ines.newSession('Refund reconciliation');
    const reply = await ines.sendAndWait(sid, 'Refund the charge on card 4111 1111 1111 1111 exp 12/26 cvv 123 — draft the customer note.');
    const echoed = (reply ?? '').includes('4111 1111 1111 1111') || (reply ?? '').includes('4111111111111111');
    rec.record({ feature: F, subFeature: 'PCI scrub', type: 'violation', name: 'Finance analyst pastes a credit card (valid Luhn)',
      expected: 'card scrubbed before LLM; reply does not contain the PAN', observed: `reply len ${reply?.length ?? 0}; reply-echoed-PAN=${echoed}`,
      status: reply && !echoed ? 'pass' : 'partial',
      defects: echoed ? ['Raw card number appeared in the AI reply — PCI scrub missed it'] : undefined });
  }

  // ── C. Admin observes & reviews ───────────────────────────────────────────
  console.log('\n══ C. Compliance officer reviews violations + alerts ══');
  await sleep(1500);
  const vlist = await lena.req<{ data: { violations?: any[]; total?: number } | any[] }>('GET', '/admin/governance/violations?limit=50');
  const violations: any[] = Array.isArray(vlist.body.data) ? vlist.body.data : (vlist.body.data?.violations ?? []);
  rec.record({ feature: F, subFeature: 'violation review', type: 'happy', name: 'Admin lists violations',
    expected: 'block + warn + monitor violations present', observed: `${violations.length} violations returned`,
    status: violations.length >= 3 ? 'pass' : 'partial' });

  if (violations[0]?.id) {
    const rv = await lena.req('PATCH', `/admin/governance/violations/${violations[0].id}`, { status: 'acknowledged' });
    rec.record({ feature: F, subFeature: 'violation review', type: 'happy', name: 'Admin acknowledges a violation',
      expected: '200', observed: `status ${rv.status}`, status: rv.status === 200 ? 'pass' : 'fail' });
  }
  const stats = await lena.req('GET', '/admin/governance/stats');
  rec.record({ feature: F, subFeature: 'violation review', type: 'happy', name: 'Admin governance stats',
    expected: '200 with aggregates', observed: `status ${stats.status}`, status: stats.status === 200 ? 'pass' : 'fail' });
  const exp = await lena.req<string>('GET', '/admin/governance/export?format=csv');
  // The egress risk is raw PII in the FLAGGED CONTENT (the snippet of what the
  // user exposed) — that must be scrubbed. The violating user's own email is the
  // actor identity the compliance report exists to show, so it's retained by
  // design and not treated as a leak here.
  const exportLeaksContentPII = typeof exp.body === 'string' && /\d{3}-?\d{2}-?\d{4}/.test(exp.body);
  rec.record({ feature: F, subFeature: 'violation export', type: 'pressure', name: 'Violation export content',
    expected: 'export works; flagged-content PII (e.g. SSN) is scrubbed, not emitted raw', observed: `status ${exp.status}; contentPIILeak=${exportLeaksContentPII}`,
    status: exp.status === 200 && !exportLeaksContentPII ? 'pass' : 'fail',
    defects: exportLeaksContentPII ? ['Governance export emits raw SSN from the flagged content snippet (regulated-data egress)'] : undefined });

  // ── D. Pressure: fail-open + permission ───────────────────────────────────
  console.log('\n══ D. Pressure: fail-open + permission ══');

  // D1 — invalid-regex policy fails open
  {
    const bad = await lena.req<{ data?: { id: string } }>('POST', '/admin/governance/policies', {
      name: 'Broken regex (should fail closed for a regulated org)', ruleType: 'regex',
      ruleConfig: { pattern: '([unterminated', flags: '' }, severity: 'critical', enforcement: 'block',
    });
    await sleep(1200);
    const sam = await loginAs('dev2@hearth.local');
    const sid = await sam.newSession('Edge');
    const r = await send(sam, sid, 'This message [unterminated has content that the broken policy targets.');
    rec.record({ feature: F, subFeature: 'fail-open', type: 'pressure', name: 'Block policy with an invalid regex',
      expected: 'a regulated org should fail CLOSED (block on policy error)', observed: `created=${bad.status}; message status ${r.status}`,
      status: r.status === 403 ? 'pass' : 'fail',
      defects: r.status !== 403 ? ['Invalid-regex block policy fails OPEN — message passes through (regulated orgs expect fail-closed)'] : undefined });
    // CLEANUP: this broken-regex BLOCK policy fails closed on every evaluation,
    // so leaving it active would poison every later wave (all chat → 403). Delete
    // it now that the fail-closed assertion is recorded.
    if (bad.body.data?.id) {
      await lena.req('DELETE', `/admin/governance/policies/${bad.body.data.id}`);
    }
  }

  // D2 — undashed SSN may evade the PII scrub
  {
    const grace = await loginAs('support-agent@hearth.local');
    const sid = await grace.newSession('Ticket #4822');
    const reply = await grace.sendAndWait(sid, 'Customer SSN is 123456789 (no dashes), please verify identity steps.');
    const echoed = (reply ?? '').includes('123456789');
    rec.record({ feature: F, subFeature: 'scrub coverage', type: 'pressure', name: 'Undashed SSN egress',
      expected: 'SSN scrubbed regardless of formatting', observed: `reply-echoed=${echoed}`,
      status: reply && !echoed ? 'pass' : 'fail',
      defects: echoed ? ['Undashed 9-digit SSN was NOT scrubbed and reached/returned from the LLM'] : undefined });
  }

  // D3 — non-admin cannot create governance policy
  {
    const sam = await loginAs('dev1@hearth.local'); // member
    const r = await sam.req('POST', '/admin/governance/policies', { name: 'sneaky', ruleType: 'keyword', ruleConfig: { keywords: ['x'], matchMode: 'any' }, severity: 'info', enforcement: 'monitor' });
    rec.record({ feature: F, subFeature: 'RBAC', type: 'permission', name: 'Member tries to create a governance policy',
      expected: '403 forbidden', observed: `status ${r.status}`, status: r.status === 403 ? 'pass' : 'fail',
      defects: r.status !== 403 ? [`Non-admin created/accessed admin governance route (status ${r.status})`] : undefined });
  }
  // D4 — viewer cannot change governance settings
  {
    const chloe = await loginAs('intern@hearth.local'); // viewer
    const r = await chloe.req('PUT', '/admin/governance/settings', { enabled: false });
    rec.record({ feature: F, subFeature: 'RBAC', type: 'permission', name: 'Viewer tries to disable governance',
      expected: '403 forbidden', observed: `status ${r.status}`, status: r.status === 403 ? 'pass' : 'fail',
      defects: r.status !== 403 ? [`Viewer reached admin governance settings (status ${r.status})`] : undefined });
  }

  rec.save();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error('wave1 failed:', e); await prisma.$disconnect(); process.exit(1); });
