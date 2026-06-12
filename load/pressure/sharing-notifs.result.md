# sharing-notifs — results (2026-06-12, live API)

Run: `API_URL=http://localhost:8000/api/v1 tsx load/pressure/sharing-notifs.sim.ts`
Actors: Devin Rao (owner), Sam Park (contributor), Nina Alvarez (viewer), unauth outsider.
Tally: **PASS=14 FAIL=2 INCONCLUSIVE=0** (16 assertions). Both FAILs are genuine product defects.

## Recipient-side sharing — all green
- A1 Sam (contributor) GETs the session (200, 2 msgs) and it appears in GET /chat/sessions/shared.
- A2 `collaborator_added` bell lands for BOTH Sam and Nina (readAt null, title "Devin Rao added you to a chat"). This is the one wired notification type and it works for viewer and contributor alike.
- A3 Viewer Nina POST /messages -> **404 "Session not found"** (not 403). Rejection works; the 404-instead-of-403 is a minor authz-shape smell, not a leak.
- A4 Contributor Sam posts -> 202, real agent reply lands.
- A5 Speaker attribution active: with two human posters the agent reply addresses "Sam" by name ("Good input, Sam — transactional locality is a real architectural win...").

## Reactions + unread
- B1 Sam's 👍 persists and Devin sees it (userIds includes Sam); disallowed emoji 🦄 -> 400.
- B2 Devin's unread for the session goes 0 -> 1 after Sam posts.
- B3 Sam's own post does not inflate Sam's own unread (0 -> 0).
- **B4 FAIL** — Owner Devin's unread for **his own session** goes 0 -> 1 after an assistant (createdBy:null) reply. The agent's own answers count as "unread" against the person who asked. Root cause: `getUnreadCounts` (chat-service.ts ~L460) `OR: [{ createdBy: null }, { createdBy: { not: userId } }]` — assistant messages always count for everyone, including the asker. Every chat with Hearth shows a perpetual unread badge on your own sessions.

## Public link + defects
- C1/C2 Filters correct, unauthenticated: responses -> all assistant; prompts -> all user; all -> both roles.
- C3 Expired link (past expiresAt) -> 404.
- C4 Non-owner (Sam, a contributor) POST /share -> 404. Share creation is owner-only — good.
- C5 No revocation endpoint: DELETE /chat/sessions/:id/share, DELETE /shared/:token, DELETE /chat/sessions/:id/share/:token all 404. Once a link is minted you cannot kill it (only expiry, set at creation).
- **C6 FAIL** — Archiving the session does NOT invalidate its public link. After `DELETE /chat/sessions/:id` returned 200, the unauthenticated `GET /shared/:token` still returned 200 with all 8 messages. Root cause: `getSharedSession` (sharing-service.ts) never checks `session.status`; it only checks token + expiresAt. Combined with C5 (no revoke), an archived/"deleted" confidential thread stays publicly readable forever.

## Notification discipline matrix (N1) — only one bell type fires
| Event triggered | Bell fired? | Evidence |
|---|---|---|
| collaborator_added | **FIRES** | A2 — lands for Sam & Nina |
| @mention in shared chat | SILENT | mention notifs 0 -> 0 after "@Sam Park ... cc @Sam Park" |
| reaction on your message | SILENT | Devin reacts 👍 to Sam's msg (201); Sam's reaction_on_your_message 0 -> 0 |
| comment/reply on your shared thread | SILENT | Sam replies on Devin's thread; Devin's comment_on_your_message 0 -> 0 |
| task assign / mention in task | SILENT | POST /tasks 201; Sam total notifs 17 -> 17. (POST /tasks has no assignee field at all.) |

`NotificationType` enum declares 6 types (collaborator_added, mention, handoff, governance_block, comment_on_your_message, reaction_on_your_message) but `notify()` has exactly ONE production caller (collaborator_added in chat.ts). All other declared types are dead — the bell is decorative for everything except being added to a chat.

Notification center plumbing itself works: POST /notifications/:id/read -> 200, POST /notifications/read-all -> 200 (updated 16).
