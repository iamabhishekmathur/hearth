# Pressure test plan — Task lifecycle (chat → task → plan → execute → review)

Key: `tasks`. Everything below is driven against the LIVE stack
(`API_URL=http://localhost:8000/api/v1`) with REAL agent workers. No mocking.
Sim file: `load/pressure/tasks.sim.ts`.

## What we are actually testing (and why the existing sims are fake)

The existing sims type "create a task for me" into chat and *hope* the agent
calls a tool. That is non-deterministic and tests the LLM's tool-choosing, not
the product. The real product flows are explicit REST surfaces:

1. **Explicit promote** — `POST /chat/sessions/:sid/messages/:mid/promote-to-task`
   (the "+ Task" chip button under a chat message).
2. **Agent-proposed suggestion** — agent emits a `TaskSuggestion` row, user
   accepts via `POST /task-suggestions/:id/accept`.

Both converge on `chatService.promoteMessageToTask`, which:
- creates a `Task` with `sourceSessionId` / `sourceMessageId` / `sourceRef`,
- attaches a `chat_excerpt` context item with a `deepLink`
  (`/chat/:sid?messageId=:mid`),
- appends the new taskId to the originating message's `producedTaskIds`,
- posts a `started` `task_progress` milestone into chat **only when
  targetStatus = 'planning'**.

Then the worker chain runs the state machine for real.

## Confirmed endpoints + shapes (read from source)

Auth: `POST /auth/login {email,password:'changeme'}` → sets `hearth.csrf`
cookie; echo it as `x-csrf-token` on every non-GET (double-submit). Copy the
Hearth client class from `load/simulate-llm-dialogue.ts`.

Chat:
- `POST /chat/sessions {title}` → `{data:{id}}`.
- `POST /chat/sessions/:sid/messages {content}` → `202` (async; agent replies later).
- `GET /chat/sessions/:sid` → `{data:{messages:[{id,role,content,metadata,producedTaskIds}]}}`.
  - `role` is one of `user|assistant|system`. `task_progress` milestones are
    `role:'system'` rows with `metadata.kind === 'task_progress'`,
    `metadata.milestone`, `metadata.taskId`, `metadata.taskTitle`,
    `metadata.taskStatus`.
  - `producedTaskIds` is a string[] on the **originating** message.

Promote (explicit):
- `POST /chat/sessions/:sid/messages/:mid/promote-to-task`
  body `{title?, description?, attachMessageIds?, attachRecentN?, targetStatus:'backlog'|'planning', priority?, provenance?}`.
  - `targetStatus` defaults to `'backlog'`; `attachRecentN` defaults to 4;
    `provenance` defaults to `'chat_button'`.
  - Response `201` (new) or `200` (idempotent existing) → `{data:{...task, ...}}`.
  - If `targetStatus==='planning'` AND new → enqueues planner immediately.
  - **Idempotency is per (sourceMessageId, userId)**: a second promote of the
    same message by the same user returns the SAME task with `existing:true`
    and `200`.

Suggestions:
- `GET /task-suggestions?status=pending` → `{data:[{id,sessionId,messageId,proposedTitle,proposedDescription,suggestedContextMessageIds,status}]}`.
- `POST /task-suggestions/:id/accept` body `{targetStatus?:'backlog'|'planning', title?, description?}`
  → `201 {data:{suggestionId, task}}`. Sets suggestion `status:'accepted'`,
  `acceptedTaskId`. Source becomes `agent_proposed`, provenance
  `agent_propose_accepted`. NOTE: there is no REST endpoint to *create* a
  suggestion — the agent worker writes the `TaskSuggestion` row. We discover
  whether suggestions appear by polling `GET /task-suggestions` after a chat
  turn that strongly invites one; if none appear within budget, we REPORT that
  and fall back to explicit promote (we do NOT fake it).
- `POST /task-suggestions/:id/dismiss` → marks `dismissed`.

Tasks:
- `GET /tasks/:id` → `{data:{...task, subTasks, executionSteps, comments,
  reviews, contextItems, sourceSession}}`.
- `GET /tasks/:id/steps` → `{data:[{id,description,phase,status,toolUsed,
  input,output,durationMs,createdAt}]}`.
- `GET /tasks/:id/context-items` → `{data:[{id,type,label,deepLink,
  extractedText,extractedTitle,...}]}`. The chat slice is `type:'chat_excerpt'`,
  `label:'From chat'`, `deepLink:'/chat/:sid?messageId=:mid'`.
- `GET /tasks/:id/reviews` → `{data:[{id,decision,feedback,reviewer}]}`.
- `PATCH /tasks/:id {status}` → drives the state machine. Returns `422` with
  `{error:'Invalid status transition ...'}` on illegal edges.
  - `status:'planning'` (from backlog) → enqueues planner.
  - `status:'executing'` (direct) → enqueues executor.
