#!/bin/bash
# integration suite, Node 22; $1 = locale tag (unset|cutf8), $2 = shard (k/n), $3 = pg port
if [ "$1" = cutf8 ] && [ ! -f $TMPDIR/allow-cutf8 ]; then echo "# $(date -u +%FT%TZ) skipped: the C.UTF-8 run is started by pipeE (fresh 2 h task cap)" >> $TMPDIR/skipped-cutf8.txt; exit 0; fi
set -u
export PATH=/opt/node22/bin:$PATH
unset LANG LC_ALL
[ "$1" = cutf8 ] && export LANG=C.UTF-8
export QA_PG_PORT=$3 MTH_PORT_POOL=32651-32699
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-2
cd $TMPDIR/rv
S=$(echo $2 | tr / o)
L=$E/1$([ "$1" = cutf8 ] && echo 3 || echo 2)-integration-lang-$1-shard$S.log
{ echo "# $(date -u +%FT%TZ) tests/qa/support/with-pg.sh pnpm test:integration --shard=$2 (Node $(node -v), LANG=${LANG:-<unset>} LC_ALL=${LC_ALL:-<unset>}, cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), git status lines $(git status --short | wc -l), load $(cut -d' ' -f1-3 /proc/loadavg))"
  tests/qa/support/with-pg.sh pnpm test:integration --shard=$2 2>&1 | grep -v "^ *✓"; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"; df -h $TMPDIR | tail -1; } > $L
