#!/usr/bin/env bash
# qa-verifier (DG6, T-DG6-QA-G; QA-EB handback §7 Q-1/Q-2): runs the root e2e specs of the shared dev stack in an
# EXPLICIT file order, chromium-en first and then chromium-ar, one Playwright invocation per spec file, all against the
# SAME stack (so every spec sees what the specs before it left behind). Playwright itself always orders files by name;
# this script is how the reverse order is run. Run it inside apps/web/e2e/support/with-stack.sh:
#   apps/web/e2e/support/with-stack.sh e2e/support/run-spec-order.sh reverse
# Order: `default` (by file name, as Playwright orders them) or `reverse`. The set: every e2e/*.spec.ts except the
# a02-* specs, which need the demo database (e2e/support/with-demo-stack.sh); e2e/clean-start/ and e2e/identity/ have
# their own harnesses. QA_ORDER_OUTPUT (default test-results/qa-order) holds each invocation's Playwright output.
# Exit: 0 when every invocation passed, 1 otherwise (each invocation's status is printed as "=== <project> <spec>
# exit=<n>").
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ORDER="${1:-default}"
OUT="${QA_ORDER_OUTPUT:-$ROOT/test-results/qa-order}"
mapfile -t SPECS < <(find e2e -maxdepth 1 -name '*.spec.ts' ! -name 'a02-*' | LC_ALL=C sort)
case "$ORDER" in
  default) ;;
  reverse) mapfile -t SPECS < <(printf '%s\n' "${SPECS[@]}" | LC_ALL=C sort -r) ;;
  *) echo "usage: $0 default|reverse" >&2; exit 2 ;;
esac
echo "order $ORDER: ${SPECS[*]}"
RC=0
for project in chromium-en chromium-ar; do
  for spec in "${SPECS[@]}"; do
    name="$(basename "$spec" .spec.ts)"
    echo "=== $project $spec start $(date -u +%FT%TZ)"
    npx playwright test "$spec" --project="$project" --workers=1 --reporter=list --output="$OUT/$project-$name"
    status=$?
    echo "=== $project $spec exit=$status"
    [ "$status" -eq 0 ] || RC=1
  done
done
exit "$RC"
