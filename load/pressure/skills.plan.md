# Pressure Test Plan — Domain: Skills (sample skills → pulled into chat / tasks / routines)

Key: `skills`
Date: 2026-06-12
Author: planning agent

## Goal

Add sample Skills with distinctive, machine-checkable behavior, install them for ONE
user, and verify the skill content actually reaches the agent across **chat**, **tasks**,
and **routines**. Prove that:
- An installed skill measurably changes that user's agent output (the mandated
  structure/checklist appears).
- An UNinstalled / unrelated skill does NOT leak into the output.
- If an admin-approval gate exists, exercise it.

Then report honestly whether skills genuinely flow into each surface or are inert.

---

## How skills actually work (confirmed from source — this drives the scenarios)

Files read:
- `apps/api/src/routes/skills.ts`
- `apps/api/src/services/skill-service.ts`
- `apps/api/src/services/skill-validator.ts`
- `apps/api/src/services/skill-loader.ts` (disk seeding only — NOT the injection path)
- `apps/api/src/agent/system-prompt.ts` (THE injection point)
- `apps/api/src/agent/context-builder.ts` (shared entry; wraps buildSystemPrompt)
- `apps/api/src/routes/chat.ts`, `routes/tasks.ts`, `routes/routines.ts`
- `apps/api/src/services/task-service.ts`, `packages/shared/src/types/task.ts`

### Injection mechanism (the crux)
`buildSystemPrompt()` in `agent/system-prompt.ts` **section 3 (lines 338–362)**:

```
const userSkills = await prisma.userSkill.findMany({
  where: { userId: context.userId },
  include: { skill: { select: { name, description, content } } },
});
// → "## Installed Skills\nApply these skills when relevant:\n" + full content of each
```

CRITICAL FACTS:
- **Matching is by INSTALL ONLY.** There is NO tag/name/relevance/embedding match.
  Every skill the user has a `UserSkill` row for is injected, in full, every run.
  So "should be pulled in" == "user installed it". An uninstalled skill is simply
  absent from the prompt.
