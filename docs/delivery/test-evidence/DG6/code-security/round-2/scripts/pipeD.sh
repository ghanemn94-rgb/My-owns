#!/bin/bash
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-2
until [ -f $TMPDIR/pipeC-done ]; do sleep 10; done
cd $TMPDIR/rv
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
{ echo "# $(date -u +%FT%TZ) npx vitest run --project unit-node --maxWorkers=2 (Node $(node -v), LANG=${LANG:-<unset>}, \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), re-run after the worker RPC timeout of 11-unit-node24.log; load $(cut -d' ' -f1-3 /proc/loadavg))"; npx vitest run --project unit-node --maxWorkers=2 2>&1 | grep -v "^ *✓"; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"; } > $E/11b-unit-node-project-node24-maxworkers2.log
$TMPDIR/scripts/e2e2.sh
echo done > $TMPDIR/pipeD-done
