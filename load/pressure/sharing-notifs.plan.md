# Pressure Test Plan — Sharing + Notifications (recipient side + bell discipline)

Key: `sharing-notifs`
Domain: Chat sharing from the RECIPIENT's perspective + the notification center, with a hard
probe on which bell-notification types actually fire vs. are silently dropped.

API base: `http://localhost:8000/api/v1`. Live stack (API + agent worker + Redis + Postgres).
Auth: `POST /auth/login {email,password:'changeme'}`, cookie jar + `hearth.csrf` echoed as
`x-csrf-token` on non-GET. Copy the `Hearth` client from `load/simulate-llm-dialogue.ts`.

---

## Confirmed endpoints + shapes (read from source)

### Visibility / collaborators / join (`apps/api/src/routes/chat.ts`)
- `PATCH /chat/sessions/:id/visibility` body `{ visibility: 'private' | 'org' }`. 400 if not one of
  those two. Returns `{ data: session }`. (NOTE: spec said `{visibility:'org'}` — only `private`/`org`
  are valid; there is no separate validation for arbitrary strings beyond the whitelist.)
- `POST /chat/sessions/:id/collaborators` body `{ userId, role }`. Role is coerced:
  `role === 'contributor' ? 'contributor' : 'viewer'` (anything else => viewer). Owner-only
  (`addCollaborator` requires `chatSession.findFirst({id, userId: owner})`; non-owner => 404).
  On success (201) it calls `notify({type:'collaborator_added', userId: target, ...})` — **the one
  notification path with a live caller.**
- `GET /chat/sessions/:id/collaborators` => `{ data: [{ id, userId, role, user:{id,name,email} }] }`.
- `DELETE /chat/sessions/:id/collaborators/:userId` => `{ message: 'Collaborator removed' }` (owner-only).
- `POST /chat/sessions/:id/join` => 201 `{ data: collaborator }`. Joins an `org`-visible session in the
  SAME org as a `contributor`. 404 if session not org-visible or cross-org.
- `GET /chat/sessions/:id` => `{ data: { ...session, messages:[{...,reactions, createdBy}],
  messageAuthors, lastReadMessageId } }`. Access = owner OR collaborator OR org-visible same org.
- `GET /chat/sessions/shared` => `{ data: [...] }` org-shared sessions visible to the user.

### Posting / authz (`POST /chat/sessions/:id/messages`)
- Body `{ content, ... }`. 400 if no content. Write access via `getSessionWriteAccess`: returns
  `'owner'` (session.userId === user) or `'contributor'` (collaborator role === 'contributor');
  **`'viewer'` collaborators and non-members => null => 404** (not 403). Returns 202
  `{ data: { messageId } }` then runs the agent async.
- Speaker attribution: only when `humanAuthorIds.size > 1` (more than one distinct human with
  `createdBy` set) does the agent prefix each user msg with `"Name: "` and get the multi-person
  system-prompt addendum. With a single human poster, NO attribution.

### Reactions
- `POST /chat/sessions/:id/messages/:mid/reactions` body `{ emoji }`. 400 if emoji not in allowed
  set (`isAllowedReactionEmoji`). 201 `{ data }`, emits `message:reaction` over WS.
- `DELETE /chat/sessions/:id/messages/:mid/reactions/:emoji` => `{ data:{messageId,emoji,removed} }`.

### Read tracking / unread
- `POST /chat/sessions/:id/read` body `{ lastMessageId }` (NOTE: field is `lastMessageId`, the spec's
  `/read` is correct but the body key matters). 400 if missing, 404 if session/message not found.
- `GET /chat/sessions/unread-counts` => `{ data: { [sessionId]: { unreadCount, lastReadMessageId } } }`.
  Own messages excluded via `OR:[{createdBy:null},{createdBy:{not:userId}}]` — **but `createdBy:null`
  messages (assistant replies, and any msg without an author) ALWAYS count toward unread, even for the
  owner.** Probe this.

### Public share link (`apps/api/src/routes/sharing.ts` + `sharing-service.ts`)
- `POST /chat/sessions/:id/share` body `{ contentFilter:'all'|'responses'|'prompts', expiresAt? }`.
  **Owner-only** (`createShare` requires `findFirst({id, userId})`; non-owner => 404 'Session not found').
  201 `{ data: { id, token, shareType, expiresAt, ... } }`. contentFilter maps to legacy shareType:
  all->full, responses->results_only, prompts->template.
