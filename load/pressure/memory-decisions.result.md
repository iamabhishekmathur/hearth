# memory-decisions — pressure test result

Run: 2026-06-12, live API at http://localhost:8000/api/v1. Sim: `load/pressure/memory-decisions.sim.ts`.
Totals from sim harness: 10 pass / 1 fail — but the one "fail" was a flawed assertion (see B-DEDUP). After DB-level verification, the real verdict is **11/11 effective pass** on the assertions, with 2 product nuances + 1 latent risk worth reporting.

## Scenario A — Friday architecture sync (2 real decisions + tabled debate + open question)
- ingest 201, meetingId f8accd09. Worker set `processedAt`, `decisionsExtracted=2`.
- Stored decisions (verbatim, both status=active conf=high):
  - "Standardize on Postgres as primary datastore with no second OLTP database"
  - "Move nightly export to queue-backed job"
- A-RECALL **pass** (both real decisions). A-PRECISION-debate **pass** (Kafka-vs-Redis-Streams tabled debate NOT stored). A-PRECISION-question **pass** (Auth0 open question NOT stored). A-COUNT **pass** (extracted=2 == stored=2).
- Verdict: meeting extractor is **well-calibrated** here — perfect precision AND recall on a deliberately noisy transcript. The "we decided / agreed / going forward" commitment language was honored; the "let's table it, didn't land on anything" debate and "open question, no one has a view" were correctly dropped.

## Scenario B — dedup + concurrent chat
- M-dup ingested twice with identical transcript. Meeting #1 (75ff5413) extracted 2 decisions; meeting #2 (3480eeda, re-sync) extracted 2 but **created 0 rows** — both deduped into meeting #1's rows (verified by SQL: decisions sourced to meeting #2 = 0; to meeting #1 = 2).
- **B-DEDUP: actually PASS** (harness reported FAIL due to a flawed matcher). The transcript legitimately yields 2 distinct decisions ("adopt blue-green" + "Marcus owns the rollout"); the re-ingest added none. Dedup (>0.90 cosine) HELD across the identical re-ingest even under concurrent load. The 8s settle before re-ingest let embeddings land, so the known async-embedding race did not trigger.
- B-CONCURRENCY **pass**: GET /decisions returned 10 rows intact after the concurrent chat + re-ingest; no lost/garbled rows.
- B-CHAT-DECISION **pass** — but via a DIFFERENT path than the plan assumed. Sam's chat decision was captured as a real Decision row (id c55c4f78, source=chat, status=active, conf=medium, sessionId matches) NOT by the `processSessionExtraction` worker (which nothing enqueues — dead code) but because **the agent called its `capture_decision` tool** ("Let me capture that decision and create a task..."). So chat-decision capture works, but it is agent-judgment-gated, not deterministic.

## Scenario C — Priya memory (remember / ignore / forget)
- One new memory: `[user]` layer, src "user preference", never expires: "User always wants release notes drafted in a specific 'changelog voice': present tense, user-facing language, and never include internal ticket IDs."
- C-RECALL **pass** (durable preference stored, persistent user layer). C-PRECISION-question **pass** (Markdown question NOT stored). C-PRECISION-transient **pass** ("grabbing coffee" not persisted, not even as a session note). C-FORGET **pass** ("forget the Markdown thing" honored — nothing retained).
- Verdict: memory discipline is **well-calibrated**. The agent stored exactly the one durable preference and resisted the question, chit-chat, and forget-me item. Clean precision and recall.

## Product nuances / risks (not assertion failures)
1. `decisionsExtracted` is a "created/attempted" counter, not a "stored" counter. Re-sync meeting #2 reported `decisionsExtracted=2` while storing 0 (all deduped). A meeting detail UI showing "2 decisions extracted" with 0 linked rows would mislead. Recommend counting only non-merged inserts.
2. Dead code: `processSessionExtraction` (job name `chat_session`) handler exists in decision-extraction-scheduler.ts but NOTHING enqueues it. Chat decisions are captured only via the agent's `capture_decision` tool (judgment-gated). The regex `fastFilter` + draft/pending-review confidence-gating logic in that handler is therefore unreachable — dead and misleading to future maintainers.
3. Asymmetry: meeting decisions are ALWAYS status=active (no human gate) regardless of extracted confidence, while the (dead) chat path would have routed <0.85 to draft. Agent `capture_decision` also writes active directly. So no path actually uses pending-review for low-confidence meeting/agent decisions — a low-confidence/hallucinated meeting "decision" lands active with no review. Precision was perfect here, but the guardrail is absent.
