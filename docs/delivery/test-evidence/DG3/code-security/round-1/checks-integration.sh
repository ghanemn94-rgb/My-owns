#!/usr/bin/env bash
# code-security-reviewer DG3 round-1: integration re-run. checks.sh invoked with-pg.sh directly, but the Write tool
# creates it without the execute bit, so both integration steps there exited 126 ("Permission denied") before any test
# ran (integration-run1-lang-unset.log / integration-run2-lang-c-utf8.log kept as evidence of that harness error).
# This script runs the same two steps with `bash with-pg.sh`, in the same clean clone $TMPDIR/review-r1 at ec45ef1.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-1
cd $TMPDIR/review-r1
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
run() { # name env-path cmd...
  local name=$1 p=$2; shift 2
  { echo "# command: $*"; echo "# node: $(PATH=$p:$PATH node --version)  commit: $(git rev-parse HEAD)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>} LC_CTYPE=${LC_CTYPE-<unset>}  started: $(date -u +%FT%TZ)"; } > $EV/$name.log
  PATH=$p:$PATH "$@" >> $EV/$name.log 2>&1; local rc=$?
  echo "# exit_status: $rc  finished: $(date -u +%FT%TZ)" >> $EV/$name.log
  echo "$name $rc" >> $EV/summary-integration.txt
}
: > $EV/summary-integration.txt
( unset LANG LC_ALL LC_CTYPE; run integration-rerun1-lang-unset $N22 bash $EV/with-pg.sh 26301 pnpm test:integration --reporter=verbose )
( unset LC_ALL LC_CTYPE; export LANG=C.UTF-8; run integration-rerun2-lang-c-utf8 $N24 bash $EV/with-pg.sh 26302 pnpm test:integration --reporter=verbose )
echo DONE >> $EV/summary-integration.txt
