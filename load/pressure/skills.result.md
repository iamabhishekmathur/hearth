# Skills pressure test — results (2026-06-12)

Sim: load/pressure/skills.sim.ts  ·  Log: load/pressure/skills.run.log  ·  Follow-up: /tmp/skills_followup.ts

## Mechanism (verified in code)
system-prompt.ts §3: for context.userId, ALL installed UserSkills (name+desc+content) are dumped
under "## Installed Skills", truncated to a 3000-token budget. NOT relevance/tag matched — every
installed skill is always injected. buildAgentContext feeds chat, task-planner, task-executor, routine-scheduler.

## Scoreboard (after follow-up reinterpretation)
- A1 PASS — personal skill -> 201 published, no gate.
- A2 PASS — install -> 201; appears in /skills/installed.
- A3 FAIL (real gap) — skill DID influence the agent (reply cites "house style (RNF-v3)", "Known Gremlins",
  "Upgrade Footnotes" by name) BUT the formatted release-notes doc with the literal `## TL;DR/## Shipped/
  ## Known Gremlins/## Upgrade Footnotes` headings + `RNF-v3` marker line is NOT in the chat message.
  The message is meta-commentary ABOUT the doc. No artifact exists (GET /api/v1/artifacts = 404; message
  has no artifacts/attachments). The structured deliverable the skill mandates is effectively lost.
- A4 PASS — task planner's subtask description explicitly references "house release-notes-format skill
  (RNF-v3 marker, TL;DR, Shipped, Known Gremlins, Upgrade Footnotes)". Skill clearly flows into task planning.
- B1 PASS — Sam has nothing installed.
- B2 PASS — Sam's reply: "No specific release notes format stored — I'll draft in a clean, standard style."
  Zero rare sentinels. No cross-user leak. (Strong negative control.)
- C1 PASS — org-scoped skill -> 201 pending_review.
- C2 PASS — non-admin PATCH status -> 403.
- C3 PASS — admin PATCH -> 200 published.
- C4 FAIL (surface limitation, NOT skill failure) — routine test-run TIMED OUT at 30s (output=null).
  Follow-up proved the SQL skill works: Omar's CHAT reply addresses index coverage, N+1, lock contention,
  cardinality, rollback safety AND ends with `SQL-CHECKLIST-7`. The skill flows fine; the routine test-run's
  hard 30s cap is too short for a real agent run, so output is never observable on that surface.
- C5 PASS — Omar's output has no RNF sentinels (no bleed).

## Verdict
Skills GENUINELY flow into chat and tasks (and into routines mechanically — only the test-run 30s cap hides it).
Per-user isolation is solid (B2, C5). Two product issues: (1) chat does not surface the structured deliverable;
(2) routine test-run 30s timeout makes the surface unobservable for normal agent latency.
