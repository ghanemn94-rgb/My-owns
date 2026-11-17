#!/usr/bin/env bash
# qa-verifier DG7 round 1, sequence A: build, static checks and unit tests in the disposable clone.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-1/scripts
R="bash $S/run.sh"
$R 10-build pnpm build
$R 11-static-typecheck pnpm -r typecheck
$R 12-static-lint pnpm lint
$R 13-static-openapi-lint pnpm openapi:lint
$R 14-static-no-cdn pnpm check:no-cdn
$R 15-static-deps-verify pnpm deps:verify
# 10:15Z: deps:verify needs live registry access (npm view; D-057) and hung in this offline sandbox; the remaining
# steps (prettier, unit x3) were moved to seqA2.sh, so this sequence ends here.
exit 0
