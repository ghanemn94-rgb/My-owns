#!/usr/bin/env bash
# qa-verifier DG7 round 4: run the independent split-phase tests in the disposable clone: a temporary copy in
# deploy/scripts/tests/, a disposable PostgreSQL (with-pg.sh) each, then the copy is removed.
#  82: round-3 test (it FAILED on cf1fb7d5 and reproduced F-DG7-1081), unchanged;
#  83: round-4 test (F-DG7-1081 refusals and F-DG7-1082 owner/modes, negative owner cases).
set -u
. "$(dirname "$0")/env.sh"
T3=qa-dg7-rg3-backup-split-phase-config.test.mjs
T4=qa-dg7-rg4-backup-split-phase-and-owner.test.mjs
for spec in "82-split-phase-config:$T3:32560" "83-split-phase-and-owner:$T4:32561"; do
  IFS=: read -r n t port <<<"$spec"
  cp "/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/tests/$t" "$C/deploy/scripts/tests/$t"
  QA_PG_PORT=$port bash "$S/run.sh" "$n" bash tests/qa/support/with-pg.sh node --test "deploy/scripts/tests/$t"
  rc=$?
  rm -f "$C/deploy/scripts/tests/$t"; echo "copy removed: $([ -e "$C/deploy/scripts/tests/$t" ] && echo NO || echo yes); test exit=$rc" >> "$E/$n.log"
done
