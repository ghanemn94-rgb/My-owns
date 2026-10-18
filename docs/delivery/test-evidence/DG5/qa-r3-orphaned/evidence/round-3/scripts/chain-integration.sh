#!/usr/bin/env bash
# qa-verifier DG5 r3: integration twice, tests/qa alone, the export/provisional probe (round-2 probe, unchanged; samples
# for REQ-DLV-037), and the UUIDv7 order reproduction of F-DG5-143. Ports 26660-26699.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3/scripts; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
echo "== uuid probe"; { echo "\$ QA_PG_PORT=26690 MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh bash scripts/uuid-order-probe.sh ($(date -u +%FT%TZ))"; cd $TMPDIR/rev && QA_PG_PORT=26690 MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh bash $S/uuid-order-probe.sh 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"; echo "EXIT ${PIPESTATUS[0]}"; } > $E/05-uuid-order-probe.log 2>&1; tail -4 $E/05-uuid-order-probe.log
echo "== run1"; bash $S/run-integration.sh run1 26660
echo "== run2"; bash $S/run-integration.sh run2 26670
echo "== tests/qa alone"; bash $S/run-integration.sh testsqa 26680 tests/qa
echo "== packs probe"; bash $S/run-probe-integration.sh run1
