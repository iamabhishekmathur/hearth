/**
 * WAVE 11 — Admin & platform surface: audit logs, analytics, users/teams admin,
 * SSO, cognitive, notifications. Includes the audit's cross-org teamId-move
 * tenancy defect (tested on a throwaway IC user, then restored).
 */
import { loginAs, prisma, short, Recorder } from './core.js';

const F = 'Admin & Platform';

async function main() {
  const rec = new Recorder('wave11-admin-platform');
  const admin = await loginAs('it-admin@hearth.local');
  const member = await loginAs('dev1@hearth.local');

  // ── Read-only admin surfaces + RBAC ───────────────────────────────────────
  console.log('\n══ Admin read surfaces ══');
  for (const path of ['/admin/audit-logs', '/admin/analytics', '/admin/users', '/admin/teams', '/admin/sso']) {
    const ok = await admin.req('GET', path);
    rec.record({ feature: F, subFeature: 'admin read', type: 'happy', name: `Admin GET ${path}`,
      expected: '200', observed: `status ${ok.status}`, status: ok.status === 200 ? 'pass' : 'partial' });
    const denied = await member.req('GET', path);
    rec.record({ feature: F, subFeature: 'admin RBAC', type: 'permission', name: `Member GET ${path}`,
      expected: '403', observed: `status ${denied.status}`, status: denied.status === 403 ? 'pass' : 'fail',
      defects: denied.status === 200 ? [`Non-admin can read ${path}`] : undefined });
  }

  // ── Teams admin: create ───────────────────────────────────────────────────
  console.log('\n══ Teams admin ══');
  const team = await admin.req('POST', '/admin/teams', { name: `Tiger Team ${Date.now() % 10000}` });
  rec.record({ feature: F, subFeature: 'teams', type: 'happy', name: 'Admin creates a team',
    expected: '201', observed: `status ${team.status}`, status: team.status === 201 ? 'pass' : 'partial' });

  // ── DEFECT: cross-org teamId move (tenancy) — non-destructive + restore ───
  console.log('\n══ Tenancy: cross-org user move ══');
  {
    const victim = await prisma.user.findFirst({ where: { email: { startsWith: 'ic_engineering_' } }, select: { id: true, teamId: true } });
    const rivalTeam = await prisma.team.findFirst({ where: { org: { slug: 'rival-corp' } }, select: { id: true } });
    if (victim && rivalTeam) {
      const move = await admin.req('PATCH', `/admin/users/${victim.id}`, { teamId: rivalTeam.id });
      // verify + restore
      const after = await prisma.user.findUnique({ where: { id: victim.id }, select: { teamId: true } });
      const moved = after?.teamId === rivalTeam.id;
      if (moved) await prisma.user.update({ where: { id: victim.id }, data: { teamId: victim.teamId } }); // restore
      rec.record({ feature: F, subFeature: 'tenancy', type: 'permission', name: 'Admin moves a user into ANOTHER org\'s team',
        expected: 'rejected — cross-tenant move', observed: `status ${move.status}; moved=${moved} (restored)`,
        status: !moved && move.status >= 400 ? 'pass' : 'fail',
        defects: moved ? ['Admin can move a user into a DIFFERENT org\'s team — updateUserTeam connects a team by id with no org check (cross-tenant user exfiltration)'] : undefined });
    } else {
      rec.record({ feature: F, subFeature: 'tenancy', type: 'permission', name: 'Admin moves a user into another org\'s team',
        expected: 'rejected', observed: 'no rival team / IC user found to probe', status: 'blocked' });
    }
  }

  // ── Notifications spine ───────────────────────────────────────────────────
  console.log('\n══ Notifications ══');
  const notifs = await member.req('GET', '/notifications');
  rec.record({ feature: F, subFeature: 'notifications', type: 'happy', name: 'List notifications',
    expected: '200', observed: `status ${notifs.status} ${short(notifs.body, 60)}`, status: notifs.status === 200 ? 'pass' : 'fail' });
  const readAll = await member.req('POST', '/notifications/read-all', {});
  rec.record({ feature: F, subFeature: 'notifications', type: 'happy', name: 'Mark all notifications read',
    expected: '200', observed: `status ${readAll.status}`, status: readAll.status === 200 ? 'pass' : 'partial' });

  // ── Setup endpoints unauthenticated (audit) ───────────────────────────────
  console.log('\n══ Setup auth ══');
  {
    const status = await fetch(`${process.env.API_URL ?? 'http://localhost:8000/api/v1'}/admin/setup/status`);
    rec.record({ feature: F, subFeature: 'setup', type: 'happy', name: 'Public setup/status reachable',
      expected: '200 (intentionally public pre-setup)', observed: `status ${status.status}`, status: status.status === 200 ? 'pass' : 'partial' });
    const init = await fetch(`${process.env.API_URL ?? 'http://localhost:8000/api/v1'}/admin/setup/init`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'attacker@evil.com', password: 'x', name: 'x' }) });
    rec.record({ feature: F, subFeature: 'setup', type: 'violation', name: 'Replay setup/init after org exists (admin seizure)',
      expected: '400 — already set up', observed: `status ${init.status}`, status: init.status === 400 ? 'pass' : 'fail',
      defects: init.status < 300 ? ['setup/init succeeded after setup — an unauthenticated caller seized an admin account'] : undefined });
  }

  rec.save();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error('wave11 failed:', e); await prisma.$disconnect(); process.exit(1); });
