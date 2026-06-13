# Hearth E2E Coverage Matrix

Generated 2026-06-12T19:39:01.879Z · 146 scenarios

| Feature | happy | error | user_error | violation | permission | pressure |
|---|---|---|---|---|---|---|
| Admin & Platform | 9✅ | · | · | 1✅ | 5✅ 1❌ | · |
| Artifacts | 3✅ | · | · | · | · | 0✅ 1❌ |
| Chat & Artifacts | 19✅ 1❌ | 2✅ | 4✅ | · | 3✅ 5❌ | · |
| Decisions | 2✅ 1❌ | · | 1✅ 1❌ | · | 0✅ 1❌ | 0✅ 1❌ |
| Decisions (graph) | 6✅ | · | · | · | 0✅ 1❌ | 0✅ 1❌ |
| Governance & Compliance | 10✅ | · | · | 4✅ 1🟡 | 2✅ | 2✅ 1❌ |
| Intake & Detection | 4✅ | 0✅ 1❌ | · | 0✅ 1❌ | · | · |
| Memory | 2✅ | · | · | · | 2✅ | 0✅ 1❌ |
| Routines | 2✅ | · | 1✅ | · | 0✅ 2❌ | 1✅ 1❌ 1🟡 |
| Routines (internals) | 4✅ | · | 1✅ | · | 3✅ 1❌ | 1✅ |
| Skills | 2✅ | 0✅ 1🟡 | · | · | 1✅ 3❌ | 0✅ 2❌ |
| Task Context | 4✅ | · | 1✅ 1❌ | 1✅ | · | 0✅ 1❌ |
| Tasks | 5✅ | · | 3✅ | · | 1✅ | 0✅ 1❌ 1🟡 |

## Defects (31)

- **[Governance & Compliance/monitor + PII scrub]** (violation) Raw SSN appeared in the AI reply — egress scrub likely missed it  
  ↳ _Support agent includes a customer SSN_
- **[Governance & Compliance/violation export]** (pressure) Governance export includes raw emails / SSN snippets in plaintext (regulated-data exposure)  
  ↳ _Violation export content_
- **[Governance & Compliance/fail-open]** (pressure) Invalid-regex block policy fails OPEN — message passes through (regulated orgs expect fail-closed)  
  ↳ _Block policy with an invalid regex_
- **[Chat & Artifacts/artifact RBAC]** (permission) A viewer (read-only collaborator) can CREATE artifacts — write gated on read access  
  ↳ _Viewer-collaborator creates an artifact_
- **[Chat & Artifacts/artifact RBAC]** (permission) A viewer can DELETE another user's artifact (no creator check)  
  ↳ _Viewer deletes the owner's artifact_
- **[Chat & Artifacts/info leak]** (permission) Any authenticated user can list collaborators (names+emails) of a session by id — no access check  
  ↳ _Unrelated user lists a session's collaborators_
- **[Chat & Artifacts/tenancy]** (permission) Owner can add a user from ANOTHER org as a collaborator (tenancy bypass — grants cross-org read)  
  ↳ _Owner adds a cross-org user as collaborator_
- **[Tasks/decomposition]** (pressure) 13 subtask(s) created as 'auto_detected' — executor only runs 'backlog', so they may never execute (planner/executor status mismatch)  
  ↳ _Subtask status vs executor filter_
- **[Intake & Detection/signature bypass]** (violation) JIRA webhook signature verification is a no-op — forged/unsigned payloads are accepted  
  ↳ _Unsigned forged JIRA webhook_
- **[Intake & Detection/email intake]** (error) Email intake is unimplemented (poll_email returns skipped) — inbound emails never become tasks despite being an advertised source  
  ↳ _Email → task detection_
- **[Routines/scope RBAC]** (permission) A member can create an ORG-scoped routine — no role check on scope  
  ↳ _Member creates an org-scoped routine_
- **[Routines/run-history leak]** (permission) listRuns has no permission check — any user can read another routine's run history/outputs by id  
  ↳ _Unrelated user reads another user's routine run history_
- **[Routines/approval gate]** (pressure) Approval checkpoint never pauses the run (awaiting_approval never set) — checkpoint gating is dead code  
  ↳ _Routine with an approval checkpoint_
- **[Skills/scope RBAC]** (permission) A member can create an ORG-scoped skill (goes to pending_review) — no role gate on scope  
  ↳ _Member creates an org-scoped skill_
