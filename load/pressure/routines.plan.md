# Pressure Test Plan — Routines (create → run → delivery → approvals → chains)

Key: `routines`
Date: 2026-06-12
API base: `http://localhost:8000/api/v1` (LIVE — real agent + workers, nothing mocked)

## Confirmed endpoints & shapes (read from source)

Mounts (`apps/api/src/index.ts`):
- `/api/v1/routines` → `routes/routines.ts` AND `routes/chains.ts` (both mounted on same prefix)
- `/api/v1/approvals` → `routes/approvals.ts`
- `/api/v1/notifications` → `routes/notifications.ts`

### Routines (`routes/routines.ts`)
- `POST /routines` body `{ name, prompt, schedule?, description?, context?, delivery?, parameters?, checkpoints?, stateConfig?, scope?, teamId? }`
  - `name` + `prompt` required (else 400). `schedule` optional; if present must pass `isValidCron` (exactly 5 whitespace-separated fields, each matching `^(\*|[0-9]{1,2})([,-/][0-9*]{1,3})*$`) else 400 "Invalid cron schedule...".
  - Returns **201** `{ data: routine }`.
- `POST /routines/:id/run-now` body `{ parameterValues? }` → **200** `{ message: 'Routine execution enqueued' }` (async — does NOT wait for the run). `:id` must be UUID v4 (else 400 "Invalid ID format"). Validates parameterValues against the routine's parameter schema (400 on mismatch).
- `GET /routines/:id/runs?page=` → **200** `{ data: runs[], total, page, pageSize }`. **NOTE: runs are the bare array under `data`, NOT `data.data`.** Each run row: `{ id, routineId, status('running'|'success'|'failed'), output (JSON, e.g. {result}), error, durationMs, tokenCount, summary, triggeredBy, startedAt, completedAt, ... }`. Ordered `startedAt desc`.
- `GET /routines/:id` → **200** `{ data: routine }` incl. `lastRunStatus`, `lastRunAt`, `parameters`, `checkpoints`, `delivery`.
- `POST /routines/:id/chains` body `{ targetRoutineId, condition?, parameterMapping? }` → **201** `{ data: chain }`. `targetRoutineId` required (else 400). Cycle/self-reference → 400.
- `GET /routines/:id/chains` → `{ data: chains[] }`.

### Approvals (`routes/approvals.ts`)
- `GET /approvals` → `{ data: approvals[] }` (pending approvals for current user; only `status='pending'`).
- `POST /approvals/:id/resolve` body `{ decision('approved'|'rejected'|'edited'), comment?, editedOutput? }` → 200 `{ data: result }`. 403 if not owner/admin. 404 if not found/already resolved.

### Notifications (`routes/notifications.ts`)
- `GET /notifications?unreadOnly=&limit=` → **200** `{ data: { items[], unreadCount } }`.

## Execution model (read from `jobs/routine-scheduler.ts` + `services/*`)
- `run-now` → `enqueueRoutineNow` → BullMQ routine-execution worker.
- Worker: creates run (`status:'running'`), interpolates prompt via `resolvePromptTemplate` (syntax **`{{paramName}}`**, `routine-parameter-service.ts:93`), runs the real agent loop, then `completeRun({status:'success', output:{result: <agent text>}, durationMs, summary})` and updates `routine.lastRunAt/lastRunStatus='success'`.
- **`tokenCount` is never passed by the worker** → expect `tokenCount: null` on every run (record this as observed, not a hard failure).
- Delivery (`deliver()` in `services/delivery-service.ts`): for `in_app` it ONLY calls `emitToUser(userId,'notification',{...})` — a transient socket event. **No Notification DB row is written.** (Slack/email branches do real I/O.)
- **Checkpoints/approvals: `createApprovalRequest` (approval-service.ts:6) has ZERO non-test callers.** The execution worker never reads `routine.checkpoints`, never creates an approval, never sets `awaiting_approval`. `awaiting_approval` appears only in a test file. Strong prior: the approval-checkpoint pause flow is **not wired into routine execution** — the run will go straight to `success`. The live test will confirm the observable behavior.

## Scenarios (2-3 real, human; patient async polling)