- The **full `content`** is injected (not just the description), under the header
  "Apply these skills when relevant". Skill status (published/pending) is NOT
  re-checked here — only the `UserSkill` join matters. (We still respect the install
  route's behavior, which only lets a user install skills in their own org.)
- Budget: `SECTION_BUDGETS.skills = 3000` tokens (~12k chars). Keep skills small so
  they are never truncated.
- `buildSystemPrompt` is called via `buildAgentContext` (`context-builder.ts`), which
  is used by **chat** (`routes/chat.ts → runAgent`), **task planning**
  (`services/task-planner.ts`), **task execution** (`services/task-executor.ts`), and
  **routines** (`jobs/routine-scheduler.ts`). => same injection on all three surfaces.

### Validator constraints (so POST /skills bodies are valid) — `skill-validator.ts`
- `name`: MUST match `/^[a-z][a-z0-9-]*$/` (lowercase, digits, hyphens; starts with a
  letter). e.g. `release-notes-format`.
- `description`: required, ≤ 1024 chars.
- `content`: MUST itself contain YAML frontmatter with **both** `name` and
  `description` keys, or creation 400s with `Invalid skill: ...`.
  → every skill body's `content` field must start with a `---\nname: ...\ndescription: ...\n---` block.

### Approval gate — `routes/skills.ts` POST /
- `scope` omitted or `'personal'` → status `published` immediately (NO admin gate).
- `scope` `'team'` or `'org'` → status `pending_review` (admin must PATCH status).
- BUT injection does not check status — only the UserSkill join. So a `personal`
  published skill is the cleanest happy path. We additionally exercise the gate with a
  `scope:'org'` skill (Scenario C) to confirm pending → published via admin PATCH.

---

## Confirmed endpoints & shapes

Auth: `POST /auth/login {email,password:'changeme'}` → sets `hearth.session` +
`hearth.csrf` cookies. Echo csrf as `x-csrf-token` on every non-GET. (Copy the Hearth
client from `load/simulate-llm-dialogue.ts`.)

Skills:
- `POST /skills` `{name, description, content, scope?, teamId?}` → 201 `{data: skill}`
  (id, status). `personal`/omitted → published; `org`/`team` → pending_review.
- `POST /skills/:id/install` → 201 `{data: userSkill}` (idempotent upsert).
- `DELETE /skills/:id/install` → 204; 404 if not installed.
- `GET /skills/installed` → `{data: skill[]}` (each has `installed:true`, `installCount`).
- `GET /skills?search=&scope=&status=` → `{data: skill[]}` (annotated `installed`).
- `PATCH /skills/:id` `{status?}` → admin only for status (403 otherwise). Used to
  approve a pending_review skill (e.g. `{status:'published'}`).

Chat:
- `POST /chat/sessions {}` → 201 `{data:{id,...}}`.
- `POST /chat/sessions/:id/messages {content, timezone?}` → **202** `{data:{messageId}}`
  (agent runs async). Poll `GET /chat/sessions/:id` → `{data:{messages:[{role,content}]}}`
  until an `assistant` message appears after our user message.

Tasks (default status on create = `auto_detected`; transitions in
`packages/shared/src/types/task.ts`):
- `POST /tasks {title, source, description?}` → 201 `{data:task}` (`source` REQUIRED;
  use `'manual'`). status = `auto_detected`.
- `PATCH /tasks/:id {status}` walks the state machine. Path to execution:
  `auto_detected → backlog → planning → executing`.
  - `auto_detected → backlog` allowed.
  - `backlog → planning` enqueues the **task planner** (uses skills).
  - `planning → executing` enqueues the **task executor** (uses skills).
- Observe: `GET /tasks/:id` (`{data:{steps,comments,...}}`), `GET /tasks/:id/steps`
  (`{data:step[]}`) — planner-produced steps reflect the skill's mandated structure.

Routines (cleanest = test-run, synchronous-ish):
- `POST /routines/test-run {prompt}` → runs the prompt once as the user, polls up to 30s,
  returns `{data:{status, output, error, durationMs}}`. Goes through routine-scheduler →
  buildAgentContext → skills injected. `output` is the agent's text → directly checkable.
- (Fallback) `POST /routines {name,prompt,schedule}` then `POST /routines/:id/run-now`,
  poll `GET /routines/:id/runs`.

---

## Distinctive sample skills (checkable signatures)

### Skill 1 — `release-notes-format` (scope: personal → published)
Mandates a VERY specific section structure with rare literal tokens we can grep for:
```
---
name: release-notes-format
description: Standard structure for all release notes
---
When asked to write or draft release notes, you MUST use EXACTLY these four sections,
each as a markdown H2 with this exact wording, in this order, and nothing else:
## TL;DR
## Shipped
## Known Gremlins
## Upgrade Footnotes
Always include the literal marker line "RNF-v3" at the very top of the notes.
```
Checkable signature: output contains `RNF-v3` AND all four headings
`## TL;DR`, `## Shipped`, `## Known Gremlins`, `## Upgrade Footnotes`.
"Known Gremlins" / "Upgrade Footnotes" / "RNF-v3" are distinctive enough that a generic
LLM answer would not produce them by chance.

### Skill 2 — `sql-review-checklist` (scope: org → pending_review → admin-approved)
Mandates a numbered checklist with a unique sentinel:
```
---
name: sql-review-checklist
description: Mandatory checklist when reviewing any SQL
---
When reviewing SQL, you MUST end every review with a checklist titled exactly
"SQL-CHECKLIST-7" containing EXACTLY these 5 numbered items:
1. Indexed predicates
2. N+1 risk
3. Lock footprint
4. NULL semantics
5. Injection surface
```
Checkable signature: output contains `SQL-CHECKLIST-7` AND the 5 item phrases.

These two skills cover the two requested archetypes (release-notes format + SQL review)
and have non-overlapping sentinels so we can prove no cross-leak.

---

## Scenarios (3 human scenarios)

### Scenario A — Devin installs the release-notes skill; it governs chat + a task
**Actors:** Devin Rao (eng-lead@hearth.local).
**Narrative:** Devin runs every release and is tired of inconsistent release notes, so he
installs the org's "release-notes-format" skill. He then asks Hearth in chat to draft
release notes for v2.4, and separately spins up a task to write the v2.4 notes — he
expects BOTH the chat reply and the task's plan to follow the mandated structure.

Steps:
1. Login Devin. Create `release-notes-format` (scope omitted → personal/published).
   Assert 201 + status `published`.
2. `POST /skills/:id/install`; assert 201; `GET /skills/installed` includes it.
3. CHAT: new session → send "Draft the release notes for our v2.4 release. We added
   SSO and fixed a memory leak." Poll for assistant reply.
   Assert reply contains `RNF-v3` and all four mandated H2 headings.
4. TASK: `POST /tasks {title:"Write v2.4 release notes", source:"manual",
   description:"Draft release notes for v2.4 (SSO added, memory leak fixed)"}`.
   PATCH `→backlog`, `→planning`. Poll `GET /tasks/:id/steps` (and `/tasks/:id`) until
   the planner produces steps. Assert the plan/steps reference the mandated section
   names (e.g. a step mentions "TL;DR" / "Shipped" / "Known Gremlins" / "Upgrade
   Footnotes" or `RNF-v3`). (Tasks plan the work; we check the plan reflects the skill's
   structure. If the planner output doesn't reference it, REPORT — the skill influences
   chat but not task planning.)

### Scenario B — Negative control: Sam has NO skill installed → no leak
**Actors:** Sam Park (dev1@hearth.local).
**Narrative:** Sam, who never installed the release-notes skill, asks Hearth the exact
same release-notes question. His answer should be a normal, generic draft — none of
Devin's mandated sentinels.

Steps:
1. Login Sam (clean — assert `GET /skills/installed` does NOT contain
   `release-notes-format`; if a prior run installed it, uninstall first).
2. CHAT: same v2.4 release-notes prompt as A. Poll for reply.
   Assert reply does NOT contain `RNF-v3` and does NOT contain the rare heading
   "Known Gremlins" / "Upgrade Footnotes". (A generic LLM may coincidentally use
   "## TL;DR"; the load-bearing negative check is the rare sentinels `RNF-v3` /
   "Known Gremlins" / "Upgrade Footnotes", which prove the skill did not leak.)

### Scenario C — Admin approval gate + SQL skill in a routine
**Actors:** Alex Rivera (admin@hearth.local) as admin/approver; Omar Farouk
(data-analyst@hearth.local) as the user who installs & runs it.
**Narrative:** The data team wants a standard SQL-review skill. Omar (non-admin) authors
it as an **org** skill, so it lands in `pending_review`. Alex approves it. Omar installs
it and runs a routine that reviews a SQL query — the output must end with the mandated
SQL-CHECKLIST-7.

Steps:
1. Login Omar. `POST /skills {name:'sql-review-checklist', ..., scope:'org'}`.
   Assert 201 + status `pending_review` (the gate exists).
2. Omar installs it (allowed even while pending — confirms injection ignores status) OR
   we first approve then install; we will: try to confirm Omar can install pre-approval,
   note the result, then approve.
3. Login Alex (admin). `PATCH /skills/:id {status:'published'}`. Assert 200 + status
   `published`. (Also assert a NON-admin status PATCH 403s — Sam or Omar tries
   `{status:'published'}` → expect 403, exercising the gate's auth.)
4. Login Omar. Ensure installed (`POST /skills/:id/install` idempotent).
5. ROUTINE: `POST /routines/test-run {prompt:"Review this query for our reporting DB:
   SELECT * FROM events e JOIN users u ON u.id = e.user_id WHERE e.created_at > now() -
   interval '7 days';"}`. Use the returned `output`.
   Assert `output` contains `SQL-CHECKLIST-7` and the 5 item phrases.
6. CROSS-LEAK CHECK: assert the SQL routine output does NOT contain `RNF-v3` (Omar never
   installed the release-notes skill) — proves skills don't bleed between users.

---

## REST-observable assertions (the scorecard)

| ID | Assertion | Observable |
|----|-----------|------------|
| A1 | release-notes skill creates as `published` (personal, no gate) | `POST /skills` → 201, body.data.status==='published' |
| A2 | install succeeds & is listed | `POST /skills/:id/install` 201; `GET /skills/installed` contains name |
| A3 | **Chat reflects skill** | poll `GET /chat/sessions/:id`: assistant msg contains `RNF-v3` + the 4 H2 headings |
| A4 | **Task plan reflects skill** | `GET /tasks/:id/steps` / `/tasks/:id`: steps/plan reference mandated sections or `RNF-v3` |
| B1 | clean user has no skill | `GET /skills/installed` (Sam) lacks `release-notes-format` |
| B2 | **No leak in chat for uninstalled user** | Sam's assistant reply has NO `RNF-v3` / "Known Gremlins" / "Upgrade Footnotes" |
| C1 | org skill is gated | `POST /skills {scope:'org'}` → status `pending_review` |
| C2 | non-admin cannot approve | non-admin `PATCH /skills/:id {status}` → 403 |
| C3 | admin approves | admin `PATCH /skills/:id {status:'published'}` → 200, status `published` |
| C4 | **Routine reflects skill** | `POST /routines/test-run` → data.output contains `SQL-CHECKLIST-7` + 5 items |
| C5 | **No cross-user leak** | Omar's routine output has NO `RNF-v3` |

PASS criteria: A3 (chat) AND at least one of A4/C4 (task or routine) show the sentinel;
B2 + C5 show NO leak; C1–C3 confirm the gate works. Skills are "genuinely flowing" only
if installed sentinels appear AND uninstalled sentinels are absent.

## Honest-reporting notes / expected failure modes to watch
- The skill header says "Apply these skills when relevant" — the model could decide a
  skill is "not relevant" and skip it. If chat ignores a clearly-relevant skill, REPORT
  it (skill present in prompt but not honored).
- **Tasks**: the planner produces a *plan of steps*, not the final release notes prose.
  The skill may shape the plan's structure or may only surface when the executor writes
  the deliverable. If steps don't reference the structure, fall back to checking the
  executor output / task comments / any produced artifact before declaring A4 a fail —
  and report which sub-stage (planner vs executor) honored the skill.
- **Routine test-run** deletes the temp routine after; capture `output` from the response
  (do not rely on GET /runs afterward).
- Injection ignores skill `status`; if an unapproved skill still influences output, that
  is a finding worth noting (governance gap) even though it's the current code behavior.
- All polls: be patient (async workers, 5–30s for chat; up to 30s for routine test-run;
  task planning can take longer). Keep total wall time < ~10 min; reduce to Scenarios
  A + C if time-constrained (A=chat+task, C=routine+gate; B is a cheap add-on to A).

## Artifacts
- Plan: `load/pressure/skills.plan.md` (this file)
- Simulator: `load/pressure/skills.sim.ts` (to be written; copy Hearth client from
  `load/simulate-llm-dialogue.ts`)
