# Hearth E2E Coverage Matrix

Generated 2026-06-13T18:55:14.511Z · 120 scenarios

| Feature | happy | error | user_error | violation | permission | pressure |
|---|---|---|---|---|---|---|
| Admin & Platform | 9✅ | · | · | 1✅ | 6✅ | · |
| Artifacts | 3✅ | · | · | · | · | 1✅ |
| Chat & Artifacts | 10✅ | 1✅ | 2✅ | · | 4✅ | · |
| Decisions | 3✅ | · | 2✅ | · | 1✅ | 1✅ |
| Governance & Compliance | 10✅ | · | · | 5✅ | 2✅ | 3✅ |
| Intake & Detection | 5✅ | · | · | 1✅ | 1✅ | · |
| Memory | 2✅ | · | · | · | 2✅ | 1✅ |
| Routines | 2✅ | · | 1✅ | · | 2✅ | 3✅ |
| Routines (internals) | 4✅ | · | 1✅ | · | 4✅ | 1✅ |
| Skills | 1✅ | 1✅ | · | · | 3✅ | 2✅ |
| Task Context | 4✅ | · | 2✅ | 1✅ | · | 1✅ |
| Tasks | 5✅ | · | 3✅ | · | 1✅ | 2✅ |

## Defects (0)


## Failures & partials

_None — all scenarios passed._

## Per-scenario detail

Every scenario driven against the live product — the user story, the expected behavior, and Hearth's actual response.

### Admin & Platform

