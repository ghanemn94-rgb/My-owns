#!/usr/bin/env bash
# qa-verifier DG7 round 3: run one named step in the disposable clone and record its log and exit status.
#   run.sh <name> <command...>    Log: $E/<name>.log, exit status: $E/<name>.rc. Clone: $QA_CLONE, default $TMPDIR/rv (both at 3e8f5bce2).
set -u
. "$(dirname "$0")/env.sh"
N="$1"; shift
cd "${QA_CLONE:-$C}" || exit 99
{
  echo "### $N start clone $(pwd) $(date -u +%FT%TZ) node $(node -v) HEAD $(git rev-parse HEAD) LANG=${LANG-unset} LC_ALL=${LC_ALL-unset} free=$(df -Pm "$TMPDIR" | awk 'NR==2{print $4}')MB"
  echo "### \$ $*"
} > "$E/$N.log"
"$@" >> "$E/$N.log" 2>&1
rc=$?
echo "### $N end $(date -u +%FT%TZ) exit=$rc free=$(df -Pm "$TMPDIR" | awk 'NR==2{print $4}')MB" >> "$E/$N.log"
echo "$rc" > "$E/$N.rc"
exit $rc
