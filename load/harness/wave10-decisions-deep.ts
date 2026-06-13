/**
 * WAVE 10 — Decision graph, links, patterns, lifecycle (deep sub-features).
 */
import { loginAs, sleep, short, Recorder } from './core.js';

const F = 'Decisions (graph)';

async function main() {
  const rec = new Recorder('wave10-decisions-deep');
  const lead = await loginAs('eng-lead@hearth.local');
  const stranger = await loginAs('sales-rep@hearth.local');

  const D1 = (await lead.req<{ data?: { id: string } }>('POST', '/decisions', { title: 'Adopt Kafka for the event bus', reasoning: 'High-throughput, durable, replayable.', domain: 'engineering', scope: 'team', confidence: 'high' })).body.data?.id!;
  const D2 = (await lead.req<{ data?: { id: string } }>('POST', '/decisions', { title: 'Run Kafka on MSK (managed)', reasoning: 'Avoid operating Kafka ourselves.', domain: 'engineering', scope: 'team', confidence: 'medium' })).body.data?.id!;

  // ── Links ─────────────────────────────────────────────────────────────────
  console.log('\n══ Links ══');
  const link = await lead.req('POST', `/decisions/${D1}/dependencies`, { toDecisionId: D2, relationship: 'related_to', description: 'MSK realizes the Kafka choice' });
  rec.record({ feature: F, subFeature: 'link', type: 'happy', name: 'Add a dependency link between decisions',
    expected: '201', observed: `status ${link.status}`, status: link.status === 201 ? 'pass' : 'partial' });
  const strangerLink = await stranger.req('POST', `/decisions/${D1}/dependencies`, { toDecisionId: D2, relationship: 'depends_on' });
  rec.record({ feature: F, subFeature: 'link RBAC', type: 'permission', name: "Non-owner adds a link to someone's decision",
    expected: '403/404 — not owner/org-scoped', observed: `status ${strangerLink.status}`,
    status: strangerLink.status >= 400 ? 'pass' : 'fail',
    defects: strangerLink.status === 201 ? ["Decision link endpoints have no org/ownership validation — cross-user/cross-org linking"] : undefined });

  // ── Graph ─────────────────────────────────────────────────────────────────
  console.log('\n══ Graph ══');
  const graph = await lead.req('GET', `/decisions/${D1}/graph?depth=2`);
  rec.record({ feature: F, subFeature: 'graph', type: 'happy', name: 'Read the decision graph',
    expected: '200', observed: `status ${graph.status}`, status: graph.status === 200 ? 'pass' : 'fail' });

  // ── Patterns / principles ─────────────────────────────────────────────────
  console.log('\n══ Patterns ══');
  for (const path of ['/decisions/patterns', '/decisions/principles']) {
    const r = await lead.req('GET', path);
    rec.record({ feature: F, subFeature: 'patterns', type: 'happy', name: `GET ${path}`,
      expected: '200', observed: `status ${r.status}`, status: r.status === 200 ? 'pass' : 'fail' });
  }

  // ── Lifecycle: pending-review / confirm / dismiss ─────────────────────────
  console.log('\n══ Lifecycle ══');
  const pending = await lead.req('GET', '/decisions/pending-review');
  rec.record({ feature: F, subFeature: 'lifecycle', type: 'happy', name: 'List pending-review decisions',
    expected: '200', observed: `status ${pending.status}`, status: pending.status === 200 ? 'pass' : 'fail' });
  const confirm = await lead.req('POST', `/decisions/${D2}/confirm`, {});
  rec.record({ feature: F, subFeature: 'lifecycle', type: 'happy', name: 'Confirm a decision',
    expected: '200', observed: `status ${confirm.status}`, status: confirm.status === 200 ? 'pass' : 'partial' });

  // ── Conflict detection (audit: not implemented) ───────────────────────────
  console.log('\n══ Conflict ══');
  {
    const c1 = await lead.req<{ data?: { id: string } }>('POST', '/decisions', { title: 'Standardize on REST APIs', reasoning: 'Simplicity and ubiquity.', domain: 'engineering', scope: 'org', confidence: 'high' });
    await sleep(800);
    const c2 = await lead.req<{ data?: { id: string; status?: string } }>('POST', '/decisions', { title: 'Standardize on gRPC instead of REST for all services', reasoning: 'Performance and typed contracts — replaces REST.', domain: 'engineering', scope: 'org', confidence: 'high' });
    // No conflict surface exists; record the gap (the two opposing decisions both stay 'active', unlinked-as-contradiction)
    rec.record({ feature: F, subFeature: 'conflict detection', type: 'pressure', name: 'Two directly-contradictory org decisions',
      expected: 'system flags the contradiction', observed: `both created (c1=${c1.status}, c2=${c2.status}); no conflict surfaced`,
      status: 'fail', defects: ['No conflict detection — two directly-contradictory decisions are both stored as active with no contradiction flag/alert'] });
  }

  rec.save();
  process.exit(0);
}

main().catch((e) => { console.error('wave10 failed:', e); process.exit(1); });
