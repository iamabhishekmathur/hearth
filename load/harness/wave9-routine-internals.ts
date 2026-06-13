/**
 * WAVE 9 — Routine internals: chains, triggers, run-state, health alerts.
 *
 * Chains: happy A→B; self-chain 400; cycle 400; non-owner can create a chain
 * (audit: no ownership check). Triggers: create; non-owner create (no check).
 * State: put/get/delete roundtrip; non-owner blocked (scope-checked). Alerts:
 * admin creates; non-admin 403.
 */
import { loginAs, short, Recorder } from './core.js';

const F = 'Routines (internals)';

async function main() {
  const rec = new Recorder('wave9-routine-internals');
  const lead = await loginAs('eng-lead@hearth.local');
  const stranger = await loginAs('sales-rep@hearth.local'); // unrelated member

  const A = (await lead.req<{ data?: { id: string } }>('POST', '/routines', { name: 'Chain A', prompt: 'a', scope: 'personal' })).body.data!.id;
  const B = (await lead.req<{ data?: { id: string } }>('POST', '/routines', { name: 'Chain B', prompt: 'b', scope: 'personal' })).body.data!.id;

  // ── Chains ────────────────────────────────────────────────────────────────
  console.log('\n══ Chains ══');
  const chain = await lead.req('POST', `/routines/${A}/chains`, { targetRoutineId: B, condition: 'on_success' });
  rec.record({ feature: F, subFeature: 'chain', type: 'happy', name: 'Chain A → B on success',
    expected: '201', observed: `status ${chain.status}`, status: chain.status === 201 ? 'pass' : 'fail' });
  const self = await lead.req('POST', `/routines/${A}/chains`, { targetRoutineId: A, condition: 'always' });
  rec.record({ feature: F, subFeature: 'chain validation', type: 'user_error', name: 'Self-chain A → A',
    expected: '400', observed: `status ${self.status}`, status: self.status === 400 ? 'pass' : 'fail' });
  const cycle = await lead.req('POST', `/routines/${B}/chains`, { targetRoutineId: A, condition: 'always' });
  rec.record({ feature: F, subFeature: 'chain validation', type: 'pressure', name: 'Cycle B → A (A→B already exists)',
    expected: '400 cycle detected', observed: `status ${cycle.status}`, status: cycle.status === 400 ? 'pass' : 'fail',
    defects: cycle.status === 201 ? ['Cycle A→B→A was created — cycle detection did not block it'] : undefined });
  const strangerChain = await stranger.req('POST', `/routines/${A}/chains`, { targetRoutineId: B, condition: 'always' });
  rec.record({ feature: F, subFeature: 'chain RBAC', type: 'permission', name: "Non-owner adds a chain to someone's routine",
    expected: '403/404 — not the owner', observed: `status ${strangerChain.status}`,
    status: strangerChain.status >= 400 ? 'pass' : 'fail',
    defects: strangerChain.status === 201 ? ["Chain CRUD has no ownership/scope check — a non-owner can chain another user's routine (confused deputy)"] : undefined });

  // ── Triggers ──────────────────────────────────────────────────────────────
  console.log('\n══ Triggers ══');
  const ep = (await lead.req<{ data?: { id: string; urlToken: string } }>('POST', '/routines/webhook-endpoints', { provider: 'slack' })).body.data!;
  const trig = await lead.req('POST', `/routines/${A}/triggers`, { webhookEndpointId: ep.id, eventType: 'message' });
  rec.record({ feature: F, subFeature: 'trigger', type: 'happy', name: 'Attach an event trigger to a routine',
    expected: '201', observed: `status ${trig.status}`, status: trig.status === 201 ? 'pass' : 'partial' });
  const strangerTrig = await stranger.req('POST', `/routines/${A}/triggers`, { webhookEndpointId: ep.id, eventType: 'message' });
  rec.record({ feature: F, subFeature: 'trigger RBAC', type: 'permission', name: "Non-owner attaches a trigger to someone's routine",
    expected: '403/404', observed: `status ${strangerTrig.status}`,
    status: strangerTrig.status >= 400 ? 'pass' : 'fail',
    defects: strangerTrig.status === 201 ? ["Trigger CRUD has no permission/org check — cross-user trigger injection"] : undefined });

  // ── Run-state roundtrip ───────────────────────────────────────────────────
  console.log('\n══ Run state ══');
  const put = await lead.req('PUT', `/routines/${A}/state`, { counter: 1, lastSeen: 'pr-42' });
  const get = await lead.req<{ data?: any }>('GET', `/routines/${A}/state`);
  rec.record({ feature: F, subFeature: 'state', type: 'happy', name: 'Put + get run-to-run state',
    expected: '200 roundtrip', observed: `put ${put.status}; get ${get.status} ${short(get.body?.data, 50)}`,
    status: put.status === 200 && get.status === 200 ? 'pass' : 'fail' });
  const strangerState = await stranger.req('GET', `/routines/${A}/state`);
  rec.record({ feature: F, subFeature: 'state RBAC', type: 'permission', name: "Non-owner reads another routine's state",
    expected: '404 — scope-checked', observed: `status ${strangerState.status}`,
    status: strangerState.status >= 400 ? 'pass' : 'fail',
    defects: strangerState.status === 200 ? ["Routine state readable cross-user"] : undefined });

  // ── Health alerts (admin) ─────────────────────────────────────────────────
  console.log('\n══ Health alerts ══');
  const admin = await loginAs('it-admin@hearth.local');
  const alert = await admin.req('POST', '/admin/routines/alerts', { routineId: A, alertType: 'consecutive_failures', threshold: { count: 3 } });
  rec.record({ feature: F, subFeature: 'alerts', type: 'happy', name: 'Admin creates a routine health alert',
    expected: '201', observed: `status ${alert.status}`, status: alert.status === 201 ? 'pass' : 'partial' });
  const nonAdminAlert = await lead.req('POST', '/admin/routines/alerts', { routineId: A, alertType: 'high_cost', threshold: { tokens: 100000 } });
  rec.record({ feature: F, subFeature: 'alerts RBAC', type: 'permission', name: 'Non-admin creates a health alert',
    expected: '403', observed: `status ${nonAdminAlert.status}`, status: nonAdminAlert.status === 403 ? 'pass' : 'fail',
    defects: nonAdminAlert.status < 300 ? ['Non-admin reached admin routine-alert route'] : undefined });

  rec.save();
  process.exit(0);
}

main().catch((e) => { console.error('wave9 failed:', e); process.exit(1); });