- `GET /shared/:token` (UNauthenticated, public rate-limited) => `{ data: { shareType,
  contentFilterLabel, session:{id,title,ownerName}, messages:[{role,content,...}] } }`.
  Filter: results_only => only `assistant` msgs; template => only `user` msgs; full => all.
  404 if token invalid OR expired (`expiresAt < now`).

### Notifications (`apps/api/src/routes/notifications.ts`)
- `GET /notifications?unreadOnly=&limit=` => `{ data: { items:[...], unreadCount } }`.
- `POST /notifications/:id/read` => `{ data:{ok:true} }`, 404 if not found/owned/already read.
- `POST /notifications/read-all` => `{ data:{ updated } }`.
- Declared `NotificationType` union: `collaborator_added | mention | handoff | governance_block |
  comment_on_your_message | reaction_on_your_message`.

---

## CONFIRMED / SUSPECTED DEFECTS to verify with evidence

1. **Notification spine is almost entirely dead.** `notify()` has exactly ONE production caller:
   `collaborator_added` in chat.ts. `grep -rn notify\\( src/` shows no caller in tasks, routines,
   reactions, or mentions. So `mention`, `reaction_on_your_message`, `comment_on_your_message`,
   `handoff` are DECLARED but NEVER FIRED. Plan probes each event and reports fires-vs-silent.
2. **No share-link revocation endpoint.** sharing.ts has POST /share + GET /shared/:token + duplicate +
   fork only. No DELETE /share, no revoke. Verify by attempting and getting 404/405.
3. **Archiving a session does NOT invalidate its public link.** `archiveSession` (DELETE
   /chat/sessions/:id) sets status; `getSharedSession` only checks token + expiry, never session
   status. So `GET /shared/:token` keeps serving content after archive. Verify.
4. **Viewer rejection returns 404, not 403.** Authz-negative still rejects (good) but the status code
   masks the real reason. Report as observed-vs-expected.
5. **`/read` body key is `lastMessageId`** not `messageId`/`lastReadMessageId` — easy mismatch.

---

## Scenarios (3 human, real-world)

### Scenario A — Devin shares an architecture thread; Sam (contributor) and Nina (viewer) live it
Narrative: Devin Rao (eng lead) works through a "Postgres vs DynamoDB for the events table" thread with
Hearth, makes it org-visible, adds Sam Park as a **contributor** and Nina Alvarez as a **viewer** so
they can follow the decision. Sam jumps in with a follow-up; Nina tries to comment and is blocked.
Actors: Devin (owner), Sam (contributor recipient), Nina (viewer recipient). Separate clients.

Steps + REST-observable assertions:
1. Devin: create session, `ask` one real architecture question, wait for agent reply.
2. Devin: `PATCH .../visibility {visibility:'org'}` => 200, session.visibility==='org'.
3. Devin: look up Sam & Nina userIds via `GET /chat/users/search?q=` (or collaborators list / a known
   directory call). Add Sam `{role:'contributor'}` => 201; add Nina `{role:'viewer'}` => 201.
4. **Recipient experience (Sam):** Sam logs in (own client), `GET /chat/sessions/:id` => 200 and sees
   the messages (NOT 404). `GET /chat/sessions/shared` includes the session.
5. **collaborator_added bell (Sam):** Sam `GET /notifications` => `items` contains a
   `type:'collaborator_added'` notification with `sessionId` == the thread, unread. ASSERT it lands.
6. Same for Nina (the viewer also gets the notification).
7. **Viewer authz negative (Nina):** Nina `POST .../messages {content}` => expect rejection.
   ASSERT non-2xx; record actual status (predicted 404). Confirm no new message appears in
   `GET /chat/sessions/:id`.
8. **Contributor can post (Sam):** Sam `POST .../messages {content:"Sam here — what about read-replica
   lag?"}` => 202. Poll session for the agent reply.
9. **Speaker attribution:** now two humans (Devin + Sam) have posted, so attribution is active. ASSERT
   the agent's reply text references Sam / Devin by name OR addresses the asker by name (best-effort
   semantic check; record the raw reply as evidence either way).
10. **Mark-read notification probe:** does Sam posting generate any notification for Devin? `GET
    /notifications` as Devin AFTER Sam posts => expect NO new notification (report: comment/mention
    on your shared thread is silently dropped).

### Scenario B — Reactions + unread counts between two people
Narrative: After the decision, Sam reacts to Hearth's recommendation with a thumbs-up; Devin should see
the reaction and a bumped unread count for Sam's activity, but Devin's own posts must never inflate his
own unread count.
Actors: Devin (owner), Sam (contributor). Reuses Scenario A's session.