| # | Result | Type | Scenario (user story) | Expected | Hearth responded |
|---|---|---|---|---|---|
| 1 | ✅ | happy | Admin GET /admin/audit-logs | 200 | status 200 |
| 2 | ✅ | permission | Member GET /admin/audit-logs | 403 | status 403 |
| 3 | ✅ | happy | Admin GET /admin/analytics | 200 | status 200 |
| 4 | ✅ | permission | Member GET /admin/analytics | 403 | status 403 |
| 5 | ✅ | happy | Admin GET /admin/users | 200 | status 200 |
| 6 | ✅ | permission | Member GET /admin/users | 403 | status 403 |
| 7 | ✅ | happy | Admin GET /admin/teams | 200 | status 200 |
| 8 | ✅ | permission | Member GET /admin/teams | 403 | status 403 |
| 9 | ✅ | happy | Admin GET /admin/sso | 200 | status 200 |
| 10 | ✅ | permission | Member GET /admin/sso | 403 | status 403 |
| 11 | ✅ | happy | Admin creates a team | 201 | status 201 |
| 12 | ✅ | permission | Admin moves a user into ANOTHER org's team | rejected — cross-tenant move | status 400; moved=false (restored) |
| 13 | ✅ | happy | List notifications | 200 | status 200 {"data":{"items":[{"id":"b227ec8c-3e80-48e2-83cf-d481d7199c6 |
| 14 | ✅ | happy | Mark all notifications read | 200 | status 200 |
| 15 | ✅ | happy | Public setup/status reachable | 200 (intentionally public pre-setup) | status 200 |
| 16 | ✅ | violation | Replay setup/init after org exists (admin seizure) | 400 — already set up | status 400 |

### Artifacts

| # | Result | Type | Scenario (user story) | Expected | Hearth responded |
|---|---|---|---|---|---|
| 17 | ✅ | happy | Create artifact (v1) | 201 version 1 | version 1 |
| 18 | ✅ | happy | Update artifact bumps version | 200, version 2 | status 200 |
| 19 | ✅ | happy | List version history | ≥2 versions | 2 versions |
| 20 | ✅ | pressure | Concurrent artifact updates | no lost update / version collision (final version == version-row count) | a=200 b=200; final version=4; 4 version rows |

### Chat & Artifacts

| # | Result | Type | Scenario (user story) | Expected | Hearth responded |
|---|---|---|---|---|---|
| 21 | ✅ | happy | Multi-turn 1:1 chat with the agent | agent replies substantively each turn | 2 replies |
| 22 | ✅ | happy | Owner shares session org-wide + adds a contributor | visibility org; collaborator added | add status 201 |
| 23 | ✅ | happy | Contributor posts into the shared session | 202 accepted | status 202 |
| 24 | ✅ | happy | Agent produces a markdown doc artifact | artifact created + linked to its message (card renders) | 1 artifact(s), types=document, linked=true |
| 25 | ✅ | happy | Agent produces a code artifact | artifact created + linked to its message (card renders) | 1 artifact(s), types=code, linked=true |
| 26 | ✅ | happy | Agent produces a html artifact | artifact created + linked to its message (card renders) | 1 artifact(s), types=html, linked=true |
| 27 | ✅ | happy | Promote a chat message to a task | 201 task created, back-linked to the message | status 201 |
| 28 | ✅ | happy | Owner creates a public share link | 200 + token | status 201, token=yes |
| 29 | ✅ | happy | Public (unauthenticated) view of the share link | 200 renders shared transcript | status 200 |
| 30 | ✅ | happy | Revoked share link is dead | 404 after revoke | status 404 |
| 31 | ✅ | permission | Viewer-collaborator creates an artifact | viewers should not write; expect 403 | status 403 |
| 32 | ✅ | permission | Viewer deletes the owner's artifact | non-creator should not delete; expect 403 | status 403 |
| 33 | ✅ | permission | No-access user lists a PRIVATE session's collaborators | 403/404 — no access to a private session | status 404, 0 names returned |
| 34 | ✅ | permission | Owner adds a cross-org user as collaborator | rejected — cross-tenant | status 404 |
| 35 | ✅ | user_error | Send an empty message | 400 | status 400 |
| 36 | ✅ | user_error | Create artifact with an invalid type | 400 | status 400 |
| 37 | ✅ | error | Public view of an unknown share token | 404 | status 404 |

### Decisions

| # | Result | Type | Scenario (user story) | Expected | Hearth responded |
|---|---|---|---|---|---|
| 38 | ✅ | happy | Capture a decision | 201 | status 201 |
| 39 | ✅ | happy | Search decisions (hybrid) | 200 | status 200 |
| 40 | ✅ | user_error | Capture decision with invalid enum values | 400 validation error | status 400 |
| 41 | ✅ | pressure | Capture a near-duplicate decision | dedup is transparent (e.g. 200 + a "merged" flag), not a silent 201 of the old row | status 200; returned-existing-id=true |
| 42 | ✅ | happy | Record a decision outcome | 200/201 | status 201 |
| 43 | ✅ | user_error | Record an outcome with an invalid verdict | 400 | status 400 |
| 44 | ✅ | permission | Teamless user captures a decision | rejected — user has no org | status 400 |

### Governance & Compliance

| # | Result | Type | Scenario (user story) | Expected | Hearth responded |
|---|---|---|---|---|---|
| 45 | ✅ | happy | Enable governance (checkUserMessages + checkAiResponses + notifyAdmins) | 200, governance enabled | status 200 |
| 46 | ✅ | happy | Enable compliance packs PII + PCI-DSS + GDPR | 200, packs enabled | status 200 {"data":{"enabledPacks":["pii","pci-dss","gdpr"],"detectorOverrides":{},"auditLe |
| 47 | ✅ | happy | Create block policy: "Secrets & credentials" (keyword) | 201 created | status 201 |
| 48 | ✅ | happy | Create block policy: "Confidential codename (Project Titan)" (keyword) | 201 created | status 201 |
| 49 | ✅ | happy | Create warn policy: "Competitor mentions" (keyword) | 201 created | status 201 |
| 50 | ✅ | happy | Create monitor policy: "SSN exposure (monitor)" (regex) | 201 created | status 201 |
| 51 | ✅ | happy | Create block policy: "External data exfiltration" (llm_evaluation) | 201 created | status 201 |
| 52 | ✅ | violation | Dev pastes an AWS secret into chat | 403 blocked; message NOT persisted; violation recorded | status 403; transcript-leak=false |
| 53 | ✅ | violation | PM references confidential codename "Project Titan" | 403 blocked | status 403 |
| 54 | ✅ | violation | Sales rep mentions a competitor | 202 accepted; message persists; warn violation recorded | status 202; persisted=true |
| 55 | ✅ | violation | Support agent includes a customer SSN | monitor violation recorded; SSN scrubbed before the LLM (descrub restores it in the agent's own reply) | reply len 2008; violations +14 |
| 56 | ✅ | violation | Finance analyst pastes a credit card (valid Luhn) | scrub→LLM→descrub pipeline completes; PAN tokenized before the LLM (descrub may restore it for the user) | reply len 139 |
| 57 | ✅ | happy | Admin lists violations | block + warn + monitor violations present | 20 violations returned |
| 58 | ✅ | happy | Admin acknowledges a violation | 200 | status 200 |
| 59 | ✅ | happy | Admin governance stats | 200 with aggregates | status 200 |
| 60 | ✅ | pressure | Violation export content | export works; flagged-content PII (e.g. SSN) is scrubbed, not emitted raw | status 200; contentPIILeak=false |
| 61 | ✅ | pressure | Block policy with an invalid regex | a regulated org should fail CLOSED (block on policy error) | created=201; message status 403 |
| 62 | ✅ | pressure | Undashed SSN egress | SSN scrubbed regardless of formatting | reply-echoed=false |
| 63 | ✅ | permission | Member tries to create a governance policy | 403 forbidden | status 403 |
| 64 | ✅ | permission | Viewer tries to disable governance | 403 forbidden | status 403 |

### Intake & Detection

| # | Result | Type | Scenario (user story) | Expected | Hearth responded |
|---|---|---|---|---|---|
| 65 | ✅ | happy | Create a Slack ingest webhook endpoint | 200 + urlToken + secret | status 201, token=yes |
| 66 | ✅ | happy | Signed actionable Slack message → auto-detected task | 200 ack; Hearth detects + creates an auto_detected task | ack 200; new tasks=1 |
| 67 | ✅ | happy | Non-actionable Slack chatter ("thanks!") is ignored | no task created (pre-filter) | ack 200; new tasks=0 |
| 68 | ✅ | permission | Jira accepts the unguessable URL token (no body HMAC) | accepted (200) — auth is the URL token, by design | status 200 |
| 69 | ✅ | violation | Unsigned generic webhook is rejected | rejected (401) — generic providers must sign | status 401 |
| 70 | ✅ | happy | Inbound email (subject+body) → auto-detected task | 200 ack; Hearth detects the ask and creates an email-sourced auto_detected task | ack 200; new tasks=1 |
| 71 | ✅ | happy | Granola meeting ingest → decisions, not tasks | meeting ingested (200/201) and produces NO tasks (decisions only; extraction is async best-effort) | ingest 201; +0 decisions; +0 meeting-tasks |

### Memory

| # | Result | Type | Scenario (user story) | Expected | Hearth responded |
|---|---|---|---|---|---|
| 72 | ✅ | happy | Create a user-layer memory | 201 | status 201 |
| 73 | ✅ | happy | Search memory (hybrid) | 200 with results | status 200 |
| 74 | ✅ | permission | Member writes an ORG-layer memory | 403 — org layer is admin-only | status 403 |
| 75 | ✅ | permission | Member writes a TEAM-layer memory | 403 — team layer is admin/lead only | status 403 |
| 76 | ✅ | pressure | Fetch an already-expired memory by id | expired entries are not returned | GET status 404 |

### Routines

| # | Result | Type | Scenario (user story) | Expected | Hearth responded |
|---|---|---|---|---|---|
| 77 | ✅ | happy | Create a scheduled routine (valid cron) | 201 | status 201 |
| 78 | ✅ | happy | Run-now executes the routine | a run is created and completes (success/failed) | run-now 200; run status=success |
| 79 | ✅ | user_error | Invalid cron string | 400 | status 400 |
| 80 | ✅ | pressure | Impossible-but-valid-shape cron (Feb 31) | created (201) but worker skips scheduling without crashing | status 201 |
| 81 | ✅ | permission | Member creates an org-scoped routine | rejected — only admin/lead should create org-scope | status 403, scope=undefined |
| 82 | ✅ | permission | Unrelated user reads another user's routine run history | 403/404 — not the owner | status 404, 0 runs returned |
| 83 | ✅ | pressure | Run-now on a disabled routine | rejected, or clearly no-op (not a silent enqueue) | run-now 409; runs=0 |
| 84 | ✅ | pressure | Routine with an approval checkpoint | run pauses at awaiting_approval until resolved | run statuses=awaiting_approval |

### Routines (internals)

| # | Result | Type | Scenario (user story) | Expected | Hearth responded |
|---|---|---|---|---|---|
| 85 | ✅ | happy | Chain A → B on success | 201 | status 201 |
| 86 | ✅ | user_error | Self-chain A → A | 400 | status 400 |
| 87 | ✅ | pressure | Cycle B → A (A→B already exists) | 400 cycle detected | status 400 |
| 88 | ✅ | permission | Non-owner adds a chain to someone's routine | 403/404 — not the owner | status 409 |
| 89 | ✅ | happy | Attach an event trigger to a routine | 201 | status 201 |
| 90 | ✅ | permission | Non-owner attaches a trigger to someone's routine | 403/404 | status 404 |
| 91 | ✅ | happy | Put + get run-to-run state | 200 roundtrip | put 200; get 200 {"counter":1,"lastSeen":"pr-42"} |
| 92 | ✅ | permission | Non-owner reads another routine's state | 404 — scope-checked | status 404 |
| 93 | ✅ | happy | Admin creates a routine health alert | 201 | status 201 |
| 94 | ✅ | permission | Non-admin creates a health alert | 403 | status 403 |

### Skills

| # | Result | Type | Scenario (user story) | Expected | Hearth responded |
|---|---|---|---|---|---|
| 95 | ✅ | happy | Member creates a personal skill | 201, status published (personal auto-publishes) | status 201, skill=published |
| 96 | ✅ | permission | Member creates an org-scoped skill | rejected — org skills should require a lead/admin | status 403, skill status=undefined |
| 97 | ✅ | permission | A user lists skills and sees another user's personal skill | personal skills are private to their author | sees 'pr-triage-76074' (dev1's personal)=false |
| 98 | ✅ | pressure | Double-install the same skill | installCount counts the user once (idempotent) | i1=201 i2=201; installCount=1 |
| 99 | ✅ | permission | Member calls /skills/seed | 403 — admin only | status 403 |
| 100 | ✅ | error | GET /skills/proposals | reaches the proposals handler (list), not shadowed by /:id | status 200: {"data":[]} |
| 101 | ✅ | pressure | Agent proposes a reusable skill via propose_skill | agent invokes propose_skill → a draft auto_generated skill is created | +1 auto skills |

### Task Context

| # | Result | Type | Scenario (user story) | Expected | Hearth responded |
|---|---|---|---|---|---|
| 102 | ✅ | happy | Add a note context item | 201 | status 201 |
| 103 | ✅ | happy | Add a link context item | 201 | status 201 |
| 104 | ✅ | happy | Add a text_block context item | 201 | status 201 |
| 105 | ✅ | user_error | Add context item without rawValue | 400 | status 400 |
| 106 | ✅ | happy | Upload a small text file | 201 | status 201 |
| 107 | ✅ | pressure | Upload a file over the 10MB limit | rejected (413/400) | status 413 |
| 108 | ✅ | user_error | Upload a disallowed MIME (application/zip) | rejected | status 400 |
| 109 | ✅ | violation | Upload with a path-traversal filename | filename sanitized; no traversal | status 201 |

### Tasks

| # | Result | Type | Scenario (user story) | Expected | Hearth responded |
|---|---|---|---|---|---|
| 110 | ✅ | happy | Create a task (manual) | 201, status auto_detected | status 201, task auto_detected |
| 111 | ✅ | happy | Transition auto_detected → backlog | 200 | status 200 |
| 112 | ✅ | user_error | Illegal transition backlog → done | 422 invalid transition | status 422 |
| 113 | ✅ | happy | Planner runs and advances the task | planner produces subtasks and auto-advances to executing | status after planning: executing |
| 114 | ✅ | pressure | Subtask status vs executor filter | subtasks created in a status the executor will run (backlog) | 11 subtasks, statuses=[backlog,backlog,backlog,backlog,backlog,backlog,backlog,backlog,backlog,backlog,backlog] |
| 115 | ✅ | happy | Executor runs and advances to review | task reaches review | status: review |
| 116 | ✅ | user_error | changes_requested without feedback | 400 | status 400 |
| 117 | ✅ | happy | Approve review → done | task → done | review status 201, task done |
| 118 | ✅ | pressure | Two competing transitions from the same status | one 200, one rejected (409 CAS-conflict or 422 now-invalid) | statuses 200 & 422 |
| 119 | ✅ | user_error | Create task without a title | 400 | status 400 |
| 120 | ✅ | permission | Patch another user's task | 404 (not owner) | status 404 |

