#!/bin/bash
# F-DG7-963 re-run of the full harness file under a disposable PostgreSQL (with-pg.sh), as prefreeze-r3 ran it. The first
# run in 31-f963-drill-cleanup.log (A) was started without with-pg.sh by my error: its 24 failures are DB-dependent suites.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
export QA_PG_PORT=32440 MTH_PORT_POOL=32441-32460
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-3
cd $TMPDIR/rv
{
echo "# $(date -u +%FT%TZ) with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"
tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs 2>&1 | grep -E "^not ok|✖|ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)|BLOCKED|T-DG7-DO-D8 real|qa disposable|Error" | head -60; echo "exit=${PIPESTATUS[0]}"
echo "== leftover postgres processes (none expected)"; ps -eo pid,args | grep "[p]ostgres -D" | grep -c "$TMPDIR"
echo "== git status"; git status --short | head
echo "# end $(date -u +%FT%TZ)"
} > $E/31b-f963-harness-with-pg.log 2>&1
