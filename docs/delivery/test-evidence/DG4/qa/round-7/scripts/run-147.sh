#!/usr/bin/env bash
# qa-verifier DG4 round 7 (F-DG4-147 verification), in the disposable copy $TMPDIR/rv3:
#  (1) delayed-boot-/me probes (gen-147-probes.py): old (1e0dc5d) and fixed (candidate) x delay 1.5 s / 4 s, 'a 403' test only,
#      --repeat-each=3, chromium-en + chromium-ar. Expected: old fails (Expected 403 / Received 200), fixed passes.
#  (2) contention: the candidate's 'a 403 is not a session end' x10 per project, under the concurrent-review load.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7/scripts; T=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests/round-7/e2e
CLONE=$TMPDIR/rv3 EXTRA_DEST=apps/web/e2e EXTRA="$T/zz-qa-r7-147-old-d1500.spec.ts $T/zz-qa-r7-147-old-d4000.spec.ts $T/zz-qa-r7-147-fixed-d1500.spec.ts $T/zz-qa-r7-147-fixed-d4000.spec.ts" \
  bash $S/run-e2e.sh unset 26640 26645 f147-delayed-boot-me apps/web/e2e/zz-qa-r7-147-old-d1500.spec.ts apps/web/e2e/zz-qa-r7-147-old-d4000.spec.ts apps/web/e2e/zz-qa-r7-147-fixed-d1500.spec.ts apps/web/e2e/zz-qa-r7-147-fixed-d4000.spec.ts --grep "a 403 is not a session end" --repeat-each=3
CLONE=$TMPDIR/rv3 bash $S/run-e2e.sh unset 26650 26655 f147-contention-x10 apps/web/e2e/session-end.spec.ts --grep "a 403 is not a session end" --repeat-each=10
echo RUN147-DONE
