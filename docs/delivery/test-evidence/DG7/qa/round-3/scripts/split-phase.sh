#!/usr/bin/env bash
# qa-verifier DG7 round 3: run the independent split-phase test (docs/delivery/test-evidence/DG7/qa/tests/
# qa-dg7-rg3-backup-split-phase-config.test.mjs) in the disposable clone: a temporary copy in deploy/scripts/tests/,
# a disposable PostgreSQL (with-pg.sh), then the copy is removed.
set -u
. "$(dirname "$0")/env.sh"
T="$C/deploy/scripts/tests/qa-dg7-rg3-backup-split-phase-config.test.mjs"
cp /home/user/My-owns/docs/delivery/test-evidence/DG7/qa/tests/qa-dg7-rg3-backup-split-phase-config.test.mjs "$T"
QA_PG_PORT=32560 bash "$S/run.sh" 82-split-phase-config bash tests/qa/support/with-pg.sh node --test deploy/scripts/tests/qa-dg7-rg3-backup-split-phase-config.test.mjs
rc=$?
rm -f "$T"; echo "copy removed: $([ -e "$T" ] && echo NO || echo yes); test exit=$rc" >> "$E/82-split-phase-config.log"
