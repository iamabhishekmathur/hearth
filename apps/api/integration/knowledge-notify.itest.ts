/**
 * Knowledge loop, Phase 3 — quiet notifications (test plan area E), plus the
 * notification preferences API, role checks, flag-off and tenant isolation.
 *
 * Real Express app + Postgres. The digest runs through the exported
 * `runDailyDigest` with an injected clock (never waiting for cron), an
 * injected activity summary (no LLM), and a mocked email service.
 */
import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';

const mail = vi.hoisted(() => ({
  configured: true,
  sendEmail: vi.fn(async (_p: { to: string; subject: string; text: string; html: string }) => {}),
}));
vi.mock('../src/services/email-service.js', () => ({
  isEmailConfigured: () => mail.configured,
  sendEmail: mail.sendEmail,
}));

import {
  prisma,
  seedAuthFixture,
  loginAgent,
  anonAgent,
  truncateAll,
  disconnect,
  type AuthFixture,
} from './setup.js';
import { runDailyDigest, type ActivityDigestFn } from '../src/services/daily-digest.js';
import { buildSystemPrompt, markRecentlyUpdatedSources } from '../src/agent/system-prompt.js';
import type { CitationSource } from '../src/agent/system-prompt.js';

let fx: AuthFixture;

const DAY = 86_400_000;
// 2026-12-07 is a Monday; 2026-12-08 a Tuesday.
const TUE_9_UTC = new Date('2026-12-08T09:00:00Z');
const MON_9_UTC = new Date('2026-12-07T09:00:00Z');
const TUE_9_TORONTO = new Date('2026-12-08T14:00:00Z'); // EST = UTC-5

const quiet: ActivityDigestFn = async () => ({ summary: '', eventCount: 0 });
const busy: ActivityDigestFn = async () => ({ summary: 'Three tasks shipped.', eventCount: 3 });

beforeEach(async () => {
  await truncateAll();
  fx = await seedAuthFixture();
  mail.configured = true;
  mail.sendEmail.mockReset();
  mail.sendEmail.mockImplementation(async () => {});
  await setFlag(fx.primary.orgId, true);
});

afterAll(async () => {
  await disconnect();
});

// ── Fixtures ──────────────────────────────────────────────────────────────

async function setFlag(orgId: string, on: boolean) {
  await prisma.org.update({
    where: { id: orgId },
    data: { settings: { features: { knowledgeLoop: on } } },
  });
}

async function setTz(userId: string, timezone: string | null) {
  await prisma.user.update({
    where: { id: userId },
    data: { preferences: timezone ? { timezone } : {} },
  });
}

async function setPrefs(userId: string, prefs: Record<string, boolean>) {
  await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, prefs },
    update: { prefs },
  });
}

let seq = 0;
async function memory(
  over: {
    layer?: 'org' | 'team' | 'user';
    orgId?: string;
    teamId?: string | null;
    userId?: string | null;
    ownerId?: string | null;
    content?: string;
    version?: number;
  } = {},
) {
  const layer = over.layer ?? 'team';
  seq += 1;
  return prisma.memoryEntry.create({
    data: {
      orgId: over.orgId ?? fx.primary.orgId,
      layer,
      content: over.content ?? `Customer update steps ${seq}`,
      teamId: layer === 'team' ? (over.teamId ?? fx.primary.teamId) : null,
      userId: layer === 'user' ? (over.userId ?? fx.users.member.id) : null,
      ownerId: over.ownerId ?? null,
      version: over.version ?? 1,
    },
  });
}

async function proposal(
  entry: { id: string; orgId: string; layer: string; teamId: string | null; content: string },
  over: Record<string, unknown> = {},
) {
  return prisma.knowledgeProposal.create({
    data: {
      orgId: entry.orgId,
      targetType: 'memory',
      targetId: entry.id,
      targetScope: entry.layer,
      targetTeamId: entry.teamId,
      targetName: `Team memory: ${entry.content}`,
      targetVersion: 1,
      before: entry.content,
      after: `${entry.content} (fixed)`,
      reason: 'A step changed.',
      availableAt: new Date(TUE_9_UTC.getTime() - DAY),
      ...over,
    } as never,
  });
}

