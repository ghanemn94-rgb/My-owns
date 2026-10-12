#!/usr/bin/env bash
# code-security-reviewer DG4 round 7: runs ONE worker-side probe in the disposable clone $TMPDIR/probe2 (ea5e262; product
# tree == dab4562; built with pnpm -r build), its own disposable PostgreSQL (with-pg.sh). Usage: run-worker-probe.sh <probe> <port> <log> <node-bin-dir>
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-7
P=$1; PORT=$2; NAME=$3; NB=${4:-/opt/node22/bin}
cd $TMPDIR/probe2 || exit 2; export PATH=$NB:$PATH; unset LANG LC_ALL LC_CTYPE
export SECR7_PRELOAD=${SECR7_PRELOAD:-$EV/probes/sec-dg4-r7-preload.mjs}
mkdir -p apps/worker/test/integration/zz-sec; f=$(basename $P); cp $P apps/worker/test/integration/zz-sec/$f
log=$EV/$NAME.log
{ echo "# probe $f; node $(node --version); commit $(git rev-parse HEAD); LANG unset; $(sha256sum $P | cut -c1-64); preload $(sha256sum $SECR7_PRELOAD | cut -c1-16); load $(cut -d' ' -f1-3 /proc/loadavg); started $(date -u +%FT%TZ)"
  bash $EV/with-pg.sh $PORT pnpm exec vitest run --project integration --reporter=verbose apps/worker/test/integration/zz-sec/$f; echo "# exit_status: $?  finished: $(date -u +%FT%TZ)"; } > $log 2>&1
rm -r apps/worker/test/integration/zz-sec
tail -1 $log
