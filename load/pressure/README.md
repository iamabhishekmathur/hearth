# Pressure sims

Production-scale, **fully live** integration sims for Hearth. Nothing is mocked:
every sim drives the real API, the real agent/worker pipeline, the real Claude
LLM, and reads ground truth back out of Postgres. They exist to surface
correctness defects, races, and product gaps that unit tests can't see.

## Prerequisites

1. **The full stack must be running and current.**
   - API (`@hearth/api`, `src/index.ts`), the agent worker (`src/worker.ts`),
     Redis, and Postgres all up.
   - Start with `pnpm dev` (uses `tsx watch`, which reloads on source edits).
   - IMPORTANT: if the API was started with plain `tsx` (no `watch`), it will
     **not** pick up source edits — restart it after any fix, or the sims will
     test stale code.
2. **Seed fixtures.** The sims expect the seeded org and persona accounts
   (password `changeme`): `admin@hearth.local` (Alex Rivera, ADMIN),
   `cto@hearth.local` (Marcus Chen), `eng-lead@hearth.local` (Devin Rao),
   `dev1@hearth.local` (Sam Park), `dev2@hearth.local` (Jordan Lee),
   `product-lead@hearth.local` (Dana Lewis), `pm1@hearth.local` (Priya Sharma),
   `designer@hearth.local` (Nina Alvarez). Seed via:
   ```
   pnpm --filter @hearth/api sim-seed
   ```
3. **LLM keys.** Hearth's agent needs `ANTHROPIC_API_KEY` (default provider).
   The two-LLM dialogue sims under `load/` (not this dir) additionally need
   `OPENAI_API_KEY` for the test-user side. Without keys, agent-driven sims
   (tasks, governance, routines, skills, memory-decisions) will time out.
4. **`API_URL`** must point at the live API, e.g.
   `export API_URL=http://localhost:8000/api/v1`.

## What each sim covers

| Sim | Covers |
| --- | --- |
| `concurrency.sim.ts` | Correctness under concurrent REST races — reaction upserts, unread counts, collaborator add/remove, task status transitions. Asserts no lost updates / double-counts / illegal states. Avoids flooding the single agent worker. |
| `governance.sim.ts` | Blocking + monitoring keyword policies and org governance settings: blocked message → 403 + violation recorded; monitored message → flagged but runs. |
| `memory-decisions.sim.ts` | Decision capture + memory across a simulated arch sync (real decisions, tabled debate, open questions). |
| `routines.sim.ts` | Routines: parameterized run-now, `{{param}}` interpolation, approval checkpoints, `lastRunStatus`/`lastRunAt`. |
| `sharing-notifs.sim.ts` | Multi-client sharing + notification recipient experience: org-share, contributor/viewer roles, `collaborator_added` bell, read discipline. |
| `skills.sim.ts` | Installed skills flowing into chat / tasks / routines via the system prompt. |
| `tasks.sim.ts` | Full task lifecycle: chat → promote-to-task → planner → executor → review → done, plus `changes_requested` re-plan loop and idempotency guards. |
| `webhook-graph.sim.ts` | Webhook ingest → `detectAndCreateTask` → Person/Edge graph landing (actionable → task+edges, non-actionable → none, duplicate → dedup). Thin runner over `apps/api/load-pressure/webhook-graph.impl.ts` so it resolves the real API services from `apps/api/node_modules`. |

Standalone fix-verification scripts also live here (not part of `run-all`'s
`*.sim.ts` glob): `milestone-p0.verify.ts`, `notif-wiring.verify.ts`,
`verify-share-revocation.ts`. Run those directly with `tsx` to re-check the
three regression fixes.

## How to run

**All sims (sequential rollup):**
```
API_URL=http://localhost:8000/api/v1 pnpm pressure
# or directly:
API_URL=http://localhost:8000/api/v1 ./apps/api/node_modules/.bin/tsx load/pressure/run-all.ts
```
The runner executes each `*.sim.ts` **one at a time** (never parallel — that
would swamp the single agent worker), streams each sim's output live, prints a
PASS/FAIL banner per sim, and ends with a rollup. It exits non-zero if any sim
fails (by exit code or by a non-zero `N fail` tally in the sim's own output).

**List without running:**
```
pnpm pressure --list
```

**A subset:**
```
PRESSURE_ONLY=tasks,skills pnpm pressure
```

**One sim on its own:**
```
API_URL=http://localhost:8000/api/v1 ./apps/api/node_modules/.bin/tsx load/pressure/tasks.sim.ts
```

### Runner env / flags
- `--list` — discover and list sims only, don't run them.
- `PRESSURE_ONLY=a,b` — run only sims whose filename contains one of the
  comma-separated substrings.
- `PRESSURE_TIMEOUT_MS` — per-sim wall-clock timeout (default `600000`, 10 min).
  Agent-driven sims are slow (real LLM, async workers); budget accordingly.