async function signalFor(proposalId: string, userId: string, orgId = fx.primary.orgId) {
  return prisma.knowledgeSignal.create({
    data: { orgId, kind: 'correction', source: 'chat', userId, text: 'No, it is X.', proposalId },
  });
}

const notes = (userId: string) =>
  prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

// ── E1–E3, E6–E9: the owner's daily item ──────────────────────────────────

describe('owner daily summary', () => {
  it('E1: 3 proposals waiting at 9am in the owner’s timezone → exactly ONE digest item', async () => {
    await setTz(fx.users.lead.id, 'America/Toronto');
    for (let i = 0; i < 3; i++) await proposal(await memory());

    const res = await runDailyDigest({ now: TUE_9_TORONTO, activityDigest: quiet });

    const lead = await notes(fx.users.lead.id);
    expect(lead).toHaveLength(1);
    expect(lead[0]).toMatchObject({
      type: 'digest',
      title: '3 proposals wait in Review',
      entityType: 'review',
    });
    // Everyone else is at 14:00 UTC — not their 9am.
    expect(await prisma.notification.count()).toBe(1);
    expect(res.find((r) => r.orgId === fx.primary.orgId)).toMatchObject({
      delivered: 1,
      knowledgeItems: 1,
    });
  });

  it('E1: one target → the line names it', async () => {
    const m = await memory({ content: 'Customer update steps' });
    await proposal(m);
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    const [n] = await notes(fx.users.lead.id);
    expect(n.title).toBe('1 proposal for Team memory: Customer update steps');
  });

  it('E1: a second run in the same hour (a retry) sends nothing more', async () => {
    await proposal(await memory());
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    await runDailyDigest({
      now: new Date(TUE_9_UTC.getTime() + 20 * 60_000),
      activityDigest: quiet,
    });
    expect(await notes(fx.users.lead.id)).toHaveLength(1);
  });

  it('E2: nothing waiting → nothing sent', async () => {
    const res = await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(await prisma.notification.count()).toBe(0);
    expect(res.every((r) => r.delivered === 0)).toBe(true);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it('E2: decided cards, cards not yet due, and cards whose target is gone do not count', async () => {
    await proposal(await memory(), { status: 'approved', reviewedAt: TUE_9_UTC });
    await proposal(await memory(), { status: 'rejected', reviewedAt: TUE_9_UTC });
    await proposal(await memory(), { availableAt: new Date(TUE_9_UTC.getTime() + DAY) });
    const gone = await memory();
    await proposal(gone);
    await prisma.memoryEntry.delete({ where: { id: gone.id } });

    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('only owners get the line: a member and a viewer get nothing', async () => {
    await proposal(await memory());
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(await notes(fx.users.member.id)).toHaveLength(0);
    expect(await notes(fx.users.viewer.id)).toHaveLength(0);
    // team memory → admins and the team lead own it.
    expect(await notes(fx.users.lead.id)).toHaveLength(1);
    expect(await notes(fx.users.admin.id)).toHaveLength(1);
  });

  it('an org item reaches admins only, not the team lead', async () => {
    await proposal(await memory({ layer: 'org' }), { targetScope: 'org', targetTeamId: null });
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(await notes(fx.users.admin.id)).toHaveLength(1);
    expect(await notes(fx.users.lead.id)).toHaveLength(0);
  });

  it('E3: the reminder goes out after 7 days, exactly once', async () => {
    const p = await proposal(await memory(), {
      availableAt: new Date(TUE_9_UTC.getTime() - 7 * DAY),
    });

    // Day 6: the count, no reminder.
    await runDailyDigest({ now: new Date(TUE_9_UTC.getTime() - DAY), activityDigest: quiet });
    let lead = await notes(fx.users.lead.id);
    expect(lead).toHaveLength(1);
    expect(lead[0].body ?? '').not.toContain('Waiting a week');
    expect(
      (await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: p.id } })).remindedAt,
    ).toBeNull();

    // Day 7: the reminder.
    const r7 = await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    lead = await notes(fx.users.lead.id);
    expect(lead).toHaveLength(2);
    expect(lead[1].body).toContain('Waiting a week: Team memory:');
    expect(r7.find((r) => r.orgId === fx.primary.orgId)!.reminded).toBe(1);
    const remindedAt = (await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: p.id } }))
      .remindedAt;
    expect(remindedAt?.toISOString()).toBe(TUE_9_UTC.toISOString());

    // Day 8 (the reminder pass runs again): still the daily count, never a second reminder.
    const r8 = await runDailyDigest({
      now: new Date(TUE_9_UTC.getTime() + DAY),
      activityDigest: quiet,
    });
    lead = await notes(fx.users.lead.id);
    expect(lead).toHaveLength(3);
    expect(lead[2].body ?? '').not.toContain('Waiting a week');
    expect(r8.find((r) => r.orgId === fx.primary.orgId)!.reminded).toBe(0);
    expect(
      (
        await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: p.id } })
      ).remindedAt?.toISOString(),
    ).toBe(TUE_9_UTC.toISOString());
  });

  it('E3: the reminder is not used up by an owner who turned the summary off', async () => {
    const p = await proposal(await memory(), {
      availableAt: new Date(TUE_9_UTC.getTime() - 8 * DAY),
    });
    await setPrefs(fx.users.lead.id, { knowledgeSummary: false });
    await setPrefs(fx.users.admin.id, { knowledgeSummary: false });
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(
      (await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: p.id } })).remindedAt,
    ).toBeNull();
  });

  it('E6: email off (the default) → in-app only', async () => {
    await proposal(await memory());
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(await notes(fx.users.lead.id)).toHaveLength(1);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it('E6: email on → the owner also gets an email linking to Review', async () => {
    await proposal(await memory());
    await setPrefs(fx.users.lead.id, { knowledgeEmail: true });
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(await notes(fx.users.lead.id)).toHaveLength(1);
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    const arg = mail.sendEmail.mock.calls[0][0];
    expect(arg.to).toBe('lead@itest.local');
    expect(arg.subject).toMatch(/^1 proposal for /);
    expect(arg.text).toContain('/#/review');
  });

  it('E6: with activity, an owner with email off gets the activity email without the knowledge line', async () => {
    await proposal(await memory({ content: 'Secret steps' }));
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: busy });
    const leadMail = mail.sendEmail.mock.calls
      .map((c) => c[0])
      .find((a) => a.to === 'lead@itest.local');
    expect(leadMail).toBeDefined();
    expect(leadMail!.text).toContain('Three tasks shipped.');
    expect(leadMail!.text).not.toContain('proposal');
    // …while the in-app item has both.
    const [n] = await notes(fx.users.lead.id);
    expect(n.body).toContain('1 proposal for');
  });

  it('E7: an owner with no timezone gets it at 9am UTC (the default), not at another hour', async () => {
    await setTz(fx.users.lead.id, null);
    await proposal(await memory());
    await runDailyDigest({ now: TUE_9_TORONTO, activityDigest: quiet }); // 14:00 UTC
    expect(await notes(fx.users.lead.id)).toHaveLength(0);
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(await notes(fx.users.lead.id)).toHaveLength(1);
  });

  it('E7: an invalid timezone falls back to UTC too', async () => {
    await setTz(fx.users.lead.id, 'Mars/Olympus_Mons');
    await proposal(await memory());
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(await notes(fx.users.lead.id)).toHaveLength(1);
  });

  it('E8: the email service is down → the in-app item is still created', async () => {
    await proposal(await memory());
    await setPrefs(fx.users.lead.id, { knowledgeEmail: true });
    mail.sendEmail.mockRejectedValue(new Error('SMTP down'));
    const res = await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(mail.sendEmail).toHaveBeenCalled();
    expect(await notes(fx.users.lead.id)).toHaveLength(1);
    expect(res.find((r) => r.orgId === fx.primary.orgId)!.emailed).toBe(0);
  });

  it('E8: email not configured at all → in-app only, no attempt', async () => {
    mail.configured = false;
    await proposal(await memory());
    await setPrefs(fx.users.lead.id, { knowledgeEmail: true });
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(mail.sendEmail).not.toHaveBeenCalled();
    expect(await notes(fx.users.lead.id)).toHaveLength(1);
  });

  it('E9: an owner who is also a member gets ONE digest with both parts', async () => {
    await proposal(await memory());
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: busy });
    const lead = await notes(fx.users.lead.id);
    expect(lead).toHaveLength(1);
    expect(lead[0].title).toMatch(/^Daily Activity Digest/);
    expect(lead[0].body).toContain('1 proposal for');
    expect(lead[0].body).toContain('Three tasks shipped.');
    expect(lead[0].entityType).toBe('review');
    // A plain member gets the activity part only.
    const member = await notes(fx.users.member.id);
    expect(member).toHaveLength(1);
    expect(member[0].body).toBe('Three tasks shipped.');
    expect(member[0].entityType).toBe('org');
  });

  it('the knowledgeSummary switch off → no knowledge line (and no item without activity)', async () => {
    await proposal(await memory());
    await setPrefs(fx.users.lead.id, { knowledgeSummary: false });
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(await notes(fx.users.lead.id)).toHaveLength(0);
    expect(await notes(fx.users.admin.id)).toHaveLength(1);
  });

  it('flag off → no knowledge line even with cards waiting; the activity digest is unchanged', async () => {
    await setFlag(fx.primary.orgId, false);
    await proposal(await memory(), { availableAt: new Date(TUE_9_UTC.getTime() - 10 * DAY) });
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.knowledgeProposal.count({ where: { remindedAt: { not: null } } })).toBe(0);

    await runDailyDigest({ now: new Date(TUE_9_UTC.getTime() + DAY), activityDigest: busy });
    const [n] = await notes(fx.users.lead.id);
    expect(n.body).toBe('Three tasks shipped.');
  });

  it('tenant isolation: another org’s cards never appear in a digest', async () => {
    await setFlag(fx.rival.orgId, true);
    const rivalTeam = fx.rival.teamId;
    const rivalMem = await memory({
      orgId: fx.rival.orgId,
      layer: 'org',
      teamId: null,
      content: 'Rival plan',
    });
    await proposal(
      { ...rivalMem, teamId: rivalTeam },
      { targetScope: 'org', targetTeamId: null, targetName: 'Org memory: Rival plan' },
    );
    await proposal(await memory({ layer: 'org', content: 'Ours' }), {
      targetScope: 'org',
      targetTeamId: null,
      targetName: 'Org memory: Ours',
    });

    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    const admin = await notes(fx.users.admin.id);
    expect(admin).toHaveLength(1);
    expect(admin[0].title).toBe('1 proposal for Org memory: Ours');
    const rival = await notes(fx.users.rival.id);
    expect(rival).toHaveLength(1);
    expect(rival[0].title).toBe('1 proposal for Org memory: Rival plan');
    expect(rival[0].orgId).toBe(fx.rival.orgId);
  });

  it('the bell item reaches GET /notifications for the owner', async () => {
    await proposal(await memory());
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    const lead = await loginAgent('lead');
    const res = await lead.get('/api/v1/notifications');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({ type: 'digest', entityType: 'review' });
  });
});

