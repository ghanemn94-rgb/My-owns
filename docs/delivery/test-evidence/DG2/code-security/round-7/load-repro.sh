#!/usr/bin/env bash
# code-security-reviewer DG2 round-7 (T-DG2-REV-SEC-R7): `pnpm test --reporter=verbose` in $TMPDIR/rev (90439483) on
# Node 22 then Node 24, while the probe clone ($TMPDIR/probe, same commit) repeatedly runs `pnpm -r build` and the
# round-7 integration probes against a disposable PostgreSQL (port 55781) as CPU load. Probe output is discarded (load
# only; the probes include designed failures). 4 vCPU host.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG2/code-security/round-7
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
STOP=$TMPDIR/stop-load; rm -f $STOP
( cd $TMPDIR/probe; i=0
  while [ ! -f $STOP ]; do i=$((i+1))
    echo "load iter $i build $(date -u +%T) loadavg $(cut -d' ' -f1-3 /proc/loadavg)"; PATH=$N22:$PATH pnpm -r build >/dev/null 2>&1
    [ -f $STOP ] && break
    echo "load iter $i probes $(date -u +%T) loadavg $(cut -d' ' -f1-3 /proc/loadavg)"; PATH=$N22:$PATH $TMPDIR/bin/with-pg.sh 55781 pnpm vitest run --project integration apps/api/test/integration/zz-sec-r7-probe.test.ts apps/api/test/integration/zz-sec-r6-surrogate.test.ts >/dev/null 2>&1
  done ) > $EV/load-generator.log 2>&1 &
LP=$!
sleep 20
for v in 22 24; do
  eval P=\$N$v; name=unit-under-load-node$v
  { echo "# command: pnpm test --reporter=verbose   (under concurrent load, see load-repro.sh)"; echo "# node: $(PATH=$P:$PATH node --version)  commit: $(cd $TMPDIR/rev; git rev-parse HEAD)  started: $(date -u +%FT%TZ)  loadavg: $(cat /proc/loadavg)"; } > $EV/$name.log
  (cd $TMPDIR/rev; PATH=$P:$PATH pnpm test --reporter=verbose) >> $EV/$name.log 2>&1; rc=$?
  echo "# exit_status: $rc  finished: $(date -u +%FT%TZ)  loadavg: $(cat /proc/loadavg)" >> $EV/$name.log
done
touch $STOP; wait $LP; echo "load generator stopped $(date -u +%T)" >> $EV/load-generator.log
