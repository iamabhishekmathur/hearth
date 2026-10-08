# Adapting opencode / openchamber Patterns into Hearth

**Status:** Draft spec for review · **Owner:** Abhishek · **Date:** 2026-10-08
**Branch target:** new `feat/agent-loop-modernization` off `main`

---

## 1. Intent & Non‑Negotiables

We are **not** turning Hearth into a coding agent. We are porting a small set of
opencode/openchamber **agent-loop and chat-interaction mechanics** that are
objectively better than Hearth's, while preserving everything Hearth does that
those tools cannot.

### Must‑keep (regression guardrails — any change that degrades these is rejected)
- **Multiplayer chat**: presence, typing/composing indicators, message
  attribution (`Priya: …`), emoji reactions, joinable org-visible sessions,
  collaborators. (`apps/web/src/hooks/use-chat.ts`, `apps/api/src/ws/socket-manager.js`)
- **Artifacts + version history** (`artifact-panel.tsx`, `artifact-service.ts`).
- **Citations / memory surfacing** — `[n]` source badges, dev memory debug panel,
  rolling summarization (`message-bubble.tsx`, `system-prompt.ts`).
- **Cognitive queries** (`@teammate` decision/memory profile) (`cognitive-profile-service.ts`).
- **Governance**: routine approval gates, compliance packs, audit logging
  (`approval-service.ts`, `compliance/provider-wrapper.ts`, `audit-service.ts`).
- **Self-host / air-gapped operation** — no change may introduce a hard runtime
  dependency on a public network call.

### What we are adopting (from the two analyses)
| ID | Workstream | Source pattern | Fixes / replaces in Hearth |
|----|-----------|----------------|-----------------------------|
| **W1** | Provider layer on models.dev + Vercel AI SDK | opencode model catalog | Hand-rolled providers; silent `claude-haiku-4-5` → gpt-4o fallback bug |
| **W2** | Interruptible / steerable agent loop + doom-loop + graceful degradation | opencode + Claude Code | Input locked during stream; no stop; orphaned server loops; the existing `agent-runtime.ts` TODO backlog |
| **W3** | Per-tool permission policy (allow/ask/deny + pattern match) | opencode permission system | No interactive tool gate for chat agent |
| **W4** | Plan → Build mode (read-only planning agent) | opencode Plan/Build | No pre-execution approval in chat |
| **W5** | In-chat model picker | opencode / openchamber | `DEFAULT_MODEL` hardcoded; UI never sends `model`/`providerId` |
| **W6** | Extensible slash commands → Skills | opencode custom commands | Only `/task` exists |

Explicitly **not** adopting: LSP, TUI/ghostty, SQLite session store, Pierre diff
viewer, worktree multi-run, Bun runtime. (See the prior analysis.)

---

## 2. Guiding principles for coexistence

1. **Adapt behind existing interfaces.** W1 lands as a new `LLMProvider`
   implementation, not a rewrite — `provider-registry.ts`, `tool-router.ts`,
   `compliance/provider-wrapper.ts`, and `agentLoop()` signatures stay stable.
2. **Two layers of control, not one.** opencode's interactive permission prompts
   (W3) sit *below* Hearth's durable routine approval gates. Chat asks are
   ephemeral (WS + in-memory); routine approvals stay durable (`approval_requests`).
3. **Modes are "agents," agents are data.** Plan/Build (W4) are seeded rows in an
   `agent_profiles` concept reusing `agent_identities`/`role_templates`, which also
   becomes the substrate for custom commands (W6).
4. **Every new surface is feature-flagged** per-org (`org.settings.features.*`) so
   we can dark-launch and A/B against the multiplayer regression suite.
5. **Offline-first.** models.dev is fetched-and-cached with a **bundled static
   snapshot** committed to the repo as the fallback.

---

## 3. Workstreams

### W1 — Provider layer: models.dev catalog + Vercel AI SDK

**Current:** `apps/api/src/llm/{anthropic,openai,ollama,openai-compatible}-provider.ts`
each hand-implement `LLMProvider` (`chat()` async-iterable + `embed()`);
`provider-registry.ts` + `provider-loader.ts` wire them; `DEFAULT_MODEL =
'claude-sonnet-4-6'` and unknown model IDs silently fall back.

**Design**
- Add `apps/api/src/llm/model-catalog.ts`:
  - Loads a **committed snapshot** `apps/api/src/llm/models.snapshot.json`
    (generated from models.dev) at boot; attempts a background refresh from
    models.dev into Redis (`model-catalog:v1`, 24h TTL) only if
    `HEARTH_MODEL_CATALOG_REFRESH=true`. Air-gapped installs run entirely on the
    snapshot.
  - Exposes `resolveModel(id): CatalogModel` → `{ providerId, contextWindow,
    pricing, caps: { vision, tools, reasoning } }`, and `throw new
    UnknownModelError(id)` when absent. **This kills the silent-fallback bug.**