// ── 7: no alert per event ─────────────────────────────────────────────────

describe('no instant alerts', () => {
  it('approving or rejecting pings nobody', async () => {
    const m1 = await memory();
    const p1 = await proposal(m1, { availableAt: new Date(Date.now() - DAY) });
    await signalFor(p1.id, fx.users.member.id);
    const m2 = await memory();
    const p2 = await proposal(m2, { availableAt: new Date(Date.now() - DAY) });
    await signalFor(p2.id, fx.users.member.id);

    const lead = await loginAgent('lead');
    expect((await lead.post(`/api/v1/knowledge/proposals/${p1.id}/approve`, {})).status).toBe(200);
    expect(
      (await lead.post(`/api/v1/knowledge/proposals/${p2.id}/reject`, { reason: 'no' })).status,
    ).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(await prisma.notification.count()).toBe(0);

    // …but the member's weekly line now counts the approved fix.
    const member = await loginAgent('member');
    const res = await member.get('/api/v1/knowledge/my-impact');
    expect(res.body.data.count).toBe(1);
  });
});

// ── E4: member weekly line ────────────────────────────────────────────────

describe('E4: GET /knowledge/my-impact', () => {
  const recently = () => new Date(Date.now() - 2 * DAY);

  it('counts distinct things the member’s signals helped fix this week', async () => {
    const m = await memory();
    const a = await proposal(m, { status: 'approved', reviewedAt: recently() });
    const b = await proposal(m, { status: 'edited', reviewedAt: recently() }); // same target
    const c = await proposal(await memory(), { status: 'edited', reviewedAt: recently() });
    for (const p of [a, b, c]) await signalFor(p.id, fx.users.member.id);

    const member = await loginAgent('member');
    const res = await member.get('/api/v1/knowledge/my-impact?days=7');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ count: 2, days: 7 });
  });

  it('not for others: a person whose signals fed nothing sees 0', async () => {
    const p = await proposal(await memory(), { status: 'approved', reviewedAt: recently() });
    await signalFor(p.id, fx.users.member.id);
    const lead = await loginAgent('lead');
    expect((await lead.get('/api/v1/knowledge/my-impact')).body.data.count).toBe(0);
  });

  it('N = 0 when the fix is older than the week, was rejected, or still waits', async () => {
    const old = await proposal(await memory(), {
      status: 'approved',
      reviewedAt: new Date(Date.now() - 10 * DAY),
    });
    const rej = await proposal(await memory(), { status: 'rejected', reviewedAt: recently() });
    const pend = await proposal(await memory());
    const unlinked = await memory();
    for (const p of [old, rej, pend]) await signalFor(p.id, fx.users.member.id);
    await prisma.knowledgeSignal.create({
      data: {
        orgId: fx.primary.orgId,
        kind: 'correction',
        source: 'chat',
        userId: fx.users.member.id,
      },
    });
    void unlinked;
    const member = await loginAgent('member');
    expect((await member.get('/api/v1/knowledge/my-impact')).body.data.count).toBe(0);
  });

  it('never counts another org’s fixes', async () => {
    await setFlag(fx.rival.orgId, true);
    const rm = await memory({ orgId: fx.rival.orgId, layer: 'org', teamId: null });
    const rp = await proposal(rm, { status: 'approved', reviewedAt: recently() });
    // A (corrupt) cross-org signal row pointing at the rival card must not count.
    await signalFor(rp.id, fx.users.member.id, fx.rival.orgId);
    const member = await loginAgent('member');
    expect((await member.get('/api/v1/knowledge/my-impact')).body.data.count).toBe(0);
  });

  it('the knowledgeImpact switch off → always 0', async () => {
    const p = await proposal(await memory(), { status: 'approved', reviewedAt: recently() });
    await signalFor(p.id, fx.users.member.id);
    await setPrefs(fx.users.member.id, { knowledgeImpact: false });
    const member = await loginAgent('member');
    expect((await member.get('/api/v1/knowledge/my-impact')).body.data.count).toBe(0);
  });

  it('validates days; 404 with the flag off; 401 signed out', async () => {
    const member = await loginAgent('member');
    expect((await member.get('/api/v1/knowledge/my-impact?days=0')).status).toBe(400);
    expect((await member.get('/api/v1/knowledge/my-impact?days=abc')).status).toBe(400);
    expect((await member.get('/api/v1/knowledge/my-impact?days=32')).status).toBe(400);
    await setFlag(fx.primary.orgId, false);
    expect((await member.get('/api/v1/knowledge/my-impact')).status).toBe(404);
    expect((await anonAgent().get('/api/v1/knowledge/my-impact')).status).toBe(401);
  });

  it('no bell and no email for the member weekly line', async () => {
    const p = await proposal(await memory(), {
      status: 'approved',
      reviewedAt: new Date(MON_9_UTC.getTime() - DAY),
    });
    await signalFor(p.id, fx.users.member.id);
    await runDailyDigest({ now: MON_9_UTC, activityDigest: quiet });
    expect(await notes(fx.users.member.id)).toHaveLength(0);
    expect(mail.sendEmail.mock.calls.some((c) => c[0].to === 'member@itest.local')).toBe(false);
  });
});

