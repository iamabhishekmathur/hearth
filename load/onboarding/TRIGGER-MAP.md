# Hearth Onboarding TRIGGER-MAP

How each onboarding-relevant capability is **actually** triggered in production, what
side effects to assert, and when it must **NOT** fire. Built by reading `apps/api/src`
(no sims run). The golden rule: **test the trigger, not the endpoint.** Most of the
interesting capabilities are fired INDIRECTLY (an agent tool mid-chat, a BullMQ worker,
a fire-and-forget producer enqueued by the chat route). The naive "POST /decisions" path
is NOT how the feature actually fires for a real user.

Target: isolated fresh instance `http://localhost:8100/api/v1` on empty DB `hearth_onboard`.
There are NO ambient LLM keys — a brand-new company that has not even created its admin.

---

## 0. The brand-new-account cliff (read this first)

A fresh `hearth_onboard` DB has **0 users, 0 orgs, and no LLM provider registered**.
Several capabilities silently no-op or hard-fail until the org is bootstrapped:

1. **No admin/org** → setup gate (`GET /admin/setup/status` returns `needsSetup:true`).
2. **No LLM key** → `providerRegistry` has zero providers. `loadProviders()`
   (`llm/provider-loader.ts:15`) registers from `env.ANTHROPIC_API_KEY` first, then DB
   `org.settings.llm.encryptedKeys`. On `:8100` there is **no env key** (per the task),
   so until an admin POSTs `/admin/llm-config/keys`, **every agent reply, decision
   detection, cognitive extraction, decision/summary, vision call, and meeting/task LLM
   classification fails or returns empty.** This is the single biggest cliff — most of
   the map below depends on a registered provider.
3. **Worker process**: schedulers/queues only run if `worker.ts` is up. The API process
   does NOT run BullMQ workers (only `index.ts` loads providers + bootstraps integrations
   + listens). If the worker isn't running on `:8100`, every `background_worker` and
   every queue-backed `feature_side_effect` below (decision extraction from chat, cognitive
   extraction, work-intake, planning, synthesis, meeting ingestion) will **enqueue but
   never process** — a classic silent failure to probe for.

---

## 1. Org first-run setup gate