- Add `apps/api/src/llm/ai-sdk-provider.ts`: an `AiSdkProvider implements
  LLMProvider` mapping `chat()` → AI SDK `streamText` and `embed()` →
  `embedMany`, using `@ai-sdk/{anthropic,openai,google,amazon-bedrock}` +
  `@ai-sdk/openai-compatible` (covers Ollama/LM Studio/local). Keep the existing
  `ChatEvent` shape so `agentLoop` is untouched — map AI SDK `reasoning` deltas →
  Hearth `thinking` events, `tool-call` deltas → `tool_call_start/delta/end`.
- Keep `ollama-provider.ts` as a second path for pure-local installs that don't
  want the AI SDK openai-compat shim; registry picks based on provider config.
- **Model resolution chain** (replaces hardcoded default), validated against the
  catalog at each step: `skill.recommended_model → request.model → user pref →
  team default → org default`. On miss → typed error surfaced to UI (W5).
- Capability gating: image attachments allowed only if `caps.vision`; tool use
  only if `caps.tools`. Org `visionEnabled` becomes an override, not the source.
- `token-counter.ts` uses catalog `pricing` for cost; `compliance/provider-wrapper.ts`
  continues to wrap whatever provider the registry returns.

**Data model**
- `org.settings.defaultModel` (string). New `user_model_preferences(user_id,
  last_model, last_provider_id, updated_at)` — or reuse `user_preferences`
  category `model`.

**Removes (after parity + flag default-on, see §9)**
- `apps/api/src/llm/anthropic-provider.ts`, `openai-provider.ts`,
  `openai-compatible-provider.ts`, `ollama-provider.ts` → superseded by
  `ai-sdk-provider.ts` (AI SDK's `@ai-sdk/openai-compatible` covers Ollama/LM
  Studio/local, incl. air-gapped against a local endpoint).
- The bespoke per-provider loading in `provider-loader.ts` (simplify to:
  registry → single `AiSdkProvider` keyed by catalog `providerId`).
- The **silent model-fallback branch** in the resolution path and the hardcoded
  `DEFAULT_MODEL = 'claude-sonnet-4-6'` in `agent-runtime.ts` (replaced by the
  validated resolution chain).
- Dead tests: `provider-loader` cases; `provider-registry.test.ts` rewritten
  against the single provider.

**Coexistence / risk**
- No change to audit `llm_call` logging. Risk: AI SDK streaming event mapping
  (esp. Anthropic extended thinking + tool-call JSON deltas) — covered by
  contract tests (§5.1). Risk: snapshot staleness — CI job regenerates snapshot
  weekly via PR.

**Effort:** M (catalog + AI SDK provider + resolution). Highest foundational leverage.

---

### W2 — Interruptible / steerable agent loop (+ doom-loop + graceful degradation)

**Current:** `agentLoop()` in `apps/api/src/agent/agent-runtime.ts` is a fixed
`for (iteration < MAX_ITERATIONS=25)` loop with no abort, no loop detection, hard
error at the cap. UI disables input during streaming; no stop button. The file's
own TODO already specifies compaction/loop-detection/graceful-degradation.

**Design**
- Thread an `AbortSignal` through `AgentContext` → `agentLoop` → `provider.chat()`
  and `executeTool()` (tool fetches honor the signal). Check `signal.aborted`
  between iterations and before each tool call.
- **Run registry + cross-instance stop.** Each run gets a `runId`. A new WS
  message `chat:stop {sessionId, runId}` (and REST `POST
  /api/v1/chat/sessions/:id/stop`) resolves the `AbortController`. Because the API
  is multi-instance on Fargate, broadcast stop over the **existing Redis pub/sub**
  (`chat:stop:{runId}`); the instance owning the run aborts. On abort: persist the
  partial assistant message, emit `done {stopReason:'interrupted'}`.
- **Steering.** Keep the input **enabled** during streaming. Sending a message
  mid-run = *interrupt-and-continue*: abort the current run, append the partial
  assistant output (marked `interrupted`) + the new user message to history, start
  a fresh run. (Matches opencode/Claude Code; avoids a brittle queue.)
- **Doom-loop detection.** Fingerprint each iteration as
  `hash(tool_name + normalizedInput + resultHash)`. 3 identical in a row → stop
  tool use, emit `warning`, do one final toolless "summarize progress + what
  remains" call. Feeds W3 (auto-deny a looping tool).
- **Graceful degradation.** At `maxIterations`, same final toolless summary rather
  than throwing.
- **Configurable budgets** via `AgentContext`: `maxIterations`, `maxTokens` so
  task-executor / routines set per-run budgets (closes the TODO item).

**UI** (`use-chat.ts`, `pages/chat.tsx`, `message-list.tsx`)
- Remove `disabled={isStreaming}` from `ChatInput`; add a **Stop** button while
  `isStreaming`. Handle `stopReason: 'interrupted' | 'max_iterations' | 'done'`.
  Render interrupted partial messages with a subtle "stopped" affordance.

**Removes**
- `disabled={isStreaming}` on `ChatInput` and the associated disabled-state
  handling in `pages/chat.tsx` / `chat-input.tsx`.
- The hard `throw` at `MAX_ITERATIONS` (replaced by the graceful summary); the
  hardcoded `MAX_ITERATIONS` constant → config on `AgentContext`.