// ── E5: "updated" marker on sources ───────────────────────────────────────

describe('E5: updated marker on chat sources', () => {
  async function changed(
    daysAgo: number,
    changeSource = 'curator',
    layer: 'user' | 'team' = 'user',
  ) {
    const m = await memory({ layer, version: 2, content: `Customer update steps ${daysAgo}` });
    await prisma.memoryVersion.create({
      data: {
        memoryId: m.id,
        orgId: m.orgId,
        version: 1,
        content: 'old',
        changeSource: 'user',
        createdAt: new Date(Date.now() - 30 * DAY),
      },
    });
    await prisma.memoryVersion.create({
      data: {
        memoryId: m.id,
        orgId: m.orgId,
        version: 2,
        content: m.content,
        changeSource,
        createdAt: new Date(Date.now() - daysAgo * DAY),
      },
    });
    return m;
  }

  it('a user memory changed 1 day ago is marked; one changed 10 days ago is not', async () => {
    const fresh = await changed(1);
    const stale = await changed(10);
    const plain = await memory({ layer: 'user', content: 'Never changed' });

    const { sources } = await buildSystemPrompt({
      orgId: fx.primary.orgId,
      userId: fx.users.member.id,
    });
    const by = (content: string) => sources.find((s) => s.content === content)!;
    expect(by(fresh.content)).toMatchObject({
      type: 'memory',
      recentlyUpdated: true,
      changeSource: 'curator',
    });
    expect(new Date(by(fresh.content).lastChangedAt!).getTime()).toBeGreaterThan(
      Date.now() - 2 * DAY,
    );
    expect(by(stale.content).recentlyUpdated).toBeUndefined();
    expect(by(plain.content).recentlyUpdated).toBeUndefined();
  });

  it('any new version counts, not only curator ones', async () => {
    const m = await changed(2, 'user');
    const { sources } = await buildSystemPrompt({
      orgId: fx.primary.orgId,
      userId: fx.users.member.id,
    });
    expect(sources.find((s) => s.content === m.content)).toMatchObject({
      recentlyUpdated: true,
      changeSource: 'user',
    });
  });

  it('team/org context sources are marked the same way', async () => {
    const m = await changed(3, 'curator', 'team');
    const source: CitationSource = {
      index: 1,
      type: 'context',
      label: 'team context',
      content: m.content,
    };
    await markRecentlyUpdatedSources(fx.primary.orgId, [{ source, id: m.id, version: 2 }]);
    expect(source.recentlyUpdated).toBe(true);
  });

  it('flag off → no marker', async () => {
    await setFlag(fx.primary.orgId, false);
    const fresh = await changed(1);
    const { sources } = await buildSystemPrompt({
      orgId: fx.primary.orgId,
      userId: fx.users.member.id,
    });
    expect(sources.find((s) => s.content === fresh.content)!.recentlyUpdated).toBeUndefined();
  });

  it('never reads another org’s version rows', async () => {
    const fresh = await changed(1);
    const source: CitationSource = { index: 1, type: 'memory', label: 'x', content: fresh.content };
    await setFlag(fx.rival.orgId, true);
    await markRecentlyUpdatedSources(fx.rival.orgId, [{ source, id: fresh.id, version: 2 }]);
    expect(source.recentlyUpdated).toBeUndefined();
  });
});

