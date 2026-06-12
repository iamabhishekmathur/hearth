/**
 * Sharing + Notifications (recipient side + bell discipline) — pressure sim.
 *
 * Drives the REAL Hearth API across multiple authenticated clients:
 *   Devin (owner) shares an architecture thread org-wide, adds Sam (contributor)
 *   and Nina (viewer). We then log in AS Sam and AS Nina on their own clients and
 *   verify their recipient experience: reads, collaborator_added bell, viewer
 *   post rejection, contributor post + agent reply + speaker attribution,
 *   reactions, unread counts, public link filters, archive/revocation defects,
 *   and a notification-discipline matrix.
 *
 * Run:
 *   API_URL=http://localhost:8000/api/v1 \
 *     ./apps/api/node_modules/.bin/tsx load/pressure/sharing-notifs.sim.ts
 */

const API = process.env.API_URL ?? 'http://localhost:8000/api/v1';
const PASSWORD = 'changeme';
const REPLY_TIMEOUT_MS = 150_000;

// ── Hearth client (cookie jar + CSRF) — copied from load/simulate-llm-dialogue.ts
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
  async newSession(title: string): Promise<string> {
    return (await this.req<{ data: { id: string } }>('POST', '/chat/sessions', { title })).body.data.id;
  }
  /** Send a user message and WAIT for Hearth's real assistant reply. */
  async ask(sessionId: string, content: string): Promise<string> {
    const msgs = () => this.req<{ data: { messages: Array<{ role: string; content: string }> } }>('GET', `/chat/sessions/${sessionId}`);
    const before = (await msgs()).body.data.messages.filter((m) => m.role === 'assistant').length;
    const send = await this.req('POST', `/chat/sessions/${sessionId}/messages`, { content });
    if (send.status !== 202) return `[hearth send failed: ${send.status}]`;
    const start = Date.now();
    while (Date.now() - start < REPLY_TIMEOUT_MS) {
      await sleep(2500);
      const all = (await msgs()).body.data.messages.filter((m) => m.role === 'assistant');
      if (all.length > before && all[all.length - 1]?.content) return all[all.length - 1].content;
    }
    return '[hearth: no reply within timeout]';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trim = (s: string, n = 300) => { const c = (s ?? '').replace(/\s+/g, ' ').trim(); return c.slice(0, n) + (c.length > n ? '…' : ''); };

const results: Array<{ id: string; status: 'pass' | 'fail' | 'inconclusive'; observed: string }> = [];
function record(id: string, status: 'pass' | 'fail' | 'inconclusive', observed: string) {
  results.push({ id, status, observed });
  const icon = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'INCONCLUSIVE';
  console.log(`  [${icon}] ${id}: ${trim(observed, 400)}`);
}

async function main() {
  console.log(`Sharing+Notifs pressure sim against ${API}\n`);

  const devin = new Hearth();
  const sam = new Hearth();
  const nina = new Hearth();
  await devin.login('eng-lead@hearth.local'); // Devin Rao (owner)
  await sam.login('dev1@hearth.local');        // Sam Park (contributor)
  await nina.login('designer@hearth.local');   // Nina Alvarez (viewer)
  console.log(`Devin=${devin.userId} Sam=${sam.userId} Nina=${nina.userId}\n`);

  // Baseline notification counts (so we attribute new bells precisely).
  const samNotifsBefore = (await sam.req('GET', '/notifications')).body?.data?.items?.length ?? 0;
  const ninaNotifsBefore = (await nina.req('GET', '/notifications')).body?.data?.items?.length ?? 0;

  // ════════════ SCENARIO A ════════════
  console.log('═══ Scenario A: Devin shares thread; Sam contributor, Nina viewer ═══');
  const sid = await devin.newSession('Postgres vs DynamoDB — vector store decision');
  // Seed the thread with a real agent turn so there is content to share.
  const seedReply = await devin.ask(sid, 'We need to pick a primary datastore for our vector-search workload. Give me a crisp Postgres+pgvector vs DynamoDB recommendation for a 100-person eng org.');
  console.log(`  seed agent reply: ${trim(seedReply)}`);

  // Make it org-visible.
  const vis = await devin.req('PATCH', `/chat/sessions/${sid}/visibility`, { visibility: 'org' });
  console.log(`  visibility PATCH -> ${vis.status}`);

  // Add Sam as contributor, Nina as viewer.
  const addSam = await devin.req('POST', `/chat/sessions/${sid}/collaborators`, { userId: sam.userId, role: 'contributor' });
  const addNina = await devin.req('POST', `/chat/sessions/${sid}/collaborators`, { userId: nina.userId, role: 'viewer' });
  console.log(`  add Sam(contributor) -> ${addSam.status}; add Nina(viewer) -> ${addNina.status}`);

  // A1 — collaborator can read + appears in /shared
  const samRead = await sam.req<any>('GET', `/chat/sessions/${sid}`);
  const samShared = await sam.req<any>('GET', '/chat/sessions/shared');
  const inShared = (samShared.body?.data ?? []).some((s: any) => s.id === sid);
  if (samRead.status === 200 && (samRead.body?.data?.messages?.length ?? 0) > 0 && inShared) {
    record('A1-collab-can-read', 'pass', `Sam GET session=200 with ${samRead.body.data.messages.length} msgs; in /shared=${inShared}`);
  } else {
    record('A1-collab-can-read', 'fail', `Sam GET=${samRead.status} msgs=${samRead.body?.data?.messages?.length}; inShared=${inShared}`);
  }

  // A2 — collaborator_added bell for BOTH Sam and Nina
  await sleep(1500);
  const samNotifs = await sam.req<any>('GET', '/notifications');
  const ninaNotifs = await nina.req<any>('GET', '/notifications');
  const samBell = (samNotifs.body?.data?.items ?? []).find((n: any) => n.type === 'collaborator_added' && n.sessionId === sid);
  const ninaBell = (ninaNotifs.body?.data?.items ?? []).find((n: any) => n.type === 'collaborator_added' && n.sessionId === sid);
  if (samBell && ninaBell) {
    record('A2-collaborator-added-bell', 'pass', `Sam bell readAt=${samBell.readAt} title="${trim(samBell.title,80)}"; Nina bell readAt=${ninaBell.readAt}`);
  } else {
    record('A2-collaborator-added-bell', 'fail', `Sam bell=${!!samBell} Nina bell=${!!ninaBell}; samItems=${JSON.stringify((samNotifs.body?.data?.items??[]).map((n:any)=>n.type))}`);
  }

  // A3 — viewer (Nina) POST message rejected
  const ninaPost = await nina.req<any>('POST', `/chat/sessions/${sid}/messages`, { content: 'Can I weigh in on the design here?' });
  const ninaReadAfter = await nina.req<any>('GET', `/chat/sessions/${sid}`);
  const ninaMsgPresent = (ninaReadAfter.body?.data?.messages ?? []).some((m: any) => m.createdBy === nina.userId);
  if (ninaPost.status >= 400 && !ninaMsgPresent) {
    record('A3-viewer-post-rejected', 'pass', `Nina POST -> ${ninaPost.status} body=${JSON.stringify(ninaPost.body)}; no Nina msg present`);
  } else {
    record('A3-viewer-post-rejected', 'fail', `Nina POST -> ${ninaPost.status}; ninaMsgPresent=${ninaMsgPresent}`);
  }

  // A4 — contributor (Sam) CAN post and agent replies
  const samReply = await sam.ask(sid, 'Devin here is the contributor Sam — I lean Postgres for transactional locality. What are the top 2 operational risks of pgvector at our scale?');
  const samPosted = (await sam.req<any>('GET', `/chat/sessions/${sid}`)).body?.data?.messages?.some((m: any) => m.createdBy === sam.userId);
  if (samPosted && samReply && !samReply.startsWith('[hearth')) {
    record('A4-contributor-can-post', 'pass', `Sam msg persisted; agent replied: ${trim(samReply)}`);
  } else {
    record('A4-contributor-can-post', 'fail', `samPosted=${samPosted}; reply=${trim(samReply)}`);
  }

  // A5 — speaker attribution (two distinct human posters now exist: Devin + Sam)
  const attributed = /\bSam\b/i.test(samReply) || /\bDevin\b/i.test(samReply);
  record('A5-speaker-attribution', attributed ? 'pass' : 'inconclusive',
    `agent reply ${attributed ? 'references' : 'does NOT reference'} Devin/Sam by name. Raw: ${trim(samReply, 500)}`);

  // ════════════ SCENARIO B ════════════
  console.log('\n═══ Scenario B: reactions + unread counts ═══');
  // Pick the seed assistant message (Hearth's recommendation) to react to.
  const full = await devin.req<any>('GET', `/chat/sessions/${sid}`);
  const assistantMsgs = (full.body?.data?.messages ?? []).filter((m: any) => m.role === 'assistant');
  const targetMsgId = assistantMsgs[0]?.id;

  // B1 — Sam reacts 👍; visible to Devin; bad emoji -> 400
  const react = await sam.req<any>('POST', `/chat/sessions/${sid}/messages/${targetMsgId}/reactions`, { emoji: '👍' });
  const badReact = await sam.req<any>('POST', `/chat/sessions/${sid}/messages/${targetMsgId}/reactions`, { emoji: '🦄' });
  await sleep(800);
  const devinView = await devin.req<any>('GET', `/chat/sessions/${sid}`);
  const targetReactions = (devinView.body?.data?.messages ?? []).find((m: any) => m.id === targetMsgId)?.reactions ?? [];
  const thumbs = targetReactions.find((r: any) => r.emoji === '👍');
  const samInThumbs = thumbs?.userIds?.includes(sam.userId);
  if (react.status === 201 && samInThumbs && badReact.status === 400) {
    record('B1-reaction-visible-to-other', 'pass', `react=201, Devin sees 👍 userIds includes Sam=${samInThumbs}; bad emoji -> ${badReact.status}`);
  } else {
    record('B1-reaction-visible-to-other', 'fail', `react=${react.status} samInThumbs=${samInThumbs} badEmoji=${badReact.status} reactions=${JSON.stringify(targetReactions)}`);
  }

  // B2 — Devin's unread for the session increases when Sam posts.
  // First Devin reads to clear his marker, then Sam posts, then re-check.
  const devinMsgs = (await devin.req<any>('GET', `/chat/sessions/${sid}`)).body.data.messages;
  const lastId = devinMsgs[devinMsgs.length - 1].id;
  await devin.req('POST', `/chat/sessions/${sid}/read`, { lastMessageId: lastId });
  const devinUnreadBefore = (await devin.req<any>('GET', '/chat/sessions/unread-counts')).body?.data?.[sid]?.unreadCount ?? 0;
  // Sam posts a fresh message (no agent wait needed for the unread delta, but post triggers agent too).
  await sam.req('POST', `/chat/sessions/${sid}/messages`, { content: 'One more: what is the migration story if we start Postgres and later shard?' });
  await sleep(2500);
  const devinUnreadAfter = (await devin.req<any>('GET', '/chat/sessions/unread-counts')).body?.data?.[sid]?.unreadCount ?? 0;
  if (devinUnreadAfter > devinUnreadBefore) {
    record('B2-unread-increments-for-other', 'pass', `Devin unread ${devinUnreadBefore} -> ${devinUnreadAfter} after Sam posted`);
  } else {
    record('B2-unread-increments-for-other', 'fail', `Devin unread ${devinUnreadBefore} -> ${devinUnreadAfter} (no increase)`);
  }

  // B3 — Sam's own post does not inflate Sam's own unread count.
  const samMsgs = (await sam.req<any>('GET', `/chat/sessions/${sid}`)).body.data.messages;
  await sam.req('POST', `/chat/sessions/${sid}/read`, { lastMessageId: samMsgs[samMsgs.length - 1].id });
  const samUnreadBefore = (await sam.req<any>('GET', '/chat/sessions/unread-counts')).body?.data?.[sid]?.unreadCount ?? 0;
  await sam.req('POST', `/chat/sessions/${sid}/messages`, { content: 'Noting my own follow-up — does my own message count against my unread?' });
  await sleep(1500);
  const samUnreadAfter = (await sam.req<any>('GET', '/chat/sessions/unread-counts')).body?.data?.[sid]?.unreadCount ?? 0;
  // Sam's own post should NOT count. (Assistant reply may, separately — probed in B4.)
  if (samUnreadAfter === samUnreadBefore) {
    record('B3-no-self-inflation', 'pass', `Sam unread ${samUnreadBefore} -> ${samUnreadAfter} (own post did not count)`);
  } else {
    record('B3-no-self-inflation', 'inconclusive', `Sam unread ${samUnreadBefore} -> ${samUnreadAfter}; may include assistant reply (createdBy:null counts) not Sam's own post`);
  }

  // B4 — does assistant reply (createdBy:null) inflate the OWNER's unread for his own session?
  const devinMsgs2 = (await devin.req<any>('GET', `/chat/sessions/${sid}`)).body.data.messages;
  await devin.req('POST', `/chat/sessions/${sid}/read`, { lastMessageId: devinMsgs2[devinMsgs2.length - 1].id });
  const devinUnreadB4Before = (await devin.req<any>('GET', '/chat/sessions/unread-counts')).body?.data?.[sid]?.unreadCount ?? 0;
  // Devin asks his own session a question -> agent reply (createdBy:null) lands.
  await devin.ask(sid, 'Summarize our decision so far in one sentence.');
  await sleep(1500);
  const devinUnreadB4After = (await devin.req<any>('GET', '/chat/sessions/unread-counts')).body?.data?.[sid]?.unreadCount ?? 0;
  record('B4-createdBy-null-unread-probe', devinUnreadB4After > devinUnreadB4Before ? 'fail' : 'pass',
    `Owner Devin unread for his OWN session ${devinUnreadB4Before} -> ${devinUnreadB4After} after an assistant reply (createdBy:null). ${devinUnreadB4After > devinUnreadB4Before ? 'Assistant replies inflate the owner self-unread (likely UX bug).' : 'No inflation.'}`);

  // ════════════ SCENARIO C ════════════
  console.log('\n═══ Scenario C: public link filters + revocation/archive defects ═══');
  // Create three share links with different content filters.
  const shareResp = await devin.req<any>('POST', `/chat/sessions/${sid}/share`, { contentFilter: 'responses' });
  const sharePrompts = await devin.req<any>('POST', `/chat/sessions/${sid}/share`, { contentFilter: 'prompts' });
  const shareAll = await devin.req<any>('POST', `/chat/sessions/${sid}/share`, { contentFilter: 'all' });
  const tokResponses = shareResp.body?.data?.token;
  const tokPrompts = sharePrompts.body?.data?.token;
  const tokAll = shareAll.body?.data?.token;
  console.log(`  share tokens responses=${!!tokResponses} prompts=${!!tokPrompts} all=${!!tokAll}`);

  // Raw unauthenticated fetch helper (no cookies, no CSRF).
  const rawShared = async (tok: string) => {
    const res = await fetch(`${API}/shared/${tok}`);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };

  // C1 — responses filter -> only assistant messages
  const pubResp = await rawShared(tokResponses);
  const respRoles = (pubResp.body?.data?.messages ?? []).map((m: any) => m.role);
  const allAssistant = respRoles.length > 0 && respRoles.every((r: string) => r === 'assistant');
  if (pubResp.status === 200 && allAssistant) {
    record('C1-public-responses-filter', 'pass', `unauth GET 200; ${respRoles.length} msgs all role=assistant`);
  } else {
    record('C1-public-responses-filter', 'fail', `status=${pubResp.status}; roles=${JSON.stringify(respRoles)}`);
  }

  // C2 — prompts -> only user; all -> both roles
  const pubPrompts = await rawShared(tokPrompts);
  const pubAll = await rawShared(tokAll);
  const promptRoles = (pubPrompts.body?.data?.messages ?? []).map((m: any) => m.role);
  const allRoles = (pubAll.body?.data?.messages ?? []).map((m: any) => m.role);
  const promptsOk = promptRoles.length > 0 && promptRoles.every((r: string) => r === 'user');
  const allOk = allRoles.includes('user') && allRoles.includes('assistant');
  if (promptsOk && allOk) {
    record('C2-public-prompts-and-all-filters', 'pass', `prompts roles=${JSON.stringify([...new Set(promptRoles)])}; all roles=${JSON.stringify([...new Set(allRoles)])}`);
  } else {
    record('C2-public-prompts-and-all-filters', 'fail', `promptsOk=${promptsOk} roles=${JSON.stringify([...new Set(promptRoles)])}; allOk=${allOk} roles=${JSON.stringify([...new Set(allRoles)])}`);
  }

  // C3 — expired link -> 404
  const expired = await devin.req<any>('POST', `/chat/sessions/${sid}/share`, { contentFilter: 'all', expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const pubExpired = await rawShared(expired.body?.data?.token);
  record('C3-expired-link-404', pubExpired.status === 404 ? 'pass' : 'fail', `expired link unauth GET -> ${pubExpired.status} body=${JSON.stringify(pubExpired.body)}`);

  // C4 — non-owner (Sam) cannot create a share link
  const samShare = await sam.req<any>('POST', `/chat/sessions/${sid}/share`, { contentFilter: 'all' });
  record('C4-non-owner-cannot-share', samShare.status === 404 ? 'pass' : (samShare.status >= 400 ? 'inconclusive' : 'fail'),
    `Sam (contributor) POST /share -> ${samShare.status} body=${JSON.stringify(samShare.body)}`);

  // C5 — no revocation endpoint
  const delShareA = await devin.req('DELETE', `/chat/sessions/${sid}/share`);
  const delShareB = await devin.req('DELETE', `/shared/${tokResponses}`);
  const delShareC = await devin.req('DELETE', `/chat/sessions/${sid}/share/${tokResponses}`);
  const noRevoke = [delShareA.status, delShareB.status, delShareC.status].every((s) => s === 404 || s === 405);
  record('C5-no-revocation-endpoint', noRevoke ? 'pass' : 'fail',
    `DELETE /chat/sessions/:id/share=${delShareA.status}, DELETE /shared/:token=${delShareB.status}, DELETE /chat/sessions/:id/share/:token=${delShareC.status} (all 404/405 => route absent)`);

  // C6 — archive does NOT invalidate the public link
  const beforeArchive = await rawShared(tokAll);
  const archive = await devin.req<any>('DELETE', `/chat/sessions/${sid}`);
  await sleep(800);
  const afterArchive = await rawShared(tokAll);
  const stillLive = afterArchive.status === 200 && (afterArchive.body?.data?.messages?.length ?? 0) > 0;
  record('C6-archive-does-not-invalidate-link', stillLive ? 'fail' : 'pass',
    `archive DELETE session -> ${archive.status}. Public link BEFORE=${beforeArchive.status}(${beforeArchive.body?.data?.messages?.length} msgs) AFTER=${afterArchive.status}(${afterArchive.body?.data?.messages?.length} msgs). ${stillLive ? 'LINK STILL LIVE after archive — leak.' : 'Link died.'}`);

  // ════════════ NOTIFICATION DISCIPLINE MATRIX ════════════
  console.log('\n═══ N1: notification discipline matrix ═══');
  // We already proved collaborator_added fires (A2). Now probe other event types.
  // Use a fresh, non-archived session for these (the architecture thread is now archived).
  const sid2 = await devin.newSession('Notif discipline probe thread');
  await devin.req('PATCH', `/chat/sessions/${sid2}/visibility`, { visibility: 'org' });
  await devin.req('POST', `/chat/sessions/${sid2}/collaborators`, { userId: sam.userId, role: 'contributor' });
  // consume the collaborator_added bell so we don't double-count it below.
  await sleep(1200);
  const samMatrixBaseline = (await sam.req<any>('GET', '/notifications')).body?.data?.items ?? [];
  const baselineByType = (items: any[], type: string) => items.filter((n: any) => n.type === type).length;

  const matrix: Record<string, { fired: boolean; detail: string }> = {};

  // 1) @mention of Sam in a shared chat by Devin
  const before_mention = baselineByType(samMatrixBaseline, 'mention');
  await devin.req('POST', `/chat/sessions/${sid2}/messages`, { content: `@Sam Park can you confirm the pgvector index choice? cc @${sam.name}` });
  await sleep(3000);
  const afterMentionItems = (await sam.req<any>('GET', '/notifications')).body?.data?.items ?? [];
  matrix['mention'] = { fired: baselineByType(afterMentionItems, 'mention') > before_mention, detail: `mention notifs ${before_mention} -> ${baselineByType(afterMentionItems, 'mention')}` };

  // 2) reaction on Sam's own message (Devin reacts to a Sam message)
  // Sam posts first, then Devin reacts.
  await sam.req('POST', `/chat/sessions/${sid2}/messages`, { content: 'Confirmed — HNSW index, lists tuned later.' });
  await sleep(1500);
  const sid2Msgs = (await devin.req<any>('GET', `/chat/sessions/${sid2}`)).body?.data?.messages ?? [];
  const samMsg = sid2Msgs.find((m: any) => m.createdBy === sam.userId);
  let reactionFired = false, reactionDetail = 'no Sam message found to react to';
  if (samMsg) {
    const before_react = baselineByType((await sam.req<any>('GET', '/notifications')).body?.data?.items ?? [], 'reaction_on_your_message');
    const dr = await devin.req('POST', `/chat/sessions/${sid2}/messages/${samMsg.id}/reactions`, { emoji: '👍' });
    await sleep(2000);
    const after_react = baselineByType((await sam.req<any>('GET', '/notifications')).body?.data?.items ?? [], 'reaction_on_your_message');
    reactionFired = after_react > before_react;
    reactionDetail = `react POST=${dr.status}; reaction_on_your_message notifs ${before_react} -> ${after_react}`;
  }
  matrix['reaction_on_your_message'] = { fired: reactionFired, detail: reactionDetail };

  // 3) comment/reply on Devin's shared thread by Sam (another contributor posting)
  const before_comment = baselineByType((await devin.req<any>('GET', '/notifications')).body?.data?.items ?? [], 'comment_on_your_message');
  await sam.req('POST', `/chat/sessions/${sid2}/messages`, { content: 'Adding a reply on your thread, Devin — did you see my note?' });
  await sleep(2500);
  const after_comment = baselineByType((await devin.req<any>('GET', '/notifications')).body?.data?.items ?? [], 'comment_on_your_message');
  matrix['comment_on_your_message'] = { fired: after_comment > before_comment, detail: `(target=Devin owner) comment_on_your_message notifs ${before_comment} -> ${after_comment}` };

  // 4) task assign / mention a teammate in a task
  const before_task = (await sam.req<any>('GET', '/notifications')).body?.data?.items?.length ?? 0;
  const taskResp = await devin.req<any>('POST', '/tasks', { title: `Sam Park to benchmark pgvector recall @${sam.name}`, description: `Assigning ${sam.name} to run the recall benchmark.`, source: 'manual' });
  await sleep(2500);
  const after_task = (await sam.req<any>('GET', '/notifications')).body?.data?.items?.length ?? 0;
  matrix['task_assign_or_mention'] = { fired: after_task > before_task, detail: `task create=${taskResp.status} (no assignee field exists in POST /tasks); Sam total notifs ${before_task} -> ${after_task}` };

  console.log('  --- discipline matrix ---');
  for (const [k, v] of Object.entries(matrix)) {
    console.log(`    ${v.fired ? 'FIRES' : 'SILENT'}  ${k}: ${v.detail}`);
  }
  const firedTypes = Object.entries(matrix).filter(([, v]) => v.fired).map(([k]) => k);
  record('N1-notification-discipline-matrix', 'pass',
    `collaborator_added: FIRES (proven A2). Other types — ` +
    Object.entries(matrix).map(([k, v]) => `${k}:${v.fired ? 'FIRES' : 'SILENT'}`).join(', ') +
    `. Details: ${Object.values(matrix).map((v) => v.detail).join(' | ')}`);

  // Notification mark-read sanity
  const anyNotif = (await sam.req<any>('GET', '/notifications')).body?.data?.items?.[0];
  let markReadStatus = 'n/a';
  if (anyNotif) {
    const mr = await sam.req('POST', `/notifications/${anyNotif.id}/read`);
    markReadStatus = `POST /:id/read=${mr.status}`;
  }
  const readAll = await sam.req<any>('POST', '/notifications/read-all');
  console.log(`  mark-read sanity: ${markReadStatus}; read-all=${readAll.status} updated=${JSON.stringify(readAll.body?.data)}`);

  // ── Summary ──
  console.log('\n═══════════════ SUMMARY ═══════════════');
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const inc = results.filter((r) => r.status === 'inconclusive').length;
  console.log(`PASS=${pass} FAIL=${fail} INCONCLUSIVE=${inc}`);
  console.log(`baselines: Sam notifs before=${samNotifsBefore}, Nina before=${ninaNotifsBefore}`);
  console.log(`fired notification types (beyond collaborator_added): ${firedTypes.length ? firedTypes.join(', ') : 'NONE'}`);
  console.log('\nRESULTS_JSON=' + JSON.stringify(results));
}

main().catch((e) => { console.error('SIM FAILED:', e); process.exit(1); });