**Coexistence / risk**
- Multiplayer: `stop` is permissioned to the run's initiator + session
  owner/contributors; interruption event broadcasts to all session subscribers so
  everyone's UI updates. Routine approval pauses are a separate mechanism and are
  untouched. Risk: stop↔done race → idempotent finalization keyed by `runId`.

**Effort:** M–L. **Highest user-facing payoff.** Can ship UI-independent of W1.

---

### W3 — Per-tool permission policy (allow / ask / deny + pattern matching)

**Current:** `tool-router.ts` executes tools unconditionally for the chat agent.
Governance exists only for routines (`approval-service.ts`) and the capability
sandbox.

**Design**
- New `apps/api/src/agent/permission-policy.ts`: evaluate a tool call against
  ordered rules `{ tool_pattern (glob), arg_pattern?, level: allow|ask|deny }`.
  Scope precedence: **user override (narrowing only) → agent profile → org
  default**.
- `tool-router.ts` consults the policy before `executeTool`:
  - `allow` → run.
  - `deny` → return a tool_result error (`blocked_by_policy`) so the model can
    adapt — never a silent drop.
  - `ask` → emit WS `permission_request {callId, tool, input, level}`, **pause the
    run** (reuse the W2 abort/park infra), await `permission_response {callId,
    decision: allow_once | allow_always | deny}`. `allow_always` persists a user-
    scope `allow` rule.
- **Sensible defaults for Hearth's tool taxonomy** (not bash-centric):
  read/recall/search tools = `allow`; external side-effects
  (`slack_post_message`, `jira_create_issue`, `send_email`, `*_create`, `*_update`,
  `*_delete`, MCP writes) = `ask`; destructive (`*_delete`, admin) = `deny` by
  default for member role.

**Data model**
- `tool_permission_policies(id, org_id, agent_profile_id?, user_id?, tool_pattern,
  arg_pattern, level, created_by, created_at)`. Auditable; logs each ask/deny to
  `audit_logs` (`action: 'tool_permission_decision'`).

**Coexistence / risk**
- Durable routine approval gates remain the governance layer for scheduled/
  unattended runs; W3 is the *interactive* layer for live chat. Both write audit.
  Risk: over-prompting → ship with conservative defaults + `allow_always`.

**Effort:** M. Pairs naturally with W2 (shares pause infra) and enables W4.

---

### W4 — Plan → Build mode

**Current:** single execute-biased loop; `tasks` already have
`planning`/`executing` states but chat has no plan gate.

**Design**
- Introduce **agent profiles** as seeded data reusing `agent_identities` +
  `role_templates`: built-ins `plan` and `build`. A profile = `{ system_prompt
  addendum, allowed_tool_patterns, model? }`.
  - **Plan** profile: W3 policy denies all write/side-effect tools (read-only);
    prompt instructs "produce a numbered plan, do not execute." Output rendered as
    a structured plan (reuse `task_execution_steps` shape or a lightweight plan
    artifact via `artifact-service.ts`).
  - **Build** profile: full tools; seeded with the approved plan.
- Chat request carries `agentMode: 'plan' | 'build'` (stored in
  `chat_messages.metadata.agentMode`). UI toggle in `chat-input.tsx` + Tab
  shortcut. "Approve & Build" button on a plan message starts a Build run.

**Coexistence / risk**
- Artifacts, memory, citations, multiplayer all work unchanged in both modes; the
  mode is per-run and visible to collaborators. Risk: scope creep — **v1 =
  read-only plan → approve → build only.**

**Effort:** M. Depends on W3 (restricted tools).

---

### W5 — In-chat model picker

**Depends on W1.**

**Design**
- New `GET /api/v1/models` → catalog filtered to org-enabled providers +
  capability flags + admin allowlist. `chat-input.tsx` dropdown shows name,
  context window, cost hint. `use-chat.ts` `sendMessage()` passes
  `model`/`providerId` (the route in `chat.ts` already accepts them). Persist
  last-used per user (W1 table).
- Admin keeps the source of truth (`routes/admin/llm-config.ts`): which providers
  are enabled + per-role allowlist (cost governance).

**Removes**
- Any remaining hardcoded model defaults in `use-chat.ts` / `chat.tsx`; the
  `model`/`providerId` route params stop being dead (previously accepted, never
  sent).

**Coexistence / risk**
- Picker only selects among admin-enabled models. Risk: expensive-model abuse →
  role-based allowlist + audit.

**Effort:** S. Mostly UI + one endpoint.

---

### W6 — Extensible slash commands → Skills

**Current:** only `/task`.

**Design**
- `apps/web/src/components/chat/chat-input.tsx`: a `/` command menu reusing the
  existing `@`-mention menu infra. Built-ins: `/task` (existing), `/plan` (→ W4
  toggle), `/model` (→ W5 picker), `/share`, `/new`, `/skill <name>`.
- User/org commands = Skills flagged `invocable_as_command` with a `command_slug`
  and a parameter template (reuse `skills` + routine parameter schema). Server
  resolves `/slug args` → expands skill markdown into the prompt or runs the skill.

**Data model**
- `skills.invocable_as_command boolean`, `skills.command_slug text` (unique per org).

**Removes**
- The hardcoded `/task`-only parsing special-case in `chat-input.tsx` → folded
  into the generic command registry (refactor; `/task` stays as a built-in).

