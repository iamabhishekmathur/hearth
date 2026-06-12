/**
 * WEBHOOK → GRAPH pressure test (canonical entry point).
 *
 * The implementation lives at apps/api/load-pressure/webhook-graph.impl.ts so
 * that its imports of the REAL API services (detectAndCreateTask,
 * enqueueSlackMessage) and @prisma/client / @hearth/shared resolve from
 * apps/api/node_modules. This file is a thin runner.
 *
 * RUN (cwd must be apps/api so module resolution works):
 *   cd apps/api && API_URL=http://localhost:8000/api/v1 \
 *     ./node_modules/.bin/tsx load-pressure/webhook-graph.impl.ts
 *
 * Equivalently from repo root:
 *   cd /Users/abhishek/projects/hearth/apps/api && \
 *     API_URL=http://localhost:8000/api/v1 ./node_modules/.bin/tsx \
 *     /Users/abhishek/projects/hearth/apps/api/load-pressure/webhook-graph.impl.ts
 *
 * What it exercises (all LIVE — no mocks):
 *   A. POST /webhooks/ingest/:urlToken  — generic ingest of an actionable
 *      Slack event (endpoint created via the real API + signed body).
 *   B. POST /webhooks/slack             — the only HTTP route wired to
 *      detectAndCreateTask.
 *   C. detectAndCreateTask(...)         — the exact function the work-intake
 *      worker runs: actionable→task+Person+produced_by+discussed_in,
 *      non-actionable→no task, duplicate→dedup.
 *   D. enqueueSlackMessage(...) → live worker — the real /webhooks/slack path,
 *      verifying whether graph edges are landed end-to-end.
 *
 * Graph is read back via the API's Prisma client (no HTTP read route exists
 * for persons/edges — that absence is itself a finding).
 */
import '../../apps/api/load-pressure/webhook-graph.impl.js';
