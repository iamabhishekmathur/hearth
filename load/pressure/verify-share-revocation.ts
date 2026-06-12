const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';

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
  async req<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = { cookie: this.cookieHeader() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = this.csrf;
    const res = await fetch(`${API}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    this.store(res);
    const text = await res.text();
    let parsed: unknown;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
    return { status: res.status, body: parsed as T };
  }
  async login(email: string) {
    this.email = email;
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    this.store(res);
  }
}

// Unauthenticated public GET (no cookies / no auth)
async function unauthGet(path: string): Promise<number> {
  const res = await fetch(`${API}${path}`, { method: 'GET' });
  await res.text();
  return res.status;
}

async function mintShare(h: Hearth, title: string) {
  const s = await h.req<{ data: { id: string } }>('POST', '/chat/sessions', { title });
  if (s.status !== 201) throw new Error(`create session failed: ${s.status} ${JSON.stringify(s.body)}`);
  const sid = s.body.data.id;
  const sh = await h.req<{ data: { token: string } }>('POST', `/chat/sessions/${sid}/share`, { contentFilter: 'all' });
  if (sh.status !== 201) throw new Error(`create share failed: ${sh.status} ${JSON.stringify(sh.body)}`);
  return { sid, token: sh.body.data.token };
}

async function main() {
  const owner = new Hearth();
  await owner.login('dev1@hearth.local');

  // ── Scenario A: archive invalidation ───────────────────────────────
  const a = await mintShare(owner, 'Revocation test — archive');
  const aBefore = await unauthGet(`/shared/${a.token}`);
  const arch = await owner.req('DELETE', `/chat/sessions/${a.sid}`);
  const aAfter = await unauthGet(`/shared/${a.token}`);
  console.log('SCENARIO A (archive):');
  console.log(`  token=${a.token}`);
  console.log(`  unauth GET /shared/:token BEFORE archive = ${aBefore} (expect 200)`);
  console.log(`  DELETE /chat/sessions/:id (archive)       = ${arch.status}`);
  console.log(`  unauth GET /shared/:token AFTER archive  = ${aAfter} (expect 404)`);

  // ── Scenario B: explicit revocation endpoint ───────────────────────
  const b = await mintShare(owner, 'Revocation test — revoke');
  const bBefore = await unauthGet(`/shared/${b.token}`);
  const rev = await owner.req('DELETE', `/chat/sessions/${b.sid}/share`);
  const bAfter = await unauthGet(`/shared/${b.token}`);
  console.log('SCENARIO B (revoke endpoint):');
  console.log(`  token=${b.token}`);
  console.log(`  unauth GET /shared/:token BEFORE revoke = ${bBefore} (expect 200)`);
  console.log(`  DELETE /chat/sessions/:id/share          = ${rev.status} body=${JSON.stringify(rev.body)}`);
  console.log(`  unauth GET /shared/:token AFTER revoke  = ${bAfter} (expect 404)`);

  // ── Scenario C: non-owner cannot revoke ────────────────────────────
  const c = await mintShare(owner, 'Revocation test — authz');
  const other = new Hearth();
  await other.login('dev2@hearth.local');
  const otherRev = await other.req('DELETE', `/chat/sessions/${c.sid}/share`);
  const cAfter = await unauthGet(`/shared/${c.token}`);
  console.log('SCENARIO C (non-owner revoke):');
  console.log(`  non-owner DELETE .../share = ${otherRev.status} (expect 404, no effect)`);
  console.log(`  unauth GET /shared/:token still works = ${cAfter} (expect 200)`);

  const pass =
    aBefore === 200 && aAfter === 404 &&
    bBefore === 200 && rev.status === 200 && bAfter === 404 &&
    otherRev.status === 404 && cAfter === 200;
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