### Scenario 1 — Stale-PR sweep (Devin Rao, eng lead), on-demand, parameter interpolation
Narrative: Devin, the engineering lead, wants a quick on-demand "stale PR sweep" he can fire whenever review velocity drops. He builds it once with a `{{team}}` parameter so he can target a specific squad, then runs it now for the "Payments" team and reads the result.
Steps:
1. Login `eng-lead@hearth.local`.
2. `POST /routines` `{ name:'Stale PR sweep', prompt:'Write a short stale-PR sweep summary for the {{team}} team. Mention the team name explicitly and list 2-3 example follow-up actions.', schedule:'0 9 * * 1-5', delivery:{channels:['in_app']}, parameters:[{name:'team', type:'string', required:true}] }`.
3. `POST /routines/:id/run-now` `{ parameterValues:{ team:'Payments' } }` → expect 200 + enqueued message.
4. Poll `GET /routines/:id/runs` until latest `status!=='running'` (up to ~120s).
Assertions (REST-observable):
- **A1** run completes `status==='success'` with non-empty `output.result`.
- **A2** `output.result` (or `summary`) contains the literal interpolated value `"Payments"` → proves `{{team}}` interpolated into the real prompt/output.
- **A3** `GET /routines/:id` shows `lastRunStatus==='success'` and `lastRunAt` set (non-null, recent).
- **A4** `durationMs` present (> 0); record `tokenCount` (expected null — report as a gap).

### Scenario 2 — Approval checkpoint should pause (Dana Lewis, product lead) — PROBES the checkpoint gap
Narrative: Dana sets up a routine that drafts an external-facing customer announcement and adds an approval checkpoint, expecting the run to PAUSE for her sign-off before the draft is "final". She runs it and checks whether an approval actually appears for her to resolve.
Steps:
1. Login `product-lead@hearth.local`.
2. `POST /routines` `{ name:'Customer announcement draft', prompt:'Draft a 3-sentence customer-facing announcement for our new saved-views feature.', delivery:{channels:['in_app']}, checkpoints:[{ ... ApprovalCheckpointDef shape per shared types; e.g. {name:'Review draft', requireApproval:true} ... }] }`. (Confirm `ApprovalCheckpointDef` field names from `@hearth/shared` at sim-build time; if creation 400s, that itself is a finding.)
3. `POST /routines/:id/run-now`.
4. Poll runs for up to ~120s.
Assertions:
- **B1 (expected per spec)** run reaches `status==='awaiting_approval'` and pauses; `GET /approvals` lists a pending approval for Dana.
- **B2 (resume)** `POST /approvals/:id/resolve {decision:'approved'}` → run resumes and reaches `success`.
- **EXPECTED OBSERVED (gap):** per source, no approval is created and the run goes straight to `success` with no `awaiting_approval` state and an empty `GET /approvals`. **Report the divergence with evidence (run status timeline + empty approvals list).** Do NOT fake B1/B2 — record what actually happens.

### Scenario 3 — Malformed cron must not crash the worker; in_app delivery discoverability — PROBES the notification gap
Narrative: Sam Park, a backend engineer, fat-fingers a cron when creating a routine, then runs a valid routine and expects to find its result in the notification bell afterward.
Steps:
1. Login `dev1@hearth.local`.
2. **Malformed cron**: `POST /routines` `{ name:'Bad cron', prompt:'...', schedule:'not a cron at all', delivery:{channels:['in_app']} }` → expect **400** "Invalid cron schedule..." (rejected at the route — confirms a bad cron never reaches/crashes the scheduler worker).
3. **Valid routine still runs**: `POST /routines` a valid one (no schedule, `delivery:{channels:['in_app']}`), `run-now`, poll to `success`. This proves other routines run fine despite the earlier bad-cron attempt.
4. Capture `GET /notifications` unreadCount **before** the run; after the run completes, poll `GET /notifications` for ~20s.
Assertions:
- **C1** malformed cron → 400, no routine created, no worker impact.
- **C2** valid routine reaches `success` with non-empty `output.result` (the bad-cron attempt did not poison the queue).
- **C3 (notification gap)** after a completed `in_app` routine, `GET /notifications` `items`/`unreadCount` does **NOT** gain a routine-result notification → the result is **silently lost** from the notification center (only a transient socket event was emitted). **Report the before/after notification counts as evidence.** If a row DOES appear, that contradicts the source read — report that instead.

## Optional (only if time, after 1-3): 2-routine chain
- Create routine A (emits short text) + routine B. `POST /routines/:A/chains {targetRoutineId:B, condition?, parameterMapping?}`. `run-now` A, poll A→success, then poll B's runs for an auto-triggered run (`triggeredBy` reflecting chain). Assert B ran as a downstream of A. Drop this if wall-time is tight.

## Reporting rules
- Observe everything via REST GET (no socket dependency). Be patient (async workers, 5-30s+ agent replies).
- Copy the Hearth client (cookies + CSRF + polling) from `load/simulate-llm-dialogue.ts`.
- NEVER fake a pass. For Scenario 2 (checkpoints) and Scenario 3/C3 (notifications), the source strongly predicts the feature is NOT wired — report the concrete divergence (status codes, run-status timeline, empty approvals list, before/after notification counts) as findings.