// ── E10: admin weekly summary ─────────────────────────────────────────────

describe('E10: GET /knowledge/admin-summary', () => {
  async function seedWeek() {
    const now = Date.now();
    const recent = new Date(now - 2 * DAY);
    await proposal(await memory(), { status: 'approved', reviewedAt: recent });
    await proposal(await memory(), { status: 'approved', reviewedAt: recent });
    await proposal(await memory(), { status: 'edited', reviewedAt: recent });
    await proposal(await memory(), { status: 'rejected', reviewedAt: recent });
    await proposal(await memory(), { status: 'approved', reviewedAt: new Date(now - 10 * DAY) });
    await proposal(await memory(), { availableAt: new Date(now - 9 * DAY) });
    await proposal(await memory(), { availableAt: new Date(now - DAY) });

    // A team with no lead, holding a team memory and a team routine.
    const ops = await prisma.team.create({ data: { name: 'Ops', orgId: fx.primary.orgId } });
    await prisma.user.create({
      data: { email: 'ops@itest.local', name: 'Ops Member', role: 'member', teamId: ops.id },
    });
    await memory({ teamId: ops.id, content: 'Ops runbook' });
    await prisma.routine.create({
      data: {
        userId: fx.users.admin.id,
        name: 'Ops weekly',
        prompt: 'x',
        delivery: { channels: ['in_app'] },
        scope: 'team',
        teamId: ops.id,
        orgId: fx.primary.orgId,
      },
    });
    // An item whose named owner is not in this org.
    await memory({ layer: 'org', ownerId: fx.users.rival.id, content: 'Pricing rules' });
    // A team item in Engineering (has a lead) is owned.
    await memory({ content: 'Eng handbook' });
    return ops;
  }

  it('admins see counts, waiting and areas with no owner', async () => {
    const ops = await seedWeek();
    const admin = await loginAgent('admin');
    const res = await admin.get('/api/v1/knowledge/admin-summary?days=7');
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.changed).toEqual({ approved: 2, edited: 1, rejected: 1 });
    expect(s.waiting).toEqual({ pending: 2, oldestDays: 9 });
    const reasons = s.unowned.map((a: { reason: string }) => a.reason);
    expect(reasons).toEqual(['owner_left', 'team_no_lead']);
    const opsArea = s.unowned.find((a: { reason: string }) => a.reason === 'team_no_lead');
    expect(opsArea).toMatchObject({ teamId: ops.id, teamName: 'Ops', memory: 1, routines: 1 });
    const left = s.unowned.find((a: { reason: string }) => a.reason === 'owner_left');
    expect(left.memory).toBe(1);
    expect(left.items[0].name).toContain('Pricing rules');
  });

  it('lead, member and viewer get 403', async () => {
    for (const role of ['lead', 'member', 'viewer'] as const) {
      const c = await loginAgent(role);
      expect((await c.get('/api/v1/knowledge/admin-summary')).status).toBe(403);
    }
  });

  it('flag off → 404 for everyone (admins too); signed out → 401', async () => {
    await setFlag(fx.primary.orgId, false);
    const admin = await loginAgent('admin');
    expect((await admin.get('/api/v1/knowledge/admin-summary')).status).toBe(404);
    const member = await loginAgent('member');
    expect((await member.get('/api/v1/knowledge/admin-summary')).status).toBe(404);
    expect((await anonAgent().get('/api/v1/knowledge/admin-summary')).status).toBe(401);
  });

  it('tenant isolation: the rival admin sees only their own (empty) org', async () => {
    await seedWeek();
    await setFlag(fx.rival.orgId, true);
    const rival = await loginAgent('rival');
    const res = await rival.get('/api/v1/knowledge/admin-summary');
    expect(res.status).toBe(200);
    expect(res.body.data.changed).toEqual({ approved: 0, edited: 0, rejected: 0 });
    expect(res.body.data.waiting).toEqual({ pending: 0, oldestDays: null });
    expect(res.body.data.unowned).toEqual([]);
  });

  it('Monday’s digest carries one weekly line for admins; not on other days; not when switched off', async () => {
    await proposal(await memory({ layer: 'org' }), {
      targetScope: 'org',
      targetTeamId: null,
      availableAt: new Date(MON_9_UTC.getTime() - DAY),
    });
    await runDailyDigest({ now: MON_9_UTC, activityDigest: quiet });
    const [mon] = await notes(fx.users.admin.id);
    expect(mon.title).toMatch(/^1 proposal for/);
    expect(mon.body).toMatch(/^Knowledge this week: 0 changed · 1 waits/);
    // The lead (not an admin) never gets the weekly line.
    expect(await notes(fx.users.lead.id)).toHaveLength(0);

    await runDailyDigest({ now: new Date(MON_9_UTC.getTime() + DAY), activityDigest: quiet });
    const tue = (await notes(fx.users.admin.id))[1];
    expect(tue.body ?? '').not.toContain('Knowledge this week');

    await setPrefs(fx.users.admin.id, { adminWeeklySummary: false });
    await runDailyDigest({ now: new Date(MON_9_UTC.getTime() + 7 * DAY), activityDigest: quiet });
    const nextMon = (await notes(fx.users.admin.id))[2];
    expect(nextMon.body ?? '').not.toContain('Knowledge this week');
  });
});