- **[Skills/cross-scope leak]** (permission) listSkills filters org-only — a user sees every other user's personal skills (cross-scope leak)  
  ↳ _A user lists skills and sees another user's personal skill_
- **[Skills/install count]** (pressure) Double-install inflates installCount (now 2) — increment runs unconditionally on idempotent upsert  
  ↳ _Double-install the same skill_
- **[Skills/seed RBAC]** (permission) POST /skills/seed has no role gate — any member can seed org skills (comment says admin only)  
  ↳ _Member calls /skills/seed_
- **[Skills/route shadowing]** (error) GET /skills/proposals is shadowed by GET /skills/:id (id="proposals")  
  ↳ _GET /skills/proposals_
- **[Skills/propose_skill]** (pressure) propose_skill created no skill — likely the createProposedSkill `created_via` write to a non-existent column throws  
  ↳ _Agent proposes a skill (created_via column)_
- **[Memory/expiry]** (pressure) GET /memory/:id returns an EXPIRED entry (no expiry filter on the by-id read — inconsistent with listing/search)  
  ↳ _Fetch an already-expired memory by id_
- **[Decisions/validation]** (user_error) Invalid enum (confidence/scope) returns 500 — no request-body validation (Zod) on decisions  
  ↳ _Capture decision with invalid enum values_
- **[Decisions/dedup]** (pressure) Duplicate decision is silently merged and returned as a 201 with the EXISTING id — caller cannot tell it was deduped  
  ↳ _Capture a near-duplicate decision_
- **[Decisions/tenancy]** (permission) A teamless user can create a decision — getOrgId falls back to the OLDEST org in the DB (cross-tenant write)  
  ↳ _Teamless user captures a decision_
- **[Task Context/upload limits]** (pressure) Oversize upload returns 500 instead of a clean 413/400  
  ↳ _Upload a file over the 10MB limit_
- **[Artifacts/concurrency]** (pressure) Concurrent updates desynced version (3) from version-row count (4) — no optimistic concurrency control  
  ↳ _Concurrent artifact updates_
- **[Routines (internals)/trigger RBAC]** (permission) Trigger CRUD has no permission/org check — cross-user trigger injection  
  ↳ _Non-owner attaches a trigger to someone's routine_
- **[Decisions (graph)/link RBAC]** (permission) Decision link endpoints have no org/ownership validation — cross-user/cross-org linking  
  ↳ _Non-owner adds a link to someone's decision_
- **[Decisions (graph)/conflict detection]** (pressure) No conflict detection — two directly-contradictory decisions are both stored as active with no contradiction flag/alert  
  ↳ _Two directly-contradictory org decisions_
- **[Admin & Platform/tenancy]** (permission) Admin can move a user into a DIFFERENT org's team — updateUserTeam connects a team by id with no org check (cross-tenant user exfiltration)  
  ↳ _Admin moves a user into ANOTHER org's team_
- **[Chat & Artifacts/chat→artifact (html)]** (happy) No artifact created for a html work-product request  
  ↳ _Agent produces a html artifact_
- **[Chat & Artifacts/info leak]** (permission) Any authenticated user can list collaborators (names+emails) of a session by id — no access check  
  ↳ _Unrelated user lists a session's collaborators_

## Failures & partials