**Coexistence / risk**
- Skills stay the backbone. `@` (people/cognitive) and `/` (commands) menus coexist
  via different trigger chars. Risk: slug collisions → unique constraint + org
  namespacing.

**Effort:** S–M.

---

## 4. Sequencing

```
Phase 0  Snapshot + flags scaffolding (org.settings.features.*)
Phase 1  W1 provider layer  ──┐         (foundation; ship behind flag, dark)
Phase 2  W2 interruptibility │ (parallel, UI-independent of W1)
Phase 3  W3 permissions  ◀───┘           (shares W2 pause infra)
Phase 4  W4 plan/build   ◀── needs W3
Phase 5  W5 model picker ◀── needs W1
Phase 6  W6 slash commands ◀── needs W4+W5 for /plan,/model
```

Each phase is independently shippable behind `org.settings.features.<flag>` and
must pass the §5.5 multiplayer regression suite before the flag defaults on.

---

## 5. Verification & Test Plan

**Philosophy** (per standing testing bar): 20–30 cases per workstream, a
100-person org simulation for load/multiplayer, and explicit product-gap capture.
Extend existing suites (`e2e/chat.spec.ts`, `chat-to-task.spec.ts`,
`cognitive.spec.ts`, `e2e/ui/chat.spec.ts`, `e2e/concurrency/`) rather than
duplicating. Unit/integration via existing vitest `*.test.ts` convention.

### 5.1 API tests

**W1 — provider/catalog** (`apps/api/src/llm/*.test.ts`)
1. `resolveModel('claude-opus-4-8')` → correct provider + caps.
2. `resolveModel('claude-haiku-4-5')` (undated) → **throws `UnknownModelError`**
   (the bug that used to silently become gpt-4o). *Primary acceptance test.*
3. Resolution chain picks skill rec over user pref over org default.
4. Snapshot-only boot with network disabled → catalog fully functional.
5. Redis refresh path updates catalog when `HEARTH_MODEL_CATALOG_REFRESH=true`.
6. `AiSdkProvider.chat()` contract: emits `thinking` → `text_delta`* →
   `tool_call_start/delta/end` → `done{usage}` in order, for a recorded Anthropic
   tool-use stream fixture.
7. `embed()` dimensions match pgvector column (1536).
8. Capability gate: image message to a non-vision model → 422 `MODEL_NO_VISION`.
9. Compliance wrapper still scrubs around `AiSdkProvider`.
10. Pricing/token cost computed from catalog, logged to audit.

**W2 — interruptibility** (`agent-runtime.test.ts`, route tests)
11. `AbortSignal` fired mid-stream → loop stops within one iteration, partial
    message persisted, `done{stopReason:'interrupted'}` emitted.
12. Cross-instance: stop published on instance A aborts run on instance B (Redis
    pub/sub mock).
13. Steering: new message during run aborts prior run, history contains
    `interrupted` partial + new user turn, new run starts.
14. Doom-loop: 3 identical tool fingerprints → `warning` + toolless summary, no
    4th call.
15. `maxIterations` reached → graceful summary, not thrown error.
16. Per-run `maxTokens` budget honored (stops at budget).
17. Idempotent finalization: stop + natural done race → exactly one `done`
    persisted.
18. Permissioning: non-owner/non-contributor `stop` → 403.

**W3 — permissions** (`permission-policy.test.ts`)
19. `allow` rule → tool runs.
20. `deny` → tool_result `blocked_by_policy`, model continues.
21. `ask` → `permission_request` emitted, run parks, `allow_once` resumes it.
22. `allow_always` persists a user-scope rule; next identical call auto-allows.
23. Glob + arg pattern match (`slack_post_message` with channel pattern).
24. Precedence: user narrowing cannot widen an org `deny`.
25. Default policy: `recall_decisions`=allow, `slack_post_message`=ask,
    `integration_delete`=deny for member.
26. Every ask/deny writes an `audit_logs` row.

**W4 — plan/build** (route + `agent-runtime.test.ts`)
27. Plan mode: write tool requested → denied by policy, plan still produced.
28. Plan output is structured (N steps) and persisted with `agentMode:'plan'`.
29. "Approve & Build" seeds Build run with the plan; side-effect tools now allowed.
30. Non-approver cannot trigger Build on another user's plan (multiplayer).

**W5 — model picker**
31. `GET /models` returns only org-enabled + allowlisted models with caps/cost.
32. `sendMessage` with `model` overrides default for that run only.
33. Member blocked from a non-allowlisted expensive model → 403.

**W6 — commands**
34. `/task seed` opens composer (regression — existing behavior preserved).
35. `/skill <slug> args` resolves skill, expands template, runs.
36. Unknown `/slug` → inline error, not sent to agent.
37. Slug uniqueness enforced per org.

**Decommission gate** (§7)
38. CI reference-check (`knip`/`ts-prune` + `no-restricted-imports`) fails if any
    deleted module is still imported; grep asserts `DEFAULT_MODEL` and the
    silent-fallback branch are gone after the W1 PR.

### 5.2 UI / component tests (Vitest + Testing Library, `apps/web`)
- `chat-input.tsx`: input **stays enabled** while streaming; Stop button visible;
  `/` menu and `@` menu both work and don't collide; model dropdown renders from
  `/models`.
