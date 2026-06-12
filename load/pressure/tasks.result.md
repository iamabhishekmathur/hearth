# Task lifecycle pressure results (key: tasks)

Ran `load/pressure/tasks.sim.ts` against the LIVE stack (real agent + planner +
executor workers). 3 human scenarios, 324s wall. No mocks.

## Verdict per assertion
| ID | Status | Evidence |
|----|--------|----------|
| A1 | PASS | promote(targetStatus=planning)->201, message.producedTaskIds=[taskId] |
| A2 | PASS | chat_excerpt item, label='From chat', deepLink=/chat/:sid?messageId=:mid |
| A3 | PASS | planner produced 11 subTasks |
| A4 | PASS | planning step durationMs=15630; 5 execution steps; toolUsed=recall_memory, slack_search_messages, create_artifact x2 |
| A5 | PASS | auto-advanced planning->executing->review with ZERO manual PATCH |
| A6 | **FAIL** | NO task_progress milestones in chat (none of started/executing/review). Root cause below. |
| A6-done | **FAIL** | no 'done' milestone after approve — AND no caller ever posts milestone:'done' |
| A7 | PASS | approve->201, status=done, 1 approved review row |
| B1 | PASS | changes_requested(feedback)->201, status=planning |
| B2 | PASS | context.reviewFeedback == submitted feedback string |
| B3 | PASS | changes_requested without feedback -> 400 |
| B4 | PASS | re-plan reached review again; SECOND phase=planning step (1->2) |
| B5 | PASS | 2nd approve->done; 2 reviews ordered [changes_requested, approved] |
| B6 | INC->defect | executing=0 review=0 milestones across the whole loop — same root cause as A6 (not dedup) |
| C1 | PASS* | idempotent: same taskId both calls, producedTaskIds has it once, existing:true. *Literal 201/200 failed only because the AGENT auto-created the task first (race) so BOTH explicit promotes were 200/existing. Cross-path dedup is correct. |
| C2 | PASS | PATCH backlog->done -> 422 "Invalid status transition from backlog to done" |
| C3 | PASS | exactly one chat_excerpt context item after double-promote |
| C4 | PASS | planning->200 then backlog->200 (guard not over-broad) |

## Root cause of A6/A6-done/B6 (P0)
`postTaskProgress` (apps/api/src/services/chat-service.ts:697) calls
`prisma.chatMessage.findFirst({ ..., take: 25 })`. Prisma rejects findFirst with
take != 1/-1: "The 'findFirst' operation cannot be used with a 'take' argument
that isn't 1 or -1". This throws on the FIRST query inside postTaskProgress,
before any insert. Every caller wraps it in .catch() and swallows the error, so
it fails silently. Verified directly: the entire DB has 0 chat_messages with
role='system' — the task_progress milestone feature has never produced a single
row. A direct probe importing the real service reproduced the throw.

Separately, even with that fixed, milestone:'done' has a label but NO caller —
the 'done' card is unimplemented (grep: zero `milestone: 'done'`).

## Repro
API_URL=http://localhost:8000/api/v1 ./apps/api/node_modules/.bin/tsx load/pressure/tasks.sim.ts
