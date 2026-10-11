#!/usr/bin/env bash
# domain-reviewer DG4 round 1: inside ONE disposable stack (with-stack.sh) run dom-api.mjs then dom-ui.mjs. Probes are copied
# to rv/ in the disposable clone so @playwright/test resolves from the clone's node_modules. Output: <name>.log here.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/domain/round-1
cd "$TMPDIR/review-dom"; mkdir -p rv; cp "$E"/dom-*.mjs rv/
export OUT=$TMPDIR/out SHOTS=$E/screens PLAYBOOK=$TMPDIR/review-dom/docs/source/playbook.md; mkdir -p "$OUT" "$SHOTS"
rc=0
for p in ${PROBES:-dom-api dom-ui}; do
  L=${p}${LOGSUFFIX:-}
  { echo "### $(node -v) rv/$p.mjs (clone at $(git rev-parse --short HEAD))"; node rv/$p.mjs; s=$?; echo "### $p exit=$s"; } > "$E/$L.log" 2>&1
  tail -n 2 "$E/$L.log"; grep -q "exit=0$" <(tail -n 1 "$E/$L.log") || rc=1
done
exit $rc
