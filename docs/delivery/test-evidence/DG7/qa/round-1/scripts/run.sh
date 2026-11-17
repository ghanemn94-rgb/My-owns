#!/usr/bin/env bash
# qa-verifier DG7 round 1: run one named step in the disposable clone and record its log and exit status.
#   run.sh <name> <command...>
# Log: $E/<name>.log, exit status: $E/<name>.rc. Clone: $TMPDIR/rv at ddf42ccd2 (sparse: no docs/delivery/{runs,handbacks,test-evidence}).
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-1
N="$1"; shift
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
cd "$TMPDIR/rv" || exit 99
{
  echo "### $N start $(date -u +%FT%TZ) node $(node -v) HEAD $(git rev-parse HEAD) LANG=${LANG-unset} LC_ALL=${LC_ALL-unset}"
  echo "### \$ $*"
} > "$E/$N.log"
"$@" >> "$E/$N.log" 2>&1
rc=$?
echo "### $N end $(date -u +%FT%TZ) exit=$rc" >> "$E/$N.log"
echo "$rc" > "$E/$N.rc"
exit $rc
