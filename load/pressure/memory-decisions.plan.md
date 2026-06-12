# Pressure Test Plan — Memory + Decisions + Logging Discipline

Key: `memory-decisions`
Domain: Memory and Decisions getting stored CORRECTLY and concurrently with normal work — and pressure-testing the LOGIC of what gets logged vs not (precision/recall of the logging pipeline). Highest-judgment domain.

All endpoints below were CONFIRMED by reading the source, not assumed. The task brief's
route names were slightly off; corrections noted inline.

---

## Confirmed endpoints + shapes (verified against source)

### Memory — `apps/api/src/routes/memory.ts` + `services/memory-service.ts` + agent `tool-router.ts`
- `GET  /memory?layer=&page=&pageSize=` → `{ data: MemoryEntry[], total, page, pageSize }`.
  Default (no `layer`) returns org+team+user+session entries visible to the caller,
  **excluding expired** (`expiresAt` null OR > now). So persistent saves AND live
  session notes both appear; expired session notes vanish.
- `POST /memory` `{ layer, content, source?, sourceRef?, expiresAt? }` → 201 `{ data }`.
  **Route only accepts layers `['org','team','user']`** (rejects `session` with 400/403).
- `PATCH /memory/:id`, `DELETE /memory/:id`, `POST /memory/search { query, layer?, limit? }`.
- **CRITICAL: there is NO LLM auto-extraction worker for memory.** Memory is written ONLY by:
  (a) explicit `POST /memory`, or
  (b) the agent calling its `save_memory` tool (layer `user`, persistent) or
      `session_note` tool (layer `session`, 24h TTL) during a chat turn.
  The agent's tool descriptions: `save_memory` = "when the user explicitly asks you to
  remember something, or when you learn a preference/fact/context useful in future
  conversations"; `session_note` = ephemeral per-conversation context. **So the
  "remember that X" → stored behavior is entirely an agent judgment call** — this is the
  precision/recall surface we test for memory.

### Decisions — `apps/api/src/routes/decisions.ts` + `services/decision-service.ts`
- `GET  /decisions?cursor=&limit=&domain=&status=&scope=&teamId=` → `{ data?/items?, ... }`
  (sim will tolerate both `data`/`items`; excludes `archived`).
- `POST /decisions { title, reasoning, ... }` → 201 (manual; not used for the logging test).
- `POST /decisions/search { query }` → results.
- `GET  /decisions/pending-review` → `{ data: Decision[] }` (status === `draft` only).
- **Outcome route is `POST /decisions/:id/outcomes` `{ verdict, description }`** — the brief
  said `/record-outcome`; the real path is `/outcomes`. `GET /decisions/:id/outcomes` lists.
- **Link route is `POST /decisions/:id/dependencies` `{ toDecisionId, relationship, description? }`**
  — the brief said `/links`; real path is `/dependencies`.
- `POST /decisions/:id/confirm`, `POST /decisions/:id/dismiss` for draft lifecycle.

### Meetings — `apps/api/src/routes/meetings.ts`
- `POST /meetings/ingest { provider?, title, transcript?, summary?, participants?, meetingDate?, externalMeetingId?, calendarEventId? }`
  → 201 `{ data: meeting }`. **`title` is the only required field.** If `transcript` is
  present it enqueues a `meeting_ingestion` job on the `decision-extraction` queue.
- `GET /meetings/:id` → `{ data: { ...meeting, decisions } }` where `decisions` are
  `source='meeting' AND sourceRef.meetingId === id`. Also exposes
  `processedAt` and `decisionsExtracted` (count) once the worker finishes — these are the
  observable signals the async worker ran.
- `GET /meetings?limit=` lists.

