#!/usr/bin/env bash
# Orchestrator pre-freeze integration check: every check shipped in the candidate must pass before it is frozen.
#   tools/gates/prefreeze.sh DG0
# Later stages extend this with the product build, lint, typecheck and test commands.
set -uo pipefail
cd "$(dirname "$0")/../.."
STAGE="${1:?usage: prefreeze.sh DGx}"
fail=0
run() {
  local label="$1"; shift
  if out="$("$@" 2>&1)"; then
    echo "PASS  $label :: $(printf '%s' "$out" | tail -n 1)"
  else
    echo "FAIL  $label"; printf '%s\n' "$out" | tail -n 15 | sed 's/^/      /'; fail=1
  fi
}
run "source extraction reproducible" tools/source/check_extraction.sh
run "gate validator + guard tests" node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs
run "runner metadata tests" python3 -m unittest discover -s tools/agents/tests -p 'test_*.py'
run "register rules ($STAGE)" node tools/gates/validate.mjs --register "$STAGE"
run "pipeline state" node tools/gates/validate.mjs --pipeline
for script in docs/analysis/tools/*.py; do
  [ -f "$script" ] && run "analysis check $(basename "$script")" python3 "$script"
done
dirty="$(git status --porcelain -- . ':(exclude)docs/delivery' ':(exclude)trading_agent' | grep -v '^??' || true)"
if [ -n "$dirty" ]; then echo "FAIL  uncommitted candidate changes:"; echo "$dirty" | sed 's/^/      /'; fail=1; else echo "PASS  no uncommitted candidate changes"; fi
exit $fail
