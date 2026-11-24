#!/usr/bin/env bash
# qa-verifier DG7 round 3: A27 / REQ-DLV-030 "the reconcile report flags a review whose candidate no longer matches",
# on THIS branch, in a disposable shared sparse clone at the round-3 freeze commit 557a95133 (freeze + assignments).
# Steps: (a) reconcile as frozen (round-3 records not yet written -> "missing (STALE ...)"); (b) a SYNTHETIC test
# record (a copy of no real review: only the fields reconcile reads) for qa-verifier on candidate cf1fb7d5 ->
# "(current)"; (c) one candidate source byte changed -> working tree "differs" and the same record "(STALE for current
# content)"; (d) pipeline and stage validation must not show any approval. The clone is deleted afterwards.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
M=/home/user/My-owns; C="$TMPDIR/k10b"; H=557a95133f4825e77d930500c1298df17549029e  # round-3 freeze commit (no round-3 review record yet)
rm -rf "$C"; git clone -q --shared --no-checkout "$M" "$C" && cd "$C" && \
  git sparse-checkout set --no-cone '/*' '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '!/docs/delivery/runs/' '!/trading_agent/' && \
  git checkout -q "$H" || exit 2
echo "clone HEAD $(git rev-parse HEAD)"
echo "## (a) reconcile at the frozen round-3 state"; node tools/gates/validate.mjs --reconcile | tail -8; echo "exit=${PIPESTATUS[0]}"
R=docs/delivery/reviews/DG7/round-3/qa-verifier.json; mkdir -p "$(dirname "$R")"
printf '{"candidate_id":"sha256:cf1fb7d59a04e2f0d18a7773eca4e10893b72f3119a70d0e74796c8a8437a541","verdict":"PASS","note":"SYNTHETIC drill fixture in a disposable clone, not a review"}\n' > "$R"
echo "## (b) synthetic record on the frozen candidate"; node tools/gates/validate.mjs --reconcile | tail -8; echo "exit=${PIPESTATUS[0]}"
printf '\n// qa A27 drill byte\n' >> apps/api/src/server.ts
echo "## (c) one candidate source file changed"; node tools/gates/validate.mjs --reconcile | tail -8; echo "exit=${PIPESTATUS[0]}"
echo "## (d) DG7 stage validation must FAIL (no approval without real records and a gate record)"; node tools/gates/validate.mjs --stage DG7 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
cd /; rm -rf "$C"; echo "clone removed"
