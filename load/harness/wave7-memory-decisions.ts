/**
 * WAVE 7 — Memory & Decisions, end to end.
 *
 * Memory happy: create user-layer + search. RBAC: member writing org/team
 * layers should 403. Defect: expired entry still fetchable via GET /:id.
 * Decisions happy: capture + search + record outcome. Defects: no Zod → bad
 * enum returns 500 not 400; silent dedup merge (duplicate create returns the
 * existing decision as 201, caller can't tell); bad outcome verdict → 500.
 */
import { loginAs, prisma, sleep, short, Recorder } from './core.js';

const F1 = 'Memory';
const F2 = 'Decisions';

async function main() {
  const rec = new Recorder('wave7-memory-decisions');

  // ── Memory ────────────────────────────────────────────────────────────────
  console.log('\n══ Memory ══');
  const dev = await loginAs('dev1@hearth.local'); // member
  const mk = await dev.req<{ data?: { id: string } }>('POST', '/memory', { layer: 'user', content: 'I prefer pnpm over npm for all our repos.' });
  rec.record({ feature: F1, subFeature: 'create', type: 'happy', name: 'Create a user-layer memory',
    expected: '201', observed: `status ${mk.status}`, status: mk.status === 201 ? 'pass' : 'fail' });

  await sleep(1200); // embedding is async
  const search = await dev.req<{ data?: any }>('POST', '/memory/search', { query: 'package manager preference' });
  rec.record({ feature: F1, subFeature: 'search', type: 'happy', name: 'Search memory (hybrid)',
    expected: '200 with results', observed: `status ${search.status}`, status: search.status === 200 ? 'pass' : 'fail' });

  // RBAC: member writing org-layer / team-layer
  const orgMem = await dev.req('POST', '/memory', { layer: 'org', content: 'Org-wide secret note' });
  rec.record({ feature: F1, subFeature: 'layer RBAC', type: 'permission', name: 'Member writes an ORG-layer memory',
    expected: '403 — org layer is admin-only', observed: `status ${orgMem.status}`,
    status: orgMem.status === 403 ? 'pass' : 'fail',
    defects: orgMem.status === 201 ? ['A member can write an ORG-layer memory (should be admin-only)'] : undefined });
  const teamMem = await dev.req('POST', '/memory', { layer: 'team', content: 'Team note' });
  rec.record({ feature: F1, subFeature: 'layer RBAC', type: 'permission', name: 'Member writes a TEAM-layer memory',
    expected: '403 — team layer is admin/lead only', observed: `status ${teamMem.status}`,
    status: teamMem.status === 403 ? 'pass' : 'fail',
    defects: teamMem.status === 201 ? ['A member can write a TEAM-layer memory (should be admin/team_lead only)'] : undefined });

  // Defect: expired memory still fetchable via GET /:id
  {
    const exp = await dev.req<{ data?: { id: string } }>('POST', '/memory', { layer: 'user', content: 'Already-expired note', expiresAt: new Date(Date.now() - 86_400_000).toISOString() });
    const id = exp.body.data?.id;
    if (id) {
      const get = await dev.req('GET', `/memory/${id}`);
      rec.record({ feature: F1, subFeature: 'expiry', type: 'pressure', name: 'Fetch an already-expired memory by id',
        expected: 'expired entries are not returned', observed: `GET status ${get.status}`,
        status: get.status === 404 ? 'pass' : 'fail',
        defects: get.status === 200 ? ['GET /memory/:id returns an EXPIRED entry (no expiry filter on the by-id read — inconsistent with listing/search)'] : undefined });
    }
  }

  // ── Decisions ─────────────────────────────────────────────────────────────
  console.log('\n══ Decisions ══');
  // The FRESH capture must not dedup-merge into a prior run's identical decision
  // (a [tag] suffix alone stays >0.90 similar and merges → 200, not 201). So we
  // clear prior runs' marked capture decisions first (FKs cascade), then capture
  // with a marker. The dedup test below re-sends this exact decision to verify
  // the merge path returns 200.
  // Test-EXCLUSIVE subject ("Zephyr-trace") so the fresh capture doesn't dedup
  // against the org's many real tracing/OpenTelemetry decisions (embedding match
  // is org-wide and ignores a [tag] suffix). Clear prior Zephyr-trace rows first.
  const capTag = Math.floor(Date.now() / 1000) % 100000;
  await prisma.decision.deleteMany({ where: { title: { contains: 'Zephyr-trace' } } });
  const capPayload = { title: `Adopt Zephyr-trace as the tracing standard [${capTag}]`, reasoning: `Zephyr-trace becomes our one tracing standard across services. Ref ${capTag}.`, domain: 'engineering', scope: 'team' as const, confidence: 'high' as const };
  const cap = await dev.req<{ data?: { id: string } }>('POST', '/decisions', capPayload);
  const did = cap.body.data?.id;
  rec.record({ feature: F2, subFeature: 'capture', type: 'happy', name: 'Capture a decision',
    expected: '201', observed: `status ${cap.status}`, status: cap.status === 201 ? 'pass' : 'fail' });

  await sleep(1200);
  const dsearch = await dev.req('POST', '/decisions/search', { query: 'tracing observability' });
  rec.record({ feature: F2, subFeature: 'search', type: 'happy', name: 'Search decisions (hybrid)',
    expected: '200', observed: `status ${dsearch.status}`, status: dsearch.status === 200 ? 'pass' : 'fail' });

  // Defect: no Zod — bad enum → 500 not 400
  const badEnum = await dev.req('POST', '/decisions', { title: 'Bad enum decision', reasoning: 'x', confidence: 'super-high', scope: 'galactic' });
  rec.record({ feature: F2, subFeature: 'validation', type: 'user_error', name: 'Capture decision with invalid enum values',
    expected: '400 validation error', observed: `status ${badEnum.status}`,
    status: badEnum.status === 400 ? 'pass' : 'fail',
    defects: badEnum.status >= 500 ? ['Invalid enum (confidence/scope) returns 500 — no request-body validation (Zod) on decisions'] : undefined });

  // Defect: silent dedup merge — duplicate create returns the existing decision
  {
    const a = await dev.req<{ data?: { id: string }; deduped?: boolean }>('POST', '/decisions', capPayload);
    const merged = a.body.data?.id === did;
    rec.record({ feature: F2, subFeature: 'dedup', type: 'pressure', name: 'Capture a near-duplicate decision',
      expected: 'dedup is transparent (e.g. 200 + a "merged" flag), not a silent 201 of the old row', observed: `status ${a.status}; returned-existing-id=${merged}`,
      status: merged && a.status === 201 ? 'fail' : 'pass',
      defects: merged && a.status === 201 ? ['Duplicate decision is silently merged and returned as a 201 with the EXISTING id — caller cannot tell it was deduped'] : undefined });
  }

  // Outcomes
  if (did) {
    const oc = await dev.req('POST', `/decisions/${did}/outcomes`, { verdict: 'positive', description: 'Tracing coverage is up.' });
    rec.record({ feature: F2, subFeature: 'outcomes', type: 'happy', name: 'Record a decision outcome',
      expected: '200/201', observed: `status ${oc.status}`, status: oc.status < 300 ? 'pass' : 'fail' });
    const badOc = await dev.req('POST', `/decisions/${did}/outcomes`, { verdict: 'amazing', description: 'should be rejected for the verdict' });
    rec.record({ feature: F2, subFeature: 'outcomes', type: 'user_error', name: 'Record an outcome with an invalid verdict',
      expected: '400', observed: `status ${badOc.status}`,
      status: badOc.status === 400 ? 'pass' : 'fail',
      defects: badOc.status >= 500 ? ['Invalid outcome verdict returns 500 — no validation'] : undefined });
  }

  // Teamless cross-tenant fallback (getOrgId → oldest org)
  {
    const orphan = await loginAs('orphan@nowhere.local'); // no team → no org
    const r = await orphan.req<{ data?: { id: string; orgId?: string } }>('POST', '/decisions', { title: 'Orphan decision', reasoning: 'no team here' });
    rec.record({ feature: F2, subFeature: 'tenancy', type: 'permission', name: 'Teamless user captures a decision',
      expected: 'rejected — user has no org', observed: `status ${r.status}`,
      status: r.status >= 400 ? 'pass' : 'fail',
      defects: r.status === 201 ? ['A teamless user can create a decision — getOrgId falls back to the OLDEST org in the DB (cross-tenant write)'] : undefined });
  }

  rec.save();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error('wave7 failed:', e); await prisma.$disconnect(); process.exit(1); });
