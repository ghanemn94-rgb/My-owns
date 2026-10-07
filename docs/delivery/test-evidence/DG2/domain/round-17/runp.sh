#!/usr/bin/env bash
# domain-reviewer DG2 round 17: run probes (rv/<name>.mjs inside the disposable clone) against the stack started by
# with-stack*.sh; each probe's output goes to <log-name>.log in this evidence directory. Usage: runp.sh name[:log] ...
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/domain/round-17
export OUT=${OUT:-$TMPDIR/shots}; mkdir -p $OUT
rc=0
for spec in "$@"; do
  p=${spec%%:*}; L=${spec#*:}; [ "$L" = "$spec" ] && L=$p
  echo "### node rv/$p.mjs -> $L.log"
  { echo "### $(node -v) rv/$p.mjs (clone at $(git rev-parse --short HEAD)) TAG=${TAG:-} TRIGGERS=${TRIGGERS:-}"; node rv/$p.mjs; s=$?; echo "### $p exit=$s"; } > $E/$L.log 2>&1
  tail -n 1 $E/$L.log; grep -q "exit=0$" <(tail -n 1 $E/$L.log) || rc=1
done
exit $rc
