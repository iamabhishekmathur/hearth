# Hearth E2E Coverage Matrix

Generated 2026-06-13T01:23:55.622Z · 110 scenarios

| Feature | happy | error | user_error | violation | permission | pressure |
|---|---|---|---|---|---|---|
| Admin & Platform | 9✅ | · | · | 1✅ | 6✅ | · |
| Artifacts | 3✅ | · | · | · | · | 0✅ 1❌ |
| Decisions | 2✅ 1❌ | · | 2✅ | · | 1✅ | 0✅ 1❌ |
| Decisions (graph) | 5✅ 1🟡 | · | · | · | 1✅ | 0✅ 1❌ |
| Governance & Compliance | 10✅ | · | · | 5✅ | 2✅ | 3✅ |
| Intake & Detection | 4✅ 1🟡 | · | · | 1✅ | 1✅ | · |
| Memory | 2✅ | · | · | · | 2✅ | 1✅ |
| Routines | 2✅ | · | 1✅ | · | 2✅ | 2✅ 1🟡 |
| Routines (internals) | 4✅ | · | 1✅ | · | 4✅ | 1✅ |
| Skills | 0✅ 1❌ | 0✅ 1🟡 | · | · | 3✅ | 0✅ 1❌ |
| Task Context | 4✅ | · | 2✅ | 1✅ | · | 1✅ |
| Tasks | 5✅ | · | 3✅ | · | 1✅ | 2✅ |

## Defects (6)

- **[Governance & Compliance/violation export]** (pressure) Governance export includes raw emails / SSN snippets in plaintext (regulated-data exposure)  
  ↳ _Violation export content_
- **[Intake & Detection/email detection]** (happy) Actionable inbound email did not produce an auto_detected task within timeout  
  ↳ _Inbound email (subject+body) → auto-detected task_
- **[Skills/propose_skill]** (pressure) propose_skill created no skill — likely the createProposedSkill `created_via` write to a non-existent column throws  
  ↳ _Agent proposes a skill (created_via column)_
- **[Decisions/dedup]** (pressure) Duplicate decision is silently merged and returned as a 201 with the EXISTING id — caller cannot tell it was deduped  
  ↳ _Capture a near-duplicate decision_
- **[Artifacts/concurrency]** (pressure) Concurrent updates desynced version (3) from version-row count (4) — no optimistic concurrency control  
  ↳ _Concurrent artifact updates_
- **[Decisions (graph)/conflict detection]** (pressure) Contradiction between two opposing same-domain decisions was not flagged  
  ↳ _Two directly-contradictory org decisions_

## Failures & partials

- 🟡 **[Intake & Detection/email detection]** Inbound email (subject+body) → auto-detected task — expected: 200 ack; Hearth detects the ask and creates an email-sourced auto_detected task · observed: ack 200; new tasks=0
- 🟡 **[Routines/disabled run-now]** Run-now on a disabled routine — expected: rejected, or clearly no-op (not a silent enqueue) · observed: run-now 200; runs=1
- ❌ **[Skills/create]** Member creates a personal skill — expected: 201, status published (personal auto-publishes) · observed: status 409, skill=undefined
- 🟡 **[Skills/route shadowing]** GET /skills/proposals — expected: returns the proposals list · observed: status 400: {"error":"taskId query parameter is required"}
- ❌ **[Skills/propose_skill]** Agent proposes a skill (created_via column) — expected: a draft auto_generated skill is created · observed: +0 auto skills; reply hints error=true
- ❌ **[Decisions/dedup]** Capture a near-duplicate decision — expected: dedup is transparent (e.g. 200 + a "merged" flag), not a silent 201 of the old row · observed: status 201; returned-existing-id=true
- ❌ **[Decisions/outcomes]** Record a decision outcome — expected: 200/201 · observed: status 400
- ❌ **[Artifacts/concurrency]** Concurrent artifact updates — expected: no lost update / version collision (optimistic concurrency) · observed: a=200 b=200; final version=3; 4 version rows
- 🟡 **[Decisions (graph)/link]** Add a dependency link between decisions — expected: 201 · observed: status 409
- ❌ **[Decisions (graph)/conflict detection]** Two directly-contradictory org decisions — expected: system flags the contradiction (a contradicts link surfaced via /conflicts) · observed: both created (c1=201, c2=201); conflicts surfaced=0
