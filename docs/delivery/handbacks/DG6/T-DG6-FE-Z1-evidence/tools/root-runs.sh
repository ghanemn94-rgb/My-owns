#!/usr/bin/env bash
# T-DG6-FE-Z1B: the root acceptance e2e (the QA round-2 05 list, both projects) and then the demo-stack specs
# (the QA round-2 07 list), one stack on ports 29140-29149, alongside full-runs.sh's load. Run from the repository root.
# usage: root-runs.sh <evidence dir> <tag> <unset|cutf8>
set -u
EV="$1"; TAG="$2"; LOC="$3"; OUT="${TMPDIR:?}/fez1-$TAG-root"; mkdir -p "$OUT"
ROOT_SPECS=$(ls e2e/a03-modular-entry.spec.ts e2e/a04-kpi-update.spec.ts e2e/a06-configuration-change.spec.ts e2e/a07-historical-integrity.spec.ts e2e/a08-a09-gates-decisions.spec.ts e2e/a12-p6-scope-isolation.spec.ts e2e/a13-automation-recovery.spec.ts e2e/a13-connector-run-once.spec.ts e2e/a14-compare-reapply.spec.ts e2e/a15-reporting.spec.ts e2e/a16-health-launch.spec.ts e2e/a17-failing-connector-exception.spec.ts e2e/a17-import-and-integration.spec.ts e2e/a20-bilingual-shell.spec.ts e2e/a20-p6-axe.spec.ts e2e/a20-p6-layout-brand.spec.ts e2e/a20-p6-ux.spec.ts e2e/a20-s15-014-term-scan.spec.ts e2e/a21-no-ai-operation.spec.ts e2e/a21-p6-degradation.spec.ts e2e/a22-operations-jobs.spec.ts e2e/a22-p6-operability.spec.ts)
DEMO_SPECS="e2e/a02-demo-labels.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-guided-walkthrough.spec.ts"
envrun() { if [ "$LOC" = unset ]; then env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE "$@"; else env LANG=C.UTF-8 LC_ALL=C.UTF-8 "$@"; fi; }
one() { # name wrapper specs...
  local name=$1 wrap=$2; shift 2
  local log="$EV/$TAG-$name-$LOC.log"
  {
    echo "\$ $wrap npx playwright test $* --workers=1 --reporter=list --output=\$TMPDIR/fez1-$TAG-root/$name ($(date -u +%FT%TZ)) node=$(node -v) LANG=$LOC load=$(cut -d' ' -f1-3 /proc/loadavg)"
    envrun E2E_PG_PORT=29140 E2E_API_PORT=29141 MTH_PORT_POOL=29142-29149 "$wrap" npx playwright test "$@" --workers=1 --reporter=list --output="$OUT/$name"
    echo "EXIT $? ($(date -u +%FT%TZ)) load=$(cut -d' ' -f1-3 /proc/loadavg)"
  } > "$log" 2>&1
}
one root apps/web/e2e/support/with-stack.sh $ROOT_SPECS
one demo e2e/support/with-demo-stack.sh $DEMO_SPECS
grep -H '^EXIT' "$EV/$TAG"-root-"$LOC".log "$EV/$TAG"-demo-"$LOC".log