// ── 6: notification preferences ──────────────────────────────────────────

describe('GET/PUT /notifications/preferences', () => {
  it('GET returns defaults by role and the flag state', async () => {
    const member = await loginAgent('member');
    const m = await member.get('/api/v1/notifications/preferences');
    expect(m.status).toBe(200);
    expect(m.body.data).toEqual({
      prefs: {
        knowledgeSummary: true,
        knowledgeEmail: false,
        adminWeeklySummary: false,
        knowledgeImpact: true,
      },
      knowledgeLoop: true,
    });
    const admin = await loginAgent('admin');
    expect(
      (await admin.get('/api/v1/notifications/preferences')).body.data.prefs.adminWeeklySummary,
    ).toBe(true);
  });

  it('PUT merges a subset and persists it', async () => {
    const lead = await loginAgent('lead');
    let res = await lead.put('/api/v1/notifications/preferences', { knowledgeEmail: true });
    expect(res.status).toBe(200);
    expect(res.body.data.prefs.knowledgeEmail).toBe(true);
    res = await lead.put('/api/v1/notifications/preferences', { knowledgeSummary: false });
    expect(res.body.data.prefs).toMatchObject({ knowledgeEmail: true, knowledgeSummary: false });
    const row = await prisma.notificationPreference.findUniqueOrThrow({
      where: { userId: fx.users.lead.id },
    });
    expect(row.prefs).toEqual({ knowledgeEmail: true, knowledgeSummary: false });
    expect((await lead.get('/api/v1/notifications/preferences')).body.data.prefs).toMatchObject({
      knowledgeEmail: true,
      knowledgeSummary: false,
    });
  });

  it('PUT rejects a bad shape with 400 and stores nothing', async () => {
    const lead = await loginAgent('lead');
    for (const body of [
      { spam: true },
      { knowledgeEmail: 'yes' },
      { knowledgeSummary: 1 },
      [true],
    ]) {
      expect((await lead.put('/api/v1/notifications/preferences', body)).status).toBe(400);
    }
    expect(await prisma.notificationPreference.count()).toBe(0);
  });

  it('per-user isolation: one person’s switches never change another’s', async () => {
    const member = await loginAgent('member');
    await member.put('/api/v1/notifications/preferences', { knowledgeSummary: false });
    const lead = await loginAgent('lead');
    expect(
      (await lead.get('/api/v1/notifications/preferences')).body.data.prefs.knowledgeSummary,
    ).toBe(true);
    expect(await prisma.notificationPreference.count()).toBe(1);
  });

  it('the digest honours a switch set through the API', async () => {
    await proposal(await memory());
    const lead = await loginAgent('lead');
    await lead.put('/api/v1/notifications/preferences', { knowledgeSummary: false });
    await runDailyDigest({ now: TUE_9_UTC, activityDigest: quiet });
    expect(await notes(fx.users.lead.id)).toHaveLength(0);
    await lead.put('/api/v1/notifications/preferences', {
      knowledgeSummary: true,
      knowledgeEmail: true,
    });
    await runDailyDigest({ now: new Date(TUE_9_UTC.getTime() + DAY), activityDigest: quiet });
    expect(await notes(fx.users.lead.id)).toHaveLength(1);
    expect(mail.sendEmail.mock.calls.some((c) => c[0].to === 'lead@itest.local')).toBe(true);
  });

  it('flag off → GET says so (the UI hides the switches); 401 signed out', async () => {
    await setFlag(fx.primary.orgId, false);
    const member = await loginAgent('member');
    expect((await member.get('/api/v1/notifications/preferences')).body.data.knowledgeLoop).toBe(
      false,
    );
    expect((await anonAgent().get('/api/v1/notifications/preferences')).status).toBe(401);
    expect(
      (await anonAgent().put('/api/v1/notifications/preferences').send({})).status,
    ).toBeGreaterThanOrEqual(401);
  });
});
