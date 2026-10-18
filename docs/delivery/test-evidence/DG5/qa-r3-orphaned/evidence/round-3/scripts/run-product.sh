#!/usr/bin/env bash
# qa-verifier DG5 r3: the product journeys (apps/web/e2e) on the production-initialized stack, locale unset.
# (The C.UTF-8 run is run-product-cutf8.sh, started in parallel; a queued call of this script with "cutf8" is a no-op.)
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3/scripts
if [ "$1" = unset ]; then bash $S/run-e2e.sh unset prod 26622 26623 product apps/web/e2e; else echo "no-op (see run-product-cutf8.sh)"; fi
