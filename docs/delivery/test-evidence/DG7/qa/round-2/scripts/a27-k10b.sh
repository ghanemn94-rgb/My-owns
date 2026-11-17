#!/usr/bin/env bash
# qa-verifier DG7 round 2: A27 / REQ-DLV-030 "the reconcile report flags a review whose candidate no longer matches",
# on THIS branch, in a disposable shared sparse clone at the round-2 assignment commit 1c119c031 (freeze c26f69d70 + assignments).
# Steps: (a) reconcile as frozen (round-2 records not yet written -> "missing (STALE ...)"); (b) a SYNTHETIC test
# record (a copy of no real review: only the fields reconcile reads) for qa-verifier on candidate 33266ccd ->
# "(current)"; (c) one candidate source byte changed -> working tree "differs" and the same record "(STALE for current
# content)"; (d) pipeline and stage validation must not show any approval. The clone is deleted afterwards.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
M=/home/user/My-owns; C="$TMPDIR/k10b"; H=1c119c031340108dde053083e80e6336f7c00691  # round-2 assignment commit (HEAD later carries other reviewers' auto-committed records)
rm -rf "$C"; git clone -q --shared --no-checkout "$M" "$C" && cd "$C" && \
  git sparse-checkout set --no-cone '/*' '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '!/docs/delivery/runs/' '!/trading_agent/' && \
  git checkout -q "$H" || exit 2
echo "clone HEAD $(git rev-parse HEAD)"
echo "## (a) reconcile at the frozen round-2 state"; node tools/gates/validate.mjs --reconcile | tail -8; echo "exit=${PIPESTATUS[0]}"
R=docs/delivery/reviews/DG7/round-2/qa-verifier.json; mkdir -p "$(dirname "$R")"
printf '{"candidate_id":"sha256:33266ccd9ce4ec4475de745ebacfaafbd2f25870f8be966086f4a74578b7259c","verdict":"PASS","note":"SYNTHETIC drill fixture in a disposable clone, not a review"}\n' > "$R"
echo "## (b) synthetic record on the frozen candidate"; node tools/gates/validate.mjs --reconcile | tail -8; echo "exit=${PIPESTATUS[0]}"
printf '\n// qa A27 drill byte\n' >> apps/api/src/server.ts
echo "## (c) one candidate source file changed"; node tools/gates/validate.mjs --reconcile | tail -8; echo "exit=${PIPESTATUS[0]}"
echo "## (d) DG7 stage validation must FAIL (no approval without real records and a gate record)"; node tools/gates/validate.mjs --stage DG7 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
cd /; rm -rf "$C"; echo "clone removed"
