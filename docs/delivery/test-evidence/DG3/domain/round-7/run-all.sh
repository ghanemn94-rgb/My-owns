#!/usr/bin/env bash
# domain-reviewer DG3 round 7: inside ONE disposable stack (with-stack.sh) run the API probe, the supplementary API probe,
# the UI-world setup and the UI probe, in that order. Probes are copied to rv/ in the disposable clone so that
# @playwright/test resolves from the clone's node_modules. Each probe's output goes to <name>.log in this directory.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG3/domain/round-7
cd "$TMPDIR/review-dom7"; mkdir -p rv; cp "$E"/dg3-*.mjs rv/
export OUT=$TMPDIR/out SHOTS=$E/screens; mkdir -p "$OUT" "$SHOTS"
rc=0
for p in ${PROBES:-dg3-api dg3-api-extra dg3-ui-world dg3-ui dg3-ui-inherited}; do
  L=${p}${LOGSUFFIX:-}
  { echo "### $(node -v) rv/$p.mjs (clone at $(git rev-parse --short HEAD))"; node rv/$p.mjs; s=$?; echo "### $p exit=$s"; } > "$E/$L.log" 2>&1
  tail -n 2 "$E/$L.log"; grep -q "exit=0$" <(tail -n 1 "$E/$L.log") || rc=1
done
exit $rc
