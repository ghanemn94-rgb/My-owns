#!/usr/bin/env bash
# F-DG2-143 extra data point: heavier load. In $TMPDIR/review-probe, a `pnpm -r build` loop AND the full integration
# suite (disposable PostgreSQL, port 55494) run concurrently while `pnpm test --reporter=verbose` (Node 22) runs in
# $TMPDIR/review-sec at 9e13947e.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG2/code-security/round-3
N22=/opt/node22/bin; STOP=$TMPDIR/stop-load2; rm -f $STOP
( cd $TMPDIR/review-probe; while [ ! -f $STOP ]; do PATH=$N22:$PATH pnpm -r build >/dev/null 2>&1; done ) & B=$!
( cd $TMPDIR/review-probe; PATH=$N22:$PATH $TMPDIR/bin/with-pg.sh 55494 pnpm test:integration >/dev/null 2>&1 ) & I=$!
sleep 25
name=unit-under-heavy-load-node22
{ echo "# command: pnpm test --reporter=verbose   (under heavier concurrent load, see load-repro-heavy.sh)"; echo "# node: $(PATH=$N22:$PATH node --version)  commit: $(cd $TMPDIR/review-sec; git rev-parse HEAD)  started: $(date -u +%FT%TZ)  loadavg: $(cat /proc/loadavg)"; } > $EV/$name.log
(cd $TMPDIR/review-sec; PATH=$N22:$PATH pnpm test --reporter=verbose) >> $EV/$name.log 2>&1; rc=$?
echo "# exit_status: $rc  finished: $(date -u +%FT%TZ)  loadavg: $(cat /proc/loadavg)" >> $EV/$name.log
touch $STOP; wait $B; wait $I
