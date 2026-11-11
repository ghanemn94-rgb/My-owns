#!/bin/bash
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-7
cd $TMPDIR/rv
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), git status lines $(git status --short | wc -l), load $(cut -d' ' -f1-3 /proc/loadavg), mem avail $(free -m | awk '/Mem:/{print $7}') MiB)"; }
( export PATH=/opt/node22/bin:$PATH; unset LANG LC_ALL
  { hdr "Node 22 re-run ALONE of the 5 unit-web files that failed in 10-unit-node22.log"; npx vitest run --project unit-web src/pages/raid/raid.test.tsx src/pages/meetings/governance.test.tsx src/pages/dashboards/kpiUnit.test.tsx src/components/form-framework/extension-hosts-twelve.test.tsx src/pages/prioritization/prioritization.test.tsx 2>&1 | grep -v "^ *✓"; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ)"; } > $E/10b-unit-node22-five-files-rerun.log 2>&1 )
( export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH; unset LANG LC_ALL
  { hdr "Node 24 re-run ALONE of the unit-node project (11-unit-node24.log had 1 vitest RPC timeout, onTaskUpdate)"; npx vitest run --project unit-node 2>&1 | grep -v "^ *✓"; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ)"; } > $E/11b-unit-node24-unit-node-rerun.log 2>&1
  { hdr "pnpm -r --workspace-concurrency=1 typecheck (re-run; 04-typecheck.log was OOM-killed, exit 137)"; pnpm -r --workspace-concurrency=1 typecheck 2>&1 | tail -30; echo "exit=${PIPESTATUS[0]}"; } > $E/04b-typecheck-rerun-serial.log 2>&1
  { hdr "pnpm lint (re-run; 05-lint.log failed with ENOENT on my own sweep probe file removed while lint ran)"; pnpm lint 2>&1 | tail -30; echo "exit=${PIPESTATUS[0]}"; } > $E/05b-lint-rerun.log 2>&1 )
echo RERUNS-DONE
