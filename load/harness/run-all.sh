#!/usr/bin/env bash
# Sequential E2E harness runner. Runs every wave in order against the live dev
# stack (API on :8000 + worker + dev Postgres), each appending to the shared
# results.json / COVERAGE.md via the Recorder. Continues past a failing wave so
# one broken scenario can't abort the matrix refresh.
#
# Prereqs: API + worker running, enterprise fixture (hearth-sim) seeded,
# OPENAI_API_KEY + DATABASE_URL in apps/api/.env.
set -u
cd "$(dirname "$0")/../.." || exit 1

# Load env (DATABASE_URL, OPENAI_API_KEY, ...). Pin API_URL to the confirmed
# local API regardless of any value in .env.
set -a; . apps/api/.env 2>/dev/null; set +a
export API_URL="http://localhost:8000/api/v1"

WAVES=(
  wave1-governance
  wave2-chat
  wave3-tasks
  wave4-intake
  wave5-routines
  wave6-skills
  wave7-memory-decisions
  wave8-context-artifacts
  wave9-routine-internals
  wave10-decisions-deep
  wave11-admin-platform
)

for w in "${WAVES[@]}"; do
  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "▶ $w  ($(date +%H:%M:%S))"
  echo "════════════════════════════════════════════════════════════════"
  apps/api/node_modules/.bin/tsx "load/harness/$w.ts"
  echo "◀ $w exit=$? ($(date +%H:%M:%S))"
done

echo ""
echo "ALL WAVES COMPLETE ($(date +%H:%M:%S)) — scenarios: $(grep -c '"feature"' load/harness/results.json)"
