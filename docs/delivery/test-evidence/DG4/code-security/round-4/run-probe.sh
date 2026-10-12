#!/usr/bin/env bash
# code-security-reviewer DG4 round 4: runs ONE probe file in the disposable probe clone $TMPDIR/probe (afba46f; product
# tree == ccc37c9), Node 22, LANG/LC_* unset, its own disposable PostgreSQL (with-pg.sh). Usage: run-probe.sh <probe-path> <port> <log-name>
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-4
P=$1; PORT=$2; NAME=$3
cd $TMPDIR/probe || exit 2; export PATH=/opt/node22/bin:$PATH; unset LANG LC_ALL LC_CTYPE
mkdir -p apps/api/test/integration/zz-sec-dg4; f=$(basename $P); cp $P apps/api/test/integration/zz-sec-dg4/$f
log=$EV/$NAME.log
{ echo "# probe $f; node $(node --version); commit $(git rev-parse HEAD); LANG unset; $(sha256sum $P | cut -c1-64); started $(date -u +%FT%TZ)"
  bash $EV/with-pg.sh $PORT pnpm exec vitest run --project integration apps/api/test/integration/zz-sec-dg4/$f; echo "# exit_status: $?  finished: $(date -u +%FT%TZ)"; } > $log 2>&1
rm apps/api/test/integration/zz-sec-dg4/$f
tail -1 $log
