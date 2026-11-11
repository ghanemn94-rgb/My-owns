#!/bin/bash
S=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5/scripts
$S/probes.sh
$S/run.sh 03-static-typecheck node24 pnpm -r typecheck
$S/run.sh 03-static-lint node24 pnpm lint
$S/run.sh 03-static-openapi node24 pnpm openapi:lint
$S/run.sh 03-static-nocdn node24 pnpm check:no-cdn
$S/run.sh 03-static-format node24 pnpm format:check
$S/run.sh 03-static-contrast node24 pnpm --filter @mth/design-tokens run check:contrast
$S/run.sh 04-unit-node22-unset node22 env -u LANG -u LC_ALL -u LC_CTYPE pnpm test
$S/run.sh 04-unit-node22-cutf8 node22 env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test
$S/run.sh 04-unit-node24-unset node24 env -u LANG -u LC_ALL -u LC_CTYPE pnpm test
$S/run.sh 04-unit-node24-cutf8 node24 env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test
echo SEQA1-DONE
