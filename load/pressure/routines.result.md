# Routines pressure test — results (2026-06-12)

Ran `load/pressure/routines.sim.ts` against the live API + workers. 3 real scenarios, 26s wall.
Full log: `load/pressure/routines.run.log`.

| ID | Assertion | Status | Evidence |
|----|-----------|--------|----------|
| A1 | run completes success + non-empty output.result | PASS | run.status=success, result len=592 |
| A2 | {{team}} interpolates → 'Payments' in output | PASS | result opens "**Payments team** — this stale-PR sweep…" |
| A3 | lastRunStatus/lastRunAt updated | PASS | GET /routines/:id lastRunStatus=success, lastRunAt=2026-06-12T04:33:03Z (recent) |
| A4 | durationMs recorded; tokenCount null (gap) | PASS-as-gap | durationMs=4611; tokenCount=null (worker never records token usage) |
| B1 | approval checkpoint pauses run as awaiting_approval + surfaces approval | **FAIL (gap)** | checkpoint stored at create; run trail running→success; /approvals stayed count=0 |
| B2 | resolving approval resumes run | INCONCLUSIVE | no approval ever created (blocked by B1) |
| C1 | malformed cron rejected at route | PASS | POST /routines schedule:'not a cron at all' → 400 "Invalid cron schedule. Use 5-field cron format…" |
| C2 | valid routine still runs to success (queue not poisoned) | PASS | good routine run.status=success, resultLen=214 |
| C3 | in_app delivery writes a discoverable notification row | **FAIL (gap)** | /notifications items 15→15, unread 15→15, routine-result rows=0 |

## Key gaps confirmed against source

- **Approval checkpoints are dead config (B1).** `POST /routines` accepts + persists `checkpoints` and
  echoes them back, but `jobs/routine-scheduler.ts` worker never reads `routine.checkpoints`, never calls
  `createApprovalRequest`. The run goes straight to `success` and delivers immediately. A product lead who
  adds a sign-off gate gets ZERO gate — the customer-facing announcement is "delivered" with no human review.
  `GET /approvals` is permanently empty for routine runs.

- **in_app routine delivery never reaches the bell (C3).** `services/delivery-service.ts` `deliver()` for
  `in_app` only calls `emitToUser(userId,'notification',…)` — a transient socket event. It never calls
  `notification-service.notify()`, which is the only thing that writes a `Notification` row. Verified the
  bell is otherwise live: existing rows like `collaborator_added` persist fully. So a completed routine
  result is invisible to any user who wasn't watching the socket at that instant (offline, refreshed, etc.).

- **tokenCount never recorded (A4).** `completeRun` supports `tokenCount` but the success path in the worker
  only passes `{status,output,durationMs,summary}`. Cost/usage reporting per run is impossible.

## Notable
- Parameter interpolation is solid: `{{team}}` correctly replaced in the REAL Claude prompt and the model
  echoed "Payments team" verbatim. Validation of parameterValues against the schema works at run-now.
- Malformed cron is correctly rejected at the route boundary; a prior bad-cron POST did not poison the queue.
- Real agent latency was ~4.6s/run — fast, no timeouts.
