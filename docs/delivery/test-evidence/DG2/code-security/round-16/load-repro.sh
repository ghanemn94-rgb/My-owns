#!/usr/bin/env bash
# code-security-reviewer DG2 round-16 (T-DG2-REV-SEC-R16): `pnpm test --reporter=verbose` in $TMPDIR/review-r16 (f4242ae)
# on Node 22 then Node 24, while the probe clone ($TMPDIR/r16p, same commit + the probe files) repeatedly runs
# `pnpm -r build` and the commit-time-auth integration test against a disposable PostgreSQL (port 30291) as concurrent
# CPU load. Load output is discarded (load only). 4 vCPU.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG2/code-security/round-16
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
STOP=$TMPDIR/stop-load; rm -f $STOP
( cd $TMPDIR/r16p; i=0
  while [ ! -f $STOP ]; do i=$((i+1))
    echo "load iter $i build $(date -u +%T) loadavg $(cut -d' ' -f1-3 /proc/loadavg)"; PATH=$N22:$PATH pnpm -r build >/dev/null 2>&1
    [ -f $STOP ] && break
    echo "load iter $i integration $(date -u +%T) loadavg $(cut -d' ' -f1-3 /proc/loadavg)"; PATH=$N22:$PATH $TMPDIR/bin/with-pg.sh 30291 pnpm vitest run --project integration apps/api/test/integration/commit-time-auth.test.ts >/dev/null 2>&1
  done ) > $EV/load-generator.log 2>&1 &
LP=$!
sleep 20
for v in 22 24; do
  eval P=\$N$v; name=unit-under-load-node$v
  { echo "# command: pnpm test --reporter=verbose   (under concurrent load, see load-repro.sh)"; echo "# node: $(PATH=$P:$PATH node --version)  commit: $(cd $TMPDIR/review-r16; git rev-parse HEAD)  started: $(date -u +%FT%TZ)  loadavg: $(cat /proc/loadavg)"; } > $EV/$name.log
  (cd $TMPDIR/review-r16; PATH=$P:$PATH pnpm test --reporter=verbose) >> $EV/$name.log 2>&1; rc=$?
  echo "# exit_status: $rc  finished: $(date -u +%FT%TZ)  loadavg: $(cat /proc/loadavg)" >> $EV/$name.log
done
touch $STOP; wait $LP; echo "load generator stopped $(date -u +%T)" >> $EV/load-generator.log