- `POST /tasks/:id/reviews {decision, feedback}` — only valid when task is in
  `review` (else `422`). `decision:'approved'` → task → `done`.
  `decision:'changes_requested'` (feedback REQUIRED, else `400`) → task →
  `planning`, stores `context.reviewFeedback`, re-enqueues planner with feedback.
- `POST /tasks/:id/replan {feedback}` — works from `planning` or `executing`.

State machine (`VALID_STATUS_TRANSITIONS`, from packages/shared):
```
auto_detected → backlog, archived
backlog       → planning, archived
planning      → backlog, executing, archived
executing     → review, failed, archived, planning
review        → planning, executing, done, archived
done          → archived
failed        → backlog, planning, archived
```

Worker chain (confirmed in task-planner.ts / task-executor.ts):
- planner: adds a `phase:'planning'` step, calls the real agent to decompose,
  creates subtasks (`createSubtask`), completes the planning step with
  `durationMs`, then **auto-advances planning → executing** (no manual PATCH),
  posts `executing` milestone to source chat, enqueues executor.
- executor: adds `phase:'execution'` step `Executing: <title>`, runs the agent
  loop; **each tool call** becomes its own step row with `toolUsed`, `input`,
  `durationMs`; stores `agentOutput`; moves executing → `review`; posts
  `review` milestone to source chat.

## Pre-flagged gap to verify (do NOT assume — confirm with evidence)

