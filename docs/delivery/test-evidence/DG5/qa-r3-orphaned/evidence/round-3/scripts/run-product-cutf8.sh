#!/usr/bin/env bash
# qa-verifier DG5 r3: the product journeys (apps/web/e2e) on the production-initialized stack, LANG=LC_ALL=C.UTF-8.
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3/scripts
bash $S/run-e2e.sh cutf8 prod 26628 26629 product apps/web/e2e
