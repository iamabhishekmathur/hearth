/**
 * WAVE 5 — Routines (scheduled cloud agents), end to end.
 *
 * Happy: create → run-now → run executes and produces output. Validation:
 * invalid cron → 400; impossible-but-valid-shape cron → created but never
 * scheduled. Defects from the audit: member creates org-scoped routine
 * (no role check); listRuns has no permission check (cross-user run-history
 * leak); run-now on a disabled routine silently no-ops; approval checkpoints
 * never pause a run.
 */
import { loginAs, prisma, sleep, Recorder, type HearthClient } from './core.js';

const F = 'Routines';

async function pollRuns(c: HearthClient, routineId: string, timeoutMs = 90_000): Promise<any[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await c.req<{ data?: any[] }>('GET', `/routines/${routineId}/runs`);
    const runs = r.body.data ?? [];
    if (runs.some((x) => x.status === 'success' || x.status === 'failed' || x.status === 'awaiting_approval')) return runs;
    await sleep(3000);
  }
  return (await c.req<{ data?: any[] }>('GET', `/routines/${routineId}/runs`)).body.data ?? [];
}

async function main() {
  const rec = new Recorder('wave5-routines');

  // ── Happy: create + run-now → executes ────────────────────────────────────
  console.log('\n══ Create + run-now ══');
  const lead = await loginAs('eng-lead@hearth.local'); // Devin Rao, team_lead
  const create = await lead.req<{ data?: { id: string } }>('POST', '/routines', {
    name: 'Stale PR sweep', prompt: 'List open pull requests that look stale and summarize what is blocking each.',
    schedule: '0 9 * * 1-5', scope: 'personal', delivery: { channels: ['in_app'] },
  });
  const rid = create.body.data?.id!;
  rec.record({ feature: F, subFeature: 'create', type: 'happy', name: 'Create a scheduled routine (valid cron)',
    expected: '201', observed: `status ${create.status}`, status: create.status === 201 ? 'pass' : 'fail' });

  const runNow = await lead.req('POST', `/routines/${rid}/run-now`, {});
  const runs = await pollRuns(lead, rid);
  const terminal = runs.find((x) => x.status === 'success' || x.status === 'failed');
  rec.record({ feature: F, subFeature: 'run-now', type: 'happy', name: 'Run-now executes the routine',
    expected: 'a run is created and completes (success/failed)', observed: `run-now ${runNow.status}; run status=${terminal?.status ?? 'none'}`,
    status: terminal?.status === 'success' ? 'pass' : terminal ? 'partial' : 'fail',
    defects: !terminal ? ['run-now produced no run within timeout'] : undefined });

  // ── Validation: cron ──────────────────────────────────────────────────────
  console.log('\n══ Cron validation ══');
  {
    const bad = await lead.req('POST', '/routines', { name: 'Bad cron', prompt: 'x', schedule: 'not a cron', scope: 'personal' });
    rec.record({ feature: F, subFeature: 'cron validation', type: 'user_error', name: 'Invalid cron string',
      expected: '400', observed: `status ${bad.status}`, status: bad.status === 400 ? 'pass' : 'fail' });
    const impossible = await lead.req<{ data?: { id: string } }>('POST', '/routines', { name: 'Feb 31', prompt: 'x', schedule: '0 0 31 2 *', scope: 'personal' });
    rec.record({ feature: F, subFeature: 'cron validation', type: 'pressure', name: 'Impossible-but-valid-shape cron (Feb 31)',
      expected: 'created (201) but worker skips scheduling without crashing', observed: `status ${impossible.status}`,
      status: impossible.status === 201 ? 'pass' : 'partial' });
  }

  // ── Defect: member creates an org-scoped routine ──────────────────────────
  console.log('\n══ Scope / RBAC ══');
  {
    const member = await loginAs('dev1@hearth.local'); // member
    const r = await member.req<{ data?: { id: string; scope?: string } }>('POST', '/routines', { name: 'Org routine by member', prompt: 'x', scope: 'org' });
    rec.record({ feature: F, subFeature: 'scope RBAC', type: 'permission', name: 'Member creates an org-scoped routine',
      expected: 'rejected — only admin/lead should create org-scope', observed: `status ${r.status}, scope=${r.body.data?.scope}`,
      status: r.status >= 400 ? 'pass' : 'fail',
      defects: r.status === 201 ? ['A member can create an ORG-scoped routine — no role check on scope'] : undefined });
  }

  // ── Defect: listRuns has no permission check (cross-user leak) ─────────────
  {
    const stranger = await loginAs('sales-rep@hearth.local'); // unrelated member, not the routine owner
    const leak = await stranger.req<{ data?: any[] }>('GET', `/routines/${rid}/runs`);
    const got = leak.body.data?.length ?? 0;
    rec.record({ feature: F, subFeature: 'run-history leak', type: 'permission', name: "Unrelated user reads another user's routine run history",
      expected: '403/404 — not the owner', observed: `status ${leak.status}, ${got} runs returned`,
      status: leak.status >= 400 ? 'pass' : 'fail',
      defects: leak.status === 200 && got > 0 ? ["listRuns has no permission check — any user can read another routine's run history/outputs by id"] : undefined });
  }

  // ── Defect: run-now on a disabled routine silently no-ops ─────────────────
  {
    const dis = await lead.req<{ data?: { id: string } }>('POST', '/routines', { name: 'Disabled routine', prompt: 'x', scope: 'personal', enabled: false });
    const did = dis.body.data?.id!;
    const rn = await lead.req('POST', `/routines/${did}/run-now`, {});
    await sleep(8000);
    const runs2 = (await lead.req<{ data?: any[] }>('GET', `/routines/${did}/runs`)).body.data ?? [];
    rec.record({ feature: F, subFeature: 'disabled run-now', type: 'pressure', name: 'Run-now on a disabled routine',
      expected: 'rejected, or clearly no-op (not a silent enqueue)', observed: `run-now ${rn.status}; runs=${runs2.length}`,
      status: rn.status >= 400 ? 'pass' : 'partial',
      defects: rn.status === 200 && runs2.length === 0 ? ['run-now on a DISABLED routine returns 200 then silently no-ops (worker bails) — no feedback to the user'] : undefined });
  }

  // ── Defect: approval checkpoint never pauses a run ────────────────────────
  {
    const cp = await lead.req<{ data?: { id: string } }>('POST', '/routines', {
      name: 'Routine with approval gate', prompt: 'Draft an external customer email and send it.', scope: 'personal',
      checkpoints: [{ name: 'Before send', condition: 'always' }],
    });
    const cid = cp.body.data?.id;
    if (cid) {
      await lead.req('POST', `/routines/${cid}/run-now`, {});
      const runs3 = await pollRuns(lead, cid, 60_000);
      const paused = runs3.some((x) => x.status === 'awaiting_approval');
      rec.record({ feature: F, subFeature: 'approval gate', type: 'pressure', name: 'Routine with an approval checkpoint',
        expected: 'run pauses at awaiting_approval until resolved', observed: `run statuses=${runs3.map((x) => x.status).join(',') || 'none'}`,
        status: paused ? 'pass' : 'fail',
        defects: !paused ? ['Approval checkpoint never pauses the run (awaiting_approval never set) — checkpoint gating is dead code'] : undefined });
    }
  }

  rec.save();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error('wave5 failed:', e); await prisma.$disconnect(); process.exit(1); });