`postTaskProgress` supports a `'done'` milestone, but grep shows **no caller
ever posts it**. The review-approve path in `routes/tasks.ts` moves the task to
`done` but does NOT post a `done` milestone back to chat. Assertion A6 below
EXPECTS a `done` milestone (matching the task's stated "started/executing/
review/done" contract); if it never appears, REPORT it as a product gap with
evidence (the chat thread shows started→executing→review but no done card even
though the task reached `done`).

Also verify: an *executing*-initiated review milestone — the planner only posts
the `executing` milestone and the chat `started` milestone is only posted when
the original promote used `targetStatus:'planning'`. A `backlog`-first promote
that is later PATCHed to `planning` will NOT have a `started` chat card — verify
which milestones actually land for each path.

---

## Scenario 1 — Dev drives an incident fix to DONE (happy path, planning route)

**Narrative.** Sam Park (dev1) is in a chat thread debugging a 500-spike
incident with Hearth. They land on a concrete fix ("add a null-guard + retry
around the payments webhook handler"). Sam clicks "+ Task" on that message and
sends it straight to planning so the agent decomposes and executes it, then Sam
reviews and approves.

**Actors:** Sam Park (dev1@hearth.local).

**Steps:**
1. Login dev1. Create chat session "Incident: payments 500 spike".
2. Send 2–3 real user turns describing the incident; wait for Hearth's real
   replies (poll assistant messages). Capture the messageId of the user turn
   that states the concrete fix.
3. `POST .../promote-to-task` on that messageId with
   `{title:'Add null-guard + retry to payments webhook handler',
   targetStatus:'planning', attachRecentN:4, provenance:'chat_button'}`.
4. Poll `GET /tasks/:id` until `status` reaches `review` (planner →
   auto-executing → executor → review). Budget ~3–4 min.
5. `POST /tasks/:id/reviews {decision:'approved'}`.

**REST-observable assertions:**
- A1 promote returns `201`; `GET /chat/sessions/:sid` shows the originating
  message's `producedTaskIds` contains the new taskId (the chat "chip").
- A2 `GET /tasks/:id/context-items` has a `type:'chat_excerpt'` item,
  `label:'From chat'`, `deepLink === '/chat/:sid?messageId=:mid'` for the exact
  originating message.
- A3 `GET /tasks/:id` `subTasks.length >= 1` (planner decomposed). REPORT if 0.
- A4 `GET /tasks/:id/steps` has a `phase:'planning'` step (`status:'completed'`,
  `durationMs` numeric) AND `phase:'execution'` step(s); at least one execution
  step has a non-null `toolUsed` OR (REPORT if the agent used zero tools, which
  is allowed but means `toolUsed` coverage is unproven).
- A5 status auto-advanced `planning → executing` with NO manual PATCH — we only
  ever promoted; we never PATCH before review. Evidence: task reaches `review`
  on its own.
- A6 chat thread (`role:'system'`, `metadata.kind:'task_progress'`) accumulates
  milestones `started` (from planning-route promote), `executing`, `review`,
  and — per the contract — `done` after approval. EXPECT all four; if `done`
  is missing, REPORT the gap with the milestone list actually observed.
- A7 after approve, `GET /tasks/:id` `status === 'done'`;
  `GET /tasks/:id/reviews` has one `decision:'approved'` row.

## Scenario 2 — PM uses the changes_requested loop (review → planning re-plan)

**Narrative.** Dana Lewis (product-lead) promotes a launch step ("Draft the GA
announcement blog post") from a planning chat. The agent executes and parks it
in review. Dana isn't happy — too marketing-heavy — and requests changes with
specific feedback. The task must loop back to planning and re-decompose using
that feedback, then reach review again, and Dana approves the second pass.

**Actors:** Dana Lewis (product-lead@hearth.local).

**Steps:**
1. Login product-lead. New session "GA launch prep". Send a couple of real
   turns about launch tasks; capture the messageId naming the blog post.
2. Promote with `targetStatus:'planning'`. Poll to `review`.
3. `POST /tasks/:id/reviews {decision:'changes_requested',
   feedback:'Too marketing-heavy. Make it developer-focused: lead with the API,
   include a code sample, cut the hype.'}`.
4. Assert task → `planning` and re-plans. Poll back to `review` (second pass).
5. `POST /tasks/:id/reviews {decision:'approved'}`. Assert `done`.

**REST-observable assertions:**
- B1 `changes_requested` with feedback returns `201`; immediately after,
  `GET /tasks/:id` `status === 'planning'` (review → planning edge).
- B2 `GET /tasks/:id` `context.reviewFeedback` equals the submitted feedback
  string (persisted for the re-plan).
- B3 `changes_requested` with EMPTY feedback returns `400` (validation) — quick
  negative check before B1.
- B4 task re-reaches `review` after the loop (re-plan + re-execute ran). Steps
  list grows: a SECOND `phase:'planning'` step appears (the re-plan round).
- B5 second `POST /reviews {decision:'approved'}` → `status === 'done'`;
  `GET /tasks/:id/reviews` now has 2 rows (`changes_requested` then `approved`),
  ordered by createdAt.
- B6 chat milestones reflect at least two `executing`/`review` cycles OR the
  milestone idempotency suppresses duplicates — observe and REPORT actual
  behavior (postTaskProgress is idempotent per (session,task,milestone), so the
  second review milestone may be deduped; capture which it is).

## Scenario 3 — Idempotency + illegal transitions (guard rails)

**Narrative.** Jordan Lee (dev2) double-clicks the "+ Task" chip (common UI
reality), and later a script tries to shove a fresh backlog task straight to
`done`. The system must be idempotent on the double-promote and must reject
illegal state jumps.

**Actors:** Jordan Lee (dev2@hearth.local).

**Steps:**
1. Login dev2. New session, one user message. Capture its messageId.
2. Promote that message twice (same user, `targetStatus:'backlog'`).
3. Create a vanilla task via `POST /tasks {title, source:'manual'}` in backlog.
4. Attempt illegal `PATCH /tasks/:id {status:'done'}` (backlog → done not allowed).
5. Attempt legal `PATCH /tasks/:id {status:'planning'}` then `{status:'backlog'}`
   (planning → backlog is allowed) to confirm the legal edge works.

**REST-observable assertions:**
- C1 first promote → `201`, second promote (same message+user) → `200` with
  `existing:true` and the SAME taskId. `producedTaskIds` contains that taskId
  exactly once (no duplicate append). REPORT if it appears twice.
- C2 illegal `PATCH {status:'done'}` from backlog → `422` with body
  `{error:/Invalid status transition/}`. REPORT if it succeeds (2xx).
- C3 `GET /tasks/:id/context-items` for the double-promoted task has exactly ONE
  `chat_excerpt` item (deepLink idempotency held), not two.
- C4 legal `PATCH {status:'planning'}` → `200`; subsequent `{status:'backlog'}`
  → `200` (confirms the planning→backlog edge is reachable and the guard isn't
  over-broad).

---

## Execution notes
- Budget ~10 min wall. Scenarios 1 and 2 each spend ~3–4 min on worker polls;
  Scenario 3 is fast (no worker waits except the optional backlog promote).
- Poll cadence: 2.5–3 s, with per-phase caps (planning→review up to ~210 s).
  If a task is stuck in `planning`/`executing` past cap, snapshot
  `GET /tasks/:id` + `/steps` and REPORT (planner/executor failure → task may
  flip to `backlog`/`failed` with an agent error comment).
- Never assert a pass on a timeout. A no-reply / no-advance is a finding.
- For the suggestion path (mentioned for completeness): poll
  `GET /task-suggestions?status=pending` once after a strongly-inviting chat
  turn; if empty within ~60 s, REPORT "no agent suggestion emitted" and rely on
  explicit promote — do not fabricate a suggestion row.
