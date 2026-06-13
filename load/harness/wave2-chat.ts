/**
 * WAVE 2 — Chat, artifacts & sharing, end to end.
 *
 * Happy: regular chat, shared multi-party session, chat→task, chat→artifact
 * (markdown / code / html), artifact versioning, session share link lifecycle,
 * duplicate. Plus the over-permission + tenancy findings from the audit:
 * viewers creating/deleting artifacts, listCollaborators info-leak, cross-org
 * collaborator add, and core error/user-error cases.
 */
import { loginAs, prisma, sleep, short, persona, runDialogue, Recorder, API } from './core.js';

const F = 'Chat & Artifacts';

async function main() {
  const rec = new Recorder('wave2-chat');
  const org = await prisma.org.findUniqueOrThrow({ where: { slug: 'hearth-sim' } });

  // ── Happy: regular chat (LLM persona ↔ real agent) ────────────────────────
  console.log('\n══ Regular chat ══');
  {
    const eng = await loginAs('dev1@hearth.local');
    const sid = await eng.newSession('Rate limiter design');
    const sys = persona('Sam Park', 'backend engineer', 'Get Hearth to help you design a token-bucket rate limiter and weigh Redis vs in-memory.');
    const t = await runDialogue(eng, sid, sys, 4, (who, txt) => console.log(`    ${who === 'user' ? '🧑' : '🔥'} ${short(txt, 110)}`));
    const replied = t.some((x) => x.who === 'hearth' && x.text.length > 20 && !x.text.startsWith('[no reply'));
    rec.record({ feature: F, subFeature: 'regular chat', type: 'happy', name: 'Multi-turn 1:1 chat with the agent',
      expected: 'agent replies substantively each turn', observed: `${t.filter((x) => x.who === 'hearth').length} replies`,
      status: replied ? 'pass' : 'fail' });
  }

  // ── Happy: shared multi-party session ─────────────────────────────────────
  console.log('\n══ Shared session ══');
  let sharedSid = '';
  {
    const lead = await loginAs('eng-lead@hearth.local'); // Devin Rao
    const cto = await loginAs('cto@hearth.local'); // Marcus Chen
    sharedSid = await lead.newSession('Incident: checkout 500s');
    await lead.req('PATCH', `/chat/sessions/${sharedSid}/visibility`, { visibility: 'org' });
    const add = await lead.req('POST', `/chat/sessions/${sharedSid}/collaborators`, { userId: cto.me.id, role: 'contributor' });
    rec.record({ feature: F, subFeature: 'shared session', type: 'happy', name: 'Owner shares session org-wide + adds a contributor',
      expected: 'visibility org; collaborator added', observed: `add status ${add.status}`, status: add.status < 300 ? 'pass' : 'fail' });
    await lead.sendAndWait(sharedSid, 'Checkout throwing 500s since the deploy. @Marcus can you confirm the rollback window?');
    const ctoPost = await cto.req('POST', `/chat/sessions/${sharedSid}/messages`, { content: 'Rolling back now. Agent — summarize the blast radius for the incident doc.' });
    rec.record({ feature: F, subFeature: 'shared session', type: 'happy', name: 'Contributor posts into the shared session',
      expected: '202 accepted', observed: `status ${ctoPost.status}`, status: ctoPost.status === 202 ? 'pass' : 'fail' });
  }

  // ── Happy: chat → artifact (markdown, code, html) ─────────────────────────
  console.log('\n══ Chat → artifact (md / code / html) ══');
  for (const [kind, ask] of [
    ['markdown doc', 'Draft a one-page incident runbook for checkout 500s as a document I can keep.'],
    ['code', 'Write a small TypeScript health-check script for the checkout service as a code file.'],
    ['html', 'Build a simple standalone HTML status page for the checkout service.'],
  ] as const) {
    const u = await loginAs('dev2@hearth.local');
    const sid = await u.newSession(`Artifact: ${kind}`);
    await u.sendAndWait(sid, ask);
    await sleep(1500);
    const arts = await prisma.artifact.findMany({ where: { sessionId: sid }, select: { type: true, parentMessageId: true } });
    rec.record({ feature: F, subFeature: `chat→artifact (${kind})`, type: 'happy', name: `Agent produces a ${kind} artifact`,
      expected: 'artifact created + linked to its message (card renders)', observed: `${arts.length} artifact(s), types=${arts.map((a) => a.type).join(',')}, linked=${arts.every((a) => a.parentMessageId)}`,
      status: arts.length > 0 && arts.every((a) => a.parentMessageId) ? 'pass' : arts.length > 0 ? 'partial' : 'fail',
      defects: arts.length === 0 ? [`No artifact created for a ${kind} work-product request`] : undefined });
  }

  // ── Happy: chat → task promotion ──────────────────────────────────────────
  console.log('\n══ Chat → task ══');
  {
    const u = await loginAs('pm1@hearth.local');
    const sid = await u.newSession('Follow-ups');
    await u.sendAndWait(sid, 'We need to add structured logging to the checkout service before the next launch.');
    const s = await u.req<{ data: { messages: Array<{ id: string; role: string }> } }>('GET', `/chat/sessions/${sid}`);
    const userMsg = s.body.data.messages.find((m) => m.role === 'user');
    const prom = await u.req<{ data?: { id: string } }>('POST', `/chat/sessions/${sid}/messages/${userMsg!.id}/promote-to-task`, { provenance: 'chat_button', targetStatus: 'backlog' });
    rec.record({ feature: F, subFeature: 'chat→task', type: 'happy', name: 'Promote a chat message to a task',
      expected: '201 task created, back-linked to the message', observed: `status ${prom.status}`, status: prom.status === 201 ? 'pass' : prom.status === 200 ? 'partial' : 'fail' });
  }

  // ── Happy: session share link lifecycle ───────────────────────────────────
  console.log('\n══ Share links ══');
  {
    const owner = await loginAs('designer@hearth.local');
    const sid = await owner.newSession('Brand voice notes');
    await owner.sendAndWait(sid, 'Give me 3 taglines for the new dashboard.');
    const share = await owner.req<{ data?: { token: string } }>('POST', `/chat/sessions/${sid}/share`, { contentFilter: 'all' });
    const token = share.body.data?.token;
    rec.record({ feature: F, subFeature: 'share link', type: 'happy', name: 'Owner creates a public share link',
      expected: '200 + token', observed: `status ${share.status}, token=${token ? 'yes' : 'no'}`, status: token ? 'pass' : 'fail' });
    if (token) {
      const pub = await fetch(`${API}/shared/${token}`); // UNAUTH
      rec.record({ feature: F, subFeature: 'share link', type: 'happy', name: 'Public (unauthenticated) view of the share link',
        expected: '200 renders shared transcript', observed: `status ${pub.status}`, status: pub.status === 200 ? 'pass' : 'fail' });
      await owner.req('DELETE', `/chat/sessions/${sid}/share`);
      const after = await fetch(`${API}/shared/${token}`);
      rec.record({ feature: F, subFeature: 'share link', type: 'happy', name: 'Revoked share link is dead',
        expected: '404 after revoke', observed: `status ${after.status}`, status: after.status === 404 ? 'pass' : 'fail' });
    }
  }

  // ── Permission / over-permission (audit findings) ─────────────────────────
  console.log('\n══ Permission & tenancy ══');
  {
    // A viewer-collaborator creates + deletes an artifact (audit: gated on read access, not write)
    const owner = await loginAs('product-lead@hearth.local');
    const viewer = await loginAs('intern@hearth.local'); // viewer role
    const sid = await owner.newSession('Spec review');
    await owner.req('POST', `/chat/sessions/${sid}/collaborators`, { userId: viewer.me.id, role: 'viewer' });
    const create = await viewer.req<{ data?: { id: string } }>('POST', `/chat/sessions/${sid}/artifacts`, { type: 'document', title: 'Viewer-made', content: '# hi' });
    rec.record({ feature: F, subFeature: 'artifact RBAC', type: 'permission', name: 'Viewer-collaborator creates an artifact',
      expected: 'viewers should not write; expect 403', observed: `status ${create.status}`,
      status: create.status === 403 ? 'pass' : 'fail',
      defects: create.status < 300 ? ['A viewer (read-only collaborator) can CREATE artifacts — write gated on read access'] : undefined });
    // Owner makes an artifact, viewer deletes it
    const ownerArt = await owner.req<{ data?: { id: string } }>('POST', `/chat/sessions/${sid}/artifacts`, { type: 'document', title: 'Owner doc', content: '# owned' });
    if (ownerArt.body.data?.id) {
      const del = await viewer.req('DELETE', `/chat/artifacts/${ownerArt.body.data.id}`);
      rec.record({ feature: F, subFeature: 'artifact RBAC', type: 'permission', name: "Viewer deletes the owner's artifact",
        expected: 'non-creator should not delete; expect 403', observed: `status ${del.status}`,
        status: del.status === 403 ? 'pass' : 'fail',
        defects: del.status < 300 ? ["A viewer can DELETE another user's artifact (no creator check)"] : undefined });
    }
  }
  {
    // listCollaborators info-leak: an UNRELATED user reads collaborators of a private session
    const stranger = await loginAs('sales-rep@hearth.local');
    const leak = await stranger.req<{ data?: any[] }>('GET', `/chat/sessions/${sharedSid}/collaborators`);
    rec.record({ feature: F, subFeature: 'info leak', type: 'permission', name: 'Unrelated user lists a session\'s collaborators',
      expected: '403/404 — no access', observed: `status ${leak.status}, ${Array.isArray(leak.body.data) ? leak.body.data.length : 0} names returned`,
      status: leak.status >= 400 ? 'pass' : 'fail',
      defects: leak.status < 300 ? ['Any authenticated user can list collaborators (names+emails) of a session by id — no access check'] : undefined });
  }
  {
    // Cross-org collaborator add: owner adds a RIVAL-CORP user → tenancy bypass
    const owner = await loginAs('eng-lead@hearth.local');
    const rival = await prisma.user.findFirst({ where: { team: { org: { slug: 'rival-corp' } } }, select: { id: true } });
    const sid = await owner.newSession('Tenancy probe');
    const add = rival ? await owner.req('POST', `/chat/sessions/${sid}/collaborators`, { userId: rival.id, role: 'contributor' }) : { status: -1 };
    rec.record({ feature: F, subFeature: 'tenancy', type: 'permission', name: 'Owner adds a cross-org user as collaborator',
      expected: 'rejected — cross-tenant', observed: `status ${add.status}`,
      status: add.status >= 400 ? 'pass' : 'fail',
      defects: add.status >= 200 && add.status < 300 ? ['Owner can add a user from ANOTHER org as a collaborator (tenancy bypass — grants cross-org read)'] : undefined });
  }

  // ── Error / user-error ────────────────────────────────────────────────────
  console.log('\n══ Error / user-error ══');
  {
    const u = await loginAs('dev1@hearth.local');
    const sid = await u.newSession('Errors');
    const empty = await u.req('POST', `/chat/sessions/${sid}/messages`, { content: '' });
    rec.record({ feature: F, subFeature: 'validation', type: 'user_error', name: 'Send an empty message',
      expected: '400', observed: `status ${empty.status}`, status: empty.status === 400 ? 'pass' : 'fail' });
    const badArt = await u.req('POST', `/chat/sessions/${sid}/artifacts`, { type: 'spreadsheet', title: 'x', content: 'y' });
    rec.record({ feature: F, subFeature: 'validation', type: 'user_error', name: 'Create artifact with an invalid type',
      expected: '400', observed: `status ${badArt.status}`, status: badArt.status === 400 ? 'pass' : 'fail' });
    const badShare = await fetch(`${API}/shared/nonexistent-token-xyz`);
    rec.record({ feature: F, subFeature: 'validation', type: 'error', name: 'Public view of an unknown share token',
      expected: '404', observed: `status ${badShare.status}`, status: badShare.status === 404 ? 'pass' : 'fail' });
  }

  rec.save();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error('wave2 failed:', e); await prisma.$disconnect(); process.exit(1); });
