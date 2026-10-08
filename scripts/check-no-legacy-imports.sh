#!/usr/bin/env bash
# Dead-code decommission gate (Wave 0 scaffold) for the opencode adaptation.
#
# As each workstream deletes a module (see §7 of
# plans/opencode-adaptation-plan.md), add its import path to BANNED_PATTERNS
# below. This script fails the build if any banned module is still imported,
# so removals can't silently leave dangling references.
#
# Usage: bash scripts/check-no-legacy-imports.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# One extended-regex pattern per line. Empty until W1/W2 start deleting modules.
# Examples (commented until the replacements land):
#   anthropic-provider            # W1: superseded by ai-sdk-provider
#   openai-provider
#   openai-compatible-provider
#   DEFAULT_MODEL                 # W1: replaced by the resolution chain
BANNED_PATTERNS=(
)

SEARCH_DIRS=(apps packages)

# Empty list is the Wave 0 steady state — nothing to decommission yet.
if [ "${#BANNED_PATTERNS[@]}" -eq 0 ]; then
  echo "✓ dead-code gate: no banned patterns configured yet"
  exit 0
fi

status=0
for pattern in "${BANNED_PATTERNS[@]}"; do
  [ -z "$pattern" ] && continue
  # Search TS/TSX source, excluding node_modules and build output.
  matches=$(grep -rnE "$pattern" "${SEARCH_DIRS[@]}" \
    --include='*.ts' --include='*.tsx' \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.turbo \
    2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo "✖ Banned reference still present for pattern: $pattern"
    echo "$matches"
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "✓ dead-code gate: no banned references"
fi
exit "$status"