- **capability:** First-run setup gate / "needs setup" detection
- **triggerType:** direct_user
- **howTriggered:** `GET /api/v1/admin/setup/status` — `routes/admin/setup.ts:11`. Returns
  `{ needsSetup: userCount===0, hasAdmin, hasOrg }`. No auth required (it's the pre-admin gate).
- **downstreamAsserts:** On a fresh DB → `needsSetup:true, hasAdmin:false, hasOrg:false`.
  After setup/init → `needsSetup:false, hasAdmin:true, hasOrg:true`.
- **negativeCases:** Must NOT report `needsSetup:true` once any user exists. Must NOT require auth.

## 2. Admin + org creation (first-run init)

- **capability:** Create the first admin user + default org/team
- **triggerType:** direct_user
- **howTriggered:** `POST /api/v1/admin/setup/init {email,password,name,orgName?}` —
  `routes/admin/setup.ts:31`, which calls `authService.register()` (`services/auth-service.ts:17`).
  Because `userCount===0`, `register()` upserts org slug `default` ("Default Organization"),
  creates "Default Team", and creates the user with **role `admin`**. If `orgName` given, the
  org name+slug are updated (`setup.ts:56`).
- **downstreamAsserts:** A `User(role=admin)` exists; an `Org` and `Team` exist; the user is
  linked to the team (`teamId` set). Login then works. `GET /auth/me` after login resolves
  `orgId` non-null (orgId comes from `user.team.orgId`, `middleware/auth.ts:94`).
- **negativeCases:** A 2nd call to `/admin/setup/init` must return **400 "Setup already completed"**
  (`setup.ts:35`). The first user is admin; **the SECOND user (via `/auth/register`) must be role
  `member`, not admin** (`auth-service.ts:64`) — assert this, it's an onboarding trap.

## 3. User signup / role assignment

- **capability:** Self-serve user registration + role assignment
- **triggerType:** direct_user
- **howTriggered:** `POST /api/v1/auth/register {email,password,name}` — `routes/auth.ts:84` →
  `authService.register()`. First-ever user → admin + new org/team. Every subsequent user →
  role `member`, assigned to `prisma.team.findFirst()` (the FIRST team in the WHOLE DB,
  `auth-service.ts:64`). OAuth path: `findOrCreateOAuthUser` (`auth-service.ts:100`), SSO JIT:
  `POST /auth/sso/callback` (`routes/auth.ts:203`).
- **downstreamAsserts:** New member's `GET /auth/me` shows `role:"member"`, `orgId` = the
  bootstrap org. A session cookie + CSRF cookie are set on register/login.
- **negativeCases:** Duplicate email → **409** (`routes/auth.ts:106`). A member must NOT receive
  admin role. NOTE (cliff): `register()` does multi-tenancy by "first team in DB" — there is no
  org-scoped invite flow in OSS, so any registrant lands in the single bootstrap org. A user with
  `teamId:null` hits **400 "No organization"** on `requireOrg` routes (`middleware/auth.ts:150`).

## 4. LLM provider availability (the key gate)

- **capability:** Make an LLM provider available org-wide (unblocks the agent)
- **triggerType:** direct_user (admin) → feature_side_effect (hot reload of registry)
- **howTriggered:** `POST /api/v1/admin/llm-config/keys {provider,apiKey}` (admin only) —
  `routes/admin/llm-config.ts:152`. AES-256-GCM-encrypts the key into
  `org.settings.llm.encryptedKeys[provider]`, then calls `loadProviders()` (`provider-loader.ts:15`)
  to **hot-register** the provider in the live `providerRegistry`. Default provider/model set via
  `PUT /admin/llm-config` (`llm-config.ts:59`, also calls `loadProviders()`).
  Status read: `GET /admin/llm-config/providers` (`llm-config.ts:96`) — `configured:true` when a
  DB or env key exists.
- **downstreamAsserts:** Before key: `GET /admin/llm-config/providers` shows
  `anthropic.configured:false, keySource:null`. After POST /keys: `configured:true, keySource:"db"`.
  THEN a chat message produces a real assistant reply (proves the registry is live). Use the real
  key from `/Users/abhishek/projects/hearth/.env` (never print it).
- **negativeCases:** Invalid provider → 400 (`llm-config.ts:156`). Non-admin → 403
  (`requireRole('admin')`). BEFORE a key is configured, a chat send still returns 202 but the agent
  loop emits an `error` event and persists an assistant message like `_[Error: ...]_`
  (`routes/chat.ts:1048`) — assert that an unconfigured org produces an **error-shaped** assistant
  message, not a silent hang. `/admin/setup/test-llm` (`setup.ts:85`) can validate a key WITHOUT
  saving — it does NOT register the provider, so a "connected:true" there does NOT mean chat works.

## 5. First agent reply (the core indirect path)

- **capability:** Agent generates a reply to a user chat message
- **triggerType:** direct_user → feature_side_effect (async agent loop)
- **howTriggered:** `POST /api/v1/chat/sessions/:id/messages {content}` — `routes/chat.ts:169`.
  Returns **202** immediately with `{messageId}`, then fires `runAgent()` (`chat.ts:296`,
  defined `chat.ts:886`) fire-and-forget. `runAgent` → `buildAgentContext` → `agentLoop`
  (`agent/agent-runtime.ts:34`) which streams from `providerRegistry.chatWithFallback` and runs
  the tool loop (MAX 25 iterations). Final assistant text is persisted via
  `chatService.addMessage(role:'assistant')` in the `finally` block (`chat.ts:1055`).
  Must first `POST /chat/sessions` (`chat.ts:27`, requires `requireOrg`).
- **downstreamAsserts:** Send returns 202. Poll `GET /chat/sessions/:id` until an `assistant`
  message appears. Assert non-empty content and no `metadata.error`. WS events stream via
  socket but the REST GET is the DB-observable assertion.
- **negativeCases:** No `content` → 400. No write access → 404. Org with **block governance policy**
  matching the content → **403 and the user message is NOT persisted** (`chat.ts:224`). With no LLM
  provider → assistant message carries `metadata.error` (see §4). Tool-role messages are filtered
  out of replayed history (`chat.ts:950`).

## 6. Decision capture — agent tool (mid-chat)

- **capability:** Capture an org decision into the decision graph
- **triggerType:** agent_tool_call
- **howTriggered:** The agent calls the **`capture_decision`** tool DURING a chat when it detects a
  stated decision — `agent/tool-router.ts:1417` → `decision-service.createDecision(... source:'chat',
  sessionId)`. This is NOT `POST /decisions`. To trigger: send a conversation where a real decision
  is clearly made (e.g. "We've decided to standardize on PostgreSQL over MongoDB because X").
- **downstreamAsserts:** After the agent turn, `GET /api/v1/decisions` (decisions route) shows a new
  decision row with the title/reasoning, `source:"chat"`, `sourceRef.sessionId` = the session.
- **negativeCases:** A genuine **debate with no resolution** ("should we use Postgres or Mongo? not
  sure yet") must produce NO decision — the agent should not call `capture_decision`, and the
  regex/LLM detector path (§7) `fastFilter` explicitly rejects "haven't decided / need to decide /
  what did we decide" (`services/decision-detector.ts:26`).

## 7. Decision capture — background extraction (the OTHER path)

- **capability:** Auto-extract an emergent decision from a chat session without a tool call
- **triggerType:** feature_side_effect → background_worker
- **howTriggered:** TWO-STAGE and easy to miss. (a) The chat route, after dispatching the agent,
  **enqueues** a `chat_session` job on `decisionExtractionQueue` with `jobId
  decision-extract-<sessionId>`, **delay 8000ms** (`routes/chat.ts:306`). (b) The **worker**
  (`jobs/decision-extraction-scheduler.ts:24`, registered in `worker.ts:88`) reads the last ≤50
  user/assistant messages, runs `detectDecision` (regex fast-filter then Haiku classify,
  `services/decision-detector.ts:99`), then `extractDecision`, then `createDecision(source:'chat')`.
  Confidence ≥0.85 → status `active`; else `draft` + `decision:suggestion` WS event
  (`scheduler.ts:82,102`).
- **downstreamAsserts:** ~8s+ after a decision-bearing chat (worker MUST be running, LLM MUST be
  configured), a decision row appears via `GET /decisions` even if the agent never called the tool.
  Low-confidence ones are `draft`.
- **negativeCases:** Session with <3 messages → worker returns early, NO decision (`scheduler.ts:64`).
  `fastFilter` false (no decision language) → NO Haiku call, NO decision. If the worker process is
  down, the job sits in Redis and NOTHING is created — a silent failure to detect.

## 8. Memory store — agent tool (mid-chat)

- **capability:** Persist a user-layer memory the agent can recall later
- **triggerType:** agent_tool_call
- **howTriggered:** Agent calls **`save_memory`** (`agent/tool-router.ts:324`) →
  `memory-service.createMemory({layer:'user', ...})`. Fired when the user says "remember that ..."
  or states a durable preference. (`session_note` tool, `tool-router.ts:363`, is the ephemeral 24h
  variant; `recall_memory` reads it back, `tool-router.ts:396`.) NOT `POST /memory`.
- **downstreamAsserts:** After "remember I prefer X", the memory exists (REST `GET /memory`), AND a
  **LATER, separate** chat ("what do I prefer?") retrieves it — the context-builder/`recall_memory`
  injects it and the agent answers with X. Assert the full round-trip, not just the write.
- **negativeCases:** A plain **question** ("what's the weather?") must store NO memory. Ephemeral
  `session_note` must NOT appear as a permanent user-layer memory and must carry a 24h `expiresAt`
  (`tool-router.ts:389`).

## 9. Task creation from conversation (3 distinct real triggers)

- **capability:** Turn a conversation into a Kanban task
- **triggerType:** agent_tool_call AND direct_user
- **howTriggered:** THREE real paths, none of which is "POST /tasks":
  1. **Explicit:** agent calls **`create_task`** when the user clearly asks ("add a task to…") —
     `tool-router.ts:637` → `chatService.promoteMessageToTask(provenance:'agent_create')`.
  2. **Speculative:** agent calls **`propose_task`** (`tool-router.ts:727`) → creates a
     `TaskSuggestion(status:'pending')` + `task:suggested` WS event. The user then accepts via
     `POST /api/v1/task-suggestions/:id/accept` (`routes/task-suggestions.ts:30`) which calls
     `promoteMessageToTask(provenance:'agent_propose_accepted')`.
  3. **Manual:** `POST /api/v1/chat/sessions/:sid/messages/:mid/promote-to-task`
     (`routes/chat.ts:552`, provenance `chat_button`).
  All paths set `targetStatus:'planning'` → `enqueuePlanning()` (planner worker) auto-progresses;
  `'backlog'` just stashes.
- **downstreamAsserts:** After path 1/3 → `GET /api/v1/tasks` shows the task with
  `sourceSessionId`/`sourceMessageId` set and a `chat_excerpt` context item (`chat-service.ts:697`).
  After path 2 → first `GET /task-suggestions` shows a `pending` suggestion; only after `/accept`
  does the task exist (suggestion → `accepted`, `acceptedTaskId` set).
- **negativeCases:** `propose_task` must NOT itself create a Task (only a suggestion) — assert no
  task until accept. `promoteMessageToTask` is idempotent per (messageId,user): a 2nd accept/promote
  returns `existing:true` and creates no duplicate (`chat-service.ts:671`).

## 9b. Work-intake → auto-detected task (external trigger)

- **capability:** Inbound Slack/email message auto-becomes a task
- **triggerType:** cross_service_event → background_worker
- **howTriggered:** Slack webhook / intake enqueues onto `workIntakeQueue`
  (`enqueueSlackMessage`, `jobs/work-intake-scheduler.ts:89`); the worker (`scheduler.ts:31`,
  registered `worker.ts:60`) calls `task-detector.detectAndCreateTask` which LLM-classifies
  actionability (with a regex skip pre-filter, `task-detector.ts:64`) and creates a task with
  status **`auto_detected`** + Person/Edge graph upsert. Email poll path is a stub (returns
  "not yet implemented", `scheduler.ts:67`).
- **downstreamAsserts:** An actionable inbound message → a `Task(status:'auto_detected')`. The user
  can dismiss false positives via `POST /api/v1/intake/dismiss/:taskId` (`routes/intake.ts:12`,
  which only accepts `auto_detected` tasks → archives).
- **negativeCases:** "thanks 👍", "gm", or <10-char messages → `isObviouslyNotActionable` true →
  NO LLM call, NO task (`task-detector.ts:76`). Dedup (`intake-deduplicator`) prevents a duplicate
  task for the same messageId. Dismiss on a non-`auto_detected` task → 422.

## 10. Cognitive-profile build (gated + worker)

- **capability:** Build a per-user cognitive profile from conversations
- **triggerType:** feature_side_effect (per-session enqueue) + background_worker (daily rebuild)
- **howTriggered:** DOUBLE-GATED. First, an admin must enable it org-wide:
  `PUT /api/v1/admin/cognitive/settings {enabled:true}` (`routes/admin/cognitive.ts:36`). Then a
  user must opt in: `PUT /api/v1/chat/cognitive-profile/status {enabled:true}` (`routes/chat.ts:742`).
  Only then, after each agent turn, `runAgent`'s finally block checks `isCognitiveEnabledForOrg`
  and `enqueueCognitiveExtraction` (`routes/chat.ts:1139`) → cognitive-extraction worker
  (`jobs/cognitive-extraction-scheduler.ts:30`, registered `worker.ts:79`) →
  `extractCognitivePatterns`. A daily 3am rebuild also runs (`scheduler.ts:64`).
- **downstreamAsserts:** With BOTH gates on, after a few substantive chat turns, the cognitive
  profile/patterns populate (read via admin cognitive endpoints / profile read). Requires
  ≥3 message turns (`cognitive-profile-service.ts:13`).
- **negativeCases:** Org gate OFF → no enqueue at all (the `runAgent` check short-circuits).
  Org ON but user opted OUT → `PUT /chat/cognitive-profile/status` is the only opt-in; without it,
  no extraction. `PUT /chat/cognitive-profile/status` while org disabled → 400 (`chat.ts:751`).
  This is a textbook "trigger that never fires" for a fresh org (default `enabled:false`).

## 11. Memory synthesis (daily worker, NOT on signup)

- **capability:** Consolidate/synthesize a user's memories
- **triggerType:** background_worker
- **howTriggered:** `synthesis-scheduler.ts` registers a **repeatable 24h** `daily-synthesis-trigger`
  (`scheduleDailySynthesis`, `jobs/synthesis-scheduler.ts:53`); on completion it `enqueueAllUsers`
  (`worker.ts:30`) which fans out `synthesize-user` jobs per user with `teamId != null`
  (`synthesis-scheduler.ts:75`) → `synthesizeForUser`. This is a DAILY job — it does **NOT** fire on
  signup or per chat.
- **downstreamAsserts:** To assert in a sim you must enqueue/trigger it directly via the worker
  (it won't happen on its own within a test window). Synthesized/consolidated memories appear in
  `GET /memory`.
- **negativeCases:** A brand-new user who just signed up has NOTHING synthesized — do not expect
  synthesis as part of onboarding. Users with `teamId:null` are excluded from the fan-out
  (`synthesis-scheduler.ts:76`).

## 12. Notifications (spine, fired by collaboration side-effects)

- **capability:** In-app notification persisted + pushed to a user
- **triggerType:** feature_side_effect
- **howTriggered:** `notification-service.notify()` (`services/notification-service.ts:28`) is called
  as a side effect of real collaboration actions, NOT a direct POST. Triggers: adding a collaborator
  (`routes/chat.ts:510`, type `collaborator_added`), an **@mention** in a chat message
  (`chat.ts:806 notifyMentions`, type `mention`), a **reaction** on your message
  (`chat.ts:768`, type `reaction_on_your_message`). Each persists a `Notification` row + emits
  `notification:new` WS.
- **downstreamAsserts:** After user A @mentions user B (both participants in the session) → user B's
  `GET /api/v1/notifications` shows a `mention` row; unread count increments. Same for adding a
  collaborator / reacting.
- **negativeCases:** **Self-mention / self-reaction → NO notification** (`chat.ts:781`, `chat.ts:819`
  deletes the author from recipients). Mentioning a NON-participant → NO notification (names resolve
  only against session participants, `chat.ts:818`). Reaction on an assistant/system message
  (null `createdBy`) → NO notification (`chat.ts:780`).

## 13. Activity feed (derived from audit logs)

- **capability:** Org activity feed
- **triggerType:** feature_side_effect
- **howTriggered:** The feed is a **projection of `AuditLog`** rows, not its own write. `getFeed`
  (`services/activity-feed-service.ts:27`) filters audit logs to `FEED_WORTHY_ACTIONS`. Audit rows
  are written by `audit-service.logAudit` from real mutations (decision create, etc.). Read via
  `GET /api/v1/activity`.
- **downstreamAsserts:** After performing feed-worthy actions (e.g. capture a decision), the actor's
  activity appears in `GET /activity`. Empty on a brand-new org with no actions.
- **negativeCases:** Actions not in `FEED_WORTHY_ACTIONS` don't surface. Cross-org rows never appear
  (query is `orgId`-scoped). A fresh org's feed is **empty** — assert that, don't expect seeded rows.

## 14. Recommendations / signals (on-demand compute)

- **capability:** Skill recommendations + proactive signals
- **triggerType:** direct_user (on-demand compute)
- **howTriggered:** `GET /api/v1/recommendations/skills` → `sherpa-service.getRecommendations`
  (`routes/recommendations.ts:10`). Proactive signals are computed on demand by
  `proactive-signal-service.computeSignals` (`services/proactive-signal-service.ts:9`): stale
  routines (enabled, no run 7d+), idle tasks (planning/executing, no activity 3d+), trending skills,
  stale decisions. Computed live, cached at the route layer.
- **downstreamAsserts:** On a fresh org these are **mostly empty** (no routines/tasks/decisions yet).
  To make a signal appear you must first create the underlying entity AND age it (or the time
  thresholds won't be met) — e.g. an idle-task signal needs a planning/executing task untouched 3+
  days, which a fresh sim cannot age naturally.
- **negativeCases:** No org → 400 (`recommendations.ts:13`). Fresh org → empty signals (assert the
  EMPTY state, not populated). A task touched <3 days ago must NOT be an `idle_task` signal
  (`proactive-signal-service.ts:67`).

## 15. Integration connect (admin) → MCP tools become agent tools

- **capability:** Connect an external integration; its MCP tools join the agent toolset
- **triggerType:** direct_user (admin) → feature_side_effect
- **howTriggered:** `POST /api/v1/admin/integrations {provider,credentials,...}` (admin only) —
  `routes/admin/integrations.ts:32` → `integration-service.connectIntegration` (encrypts creds,
  stores config). The MCP gateway connects; at chat time `createToolRouter` enumerates
  `mcpGateway.getConnectedIntegrations()` and registers each tool as an agent tool
  (`agent/tool-router.ts:1782`). `bootstrapIntegrations()` (`mcp/bootstrap.ts`, called in
  `index.ts:186` and `worker.ts:48`) reconnects stored integrations on startup.
- **downstreamAsserts:** After connect, `GET /api/v1/chat/integrations/active` (`routes/chat.ts:711`)
  lists the integration id; a subsequent agent turn can call its `mcp__provider__*` tools, and a
  WRITE-verb MCP tool emits a `side_effect` event (`agent-runtime.ts:174`).
- **negativeCases:** Non-admin → 403. A failed/unconnected integration: `createToolRouter` catches
  per-integration `listTools` errors and just logs (`tool-router.ts:1798`) — the agent simply lacks
  those tools (no hard failure). Cross-org integration id on PATCH/DELETE → 404 (`integrations.ts:77`).

## 16. Meeting ingestion → decision extraction (cross path)

- **capability:** Ingest a meeting transcript and extract decisions from it
- **triggerType:** direct_user → background_worker
- **howTriggered:** `POST /api/v1/meetings/ingest {title,transcript,...}` (`routes/meetings.ts:21`)
  creates a `MeetingIngestion` row and, IF a transcript is present, enqueues a `meeting_ingestion`
  job on `decisionExtractionQueue` (`meetings.ts:46`) → worker `processMeetingIngestion`
  (`decision-extraction-scheduler.ts:31`).
- **downstreamAsserts:** With a transcript containing a real decision (worker up + LLM configured),
  a decision row appears tied to the meeting. `GET /meetings` lists the ingestion.
- **negativeCases:** No `transcript` → row created but **NO extraction job enqueued**
  (`meetings.ts:45`) — assert no decision is produced. No `title` → 400.

---

## Quick dependency cheat-sheet (what blocks what)

| Capability | Hard prereq | Silent-failure mode if prereq missing |
|---|---|---|
| First agent reply (§5) | admin+org (§2), LLM key (§4) | 202 then assistant msg with `metadata.error` |
| capture_decision tool (§6) | LLM key | agent can't run, no tool call |
| decision extraction worker (§7) | worker process + LLM key | job queued in Redis, never processed |
| save/recall memory (§8) | LLM key (for embeddings/agent) | falls back to text search; agent can't run w/o key |
| task from chat (§9) | admin+org+LLM (for agent paths) | manual promote path works w/o LLM |
| work-intake task (§9b) | worker + LLM | job queued, never processed |
| cognitive build (§10) | org gate ON + user opt-in + worker + LLM | no enqueue at all (most common: gate OFF) |
| synthesis (§11) | worker (daily) | never fires in a short sim window |
| meeting decisions (§16) | transcript present + worker + LLM | no job enqueued w/o transcript |