- `message-list.tsx`: interrupted message shows "stopped"; `permission_request`
  renders an inline allow/deny card; plan message shows "Approve & Build".
- `message-bubble.tsx`: citation badges + artifacts still render (regression).
- Snapshot: no layout shift when Stop replaces Send.

### 5.3 E2E user journeys (Playwright, extend `e2e/ui/chat.spec.ts`)

Each journey below is a **happy path plus an explicit set of error/edge branches**,
and **each branch is its own Playwright test case** (not an afterthought in a
comment). The rule: every journey must prove both that the feature works *and*
that it fails safely, loudly, and without corrupting session/multiplayer state.
Target ≥25 discrete cases across J1–J13.

**J1 — Interrupt & steer (W2).**
- *Happy:* Ada asks a long multi-tool question → clicks Stop mid-stream → partial
  answer stays, input is live → types a redirect → old run ends `interrupted`,
  new run answers. Assert: no orphaned run (`/admin/analytics` run count), input
  never disabled.
- *Error/edge:*
  - **Stop after done**: Stop clicked the instant the run finishes → no error, no
    duplicate `done`, idempotent finalize.
  - **Double-stop**: two rapid Stop clicks → single interrupted finalize.
  - **Stop by non-owner**: Ben (contributor) stops Ada's run → allowed per policy;
    a pure viewer → `403`, run continues, viewer sees a toast not a crash.
  - **Steer during tool execution**: new message arrives while a tool call is
    in-flight → tool result discarded safely, loop aborts at the checkpoint, new
    run starts with the partial marked `interrupted`.
  - **WS disconnect mid-stream** then reconnect → UI resumes/repaints the
    in-progress run (or shows interrupted) with no duplicated text deltas.
  - **API instance crash mid-run** (kill the pod in the concurrency harness) →
    partial assistant message is persisted; on reload the session is coherent,
    no half-written tool card stuck "running".

**J2 — Permission prompt (W3).**
- *Happy:* Ben asks the agent to post to Slack → inline permission card →
  `allow_once` → posts (stub MCP) → asks again → prompted again; `allow_always` →
  second time no prompt. Assert audit rows.
- *Error/edge:*
  - **Deny**: user denies → tool returns `blocked_by_policy`, agent adapts and
    continues (no crash, no silent drop).
  - **Non-overridable org deny** (`integration_*`): user cannot widen it; card
    shows "blocked by admin policy", no allow option.
  - **Ask timeout**: user never responds → run parks, then times out to the
    configured `timeout_action`, finalizes cleanly.
  - **Response after run ended**: permission_response arrives for a `callId` whose
    run already finished/aborted → ignored, no exception.
  - **Concurrent asks**: two tool calls both need `ask` → two cards queue in
    order; resolving one doesn't resolve the other.
  - **Downstream tool failure after allow**: user allows, MCP then returns
    500/unauthorized → surfaced as a tool error in the card, agent continues.

**J3 — Plan → Build (W4).**
- *Happy:* Priya: "Draft and send the Q3 update to #sales" in **Plan** mode → gets
  a numbered plan, nothing sent → "Approve & Build" → send tool permitted (still
  W3-gated) → completes. Assert zero send-tool calls during Plan.
- *Error/edge:*
  - **Write attempt in Plan**: agent tries a write tool → denied by the plan
    profile, plan still produced (no leaked side effect).
  - **Empty/degenerate plan**: agent returns no actionable steps → UI shows "no
    plan produced", Build button disabled.
  - **Build without approval**: direct API call to start Build with no approved
    plan → `409 PLAN_NOT_APPROVED`.
  - **Approve by non-owner**: Ben clicks Approve & Build on Priya's plan → `403`
    (and the inverse: owner-approves works, broadcast to collaborators).
  - **Double-approve / double-Build click** → exactly one Build run (idempotent).
  - **Plan↔Build model mismatch**: plan ran on Opus, Build model now disabled →
    clear error, not a silent fallback.

**J4 — Model picker (W5).**
- *Happy:* Ada opens picker → Opus/Sonnet/Haiku/gpt-4o with context+cost → picks
  Opus for one message → next reverts to her default.
- *Error/edge:*
  - **Disabled/allowlist-blocked model**: member picks a non-allowlisted model →
    blocked with reason, default used.
  - **Provider disabled mid-session** (admin toggles off during the chat) → picker
    refreshes, in-flight selection falls back with a visible notice, not a 500.
  - **Vision image to non-vision model**: attach image + pick a `caps.vision:false`
    model → `422 MODEL_NO_VISION` surfaced before send.
  - **Cost cap exceeded** (if role budget set) → blocked with cost reason.
  - **Empty catalog** (all providers disabled) → picker shows empty state, send
    disabled, actionable message.

**J5 — Unknown-model safety (W1). (Headline regression fix.)**
- *Happy:* valid model id resolves and answers.
- *Error/edge:*
  - **Undated id** `claude-haiku-4-5` set as a skill/routine `recommended_model` →
    clear `UnknownModelError` in UI, **no answer on gpt-4o**. Must be visible
    end-to-end (chat, routine run view, and task executor).
  - **Typo'd id** (`claude-sonnet-4.6`) → same loud error.
  - **Model from a disabled provider** → `PROVIDER_DISABLED`, not a fallback.
  - **models.dev refresh fails** (network blocked) → system runs on the committed
    snapshot, chat fully functional, a single warning logged (not per-request).

