#!/bin/bash
# pnpm test on Node $1 (path)
set -u
export PATH=$1:$PATH
N=$2
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-7
cd $TMPDIR/rv
{ echo "# $(date -u +%FT%TZ) pnpm test (Node $(node -v), LANG=${LANG:-<unset>} LC_ALL=${LC_ALL:-<unset>}, cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), git status lines $(git status --short | wc -l), load $(cut -d' ' -f1-3 /proc/loadavg))"
  pnpm test 2>&1 | grep -v "^ *✓" ; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"; } > $E/$N
