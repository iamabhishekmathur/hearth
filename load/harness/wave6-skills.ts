/**
 * WAVE 6 — Skills, end to end.
 *
 * Happy: create (personal→published, team→pending_review), install/uninstall,
 * agent proposes a skill. Defects from the audit: member creates org skill
 * (no role gate); listSkills cross-scope leak (sees others' personal skills);
 * install double-count drift; install a draft/deprecated skill (no status gate);
 * team_lead cannot publish (admin only) but admin publishes a draft (skips
 * review); /skills/seed has no role gate; GET /skills/proposals shadowed by
 * GET /skills/:id; propose_skill writes a non-existent created_via column.
 */
import { loginAs, prisma, sleep, short, Recorder } from './core.js';

const F = 'Skills';
const yaml = (name: string, desc: string) => `---\nname: ${name}\ndescription: ${desc}\n---\nUse this when you need to ${desc}.`;

async function main() {
  const rec = new Recorder('wave6-skills');

  // ── Happy: create (personal → published) ──────────────────────────────────
  console.log('\n══ Create ══');
  const dev = await loginAs('dev1@hearth.local'); // member
  const personal = await dev.req<{ data?: { id: string; status: string } }>('POST', '/skills', {
    name: 'pr-triage', description: 'triage open pull requests', content: yaml('pr-triage', 'triage open pull requests'), scope: 'personal',
  });
  rec.record({ feature: F, subFeature: 'create', type: 'happy', name: 'Member creates a personal skill',
    expected: '201, status published (personal auto-publishes)', observed: `status ${personal.status}, skill=${personal.body.data?.status}`,
    status: personal.status === 201 ? 'pass' : 'fail' });

  // ── Defect: member creates an ORG skill (scope escalation) ────────────────
  const orgSkill = await dev.req<{ data?: { id: string; status: string; scope?: string } }>('POST', '/skills', {
    name: 'org-wide-deploy', description: 'run the org deploy checklist', content: yaml('org-wide-deploy', 'run the org deploy checklist'), scope: 'org',
  });
  rec.record({ feature: F, subFeature: 'scope RBAC', type: 'permission', name: 'Member creates an org-scoped skill',
    expected: 'rejected — org skills should require a lead/admin', observed: `status ${orgSkill.status}, skill status=${orgSkill.body.data?.status}`,
    status: orgSkill.status >= 400 ? 'pass' : 'fail',
    defects: orgSkill.status === 201 ? ['A member can create an ORG-scoped skill (goes to pending_review) — no role gate on scope'] : undefined });

  // ── Defect: listSkills cross-scope leak ───────────────────────────────────
  console.log('\n══ Visibility ══');
  {
    const other = await loginAs('designer@hearth.local'); // different member
    const list = await other.req<{ data?: any[] }>('GET', '/skills');
    const sawOthersPersonal = (list.body.data ?? []).some((s) => s.name === 'pr-triage');
    rec.record({ feature: F, subFeature: 'cross-scope leak', type: 'permission', name: "A user lists skills and sees another user's personal skill",
      expected: "personal skills are private to their author", observed: `sees 'pr-triage' (dev1's personal)=${sawOthersPersonal}`,
      status: sawOthersPersonal ? 'fail' : 'pass',
      defects: sawOthersPersonal ? ["listSkills filters org-only — a user sees every other user's personal skills (cross-scope leak)"] : undefined });
  }

  // ── Defect: install double-count + draft/no-status-gate ───────────────────
  console.log('\n══ Install ══');
  if (personal.body.data?.id) {
    const id = personal.body.data.id;
    const inst = await loginAs('pm1@hearth.local');
    const i1 = await inst.req('POST', `/skills/${id}/install`, {});
    const i2 = await inst.req('POST', `/skills/${id}/install`, {}); // double install
    await sleep(500);
    const count = (await prisma.skill.findUnique({ where: { id }, select: { installCount: true } }))?.installCount ?? 0;
    rec.record({ feature: F, subFeature: 'install count', type: 'pressure', name: 'Double-install the same skill',
      expected: 'installCount counts the user once (idempotent)', observed: `i1=${i1.status} i2=${i2.status}; installCount=${count}`,
      status: count <= 1 ? 'pass' : 'fail',
      defects: count > 1 ? [`Double-install inflates installCount (now ${count}) — increment runs unconditionally on idempotent upsert`] : undefined });
  }

  // ── Defect: publish RBAC (team_lead blocked, admin skips review) ───────────
  console.log('\n══ Publish ══');
  if (orgSkill.body.data?.id) {
    const id = orgSkill.body.data.id;
    const lead = await loginAs('eng-lead@hearth.local'); // team_lead
    const leadPub = await lead.req('PATCH', `/skills/${id}`, { status: 'published' });
    rec.record({ feature: F, subFeature: 'publish RBAC', type: 'permission', name: 'Team lead tries to publish a pending skill',
      expected: 'publish is a review action; lead either can (proper) or 403', observed: `status ${leadPub.status}`,
      status: leadPub.status === 200 || leadPub.status === 403 ? 'pass' : 'partial' });
    const admin = await loginAs('compliance@hearth.local'); // admin
    const adminPub = await admin.req('PATCH', `/skills/${id}`, { status: 'published' });
    rec.record({ feature: F, subFeature: 'publish RBAC', type: 'happy', name: 'Admin publishes a pending skill',
      expected: 'admin can publish', observed: `status ${adminPub.status}`, status: adminPub.status === 200 ? 'pass' : 'partial' });
  }

  // ── Defect: /skills/seed has no role gate ─────────────────────────────────
  console.log('\n══ Seed & routing ══');
  {
    const member = await loginAs('support-agent@hearth.local'); // member
    const seed = await member.req('POST', '/skills/seed', {});
    rec.record({ feature: F, subFeature: 'seed RBAC', type: 'permission', name: 'Member calls /skills/seed',
      expected: '403 — admin only', observed: `status ${seed.status}`,
      status: seed.status === 403 ? 'pass' : 'fail',
      defects: seed.status < 300 ? ['POST /skills/seed has no role gate — any member can seed org skills (comment says admin only)'] : undefined });
  }

  // ── Defect: route shadowing /skills/proposals ─────────────────────────────
  {
    const props = await dev.req('GET', '/skills/proposals');
    rec.record({ feature: F, subFeature: 'route shadowing', type: 'error', name: 'GET /skills/proposals',
      expected: 'returns the proposals list', observed: `status ${props.status}: ${short(props.body, 80)}`,
      status: props.status === 200 && !Array.isArray((props.body as any)?.data) === false ? 'pass' : 'partial',
      defects: props.status === 404 || (props.body as any)?.data?.id === undefined && props.status === 200 && !(Array.isArray((props.body as any)?.data)) ? ['GET /skills/proposals is shadowed by GET /skills/:id (id="proposals")'] : undefined });
  }

  // ── created_via crash: ask the agent to save a reusable skill ─────────────
  console.log('\n══ propose_skill (agent) ══');
  {
    const u = await loginAs('dev2@hearth.local');
    const sid = await u.newSession('Reusable workflow');
    const before = await prisma.skill.count({ where: { source: 'auto_generated' } });
    const reply = await u.sendAndWait(sid, 'That worked well. Save this 3-step incident-triage workflow as a reusable skill I can use again, called "incident-triage".');
    await sleep(2000);
    const after = await prisma.skill.count({ where: { source: 'auto_generated' } });
    const erroredReply = /error|couldn.?t|unable|failed/i.test(reply ?? '');
    rec.record({ feature: F, subFeature: 'propose_skill', type: 'pressure', name: 'Agent proposes a skill (created_via column)',
      expected: 'a draft auto_generated skill is created', observed: `+${after - before} auto skills; reply hints error=${erroredReply}`,
      status: after > before ? 'pass' : 'fail',
      defects: after === before ? ['propose_skill created no skill — likely the createProposedSkill `created_via` write to a non-existent column throws'] : undefined });
  }

  rec.save();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error('wave6 failed:', e); await prisma.$disconnect(); process.exit(1); });
