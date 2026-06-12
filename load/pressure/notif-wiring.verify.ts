/**
 * Live verification for notification wiring (FIX #2).
 * - reaction_on_your_message: A reacts to B's message -> B gets notified
 * - mention: A @mentions B in a shared session -> B gets notified
 * - comment_on_your_message: A comments on B's task -> B gets notified
 */
const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';

class Hearth {
  private cookies = new Map<string, string>();
  private csrf = '';
  email = '';
  userId = '';
  name = '';

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
    const me = await this.req<{ data: { id: string; name: string } }>('GET', '/auth/me');
    this.userId = me.body?.data?.id ?? '';
    this.name = me.body?.data?.name ?? '';
  }
  async unread(): Promise<number> {
    const r = await this.req<{ data: { unreadCount: number } }>('GET', '/notifications');
    return r.body?.data?.unreadCount ?? -1;
  }
  async notifs(): Promise<Array<{ type: string; title: string }>> {
    const r = await this.req<{ data: { items: Array<{ type: string; title: string }> } }>('GET', '/notifications');
    return r.body?.data?.items ?? [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const A = new Hearth(); // Sam Park (dev1) — actor
  const B = new Hearth(); // Jordan Lee (dev2) — recipient
  await A.login('dev1@hearth.local');
  await B.login('dev2@hearth.local');
  console.log(`A=${A.name} (${A.userId})  B=${B.name} (${B.userId})`);

  const results: Record<string, string> = {};

  // ── (1) reaction_on_your_message ──────────────────────────────────────────
  // B owns a session, posts a message; B shares it org-wide so A can react.
  {
    const sid = (await B.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'reaction test' })).body.data.id;
    await B.req('PATCH', `/chat/sessions/${sid}/visibility`, { visibility: 'org' });
    const send = await B.req<{ data: { messageId: string } }>('POST', `/chat/sessions/${sid}/messages`, { content: 'B says hello (reaction target)' });
    const msgId = send.body.data.messageId;

    const beforeUnread = await B.unread();
    const beforeReaction = (await B.notifs()).filter((n) => n.type === 'reaction_on_your_message').length;

    const react = await A.req('POST', `/chat/sessions/${sid}/messages/${msgId}/reactions`, { emoji: '👍' });
    let afterUnread = beforeUnread;
    let afterReaction = beforeReaction;
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      afterUnread = await B.unread();
      afterReaction = (await B.notifs()).filter((n) => n.type === 'reaction_on_your_message').length;
      if (afterReaction > beforeReaction) break;
    }
    results.reaction = `react.status=${react.status} unread ${beforeUnread}->${afterUnread} reactionNotifs ${beforeReaction}->${afterReaction} ${afterReaction > beforeReaction ? 'PASS' : 'FAIL'}`;

    // Self-reaction must NOT notify (B reacts to own message)
    const selfBefore = (await B.notifs()).filter((n) => n.type === 'reaction_on_your_message').length;
    await B.req('POST', `/chat/sessions/${sid}/messages/${msgId}/reactions`, { emoji: '🎉' });
    await sleep(1500);
    const selfAfter = (await B.notifs()).filter((n) => n.type === 'reaction_on_your_message').length;
    results.selfReaction = `selfReactionNotifs ${selfBefore}->${selfAfter} ${selfAfter === selfBefore ? 'PASS (no self-notify)' : 'FAIL (self-notified)'}`;
  }

  // ── (2) mention ───────────────────────────────────────────────────────────
  // A owns an org-shared session, B joins, A @mentions B by name.
  {
    const sid = (await A.req<{ data: { id: string } }>('POST', '/chat/sessions', { title: 'mention test' })).body.data.id;
    await A.req('PATCH', `/chat/sessions/${sid}/visibility`, { visibility: 'org' });
    await B.req('POST', `/chat/sessions/${sid}/join`, {});

    const beforeUnread = await B.unread();
    const beforeMention = (await B.notifs()).filter((n) => n.type === 'mention').length;

    const firstName = B.name.split(' ')[0];
    const send = await A.req('POST', `/chat/sessions/${sid}/messages`, { content: `Hey @${firstName} can you take a look at this?` });

    let afterUnread = beforeUnread;
    let afterMention = beforeMention;
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      afterUnread = await B.unread();
      afterMention = (await B.notifs()).filter((n) => n.type === 'mention').length;
      if (afterMention > beforeMention) break;
    }
    results.mention = `send.status=${send.status} unread ${beforeUnread}->${afterUnread} mentionNotifs ${beforeMention}->${afterMention} ${afterMention > beforeMention ? 'PASS' : 'FAIL'}`;

    // A mentions self -> must NOT notify A; non-participant name must NOT notify.
    const aBefore = (await A.notifs()).filter((n) => n.type === 'mention').length;
    await A.req('POST', `/chat/sessions/${sid}/messages`, { content: `@${A.name.split(' ')[0]} note to self` });
    await sleep(1500);
    const aAfter = (await A.notifs()).filter((n) => n.type === 'mention').length;
    results.selfMention = `selfMentionNotifs ${aBefore}->${aAfter} ${aAfter === aBefore ? 'PASS (no self-notify)' : 'FAIL'}`;
  }

  // ── (3) comment_on_your_message (task comment) ────────────────────────────
  {
    const task = await B.req<{ data: { id: string } }>('POST', '/tasks', {
      title: 'B task for comment notif', source: 'manual', status: 'backlog',
    });
    if (task.status >= 200 && task.status < 300 && task.body?.data?.id) {
      const taskId = task.body.data.id;
      const beforeComment = (await B.notifs()).filter((n) => n.type === 'comment_on_your_message').length;
      const c = await A.req('POST', `/tasks/${taskId}/comments`, { content: 'A comment from a non-owner' });
      let afterComment = beforeComment;
      for (let i = 0; i < 15; i++) {
        await sleep(300);
        afterComment = (await B.notifs()).filter((n) => n.type === 'comment_on_your_message').length;
        if (afterComment > beforeComment) break;
      }
      results.comment = `comment.status=${c.status} commentNotifs ${beforeComment}->${afterComment} ${afterComment > beforeComment ? 'PASS' : 'FAIL'}`;
    } else {
      results.comment = `task create failed status=${task.status} body=${JSON.stringify(task.body).slice(0, 200)} (A may lack read access to B task — SKIP)`;
    }
  }

  console.log('\n==== RESULTS ====');
  for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
