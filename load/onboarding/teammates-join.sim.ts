/**
 * TEAMMATES-JOIN journey — real teammates come aboard a brand-new org.
 *
 * What a real "teammates join" flow looks like in Hearth TODAY (confirmed by
 * reading apps/api/src):
 *   - There is NO invite flow. No Invitation model, no token, no email, no
 *     accept route. A teammate JOINS by self-registering at POST /auth/register.
 *   - The FIRST user ever became admin + created org 'default' + 'Default Team'
 *     (done by the genesis sim). Every subsequent /auth/register is a plain
 *     'member' auto-assigned to prisma.team.findFirst() (the Default Team).
 *   - Promotion to team_lead/admin is an admin-only PATCH /admin/users/:id.
 *
 * So this sim drives the REAL entry points and asserts the FULL chain — and the
 * NEGATIVES (the things that should NOT exist / should NOT be allowed):
 *
 *   1. register several teammates → assert role=member, landed in Default Team,
 *      derived orgId present (chat-eligible).
 *   2. NEGATIVE: probe for an invite/accept/verify surface → must 404 (proves
 *      no invite flow exists; a teammate cannot "accept" anything).
 *   3. The REAL promotion path: admin PATCH role=team_lead and role=admin →
 *      assert the role actually changes and the newly-minted admin can hit an
 *      admin-only route.
 *   4. TRIGGER (not endpoint): a brand-new member, seconds after signup, opens
 *      a chat session and sends a message → asserts the REAL shared org+LLM
 *      produces an assistant reply. Negative twin: a member is FORBIDDEN from
 *      the admin PATCH (403) — role is enforced, not cosmetic.
 *   5. Onboarding-gap probes: no email verification gate, no team selection at
 *      signup, no per-user onboarding state on /auth/me.
 *
 * Run:
 *   API_URL=http://localhost:8100/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/onboarding/teammates-join.sim.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8100/api/v1';
const REPLY_TIMEOUT_MS = 90_000;

// Genesis admin (created by genesis.sim.ts on this throwaway instance).
const ADMIN_EMAIL = 'founder+genesis@hearth-onboard.test';
const ADMIN_PASSWORD = 'GenesisAdmin!2026';

// New-teammate default password used for every self-registration here.
const MEMBER_PASSWORD = 'Teammate!2026';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 320) => {
  const c = (s ?? '').replace(/\s+/g, ' ').trim();
  return c.slice(0, n) + (c.length > n ? '…' : '');
};

// ── Hearth client (cookie jar + double-submit CSRF) ──────────────────────────
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
  async req<T = any>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = { cookie: this.cookieHeader() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = this.csrf;
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this.store(res);
    const text = await res.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed as T };
  }
  /** Self-register a brand-new teammate. Returns the created user row. */
  async register(email: string, name: string, password = MEMBER_PASSWORD) {
    this.email = email;
    const r = await this.req<{ data: any; error?: string }>('POST', '/auth/register', {
      email,
      password,
      name,
    });
    return r;
  }
  async login(email: string, password: string): Promise<number> {
    this.email = email;
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    this.store(res);
    return res.status;
  }
  /** Send a user message and WAIT for the real assistant reply. */
  async ask(
    sessionId: string,
    content: string,
    timeoutMs = REPLY_TIMEOUT_MS,
  ): Promise<{ sendStatus: number; reply: string | null }> {
    const msgs = () =>
      this.req<{ data: { messages: Array<{ role: string; content: string }> } }>(
        'GET',
        `/chat/sessions/${sessionId}`,
      );
    const before = (await msgs()).body?.data?.messages?.filter((m) => m.role === 'assistant').length ?? 0;
    const send = await this.req('POST', `/chat/sessions/${sessionId}/messages`, { content });
    if (send.status !== 202) return { sendStatus: send.status, reply: null };
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(2500);
      const all = (await msgs()).body?.data?.messages?.filter((m) => m.role === 'assistant') ?? [];
      if (all.length > before && all[all.length - 1]?.content) {
        return { sendStatus: send.status, reply: all[all.length - 1].content };
      }
    }
    return { sendStatus: send.status, reply: null };
  }
}

const out: Record<string, unknown> = {};
const stamp = Date.now();