- 🟡 **[Governance & Compliance/monitor + PII scrub]** Support agent includes a customer SSN — expected: monitor violation recorded; SSN scrubbed before LLM; reply does not echo raw SSN · observed: reply len 2137; reply-echoed-SSN=true
- ❌ **[Governance & Compliance/fail-open]** Block policy with an invalid regex — expected: a regulated org should fail CLOSED (block on policy error) · observed: created=201; message status 202
- ❌ **[Chat & Artifacts/artifact RBAC]** Viewer-collaborator creates an artifact — expected: viewers should not write; expect 403 · observed: status 201
- ❌ **[Chat & Artifacts/artifact RBAC]** Viewer deletes the owner's artifact — expected: non-creator should not delete; expect 403 · observed: status 200
- ❌ **[Chat & Artifacts/info leak]** Unrelated user lists a session's collaborators — expected: 403/404 — no access · observed: status 200, 1 names returned
- ❌ **[Chat & Artifacts/tenancy]** Owner adds a cross-org user as collaborator — expected: rejected — cross-tenant · observed: status 201
- ❌ **[Tasks/decomposition]** Subtask status vs executor filter — expected: subtasks created in a status the executor will run (backlog) · observed: 13 subtasks, statuses=[auto_detected,auto_detected,auto_detected,auto_detected,auto_detected,auto_detected,auto_detected,auto_detected,auto_detected,auto_detected,auto_detected,auto_detected,auto_detected]
- 🟡 **[Tasks/concurrency]** Two competing transitions from the same status — expected: one 200, one 409 (compare-and-set) · observed: statuses 200 & 422
- ❌ **[Intake & Detection/signature bypass]** Unsigned forged JIRA webhook — expected: rejected (401) — no valid signature · observed: status 200
- ❌ **[Intake & Detection/email intake]** Email → task detection — expected: inbound email is detected into a task · observed: poll_email worker is a stub — no Gmail connector / no email→task path exists
- ❌ **[Routines/scope RBAC]** Member creates an org-scoped routine — expected: rejected — only admin/lead should create org-scope · observed: status 201, scope=org
- ❌ **[Routines/run-history leak]** Unrelated user reads another user's routine run history — expected: 403/404 — not the owner · observed: status 200, 1 runs returned
- 🟡 **[Routines/disabled run-now]** Run-now on a disabled routine — expected: rejected, or clearly no-op (not a silent enqueue) · observed: run-now 200; runs=1
- ❌ **[Routines/approval gate]** Routine with an approval checkpoint — expected: run pauses at awaiting_approval until resolved · observed: run statuses=success
- ❌ **[Skills/scope RBAC]** Member creates an org-scoped skill — expected: rejected — org skills should require a lead/admin · observed: status 201, skill status=pending_review
- ❌ **[Skills/cross-scope leak]** A user lists skills and sees another user's personal skill — expected: personal skills are private to their author · observed: sees 'pr-triage' (dev1's personal)=true
- ❌ **[Skills/install count]** Double-install the same skill — expected: installCount counts the user once (idempotent) · observed: i1=201 i2=201; installCount=2
- ❌ **[Skills/seed RBAC]** Member calls /skills/seed — expected: 403 — admin only · observed: status 200
- 🟡 **[Skills/route shadowing]** GET /skills/proposals — expected: returns the proposals list · observed: status 404: {"error":"Skill not found"}
- ❌ **[Skills/propose_skill]** Agent proposes a skill (created_via column) — expected: a draft auto_generated skill is created · observed: +0 auto skills; reply hints error=true
- ❌ **[Memory/expiry]** Fetch an already-expired memory by id — expected: expired entries are not returned · observed: GET status 200
- ❌ **[Decisions/validation]** Capture decision with invalid enum values — expected: 400 validation error · observed: status 500
- ❌ **[Decisions/dedup]** Capture a near-duplicate decision — expected: dedup is transparent (e.g. 200 + a "merged" flag), not a silent 201 of the old row · observed: status 201; returned-existing-id=true
- ❌ **[Decisions/outcomes]** Record a decision outcome — expected: 200/201 · observed: status 400
- ❌ **[Decisions/tenancy]** Teamless user captures a decision — expected: rejected — user has no org · observed: status 201
- ❌ **[Task Context/upload limits]** Upload a file over the 10MB limit — expected: rejected (413/400) · observed: status 500
- ❌ **[Task Context/upload MIME]** Upload a disallowed MIME (application/zip) — expected: rejected · observed: status 500
- ❌ **[Artifacts/concurrency]** Concurrent artifact updates — expected: no lost update / version collision (optimistic concurrency) · observed: a=200 b=200; final version=3; 4 version rows
- ❌ **[Routines (internals)/trigger RBAC]** Non-owner attaches a trigger to someone's routine — expected: 403/404 · observed: status 201
- ❌ **[Decisions (graph)/link RBAC]** Non-owner adds a link to someone's decision — expected: 403/404 — not owner/org-scoped · observed: status 201
- ❌ **[Decisions (graph)/conflict detection]** Two directly-contradictory org decisions — expected: system flags the contradiction · observed: both created (c1=201, c2=201); no conflict surfaced
- ❌ **[Admin & Platform/tenancy]** Admin moves a user into ANOTHER org's team — expected: rejected — cross-tenant move · observed: status 200; moved=true (restored)
- ❌ **[Chat & Artifacts/chat→artifact (html)]** Agent produces a html artifact — expected: artifact created + linked to its message (card renders) · observed: 0 artifact(s), types=, linked=true
- ❌ **[Chat & Artifacts/info leak]** Unrelated user lists a session's collaborators — expected: 403/404 — no access · observed: status 200, 1 names returned
