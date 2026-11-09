#!/usr/bin/env bash
# qa-verifier DG6 round 10 runner. usage: run.sh <label> <node:24|22> <locale:unset|C.UTF-8> -- <command...>
# Runs <command> in the disposable clone $TMPDIR/c and writes the log to the round-10 evidence folder.
set -u
# Guard (added during the run, D-028 task limit): a label listed in $TMPDIR/skip-labels is skipped unless FORCE=1, so a
# long chained pipeline never crosses the 2-hour task limit; each skipped run is started later as its own task.
grep -qxF -- "$1" "${TMPDIR}/skip-labels" 2>/dev/null && [ -z "${FORCE:-}${FORCE31:-}" ] && exit 0
label=$1; nv=$2; loc=$3; shift 4
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-10
if [ "$nv" = 22 ]; then export PATH=/opt/node22/bin:$PATH; else export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH; fi
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
if [ "$loc" = unset ]; then unset LANG LC_ALL; else export LANG=$loc LC_ALL=$loc; fi
cd ${CLONE:-$TMPDIR/c}
{ echo "## $(date -u +%FT%TZ) node $(node -v) LANG=${LANG-unset} LC_ALL=${LC_ALL-unset} load $(cut -d' ' -f1-3 /proc/loadavg)"
  echo "## cmd: $*"
  bash -c "$*"; s=$?
  echo "exit=$s"; echo "## end $(date -u +%FT%TZ)"; } > $E/$label.log 2>&1
tail -3 $E/$label.log
