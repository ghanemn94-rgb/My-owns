#!/usr/bin/env bash
# code-security-reviewer DG4 round 7: re-run apps/web/src/pages/raid/raid.test.tsx ALONE (the 2 tests that failed in
# unit-node22.log), 5x on Node 22 and 5x on Node 24, in the disposable clone $TMPDIR/probe2 (ea5e262, writable
# node_modules), with DEBUG_PRINT_LIMIT=300000 so a failure prints the whole DOM. The other reviewers run concurrently,
# so the machine load stays high (logged per run). Usage: raid-alone.sh <tag>
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-7; TAG=${1:-a}
cd $TMPDIR/probe2 || exit 2
for n in 1 2 3 4 5; do for v in /opt/node22/bin /opt/nvm/versions/node/v24.21.0/bin; do
  log=$EV/raid-alone-$TAG-$n-$(basename $(dirname $v)).log
  { echo "# run $n, node $(PATH=$v:$PATH node -v), commit $(git rev-parse --short HEAD), load $(cut -d' ' -f1-3 /proc/loadavg), started $(date -u +%FT%TZ)"
    DEBUG_PRINT_LIMIT=300000 PATH=$v:$PATH pnpm exec vitest run --project unit-web apps/web/src/pages/raid/raid.test.tsx; echo "# exit_status: $?  load $(cut -d' ' -f1-3 /proc/loadavg)  finished $(date -u +%FT%TZ)"; } > $log 2>&1
  echo "$(basename $log) $(grep -aE '^\s+Tests\s' $log | tr -s ' ') $(tail -1 $log)"
done; done