**J6 — Slash command (W6).**
- *Happy:* Ben types `/` → menu → `/skill standup` → skill runs, output rendered.
- *Error/edge:*
  - **Unknown command** `/frobnicate` → inline "unknown command" error, **not**
    sent to the agent as a prompt.
  - **Missing required params** (`/skill report` needs a date) → inline param
    prompt, run not started.
  - **Skill missing a required integration** (needs Jira, not connected) → clear
    "connect Jira first" error with a link, no crash.
  - **Slug collision** (two org skills claim `standup`) → blocked at save time by
    the unique constraint; menu never shows ambiguous entries.
  - **`/task` regression**: `/task seed` still opens the composer (built-in path
    preserved through the refactor).

**Cross-cutting failure journeys (provider/network/auth/concurrency):**

**J7 — Provider failure modes (W1/W2).** Drive the chat while the stub provider
returns, in turn: `429` rate-limit (assert bounded retry/backoff then a user-
visible "rate limited, retrying" state), request `timeout` (graceful error +
Retry button), `500` (error banner + Retry, session not corrupted), **bad API
key / 401** (clear "provider auth failed", pointer to admin LLM config), and
**context-window exceeded** (rolling summarization/compaction kicks in; if still
over, a clear error — never a silent truncation of the user's content).

**J8 — Mid-stream resilience (W2).** Force a WS drop at 3 points — during
`thinking`, during a `text_delta` burst, and during `tool_call` — and assert each:
reconnect resumes or cleanly marks interrupted, no duplicated/garbled text, tool
cards never stick in `running`, exactly one persisted assistant message.

**J9 — Doom-loop & budget (W2/W3).** A tool stub that returns the same result
every call → doom-loop detection breaks after 3 identical fingerprints with a
`warning` + graceful summary (no runaway cost). Separately, set a tiny per-run
`maxTokens` → run stops at budget with a clear "budget reached" finalize.

**J10 — Auth & access-control errors.** Non-authenticated client hitting
`/sessions/:id/stop`, `/models`, message POST → `401`. Member hitting admin
LLM-config/allowlist endpoints → `403`. Contributor removed from a shared session
**mid-run** → their stream cleanly terminates, they lose access, no data leak;
the owner's run continues.

**J11 — Multiplayer error states (regression-adjacent).** Two users Stop the same
run simultaneously → single interrupted finalize, both UIs converge. Reaction on a
message deleted concurrently → no orphaned reaction/crash. Collaborator edits an
artifact that was deleted → conflict surfaced, last-write-wins notice (no silent
loss). Assert presence/typing indicators recover after one participant's WS drops.

**J12 — Compliance & audit under errors.** A message that triggers a compliance
scrub still scrubs when routed through `AiSdkProvider`; if the scrub step itself
throws, the run **fails closed** (no unscrubbed content sent) with a clear error.
Every ask/deny, stop, unknown-model error, and budget stop writes an `audit_logs`
row (assert counts and `action` values).

**J13 — Offline / self-host path.** Boot with network egress blocked and
`HEARTH_MODEL_CATALOG_REFRESH` unset → catalog loads from snapshot, all of J1–J6
happy paths pass, no hard failures from the missing models.dev call. Then flip the
legacy kill-switch `HEARTH_LEGACY_PROVIDERS=true` → old providers re-register and
a basic chat still works (deprecation-window safety).

### 5.4 Load / 100-person org simulation (extend `e2e/concurrency/`)
- 100 users across 5 teams; 30 concurrent chat sessions, 10 of them multiplayer
  (2–4 participants each). Drive: random interrupts, permission asks, plan/build,
  model switches. **Assert:** p95 stop-to-finalize < 1.5s; zero orphaned runs;
  presence/typing fan-out correct; no cross-session leakage; Redis stop pub/sub
  delivered across ≥3 API instances.
- **Chaos/error injection under load** (not just the happy path): randomly inject
  provider `429`/`500`/timeout, drop ~2% of WS connections, kill one API instance
  mid-run, and deny ~20% of permission asks. **Assert under chaos:** no orphaned
  runs, every interrupted run has exactly one persisted assistant message, no
  stuck `running` tool cards, audit rows reconcile with injected errors, and the
  §5.5 multiplayer invariants still hold.

### 5.5 Multiplayer regression guardrail (gate for every flag flip)
Re-run the existing multiplayer assertions with each new flag ON: presence badges,
typing/composing, reactions, attribution, collaborator join, artifact version
history, citation badges, cognitive `@mention`. **Any failure blocks the flag.**

### 5.6 Product-gap capture
Each journey logs friction (extra clicks, confusing prompts, over-asking) into a
`plans/findings-agent-modernization.md` running doc for the next iteration.

---

## 6. Sample data / fixtures

All fixtures live under `e2e/fixtures/agent-modernization/` and a seed script
`apps/api/prisma/seed-agent-modernization.ts`. IDs are deterministic for assertions.

### 6.1 Org, teams, users
```json
{
  "org": { "id": "org_northwind", "slug": "northwind", "name": "Northwind",
    "settings": { "defaultModel": "claude-sonnet-4-6",
      "features": { "interruptible": true, "permissions": true,
                    "planMode": true, "modelPicker": true, "slashCommands": true },
      "visionEnabled": true } },
  "teams": [ { "id": "team_eng", "name": "Engineering", "org_id": "org_northwind" },
             { "id": "team_sales", "name": "Sales", "org_id": "org_northwind" } ],
  "users": [
    { "id": "u_ada",   "email": "ada@northwind.test",   "name": "Ada",   "role": "admin",     "team_id": "team_eng" },
    { "id": "u_ben",   "email": "ben@northwind.test",   "name": "Ben",   "role": "member",    "team_id": "team_sales" },
    { "id": "u_priya", "email": "priya@northwind.test", "name": "Priya", "role": "team_lead", "team_id": "team_sales" }
  ]
}
```

### 6.2 Provider config + catalog snapshot (W1/W5)
```json
{
  "providers": [
    { "id": "prov_anthropic", "provider": "anthropic", "enabled": true,
      "models": ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"] },
    { "id": "prov_openai", "provider": "openai", "enabled": true, "models": ["gpt-4o"] },
    { "id": "prov_ollama", "provider": "ollama", "enabled": false, "models": ["llama3.1"] }
  ],
  "allowlist": { "member": ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
                 "admin": ["*"] },
  "catalogSnapshotSample": {
    "claude-opus-4-8":          { "providerId": "anthropic", "contextWindow": 1000000, "caps": { "vision": true, "tools": true, "reasoning": true } },
    "claude-sonnet-4-6":        { "providerId": "anthropic", "contextWindow": 1000000, "caps": { "vision": true, "tools": true, "reasoning": true } },
    "claude-haiku-4-5-20251001":{ "providerId": "anthropic", "contextWindow": 200000,  "caps": { "vision": true, "tools": true, "reasoning": false } },
    "gpt-4o":                   { "providerId": "openai",    "contextWindow": 128000,  "caps": { "vision": true, "tools": true, "reasoning": false } }
  },
  "unknownModelProbe": "claude-haiku-4-5"
}
```
> `unknownModelProbe` is intentionally the **undated** id — test J5 / API case 2
> assert it raises `UnknownModelError`, never a silent gpt-4o answer.

### 6.3 Permission policy fixtures (W3)
```json
[
  { "tool_pattern": "recall_*",            "level": "allow" },
  { "tool_pattern": "get_*",               "level": "allow" },
  { "tool_pattern": "slack_post_message",  "arg_pattern": { "channel": "#sales*" }, "level": "ask" },
  { "tool_pattern": "jira_create_issue",   "level": "ask" },
  { "tool_pattern": "*_delete",            "level": "deny" },
  { "tool_pattern": "integration_*",       "level": "deny", "user_scope_overridable": false }
]
```

### 6.4 Session / message fixtures
```json
{
  "sessions": [
    { "id": "sess_solo",  "user_id": "u_ada",  "visibility": "private", "title": "Infra audit" },
    { "id": "sess_multi", "user_id": "u_priya","visibility": "org",     "title": "Q3 sales update",
      "collaborators": [ { "user_id": "u_ben", "role": "contributor" } ] },
    { "id": "sess_long",  "user_id": "u_ada",  "visibility": "private", "title": "Long thread",
      "messageCount": 48 }
  ],
  "longSession": "48 alternating user/assistant messages (~120K chars) to exercise rolling summarization + compaction under W2 budgets"
}
```

### 6.5 Concrete API request/response fixtures

**Send message with model override + plan mode (W4/W5)**
```http
POST /api/v1/chat/sessions/sess_multi/messages
{ "content": "Draft and send the Q3 update to #sales",
  "agentMode": "plan", "model": "claude-opus-4-8", "providerId": "anthropic" }
```
Expected WS on `session:sess_multi` (ordered): `thinking` → `text_delta`* →
`done{stopReason:'done', usage:{...}}`; **no** `tool_call_start` for any
`*_post_*`/send tool (plan mode denies writes). Message persisted with
`metadata.agentMode='plan'`.

**Stop a run (W2)**
```http
POST /api/v1/chat/sessions/sess_solo/stop   { "runId": "<from thinking event>" }
```
Expected: `done{stopReason:'interrupted'}` within 1 iteration; partial assistant
message row exists with `metadata.interrupted=true`.

**Permission response (W3)**
```jsonc
// server → client
{ "type": "permission_request", "callId": "pc_1", "tool": "slack_post_message",
  "input": { "channel": "#sales", "text": "…" } }
// client → server
{ "type": "permission_response", "callId": "pc_1", "decision": "allow_once" }
```

**Unknown-model safety (W1/J5)**
```http
POST /api/v1/chat/sessions/sess_solo/messages
{ "content": "hi", "model": "claude-haiku-4-5" }
```
Expected: `400 { "error": "UNKNOWN_MODEL", "model": "claude-haiku-4-5" }` —
UI shows a blocking error; **no agent answer produced.**

**List models (W5)**
```http
GET /api/v1/models            →
[ { "id":"claude-opus-4-8","providerId":"anthropic","contextWindow":1000000,"caps":{"vision":true,"tools":true},"costHint":"$$$","allowedForRole":true },
  { "id":"gpt-4o","providerId":"openai","contextWindow":128000,"caps":{"vision":true,"tools":true},"costHint":"$$","allowedForRole":false } ]
```

### 6.6 Expected-result matrix (journey ↔ assertion)
| Journey | Key assertion | Fixture |
|---------|---------------|---------|
| J1 | input never disabled; run count unchanged (no orphan) | sess_solo |
| J2 | 2 audit rows; 2nd ask skipped after allow_always | §6.3 |
| J3 | zero send-tool calls during Plan | sess_multi |
| J4 | override is per-message; disabled model blocked | §6.2 allowlist |
| J5 | `UNKNOWN_MODEL`, no answer | unknownModelProbe |
| J6 | `/skill standup` runs | skill `standup` |
| J7 | 429/timeout/500/401/ctx-exceeded each → bounded retry or loud error, session intact | provider stub error modes |
| J8 | WS drop at 3 points → exactly one persisted msg, no stuck tool card | sess_solo + chaos hook |
| J9 | doom-loop breaks at 3; token budget stops cleanly | looping tool stub + `maxTokens` |
| J10 | 401/403 matrix; mid-run access removal leaks nothing | sess_multi + removed collaborator |
| J11 | concurrent stop/reaction/artifact conflicts converge | sess_multi |
| J12 | scrub fails closed; audit counts correct | compliance sample + audit assertions |
| J13 | snapshot-only boot passes J1–J6; kill-switch re-registers legacy | egress-blocked env |

---

## 7. Decommission & dead-code removal

Removal is a **gated step, not a cleanup afterthought** — but it never happens
speculatively. Rule for every workstream:

> Old code is deleted only when (a) the new path reaches **parity** (its contract
> tests in §5 are green), **and** (b) the workstream's flag has **defaulted on**
> for one release, **and** (c) a repo-wide reference check shows zero remaining
> importers.

**Deprecation window.** For W1 specifically, ship a kill-switch
`HEARTH_LEGACY_PROVIDERS=true` that re-registers the old providers for exactly one
release. If no self-host install flips it, the files are deleted in the next
release. All other removals (W2/W5/W6) are UI/constant-level and go in the same PR
once their flag defaults on — no kill-switch needed.

**Consolidated removal list**
| Workstream | Delete | Replaced by |
|-----------|--------|-------------|
| W1 | `llm/anthropic-provider.ts`, `openai-provider.ts`, `openai-compatible-provider.ts`, `ollama-provider.ts`; bespoke paths in `provider-loader.ts`; silent-fallback branch; `DEFAULT_MODEL` const | `ai-sdk-provider.ts` + `model-catalog.ts` + resolution chain |
| W1 | `provider-loader` tests; old `provider-registry.test.ts` body | rewritten registry tests |
| W2 | `disabled={isStreaming}` handling; `MAX_ITERATIONS` hard-throw + const | Stop button + `AgentContext` budgets + graceful summary |
| W5 | hardcoded model defaults in `use-chat.ts`/`chat.tsx` | picker → `model`/`providerId` params (now live) |
| W6 | `/task`-only parse special-case | generic command registry |

**Enforcement.** Add a CI gate (`knip` or `ts-prune` + an ESLint
`no-restricted-imports` rule listing the doomed modules) that **fails the build**
if any deleted module is still imported, and a grep assertion in the W1 PR that
`DEFAULT_MODEL`/the fallback branch no longer appear. This is also API test
case 38 (§5.1).

## 8. Acceptance criteria & rollout

- **Done = all §5 suites green**, including the §5.5 multiplayer regression and the
  §5.4 100-person sim, with each flag defaulting ON only after its regression pass.
- **Headline fixes demonstrably true in E2E:** (a) J5 unknown-model is loud;
  (b) J1 chat is interruptible and input never locks.
- **No regression** in artifacts, citations, cognitive `@mention`, presence,
  reactions, routine approvals, compliance scrubbing.
- **Dead code is gone**: §7 removal list deleted, CI reference-check (case 38)
  green, no `HEARTH_LEGACY_PROVIDERS` references remain after the deprecation
  release.
- Rollout: dark-launch per flag on `northwind` seed org → internal org → default
  on → (one release later) delete the legacy provider files.

## 9. Open questions (for Abhishek)
1. models.dev refresh in cloud: OK to background-refresh in the hosted deployment,
   snapshot-only for self-host? (Plan assumes yes.)
2. Steering semantics: confirm **interrupt-and-continue** over a message queue.
3. Plan/Build v1 scope: read-only plan → approve → build only (no mid-plan edits)?
4. Permission default severity for `member` vs `team_lead` vs `admin` — confirm the
   §6.3 defaults.
5. Decommission appetite: OK to **delete** the four hand-rolled providers after the
   one-release `HEARTH_LEGACY_PROVIDERS` deprecation window (plan assumes yes), or
   keep `ollama-provider.ts` indefinitely as a no-AI-SDK local fallback?
```