### Extraction pipeline — the intended bar (verified)
- **Chat path** (`processSessionExtraction` in `jobs/decision-extraction-scheduler.ts`):
  needs ≥3 messages; runs `detectDecision` = regex `fastFilter` → Haiku `classifyDecision`.
  `fastFilter` NEGATIVE patterns short-circuit questions ("should we decide", "haven't
  decided", "need to decide", "what did we decide", "help me decide"). POSITIVE patterns
  require explicit commitment language ("we decided", "let's go with", "we'll go/use/adopt/
  switch/migrate", "going forward we", etc.). Only if a positive fires (and no negative)
  does it call the LLM. Then `extractDecision`. Status = `active` if confidence ≥ 0.85
  else `draft` (→ shows in pending-review, emits `decision:suggestion`).
  **NOTE who enqueues `chat_session`:** the only `decisionExtractionQueue.add('chat_session')`
  caller must be located at runtime (search `chat_session` in scheduler/chat). The sim must
  determine whether chat-session extraction is actually wired up; if no enqueuer exists, a
  real chat decision will NOT become a Decision row — that is itself a finding.
- **Meeting path** (`processMeetingIngestion`): `extractDecisionsFromTranscript` (Haiku,
  one shot, "Extract ALL decisions ... If no decisions found return []"). For EACH extracted
  decision it calls `createDecision` directly. **There is no separate detector gate on the
  meeting path** — recall/precision rests entirely on the extraction LLM honoring "decisions
  only". **Meeting decisions are ALWAYS status `active`** (confidence only sets the label
  high/medium/low); they NEVER land in `draft`/pending-review. So a low-confidence /
  hallucinated meeting "decision" is written as active with no human gate — a precision risk
  to watch.
- **Dedup** lives inside `createDecision` (NOT a separate call from the meeting service):
  cosine on `embedding(title + ". " + reasoning)` vs existing non-archived decisions, +0.05
  for same domain, +0.05 for participant overlap; > 0.90 ⇒ returns existing row (merge, no
  insert). **Caveat: dedup compares against the PRIOR decision's stored embedding, which is
  written async AFTER insert.** Two near-identical ingests fired back-to-back can both insert
  before either embedding lands ⇒ possible duplicate despite the guard. The sim must allow
  settle time between the two dedup ingests and still verify count.

---

## Scenarios (2 human, REST-observable)

### Scenario A — "Friday architecture sync" meeting: 2 real decisions mixed with 2 non-decisions
Narrative: Devin Rao (eng-lead) drops the transcript of the Friday architecture sync into
Hearth. The meeting contained two genuine, resolved decisions, plus an unresolved debate
that got tabled and an open question nobody answered. He expects the two real decisions
captured cleanly and the noise left out.

Actors: Devin Rao (eng-lead), Marcus Chen, Sam Park, Jordan Lee (referenced participants).

Transcript content (engineered, unambiguous):
- REAL #1 (explicit, owner, horizon): "Decision: we'll move the nightly export to a
  queue-backed job by next sprint. Marcus owns it." (reversible, engineering)
- REAL #2 (explicit standardization): "We decided to standardize on Postgres as our primary
  datastore; we're not adding a second OLTP database." (strategy/engineering)
- NON-DECISION #1 (unresolved debate): a back-and-forth on Kafka vs. Redis Streams that ends
  "...let's table it, we didn't land on anything today, revisit next week." (must NOT store)
- NON-DECISION #2 (open question): "Should we move auth to a third-party provider like
  Auth0? Open question — no one has a strong view yet." (must NOT store)
- Plus chit-chat noise (coffee, weekend plans) to pad it past the 3-message bar.

Steps:
1. Login Devin. `POST /meetings/ingest { provider:'manual', title:'Friday architecture sync',
   transcript, participants:[names], meetingDate }`. Capture `meetingId`. Expect 201.
2. Poll `GET /meetings/:meetingId` until `processedAt` is non-null (worker ran).
   Record `decisionsExtracted`.
3. Read back `GET /meetings/:meetingId` `.decisions` AND `GET /decisions?domain=engineering`
   / unfiltered, filtering to `source='meeting'` + this meetingId.

Assertions (precision/recall):
- A-RECALL: both REAL decisions present (match on nightly-export/queue and Postgres/
  standardize keywords). Missing either = FALSE NEGATIVE finding.
- A-PRECISION-debate: NO stored decision references the tabled Kafka/Redis-Streams debate.
  If present = FALSE POSITIVE (logged an unresolved debate).
- A-PRECISION-question: NO stored decision is the Auth0 open question. If present = FALSE
  POSITIVE (logged a question as a decision).
- A-COUNT: `decisionsExtracted` should equal the number of real decisions stored (ideally 2).
  Report the exact number and titles verbatim as evidence.

### Scenario B — Dedup + concurrent extraction under load
Narrative: The ops automation re-syncs the same meeting twice (a flaky webhook fires the
ingest a second time). Meanwhile Sam Park is having a normal chat with Hearth that itself
contains one real decision. Devin expects: the re-synced meeting does NOT double its
decisions, and Sam's in-flight chat decision is handled correctly — extraction for one
should not block or corrupt the other.

Actors: Devin Rao (re-sync), Sam Park (concurrent chat).

Steps:
1. (reuse Scenario A's meeting OR a fresh dedicated single-decision meeting M-dup). Ingest
   M-dup once, wait for `processedAt`, snapshot decision count for that meetingId.
2. Ingest the EXACT same transcript again as a SECOND meeting M-dup2 (same title+transcript+
   participants). Wait for its `processedAt`. Give >= a few seconds so the first decision's
   embedding has landed (dedup depends on it).
3. Concurrently (kick off before/while step 2's worker runs): Sam logs in, opens a chat
   session, and over >=3 messages states a real, resolved decision in commitment language
   that trips a POSITIVE fastFilter pattern (e.g. "We're going with feature flags via
   LaunchDarkly for the rollout — final call, I'll wire it up this week."). Use the proven
   `Hearth.ask` poller from `load/simulate-llm-dialogue.ts` to get real replies.

Assertions:
- B-DEDUP: total active decisions whose title/reasoning match the duplicated decision is 1,
  NOT 2. If 2 ⇒ dedup failed (report similarity if observable, and note the async-embedding
  race as the likely cause). If the meeting path created M-dup2 decisions that duplicate
  M-dup's ⇒ FALSE POSITIVE / dedup-miss finding.
- B-CONCURRENCY: Scenario A/M-dup decisions remain intact and correct after the concurrent
  chat ran (no lost/garbled rows) — proves extraction-while-other-activity-in-flight.
- B-CHAT-DECISION: determine whether Sam's chat decision became a Decision row at all
  (`GET /decisions` filtered to `source='chat'` and/or this session). Two acceptable
  outcomes, BOTH reportable:
    * It appears (active if conf≥0.85, else draft in `GET /decisions/pending-review`) ⇒
      chat extraction is wired and working.
    * It never appears AND no enqueuer for `chat_session` exists in code ⇒ FALSE NEGATIVE:
      real chat decisions are silently never captured. Report which it is with evidence.

### Scenario C (lightweight, memory precision/recall) — "remember this, ignore that"
Narrative: Priya Sharma (PM) chats with Hearth. She states one durable preference she wants
remembered, peppered with transient noise and one thing she explicitly says to forget. She
expects exactly the durable fact in her memory afterward — not the noise, not the
forget-me item.

Actors: Priya Sharma.

Steps:
1. Priya logs in. Snapshot `GET /memory` (baseline count + contents).
2. In ONE chat session (proven `Hearth.ask` poller), over a few turns send:
   - DURABLE (should store): "Please remember that I always want release notes drafted in
     our changelog voice — present tense, user-facing, no internal ticket IDs."
   - QUESTION (should NOT store): "Do you think we should switch our changelog to Markdown?"
   - TRANSIENT (should NOT persist): "I'm grabbing coffee, back in 5."
   - FORGET (should NOT store / should be honored): "Actually forget the thing I said about
     Markdown, ignore it."
3. Read back `GET /memory` (default, then `?layer=user`).

Assertions (memory precision/recall — agent judgment):
- C-RECALL: a user-layer memory entry capturing the changelog-voice preference exists
  (match on "changelog"/"release notes"/"present tense"). Missing = FALSE NEGATIVE.
- C-PRECISION-question: no memory entry stores the "should we switch to Markdown" QUESTION.
  Present = FALSE POSITIVE (logged a question).
- C-PRECISION-transient: no persistent (user-layer) memory for "grabbing coffee". If it was
  stored as a `session_note` (layer=session, expiring) that is arguably acceptable — report
  the layer it landed in as the nuance.
- C-FORGET: nothing stores the Markdown idea as a remembered fact after the explicit forget.
- Report whether the agent over-stored (too eager), under-stored (too conservative), or hit
  it right, with the exact stored `content` strings as evidence.

---

## Logging-discipline verdict (what the run must conclude)
Tabulate FALSE POSITIVES (noise/questions/unresolved debates stored) and FALSE NEGATIVES
(real decisions/preferences missed) across A/B/C, then give a candid product verdict:
- Decision pipeline: too eager / too conservative / well-calibrated — with specific examples
  (e.g. "meeting path stored the tabled Kafka debate" or "Postgres standardization missed").
- Note the structural precision gap: meeting decisions are always `active` with no human
  gate regardless of confidence, while chat-extracted low-confidence ones go to draft. Is
  that asymmetry justified?
- Dedup: held / leaked (and whether the async-embedding race is the cause).
- Memory: did the agent honor "remember" vs "forget" and resist questions/chit-chat?
NEVER fake a pass. Report exact status codes, titles, and `content` strings as evidence.

## Execution notes
- Copy the `Hearth` client (cookies + CSRF + `ask` poller) verbatim from
  `load/simulate-llm-dialogue.ts`. No socket.io needed — observe everything via GET.
- Be patient on polls: meeting + chat extraction are async Haiku calls (5-30s+ each).
- Keep wall time < ~10 min. If tight, drop Scenario C's extra turns before dropping a whole
  scenario. Poll meetings via `processedAt`; poll decisions/memory via list endpoints.
- Run: `API_URL=http://localhost:8000/api/v1 ./apps/api/node_modules/.bin/tsx \
  load/pressure/memory-decisions.sim.ts` (Bash timeout up to 600000ms; background + poll if long).