async function main() {
  const admin = new Hearth();
  const adminLogin = await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log('[0] admin login', adminLogin);
  if (adminLogin !== 200) {
    out.fatal = `admin login failed: ${adminLogin}`;
    console.log(JSON.stringify(out));
    return;
  }
  // Snapshot the org's single default team (members should land here).
  const teamsRes = await admin.req<{ data: Array<{ id: string; name: string; orgId: string }> }>(
    'GET',
    '/admin/teams',
  );
  const teams = teamsRes.body?.data ?? [];
  const defaultTeam = teams[0];
  out.org = {
    teamCount: teams.length,
    defaultTeamId: defaultTeam?.id,
    defaultTeamName: defaultTeam?.name,
    orgId: defaultTeam?.orgId,
  };
  console.log('[0] teams', teams.length, defaultTeam?.name, defaultTeam?.id);

  // ── STEP 1: several teammates self-register ────────────────────────────
  const teammates = [
    { handle: `priya`, name: 'Priya Nair' },
    { handle: `marcus`, name: 'Marcus Webb' },
    { handle: `lena`, name: 'Lena Fischer' },
  ];
  const registered: Array<{ handle: string; email: string; id: string; role: string; teamId: string | null; status: number }> = [];
  for (const t of teammates) {
    const c = new Hearth();
    const email = `${t.handle}+${stamp}@hearth-onboard.test`;
    const r = await c.register(email, t.name);
    const u = r.body?.data;
    registered.push({
      handle: t.handle,
      email,
      id: u?.id,
      role: u?.role,
      teamId: u?.teamId,
      status: r.status,
    });
    console.log(`[1] register ${t.handle}`, r.status, 'role=', u?.role, 'teamId=', u?.teamId);
  }
  out.step1_register = registered;

  // Assert via admin list that they materialized in the org with role=member.
  const usersRes = await admin.req<{ data: any[]; total: number }>('GET', '/admin/users?pageSize=100');
  const allUsers = usersRes.body?.data ?? [];
  out.step1_orgRoster = {
    total: usersRes.body?.total,
    members: allUsers.filter((u) => u.role === 'member').map((u) => u.email),
    nonMembers: allUsers.filter((u) => u.role !== 'member').map((u) => ({ email: u.email, role: u.role })),
  };
  out.step1_allInDefaultTeam = registered.every((r) => r.teamId === defaultTeam?.id);
  console.log('[1] roster total', usersRes.body?.total, 'allInDefaultTeam', out.step1_allInDefaultTeam);

  // ── STEP 1b: each new member's /auth/me — confirm derived orgId (chat-eligible)
  // and probe for any per-user onboarding state field.
  const meSamples: any[] = [];
  for (const t of teammates.slice(0, 1)) {
    const c = new Hearth();
    await c.login(`${t.handle}+${stamp}@hearth-onboard.test`, MEMBER_PASSWORD);
    const me = await c.req<{ data: any }>('GET', '/auth/me');
    meSamples.push({ email: me.body?.data?.email, payload: me.body?.data });
  }
  out.step1b_me = meSamples;
  const meKeys = meSamples[0]?.payload ? Object.keys(meSamples[0].payload) : [];
  out.step1b_meKeys = meKeys;
  out.step1b_hasOrgId = !!meSamples[0]?.payload?.orgId;
  out.step1b_hasOnboardingState = meKeys.some((k) =>
    /onboard|verified|invite|firstLogin|completed|tour/i.test(k),
  );
  console.log('[1b] /auth/me keys', meKeys.join(','), 'orgId?', out.step1b_hasOrgId);

  // ── STEP 2: NEGATIVE — there is no invite/accept/verify surface ────────
  // A teammate cannot "accept an invite" or "verify email" because no such
  // route exists. Probe with the AUTHENTICATED admin (who holds a CSRF token)
  // so a 403 can only mean "forbidden by a real handler", never "CSRF wall".
  // All probes must 404 (route missing) to prove the surface does not exist.
  const guest = admin;
  const inviteProbes = [
    ['GET', '/invitations'],
    ['GET', '/admin/invitations'],
    ['POST', '/admin/invitations'],
    ['POST', '/invitations/accept'],
    ['POST', '/auth/accept-invite'],
    ['POST', '/auth/verify-email'],
    ['GET', '/auth/verify-email'],
  ] as const;
  const probeResults: Array<{ method: string; path: string; status: number }> = [];
  for (const [m, p] of inviteProbes) {
    const r = await guest.req(m, p, m === 'GET' ? undefined : {});
    probeResults.push({ method: m, path: p, status: r.status });
  }
  out.step2_inviteProbes = probeResults;
  // "404 (route absent)" is the proof of no invite flow. Anything that is NOT
  // 404 means a surface exists and we should look closer.
  out.step2_noInviteSurface = probeResults.every((r) => r.status === 404);
  console.log('[2] invite probes', probeResults.map((r) => `${r.path}=${r.status}`).join(' '));

  // ── STEP 3: REAL promotion path — admin PATCH role ─────────────────────
  // Promote priya → team_lead, marcus → admin. Assert the role flips and (for
  // the new admin) that admin power is REAL (can hit an admin-only route).
  const priya = registered.find((r) => r.handle === 'priya')!;
  const marcus = registered.find((r) => r.handle === 'marcus')!;

  const promoteLead = await admin.req<{ data: any }>('PATCH', `/admin/users/${priya.id}`, {
    role: 'team_lead',
  });
  out.step3_promoteLead = {
    status: promoteLead.status,
    role: promoteLead.body?.data?.role,
  };
  console.log('[3] promote priya→team_lead', promoteLead.status, promoteLead.body?.data?.role);

  const promoteAdmin = await admin.req<{ data: any }>('PATCH', `/admin/users/${marcus.id}`, {
    role: 'admin',
  });
  out.step3_promoteAdmin = {
    status: promoteAdmin.status,
    role: promoteAdmin.body?.data?.role,
  };
  console.log('[3] promote marcus→admin', promoteAdmin.status, promoteAdmin.body?.data?.role);

  // The promoted admin logs in fresh and proves the power is real.
  const marcusClient = new Hearth();
  await marcusClient.login(marcus.email, MEMBER_PASSWORD);
  const marcusAdminCall = await marcusClient.req('GET', '/admin/users');
  out.step3_newAdminCanAdmin = {
    status: marcusAdminCall.status,
    canList: marcusAdminCall.status === 200,
  };
  console.log('[3] new admin marcus GET /admin/users', marcusAdminCall.status);

  // ── STEP 4: TRIGGER — a brand-new member uses chat immediately ─────────
  // The real entry point: register a teammate, log in, open a session, send a
  // message, and assert the SHARED org+LLM returns an assistant reply. This is
  // the "can a teammate actually start working the moment they join?" test.
  const fresh = new Hearth();
  const freshEmail = `nora+${stamp}@hearth-onboard.test`;
  const freshReg = await fresh.register(freshEmail, 'Nora Quinn');
  await fresh.login(freshEmail, MEMBER_PASSWORD);
  const sess = await fresh.req<{ data: { id: string } }>('POST', '/chat/sessions', {
    title: 'My first day',
  });
  const sessId = sess.body?.data?.id;
  out.step4_sessionCreate = { regStatus: freshReg.status, sessionStatus: sess.status, sessionId: sessId };
  console.log('[4] fresh member session', sess.status, sessId);

  let chat: { sendStatus: number; reply: string | null } = { sendStatus: 0, reply: null };
  if (sessId) {
    chat = await fresh.ask(sessId, 'Hi! I just joined the team today. What can you help me with?');
  }
  out.step4_chat = {
    sendStatus: chat.sendStatus,
    gotReply: !!chat.reply,
    reply: chat.reply ? trim(chat.reply) : null,
  };
  console.log('[4] fresh member chat send', chat.sendStatus, 'reply?', !!chat.reply);

  // ── STEP 4b: NEGATIVE twin — a plain member is FORBIDDEN from admin PATCH
  // Role enforcement must be real: lena (still a member) tries to promote
  // herself to admin → must 403.
  const lena = registered.find((r) => r.handle === 'lena')!;
  const lenaClient = new Hearth();
  await lenaClient.login(lena.email, MEMBER_PASSWORD);
  const selfPromote = await lenaClient.req('PATCH', `/admin/users/${lena.id}`, { role: 'admin' });
  // Re-read lena's actual role via admin to be sure nothing changed.
  const lenaAfter = await admin.req<{ data: any[] }>('GET', '/admin/users?pageSize=100');
  const lenaRow = (lenaAfter.body?.data ?? []).find((u) => u.email === lena.email);
  out.step4b_memberCannotPromote = {
    patchStatus: selfPromote.status,
    forbidden: selfPromote.status === 403,
    lenaRoleAfter: lenaRow?.role,
  };
  console.log('[4b] member self-promote', selfPromote.status, 'role after', lenaRow?.role);

  // ── STEP 5: onboarding-gap probes ──────────────────────────────────────
  // (a) email verification gate: a freshly-registered user with a never-seen
  // email is fully active immediately (we already chatted in step 4). Record it.
  // (b) team selection at signup: register accepts NO teamId — prove it's
  // ignored (member still lands in Default Team even if we send one).
  const teamPicker = new Hearth();
  const pickerEmail = `picker+${stamp}@hearth-onboard.test`;
  const pickerReg = await teamPicker.req<{ data: any }>('POST', '/auth/register', {
    email: pickerEmail,
    password: MEMBER_PASSWORD,
    name: 'Tess Picker',
    teamId: 'nonexistent-team-id-should-be-ignored',
    role: 'admin', // attempt privilege self-grant at signup
  });
  out.step5_signupIgnoresExtras = {
    status: pickerReg.status,
    role: pickerReg.body?.data?.role, // must be 'member', not 'admin'
    teamId: pickerReg.body?.data?.teamId, // must be Default Team, not the bogus id
    landedInDefaultTeam: pickerReg.body?.data?.teamId === defaultTeam?.id,
    roleEscalationBlocked: pickerReg.body?.data?.role === 'member',
  };
  console.log(
    '[5] signup extras ignored — role',
    pickerReg.body?.data?.role,
    'teamId==default?',
    pickerReg.body?.data?.teamId === defaultTeam?.id,
  );

  console.log('\n===RESULT_JSON_BEGIN===');
  console.log(JSON.stringify(out, null, 2));
  console.log('===RESULT_JSON_END===');
}

main().catch((e) => {
  console.error('SIM CRASH', e);
  console.log('===RESULT_JSON_BEGIN===');
  console.log(JSON.stringify({ ...out, crash: String(e) }, null, 2));
  console.log('===RESULT_JSON_END===');
  process.exit(1);
});
