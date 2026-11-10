#!/usr/bin/env bash
# T-DG6-QA-G mutation checks: each mutated copy must FAIL; the c0 controls (exact copies) must PASS.
set -uo pipefail
cd "$(dirname "$0")"
run() { # name, spec, project, extra args...
  local name=$1 spec=$2 project=$3; shift 3
  echo "=== $name $spec $project start $(date -u +%FT%TZ)"
  QA_MUT_OUTPUT="$TMPDIR/pw-mut/$name" npx playwright test -c playwright.config.ts "$spec" --project="$project" --workers=1 "$@"
  echo "=== $name exit=$?"
}
run C0-A21 e2e/c0-a21-control.spec.ts chromium-en
run M1 e2e/m1-a21-fresh-configured.spec.ts chromium-en
run M1b e2e/m1b-a21-fresh-configured-api-ui.spec.ts chromium-ar
run M2 e2e/m2-a21-fresh-enabled.spec.ts chromium-en
run C0-A20 e2e/c0-a20-control.spec.ts chromium-ar
run M4 e2e/m4-a20-switch-not-keyboard.spec.ts chromium-ar
run M3 e2e/m3-a12-scope-leak.spec.ts chromium-en
exit 0