Steps + assertions:
1. Sam: `POST .../messages/:mid/reactions {emoji:'👍'}` on the agent's recommendation msg => 201.
2. Devin: `GET /chat/sessions/:id` => the target message's `reactions` array includes 👍 by Sam.
   ASSERT reaction is visible to the OTHER person (broadcast/persistence).
3. **Unread for the other person:** capture Devin's `GET /chat/sessions/unread-counts[sessionId]`
   BEFORE Sam posts a new message, then Sam posts, then re-fetch => Devin's unreadCount for that
   session INCREASES. ASSERT increment-on-other's-post.
4. **No self-inflation:** Sam `POST /chat/sessions/:id/read {lastMessageId: <latest>}` then immediately
   Sam posts a new message; Sam's `unread-counts[sessionId]` should NOT count his own post. ASSERT.
   ALSO probe the `createdBy:null` defect: after the agent replies, check whether the owner's
   unread count for HIS OWN session jumps (assistant replies have createdBy:null => counted). Record.
5. Bad emoji: `POST reactions {emoji:'zzz'}` => 400. Reaction-on-your-message notification: Devin
   `GET /notifications` after Sam's 👍 => expect NONE (report silent drop of `reaction_on_your_message`).

### Scenario C — Public read-only link to an outsider + revocation/archive defects
Narrative: Devin sends a "responses only" public link of the architecture thread to an external advisor
who has no Hearth account. Later the thread is archived; the advisor's link should die — verify whether
it actually does, and whether Devin can revoke it.
Actors: Devin (owner), an UNauthenticated outsider (no cookies/CSRF — raw fetch).

Steps + assertions:
1. Devin: `POST .../share {contentFilter:'responses'}` => 201, capture `token`.
2. **Unauthenticated fetch:** raw `GET /shared/:token` with NO cookies => 200, `data.messages` contains
   ONLY `role:'assistant'` messages (no user prompts). ASSERT filter correctness + no-auth access.
3. Create a SECOND link `{contentFilter:'prompts'}` => `GET /shared/:token2` returns ONLY `role:'user'`
   messages. ASSERT distinct filtering.
4. `{contentFilter:'all'}` link => returns both roles.
5. **Expired link:** create link with `expiresAt` in the past => `GET /shared/:token` => 404. ASSERT.
6. **Non-owner cannot share:** Sam `POST .../share` on Devin's session => expect 404 (owner-only).
   Record actual status.
7. **No revocation endpoint:** attempt `DELETE /chat/sessions/:id/share` and `DELETE /shared/:token`
   => expect 404/405 (route does not exist). REPORT as confirmed defect.
8. **Archive does not invalidate link:** Devin `DELETE /chat/sessions/:id` (archive) => 200. Then raw
   `GET /shared/:token` (the 'all' link) again => if still 200 with content, REPORT the defect with the
   before/after status + body evidence.

---

## Notification discipline matrix (the headline probe) — fill from observations
| Event triggered | Target recipient | notify() caller exists? | Bell fires in GET /notifications? |
|---|---|---|---|
| Added as collaborator | added user | YES (chat.ts) | EXPECT yes — verify |
| @mention in shared chat | mentioned user | NO caller found | EXPECT silent — verify |
| Reaction on your message | message author | NO caller found | EXPECT silent — verify |
| Comment/reply on your shared thread | thread owner | NO caller found | EXPECT silent — verify |
| Task assigned/mention to teammate | assignee | NO caller in tasks.ts | EXPECT silent — verify |
| Routine completing | owner | NO caller found | EXPECT silent — verify |

Report EVERY type as fires vs silently-dropped with the raw `GET /notifications` body as evidence.
Never fake a pass.

---

## Execution notes
- Run: `API_URL=http://localhost:8000/api/v1 ./apps/api/node_modules/.bin/tsx load/pressure/sharing-notifs.sim.ts`
  with a Bash timeout up to 600000ms; launch in background + poll if long.
- Be patient on agent polls (2.5s interval, ~150s cap, copied from the reference client).
- Keep to these 3 scenarios; reduce rather than blow the ~10 min budget. Agent replies are the slow
  part — only 2 agent round-trips are strictly needed (Scenario A steps 1 and 8).
- userId lookup: use `GET /chat/users/search?q=<name>` (confirmed route at chat.ts:622) or read ids
  from the collaborators list after adding by directory.
