#!/usr/bin/env bash
# Orchestrator pre-freeze integration check: every check shipped in the candidate must pass before it is frozen.
#   tools/gates/prefreeze.sh DG0
#
# Checks that execute candidate code (tests, analysis scripts, extraction) run against the COMMITTED HEAD in a fresh
# clone inside the OS sandbox (tools/gates/sandbox-run.sh): the orchestrator never executes agent-writable code, or
# imports from agent-writable paths, outside a sandbox (F-DG0-140, F-DG0-229). The final check proves the working tree
# equals HEAD, so what was checked is exactly what gets frozen. Later stages add their build, lint and test commands
# to the sandboxed list.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd /
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
SBX=("$REPO_ROOT/tools/gates/sandbox-run.sh" HEAD --)
run "source extraction reproducible (sandboxed)" "${SBX[@]}" tools/source/check_extraction.sh
run "gate validator + guard tests (sandboxed)" "${SBX[@]}" bash -c 'node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs'
run "runner metadata + settings tests (sandboxed)" "${SBX[@]}" python3 -m unittest discover -s tools/agents/tests -p 'test_*.py'
run "register rules ($STAGE) (sandboxed)" "${SBX[@]}" node tools/gates/validate.mjs --register "$STAGE"
# The register and coverage matrix must equal what the merge script produces from the analyst part files: no hand edits.
run "register equals the merge of docs/analysis/parts (sandboxed)" "${SBX[@]}" bash -c \
  'python3 -I -B tools/source/merge_register.py && git diff --exit-code --stat -- docs/delivery/requirements.csv docs/analysis/master-prompt-coverage.csv && echo "register and coverage equal the merge output"'
run "pipeline state (sandboxed)" "${SBX[@]}" node tools/gates/validate.mjs --pipeline
for script in $(git -C "$REPO_ROOT" ls-tree --name-only HEAD docs/analysis/tools/ 2>/dev/null | grep '\.py$'); do
  run "analysis check $(basename "$script") (sandboxed)" "${SBX[@]}" python3 -I -B "$script"
done
# Same definition as the candidate itself (F-DG0-131): the working-tree candidate must equal HEAD's. Only trusted,
# agent-protected gate code (tools/gates) runs here, from a neutral directory.
wt="$(node "$REPO_ROOT/tools/gates/candidate.mjs" --stage "$STAGE" | python3 -I -B -c 'import json,sys;print(json.load(sys.stdin)["candidate_id"])')"
hd="$(node "$REPO_ROOT/tools/gates/candidate.mjs" --stage "$STAGE" --ref HEAD | python3 -I -B -c 'import json,sys;print(json.load(sys.stdin)["candidate_id"])')"
if [ -n "$wt" ] && [ "$wt" = "$hd" ]; then
  echo "PASS  working-tree candidate equals HEAD ($hd)"
else
  echo "FAIL  working-tree candidate ($wt) differs from HEAD ($hd): uncommitted or untracked candidate changes"; fail=1
fi
exit $fail
